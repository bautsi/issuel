import { useCallback, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import { getIssueStatus, IssueReadError } from '@/lib/issues'
import type { IssuePage, IssueStatus } from '@/lib/issues'
import type { CommentsPage, IssueDetail } from '@/lib/use-issue-detail'
import { requestIssueRead } from '@/lib/use-issue-detail'
import type { projectIssueComment } from '../../server/issue-detail'

type Write =
  | { title: string; body?: string; status?: IssueStatus }
  | { status: IssueStatus; duplicateNumber?: number }
  | { label: string; remove: boolean }
  | { assignee: string; remove: boolean }
  | { body: string; baseline: string }

/** Carry a freshly verified remote body separately from an ordinary or uncertain write failure. */
export class DescriptionSaveError extends IssueReadError {
  latestRemote?: string

  /** Preserve the original safe failure and rate deadline even when remote verification also fails. */
  constructor(error: unknown, latestRemote?: string) {
    super(
      error instanceof Error
        ? error.message
        : 'Description could not be saved. Your local draft is retained.',
    )
    this.latestRemote = latestRemote
    if (error instanceof IssueReadError) {
      this.status = error.status
      this.retryAt = error.retryAt
    }
  }
}

/** Serialize writes and uncertain-body verification, then reconcile only the matching account's caches. */
export function useIssueWrite(
  userId: string,
  repositoryId: number | null,
  number?: number,
) {
  const client = useQueryClient()
  const submitting = useRef(false)
  const retryLimit = useRef<IssueReadError | null>(null)
  const mutation = useMutation({
    mutationKey: ['github', userId, repositoryId, 'write', number ?? 'create'],
    scope: { id: `github:${userId}:${repositoryId}:${number ?? 'create'}` },
    retry: false,
    networkMode: 'always',
    mutationFn: async (input: Write): Promise<IssueDetail> => {
      if (retryLimit.current && retryLimit.current.retryAt > Date.now())
        throw retryLimit.current
      if (repositoryId === null)
        throw new IssueReadError('Choose a workspace first.', 400)
      const prefix = ['github', userId, repositoryId] as const
      await Promise.all([
        client.cancelQueries({ queryKey: [...prefix, 'issues'] }),
        ...(number === undefined
          ? []
          : [
              client.cancelQueries({
                queryKey: [...prefix, 'issue', number],
                exact: true,
              }),
            ]),
      ])
      try {
        let response: Response
        try {
          response = await fetch(
            `/api/repositories/${repositoryId}/issues${number === undefined ? '' : `/${number}`}`,
            {
              method: number === undefined ? 'POST' : 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'X-Issuel-User': userId,
              },
              body: JSON.stringify(input),
              cache: 'no-store',
            },
          )
        } catch {
          throw new IssueReadError(
            'The write result is unknown. Check GitHub before retrying to avoid duplicate changes.',
          )
        }
        const data = await response.json().catch(() => null)
        if (!response.ok) {
          const messages: Record<string, string> = {
            status_mapping_conflict:
              'Conflicting Open status labels must be resolved in GitHub before changing Open status.',
            reopen_before_changing_reason:
              'Reopen this issue before choosing another closed reason.',
            invalid_duplicate_target:
              'Choose another accessible issue number in this repository.',
            issue_not_found:
              'Issue not found or no longer accessible. Pull requests are not supported here.',
            invalid_issue_write:
              'Enter a title, a valid status and an accessible duplicate target when required.',
            github_write_not_applied:
              'GitHub did not return the requested change. Check the issue in GitHub before retrying.',
            github_write_uncertain:
              'The write result is unknown. Check GitHub before retrying to avoid duplicate changes.',
            github_write_rejected:
              'GitHub rejected this change. Check the fields and duplicate target before retrying.',
            github_write_conflict:
              'GitHub reported a conflict. Check the latest issue before retrying.',
            description_conflict:
              'The remote description changed. Your local draft has not been saved.',
            status_label_protected:
              'Status labels can only be changed through Status.',
            assignee_not_applied:
              'GitHub did not apply this assignee change. The user may not be assignable or the issue may have reached its assignee limit.',
          }
          const fallback: Record<number, string> = {
            401: 'Your session has expired. Connect GitHub again.',
            403: 'Writing requires repository push access and App Issues write permission. Check access in GitHub.',
            404: 'This repository no longer exists or is not accessible to your account and App.',
            429: 'GitHub rate limit reached. Please wait before retrying.',
          }
          throw new IssueReadError(
            messages[data?.error] ??
              fallback[response.status] ??
              'The write result is unknown. Check GitHub before retrying to avoid duplicate changes.',
            response.status,
            Number(response.headers.get('Retry-After')) || 0,
          )
        }
        if (!data || typeof data.userId !== 'string')
          throw new IssueReadError(
            'The write result is unknown. Check GitHub before retrying to avoid duplicate changes.',
            502,
          )
        if (data.userId !== userId)
          throw new IssueReadError(
            'Your GitHub session changed. Connect GitHub again.',
            401,
          )
        if (
          data.repositoryId !== repositoryId ||
          !data.issue ||
          !Number.isSafeInteger(data.issue.number) ||
          (number !== undefined && data.issue.number !== number)
        )
          throw new IssueReadError(
            'The write result is unknown. Check GitHub before retrying to avoid duplicate changes.',
            502,
          )
        if (
          'baseline' in input &&
          (!(data.issue.body === null || typeof data.issue.body === 'string') ||
            (data.issue.body ?? '') !== input.body)
        )
          throw new IssueReadError(
            'The write result is unknown. Check GitHub before retrying to avoid duplicate changes.',
            502,
          )
        return data.issue
      } catch (error) {
        if (!('baseline' in input)) throw error
        // Keep verification in this mutation's scope: never replay an uncertain PATCH blindly.
        let latestRemote: string | undefined
        try {
          const remote = await requestIssueRead(
            `/api/repositories/${repositoryId}/issues/${number}`,
            AbortSignal.timeout(20_000),
          )
          if (
            remote?.userId === userId &&
            remote.repositoryId === repositoryId &&
            remote.issue?.number === number &&
            (remote.issue.body === null ||
              typeof remote.issue.body === 'string')
          ) {
            latestRemote = remote.issue.body ?? ''
            if (latestRemote === input.body) return remote.issue as IssueDetail
          }
        } catch {
          /* Preserve the write failure if the confirming read is unavailable. */
        }
        throw new DescriptionSaveError(error, latestRemote)
      }
    },
    onError: (error) => {
      if (error instanceof IssueReadError && error.retryAt > Date.now())
        retryLimit.current = error
    },
    onSuccess: async (issue, input) => {
      const prefix = ['github', userId, repositoryId] as const
      await Promise.all([
        client.cancelQueries({ queryKey: [...prefix, 'issues'] }),
        client.cancelQueries({
          queryKey: [...prefix, 'issue', issue.number],
          exact: true,
        }),
      ])
      // A late response after logout must not restore private data into a cleared client.
      if (!client.getQueryData(['github', userId, 'repositories'])) return
      client.setQueryData([...prefix, 'issue', issue.number], issue)
      client.setQueriesData<InfiniteData<IssuePage>>(
        {
          queryKey: [...prefix, 'issues'],
          predicate: (query) => query.queryKey.length === 6,
        },
        (data) => {
          if (!data) return data
          if ('label' in input || 'assignee' in input || 'baseline' in input)
            return {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                issues: page.issues.map((item) =>
                  item.id === issue.id ? issue : item,
                ),
              })),
            }
          const first = data.pages[0]
          const matches =
            first.state === issue.state &&
            (first.category === null ||
              getIssueStatus(issue).status === first.category)
          const contained = data.pages.some((page) =>
            page.issues.some((item) => item.id === issue.id),
          )
          return {
            ...data,
            pages: data.pages.map((page, index) => ({
              ...page,
              searchPending:
                page.searchPending ||
                (page.state === 'closed' && (matches || contained)),
              issues: [
                ...(index === 0 && matches ? [issue] : []),
                ...page.issues.filter((item) => item.id !== issue.id),
              ],
            })),
          }
        },
      )
      await client.invalidateQueries({
        queryKey: [...prefix, 'issues'],
        refetchType: 'none',
      })
    },
  })

  const { mutateAsync } = mutation

  /** Keep submission stable and lock immediately before React renders the pending state. */
  const submit = useCallback(
    async (input: Write) => {
      if (submitting.current) return undefined
      submitting.current = true
      try {
        return await mutateAsync(input)
      } finally {
        submitting.current = false
      }
    },
    [mutateAsync],
  )

  return { ...mutation, submit }
}

/** Post once and merge the confirmed comment without replacing pagination or refetching issue lists. */
export function useIssueComment(
  userId: string,
  repositoryId: number | null,
  number: number,
) {
  const client = useQueryClient()
  const submitting = useRef(false)
  const retryLimit = useRef<IssueReadError | null>(null)
  const prefix = ['github', userId, repositoryId] as const
  const detailKey = [...prefix, 'issue', number] as const
  const commentsKey = [...detailKey, 'comments'] as const
  const mutation = useMutation({
    mutationKey: [...prefix, 'comment', number],
    scope: { id: `github:${userId}:${repositoryId}:${number}` },
    retry: false,
    networkMode: 'always',
    mutationFn: async (
      body: string,
    ): Promise<Awaited<ReturnType<typeof projectIssueComment>>> => {
      if (!body.trim())
        throw new IssueReadError('Enter a comment before submitting.', 422)
      if (
        !client.getQueryData<InfiniteData<CommentsPage>>(commentsKey)?.pages
          .length
      )
        throw new IssueReadError('Load comments before submitting.', 409)
      if (retryLimit.current && retryLimit.current.retryAt > Date.now())
        throw retryLimit.current
      let response: Response
      try {
        response = await fetch(
          `/api/repositories/${repositoryId}/issues/${number}/comments`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Issuel-User': userId,
            },
            body: JSON.stringify({ body }),
            cache: 'no-store',
          },
        )
      } catch {
        throw new IssueReadError(
          'The comment result is unknown. Check GitHub before submitting again to avoid duplicates.',
        )
      }
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const messages: Record<number, string> = {
          401: 'Your session has expired. Connect GitHub again.',
          403: 'Writing requires repository push access and App Issues write permission. Check access in GitHub.',
          404: 'Issue not found or no longer accessible. Pull requests are not supported here.',
          422: 'GitHub rejected this comment. Check the content before retrying.',
          429: 'GitHub rate limit reached. Please wait before retrying.',
        }
        throw new IssueReadError(
          messages[response.status] ??
            'The comment result is unknown. Check GitHub before submitting again to avoid duplicates.',
          response.status,
          Number(response.headers.get('Retry-After')) || 0,
        )
      }
      if (!data || typeof data.userId !== 'string')
        throw new IssueReadError(
          'The comment result is unknown. Check GitHub before submitting again to avoid duplicates.',
          502,
        )
      if (data.userId !== userId)
        throw new IssueReadError(
          'Your GitHub session changed. Connect GitHub again.',
          401,
        )
      if (
        data.repositoryId !== repositoryId ||
        data.number !== number ||
        !Number.isSafeInteger(data.comment?.id) ||
        data.comment.id <= 0 ||
        typeof data.comment.body !== 'string'
      )
        throw new IssueReadError(
          'The comment result is unknown. Check GitHub before submitting again to avoid duplicates.',
          502,
        )
      return data.comment
    },
    onError: (error) => {
      if (error instanceof IssueReadError && error.retryAt > Date.now())
        retryLimit.current = error
    },
    onSuccess: async (comment) => {
      await Promise.all([
        client.cancelQueries({ queryKey: commentsKey }),
        client.cancelQueries({ queryKey: detailKey, exact: true }),
        client.cancelQueries({ queryKey: [...prefix, 'issues'] }),
      ])
      if (!client.getQueryData(['github', userId, 'repositories'])) return
      const cached =
        client.getQueryData<InfiniteData<CommentsPage>>(commentsKey)
      const alreadyPresent = cached?.pages.some((page) =>
        page.comments.some((item) => item.id === comment.id),
      )
      client.setQueryData<InfiniteData<CommentsPage>>(commentsKey, (data) => {
        // Keep every GitHub cursor: a confirmed newest comment can follow an incomplete history.
        if (!data?.pages.length) return data
        if (alreadyPresent) return data
        return {
          ...data,
          pages: data.pages.map((page, index) =>
            index === data.pages.length - 1
              ? { ...page, comments: [...page.comments, comment] }
              : page,
          ),
        }
      })
      if (!alreadyPresent) {
        client.setQueryData<IssueDetail>(detailKey, (issue) =>
          issue ? { ...issue, comments: issue.comments + 1 } : issue,
        )
        client.setQueriesData<InfiniteData<IssuePage>>(
          { queryKey: [...prefix, 'issues'] },
          (data) =>
            data
              ? {
                  ...data,
                  pages: data.pages.map((page) => ({
                    ...page,
                    issues: page.issues.map((issue) =>
                      issue.number === number
                        ? { ...issue, comments: issue.comments + 1 }
                        : issue,
                    ),
                  })),
                }
              : data,
        )
      }
      await client.invalidateQueries({ queryKey: detailKey, exact: true })
      const accepted = client.getQueryState<IssueDetail>(detailKey)
      if (
        accepted?.status === 'success' &&
        accepted.data &&
        client.getQueryData(['github', userId, 'repositories'])
      ) {
        const count = accepted.data.comments
        client.setQueriesData<InfiniteData<IssuePage>>(
          { queryKey: [...prefix, 'issues'] },
          (data) =>
            data
              ? {
                  ...data,
                  pages: data.pages.map((page) => ({
                    ...page,
                    issues: page.issues.map((issue) =>
                      issue.number === number
                        ? { ...issue, comments: count }
                        : issue,
                    ),
                  })),
                }
              : data,
        )
      }
    },
  })

  /** Guard the click-to-render interval as well as the pending network operation. */
  async function submit(body: string) {
    if (submitting.current) return undefined
    submitting.current = true
    try {
      return await mutation.mutateAsync(body)
    } finally {
      submitting.current = false
    }
  }

  return { ...mutation, submit }
}
