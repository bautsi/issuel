import { defaultStatuses } from '@/lib/issues'
import type { IssueStatus } from '@/lib/issues'

export type WorkspacePreferences = {
  expandedGroups: Record<IssueStatus, boolean>
  sort: 'updated' | 'created' | 'title'
  filters: Record<string, string>
}

/** Restore this workspace's choices while newly introduced statuses use product defaults. */
export function readWorkspacePreferences(userId: string, repositoryId: number) {
  const preferences: WorkspacePreferences = {
    expandedGroups: Object.fromEntries(
      defaultStatuses.map((status) => [status.id, status.defaultExpanded]),
    ) as Record<IssueStatus, boolean>,
    sort: 'updated',
    filters: {},
  }
  try {
    const stored = window.localStorage.getItem(
      `issuel:preferences:${userId}:${repositoryId}`,
    )
    if (!stored) return { preferences, unavailable: false }
    const value: unknown = JSON.parse(stored)
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return { preferences, unavailable: false }
    const saved = value as Partial<WorkspacePreferences>
    if (
      saved.sort === 'updated' ||
      saved.sort === 'created' ||
      saved.sort === 'title'
    )
      preferences.sort = saved.sort
    for (const { id } of defaultStatuses) {
      if (typeof saved.expandedGroups?.[id] === 'boolean')
        preferences.expandedGroups[id] = saved.expandedGroups[id]
    }
    if (
      saved.filters &&
      typeof saved.filters === 'object' &&
      !Array.isArray(saved.filters)
    ) {
      preferences.filters = Object.fromEntries(
        Object.entries(saved.filters).filter(
          ([, value]) => typeof value === 'string',
        ),
      )
    }
    return { preferences, unavailable: false }
  } catch {
    return { preferences, unavailable: true }
  }
}

/** Save only UI preferences under the same user and repository boundary. */
export function writeWorkspacePreferences(
  userId: string,
  repositoryId: number,
  preferences: WorkspacePreferences,
) {
  try {
    window.localStorage.setItem(
      `issuel:preferences:${userId}:${repositoryId}`,
      JSON.stringify(preferences),
    )
    return true
  } catch {
    return false
  }
}
