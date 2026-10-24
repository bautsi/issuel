import { useState } from 'react'
import { readWorkspacePreferences, writeWorkspacePreferences } from '@/lib/workspace-preferences'
import type { WorkspacePreferences } from '@/lib/workspace-preferences'

/** Display one verified repository and keep its UI state inside a keyed workspace boundary. */
export function Workspace({ userId, repository }: {
  userId: string
  repository: { id: number; full_name: string; private: boolean }
}) {
  const [stored, setStored] = useState(() => readWorkspacePreferences(userId, repository.id))

  /** Remember a default sort without creating issue queries or pretending issues are loaded. */
  function changeSort(sort: WorkspacePreferences['sort']) {
    const preferences = { ...stored.preferences, sort }
    const saved = writeWorkspacePreferences(userId, repository.id, preferences)
    setStored({ preferences, unavailable: !saved })
  }

  return (
    <>
      {/* Workspace identity */}
      <header>
        <p className="text-xs font-medium tracking-widest text-muted-foreground">REPOSITORY WORKSPACE</p>
        <h1 className="mt-3 break-words text-2xl font-semibold tracking-tight">{repository.full_name}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{repository.private ? 'Private' : 'Public'} repository · Repository ID {repository.id}</p>
      </header>

      {/* Issues placeholder and local default */}
      <section aria-labelledby="issues-heading" className="mt-10 rounded-xl border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="issues-heading" className="font-semibold">Issues</h2>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Default sort
            <select value={stored.preferences.sort} onChange={event => changeSort(event.target.value as WorkspacePreferences['sort'])} className="rounded-md border bg-background px-2 py-1 text-foreground">
              <option value="updated">Last Updated</option>
              <option value="created">Created</option>
              <option value="title">Title</option>
            </select>
          </label>
        </div>
        <p className="mt-6 text-sm leading-6 text-muted-foreground">Your repository workspace is ready. Issue loading is coming in a later update. No issues have been requested.</p>
        <p className="mt-2 text-xs text-muted-foreground">The default sort is saved for this workspace and will apply when issues are available.</p>
        {stored.unavailable && <p role="status" className="mt-4 text-sm text-muted-foreground">Browser preferences could not be read or saved. Defaults are available for this visit.</p>}
      </section>
    </>
  )
}
