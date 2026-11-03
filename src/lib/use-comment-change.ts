import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import { IssueReadError } from '@/lib/issues'
import type { IssuePage } from '@/lib/issues'
import type { CommentsPage, IssueDetail } from '@/lib/use-issue-detail'
import type { projectIssueComment } from '../../server/issue-detail'

type Change = { id: number } & (
  { body: string; baseline: string } | { remove: true }
)
type Result = {
  comment?: ReturnType<typeof projectIssueComment>
  deletedId?: number
}

/** Reconcile explicit comment changes in the current account's newest-first paginated history. */
export function useCommentChange(
  userId: string,
  repositoryId: number | null,
  number: number,
) {
  const client = useQueryClient()
  const submitting = useRef(false)
  const retryLimit = useRef<IssueReadError | null>(null)
  const prefix = ['github', userId, repositoryId] as const
  const detailKey = [...prefix, 'issue', number] as const
  const commentsKey = [...detailKey, 'comments', 'newest-first'] as const
  const mutation = useMutation({
    mutationKey: [...detailKey, 'comment-change'],
    scope: { id: `github:${userId}:${repositoryId}:${number}` },
    retry: false,
    networkMode: 'always',
    mutationFn: async (input: Change): Promise<Result> => {
      if (retryLimit.current && retryLimit.current.retryAt > Date.now())
        throw retryLimit.current
      let response: Response
      try {
        response = await fetch(
          `/api/repositories/${repositoryId}/issues/${number}/comments/${input.id}`,
          {
            method: 'remove' in input ? 'DELETE' : 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'X-Issuel-User': userId,
            },
            body: JSON.stringify(
              'remove' in input
                ? {}
                : { body: input.body, baseline: input.baseline },
            ),
            cache: 'no-store',
          },
        )
      } catch {
        throw new IssueReadError(
          'The comment change could not be confirmed. Check GitHub or refresh comments before retrying. Your edits are retained.',
        )
      }
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        const messages: Record<number, string> = {
          401: 'Your session has expired. Connect GitHub again.',
          403: 'Only your own comments can be changed. Check repository access and App Issues write permission.',
          404: 'Comment not found or no longer accessible. Refresh comments to check GitHub.',
          409:
            data?.error === 'comment_conflict'
              ? 'The remote comment changed. Your edits are retained. Cancel and reopen the latest comment before saving again.'
              : 'GitHub reported a conflict. Your comment edits are retained.',
          422: 'GitHub rejected this comment. Check the content before retrying.',
          429: 'GitHub rate limit reached. Please wait before retrying.',
        }
        throw new IssueReadError(
          messages[response.status] ??
            'The comment change could not be confirmed. Check GitHub or refresh comments before retrying. Your edits are retained.',
          response.status,
          Number(response.headers.get('Retry-After')) || 0,
        )
      }
      if (data?.userId !== userId)
        throw new IssueReadError(
          'Your GitHub session changed. Connect GitHub again.',
          401,
        )
      if (
        data.repositoryId !== repositoryId ||
        data.number !== number ||
        ('remove' in input
          ? data.deletedId !== input.id
          : data.comment?.id !== input.id || data.comment?.body !== input.body)
      )
        throw new IssueReadError(
          'The comment change could not be confirmed. Check GitHub or refresh comments before retrying. Your edits are retained.',
          502,
        )
      return data
    },
    onError: (error) => {
      if (error instanceof IssueReadError && error.retryAt > Date.now())
        retryLimit.current = error
    },
    onSuccess: async (result) => {
      await Promise.all([
        client.cancelQueries({ queryKey: commentsKey, exact: true }),
        client.cancelQueries({ queryKey: detailKey, exact: true }),
        client.cancelQueries({ queryKey: [...prefix, 'issues'] }),
      ])
      if (!client.getQueryData(['github', userId, 'repositories'])) return
      const removed =
        result.deletedId !== undefined &&
        client
          .getQueryData<InfiniteData<CommentsPage>>(commentsKey)
          ?.pages.some((page) =>
            page.comments.some((comment) => comment.id === result.deletedId),
          )
      client.setQueryData<InfiniteData<CommentsPage>>(commentsKey, (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                comments: result.comment
                  ? page.comments.map((comment) =>
                      comment.id === result.comment!.id
                        ? result.comment!
                        : comment,
                    )
                  : page.comments.filter(
                      (comment) => comment.id !== result.deletedId,
                    ),
              })),
            }
          : data,
      )
      if (removed) {
        client.setQueryData<IssueDetail>(detailKey, (issue) =>
          issue
            ? { ...issue, comments: Math.max(0, issue.comments - 1) }
            : issue,
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
                        ? {
                            ...issue,
                            comments: Math.max(0, issue.comments - 1),
                          }
                        : issue,
                    ),
                  })),
                }
              : data,
        )
      }
      if (result.deletedId !== undefined) {
        // GitHub uses page offsets: reload this issue's loaded pages before allowing Load more.
        await client.invalidateQueries({ queryKey: commentsKey, exact: true })
        await client.invalidateQueries({ queryKey: detailKey, exact: true })
        const issue = client.getQueryData<IssueDetail>(detailKey)
        if (
          issue &&
          client.getQueryState(detailKey)?.status === 'success' &&
          client.getQueryData(['github', userId, 'repositories'])
        )
          client.setQueriesData<InfiniteData<IssuePage>>(
            { queryKey: [...prefix, 'issues'] },
            (data) =>
              data
                ? {
                    ...data,
                    pages: data.pages.map((page) => ({
                      ...page,
                      issues: page.issues.map((item) =>
                        item.number === number
                          ? { ...item, comments: issue.comments }
                          : item,
                      ),
                    })),
                  }
                : data,
          )
      }
    },
  })

  /** Lock synchronously before React renders pending, without automatic mutation retries. */
  async function submit(input: Change) {
    if (submitting.current) return undefined
    submitting.current = true
    try {
      return await mutation.mutateAsync(input)
    } finally {
      submitting.current = false
    }
  }

  return { ...mutation, submit }
}
