import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useMatch } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { RepositorySettings } from '@/components/repository-settings'
import {
  RepositoryConfigContext,
  useRepositoryConfigQuery,
} from '@/lib/use-repository-config'
import { IssueReadError } from '@/lib/issues'

/** Keep the workspace skeleton while config loads and retain settings for mapping repair. */
export function RepositoryConfigProvider({
  userId,
  repository,
  children,
  onSessionExpired,
}: {
  userId: string
  repository: {
    id: number
    permissions: Record<string, boolean>
    installations: { permissions: Record<string, string> }[]
  } | null
  children: ReactNode
  onSessionExpired: () => void
}) {
  const { t } = useTranslation()
  const workspaceMatch = useMatch('/workspace/:owner/:repo')
  const config = useRepositoryConfigQuery(userId, repository?.id ?? null)
  useEffect(() => {
    if (
      !config.data &&
      config.error instanceof IssueReadError &&
      config.error.status === 401
    )
      onSessionExpired()
  }, [config.data, config.error, onSessionExpired])
  if (!repository) return children
  return (
    <RepositoryConfigContext value={config}>
      {/* Read failures never fall back to product defaults */}
      {config.error && (
        <div role="alert" className="mb-4 space-y-3 text-sm text-destructive">
          <p>{t(config.error.message)}</p>
          {config.data && (
            <p>
              {t(
                'Showing the last loaded repository config until reload succeeds.',
              )}
            </p>
          )}
          <Button
            variant="outline"
            disabled={config.isFetching}
            onClick={() => void config.refetch()}
          >
            {t('Reload remote config')}
          </Button>
        </div>
      )}
      {!config.data && !config.error && (
        <div role="status" aria-busy="true">
          <span className="sr-only">{t('Loading workspace…')}</span>
          <div aria-hidden="true">
            {/* Keep the workspace header stable while repository config loads */}
            <Skeleton className="h-4 w-44" />
            <Skeleton className="mt-3 h-8 w-56 max-w-full" />
            <Skeleton className="mt-3 h-5 w-48" />

            {/* Match the existing Issues loading region */}
            <div className="mt-8 overflow-hidden rounded-xl border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
                <span className="font-semibold">{t('Issues')}</span>
                <Skeleton className="h-8 w-40" />
              </div>
              <div className="flex min-h-72 flex-col items-center justify-center gap-4 border-t">
                <span className="relative block h-0.5 w-12 overflow-hidden rounded-full bg-foreground/10">
                  <span className="absolute inset-y-0 left-1/3 w-1/3 rounded-full bg-foreground/50 motion-safe:animate-[issuel-loading_1.6s_ease-in-out_infinite]" />
                </span>
                <p className="text-xs text-muted-foreground">
                  {t('Loading workspace…')}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invalid label choices can be repaired without rendering misleading issue statuses */}
      {config.data &&
        (!workspaceMatch || config.data.validationErrors.length > 0) && (
          <div className="mb-3 flex justify-end">
            <RepositorySettings
              canWrite={
                !!repository.permissions.push &&
                repository.installations.some(
                  (installation) =>
                    installation.permissions.contents === 'write',
                )
              }
            />
          </div>
        )}
      {config.data && config.data.validationErrors.length === 0 && children}
      {config.data && config.data.validationErrors.length > 0 && (
        <p role="alert">
          {t(
            'Status mapping is invalid. Select distinct existing labels for all required statuses.',
          )}
        </p>
      )}
    </RepositoryConfigContext>
  )
}
