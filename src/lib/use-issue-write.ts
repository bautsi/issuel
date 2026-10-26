import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import { getIssueStatus, IssueReadError } from '@/lib/issues'
import type { IssuePage, IssueStatus } from '@/lib/issues'
import type { IssueDetail } from '@/lib/use-issue-detail'

type Write = { title: string; body?: string; status?: IssueStatus } | { status: IssueStatus; duplicateNumber?: number }

/** Submit once, then reconcile only this user's repository caches from GitHub's accepted issue. */
export function useIssueWrite(userId: string, repositoryId: number | null, number?: number) {
  const client = useQueryClient()
  const submitting = useRef(false)
  const retryLimit = useRef<IssueReadError | null>(null)
  const mutation = useMutation({
    mutationKey: ['github', userId, repositoryId, 'write', number ?? 'create'],
    scope: { id: `github:${userId}:${repositoryId}:${number ?? 'create'}` },
    retry: false,
    networkMode: 'always',
    mutationFn: async (input: Write): Promise<IssueDetail> => {
      if (retryLimit.current && retryLimit.current.retryAt > Date.now()) throw retryLimit.current
      if (repositoryId === null) throw new IssueReadError('Choose a workspace first.', 400)
      const prefix = ['github', userId, repositoryId] as const
      await Promise.all([
        client.cancelQueries({ queryKey: [...prefix, 'issues'] }),
        ...(number === undefined ? [] : [client.cancelQueries({ queryKey: [...prefix, 'issue', number], exact: true })]),
      ])
      let response: Response
      try {
        response = await fetch(`/api/repositories/${repositoryId}/issues${number === undefined ? '' : `/${number}`}`, {
          method: number === undefined ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-Issuel-User': userId },
          body: JSON.stringify(input),
          cache: 'no-store',
        })
      } catch {
        throw new IssueReadError('The write result is unknown. Check GitHub before retrying to avoid duplicate changes.')
      }
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const messages: Record<string, string> = {
          status_mapping_conflict: 'Conflicting Open status labels must be resolved in GitHub before changing Open status.',
          reopen_before_changing_reason: 'Reopen this issue before choosing another closed reason.',
          invalid_duplicate_target: 'Choose another accessible issue number in this repository.',
          issue_not_found: 'Issue not found or no longer accessible. Pull requests are not supported here.',
          invalid_issue_write: 'Enter a title, a valid status and an accessible duplicate target when required.',
          github_write_not_applied: 'GitHub did not return the requested change. Check the issue in GitHub before retrying.',
          github_write_uncertain: 'The write result is unknown. Check GitHub before retrying to avoid duplicate changes.',
          github_write_rejected: 'GitHub rejected this change. Check the fields and duplicate target before retrying.',
          github_write_conflict: 'GitHub reported a conflict. Check the latest issue before retrying.',
        }
        const fallback: Record<number, string> = {
          401: 'Your session has expired. Connect GitHub again.',
          403: 'Writing requires repository push access and App Issues write permission. Check access in GitHub.',
          404: 'This repository no longer exists or is not accessible to your account and App.',
          429: 'GitHub rate limit reached. Please wait before retrying.',
        }
        throw new IssueReadError(
          messages[data?.error] ?? fallback[response.status] ?? 'The write result is unknown. Check GitHub before retrying to avoid duplicate changes.',
          response.status, Number(response.headers.get('Retry-After')) || 0,
        )
      }
      if (data?.userId !== userId)
        throw new IssueReadError('Your GitHub session changed. Connect GitHub again.', 401)
      if (data.repositoryId !== repositoryId || !data.issue ||
        !Number.isSafeInteger(data.issue.number) || (number !== undefined && data.issue.number !== number))
        throw new IssueReadError('The write result is unknown. Check GitHub before retrying to avoid duplicate changes.', 502)
      return data.issue
    },
    onError: (error) => {
      if (error instanceof IssueReadError && error.retryAt > Date.now()) retryLimit.current = error
    },
    onSuccess: async (issue) => {
      const prefix = ['github', userId, repositoryId] as const
      await Promise.all([
        client.cancelQueries({ queryKey: [...prefix, 'issues'] }),
        client.cancelQueries({ queryKey: [...prefix, 'issue', issue.number], exact: true }),
      ])
      // A late response after logout must not restore private data into a cleared client.
      if (!client.getQueryData(['github', userId, 'repositories'])) return
      client.setQueryData([...prefix, 'issue', issue.number], issue)
      client.setQueriesData<InfiniteData<IssuePage>>({
        queryKey: [...prefix, 'issues'],
        predicate: (query) => query.queryKey.length === 6,
      }, (data) => {
        if (!data) return data
        const first = data.pages[0]
        const matches = first.state === issue.state &&
          (first.category === null || getIssueStatus(issue).status === first.category)
        const contained = data.pages.some((page) => page.issues.some((item) => item.id === issue.id))
        return {
          ...data,
          pages: data.pages.map((page, index) => ({
            ...page,
            searchPending: page.searchPending || (page.state === 'closed' && (matches || contained)),
            issues: [
              ...(index === 0 && matches ? [issue] : []),
              ...page.issues.filter((item) => item.id !== issue.id),
            ],
          })),
        }
      })
      await client.invalidateQueries({ queryKey: [...prefix, 'issues'], refetchType: 'none' })
    },
  })

  /** Lock immediately, including the interval before React renders the pending state. */
  async function submit(input: Write) {
    if (submitting.current) return undefined
    submitting.current = true
    try { return await mutation.mutateAsync(input) }
    finally { submitting.current = false }
  }

  return { ...mutation, submit }
}
