import { createContext, useContext, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { IssueReadError } from '@/lib/issues'
import { defaultStatusMapping, getStatuses } from '../../server/issue-status'
import type { StatusMapping } from '../../server/issue-status'

export type RepositoryConfig = {
  userId: string
  repositoryId: number
  mapping: StatusMapping
  sha: string | null
  branch: string
  validationErrors: string[]
}

/** Read or explicitly save settings, validating repository and account identity on every response. */
async function requestConfig(
  userId: string,
  repositoryId: number,
  signal: AbortSignal,
  input?: RepositoryConfig,
) {
  let response: Response
  try {
    response = await fetch(`/api/repositories/${repositoryId}/config`, {
      signal,
      cache: 'no-store',
      ...(input
        ? {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Issuel-User': userId,
            },
            body: JSON.stringify({
              mapping: input.mapping,
              sha: input.sha,
              branch: input.branch,
            }),
          }
        : {}),
    })
  } catch (error) {
    if (signal.aborted && !input) throw error
    throw new IssueReadError(
      input
        ? 'Config save could not be confirmed. Your draft is retained. Reload remote config before retrying.'
        : 'Unable to load repository config. Check your connection and retry.',
    )
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const messages: Record<string, string> = {
      config_yaml_invalid:
        'Repository YAML is invalid or uses unsupported syntax. Fix it in GitHub; it will not be overwritten.',
      config_mapping_invalid:
        'Status mapping is invalid. Select distinct existing labels for all required statuses.',
      config_sha_conflict:
        'Remote config changed. Your draft is retained. Reload remote config before saving again.',
      config_save_pending:
        'A config save is already in progress. Wait and reload remote config.',
      contents_read_required:
        'Repository config requires App Contents read permission.',
      contents_write_required:
        'Saving config requires repository push access and App Contents write permission.',
    }
    const fallback: Record<number, string> = {
      401: 'Your session has expired. Connect GitHub again.',
      403: input
        ? 'Saving config requires repository push access and App Contents write permission.'
        : 'Repository config requires App Contents read permission.',
      404: 'Repository config could not be read. Check repository and Contents access.',
      409: 'Remote config changed. Your draft is retained. Reload remote config before saving again.',
      429: 'GitHub rate limit reached. Please wait before retrying.',
    }
    throw new IssueReadError(
      messages[data?.error] ??
        fallback[response.status] ??
        (input
          ? 'Config save could not be confirmed. Your draft is retained. Reload remote config before retrying.'
          : 'Unable to load repository config. Check your connection and retry.'),
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
    !data.mapping ||
    typeof data.mapping !== 'object' ||
    Object.keys(data.mapping).length !== 4 ||
    !Object.keys(defaultStatusMapping).every(
      (key) =>
        Object.hasOwn(data.mapping, key) &&
        (data.mapping[key] === null || typeof data.mapping[key] === 'string'),
    ) ||
    !(
      data.sha === null ||
      (typeof data.sha === 'string' && /^[a-f0-9]{40}$/u.test(data.sha))
    ) ||
    typeof data.branch !== 'string' ||
    !Array.isArray(data.validationErrors) ||
    !data.validationErrors.every((value: unknown) => typeof value === 'string')
  )
    throw new IssueReadError(
      'The server returned invalid repository config.',
      502,
    )
  return data as RepositoryConfig
}

/** Keep GitHub config isolated per account/repository and never retry writes automatically. */
export function useRepositoryConfigQuery(
  userId: string,
  repositoryId: number | null,
) {
  const client = useQueryClient()
  const retryLimit = useRef<IssueReadError | null>(null)
  const queryKey = ['github', userId, repositoryId, 'config'] as const
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      await Promise.resolve()
      if (retryLimit.current && retryLimit.current.retryAt > Date.now())
        throw retryLimit.current
      try {
        return await requestConfig(userId, repositoryId!, signal)
      } catch (error) {
        if (error instanceof IssueReadError && error.retryAt > Date.now())
          retryLimit.current = error
        throw error
      }
    },
    enabled: repositoryId !== null,
    staleTime: 0,
    gcTime: Infinity,
    retry: false,
    retryOnMount: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    networkMode: 'always',
  })
  const save = useMutation({
    mutationKey: [...queryKey, 'save'],
    scope: { id: `config:${userId}:${repositoryId}` },
    retry: false,
    networkMode: 'always',
    mutationFn: async (input: RepositoryConfig) => {
      if (retryLimit.current && retryLimit.current.retryAt > Date.now())
        throw retryLimit.current
      await client.cancelQueries({ queryKey, exact: true })
      return requestConfig(
        userId,
        repositoryId!,
        AbortSignal.timeout(60_000),
        input,
      )
    },
    onError: (error) => {
      if (error instanceof IssueReadError && error.retryAt > Date.now())
        retryLimit.current = error
    },
    onSuccess: async (data) => {
      await client.cancelQueries({ queryKey, exact: true })
      if (!client.getQueryData(['github', userId, 'repositories'])) return
      client.setQueryData(queryKey, data)
    },
  })
  return { ...query, save }
}

export const RepositoryConfigContext = createContext<ReturnType<
  typeof useRepositoryConfigQuery
> | null>(null)

/** Share the accepted GitHub configuration with every status-sensitive repository view. */
export function useRepositoryConfig() {
  const context = useContext(RepositoryConfigContext)
  if (!context?.data)
    throw new Error('Repository config must load before rendering issues.')
  return { ...context, data: context.data }
}

/** Derive status definitions from the same accepted mapping used by repository settings. */
export function useRepositoryStatuses() {
  return getStatuses(useRepositoryConfig().data.mapping)
}
