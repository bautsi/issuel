import { githubResponse, RepositoryError } from './repositories.ts'
import { projectIssueDetail, readIssueDetail } from './issue-detail.ts'
import { defaultStatuses, getIssueStatus } from './issue-status.ts'

const pendingWrites = new Map<string, Promise<unknown>>()

/** Resolve a required Open label, creating it only for an explicit write and never retrying POST. */
async function ensureStatusLabel(access: string, fullName: string, name: string) {
  const path = `/repos/${fullName}/labels/${encodeURIComponent(name)}`
  try {
    await githubResponse(path, access)
    return
  } catch (error) {
    if (!(error instanceof RepositoryError) || error.status !== 404) throw error
  }
  try {
    await githubResponse(`/repos/${fullName}/labels`, access, {
      method: 'POST', body: { name, color: '6e7681' },
    })
  } catch (error) {
    // Another request may have created this exact label; verify it rather than replaying POST.
    if (!(error instanceof RepositoryError) || error.status !== 422) throw error
    await githubResponse(path, access)
  }
}

/** Create one issue from validated fields and confirm the status using the provider response. */
export async function createIssue(access: string, repositoryId: number, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new RepositoryError('invalid_issue_write', 400)
  const fields = input as Record<string, unknown>
  const status = defaultStatuses.find((item) => item.id === fields.status && item.state === 'open')
  if (typeof fields.title !== 'string' || !fields.title.trim() ||
    !(fields.body === undefined || typeof fields.body === 'string') ||
    status?.state !== 'open' ||
    Object.keys(fields).some((key) => !['title', 'body', 'status'].includes(key)))
    throw new RepositoryError('invalid_issue_write', 400)
  const { data: repository } = await githubResponse(`/repositories/${repositoryId}`, access)
  const metadata = repository as Record<string, unknown>
  if (metadata.id !== repositoryId || typeof metadata.full_name !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(metadata.full_name) ||
    typeof metadata.default_branch !== 'string' || !metadata.default_branch)
    throw new RepositoryError('github_invalid_response', 502)
  if (status.id !== 'backlog') await ensureStatusLabel(access, metadata.full_name, status.label)
  const { data } = await githubResponse(`/repos/${metadata.full_name}/issues`, access, {
    method: 'POST',
    body: { title: fields.title.trim(), body: fields.body ?? '', labels: status.id === 'backlog' ? [] : [status.label] },
  })
  const number = data && typeof data === 'object' && 'number' in data ? Number(data.number) : NaN
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new RepositoryError('github_write_uncertain', 502)
  const issue = projectIssueDetail(data, repository, repositoryId, number)
  if (getIssueStatus(issue).status !== status.id || issue.title !== fields.title.trim())
    throw new RepositoryError('github_write_not_applied', 409)
  return issue
}

/** Serialize all local writers for the same GitHub issue, then patch only title or status fields. */
export async function updateIssue(access: string, repositoryId: number, number: number, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new RepositoryError('invalid_issue_write', 400)
  const fields = input as Record<string, unknown>
  const titleWrite = Object.keys(fields).length === 1 && typeof fields.title === 'string' && !!fields.title.trim()
  const status = defaultStatuses.find((item) => item.id === fields.status)
  if (!titleWrite && (!status ||
    Object.keys(fields).some((key) => !['status', 'duplicateNumber'].includes(key)) ||
    (status.id === 'duplicate'
      ? !Number.isSafeInteger(fields.duplicateNumber) || Number(fields.duplicateNumber) <= 0 || fields.duplicateNumber === number
      : fields.duplicateNumber !== undefined)))
    throw new RepositoryError('invalid_issue_write', 400)
  const key = `${repositoryId}:${number}`
  const previous = pendingWrites.get(key)
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  pendingWrites.set(key, pending)
  await previous
  try {
    const current = await readIssueDetail(access, repositoryId, number)
    const body: Record<string, unknown> = {}
    if (titleWrite) {
      const title = (fields.title as string).trim()
      if (title === current.title) return current
      body.title = title
    } else if (status) {
      if (status.state === 'closed') {
        if (current.state === 'closed')
          throw new RepositoryError('reopen_before_changing_reason', 409)
        body.state = 'closed'
        body.state_reason = status.reason
        if (status.id === 'duplicate') {
          const target = await readIssueDetail(access, repositoryId, Number(fields.duplicateNumber))
          if (target.id === current.id) throw new RepositoryError('invalid_duplicate_target', 400)
          body.duplicate_issue_id = target.id
        }
      } else {
        if (getIssueStatus(current).status === 'conflict')
          throw new RepositoryError('status_mapping_conflict', 409)
        if (current.state === 'open' && getIssueStatus(current).status === status.id) return current
        if (status.id !== 'backlog') await ensureStatusLabel(access, current.full_name, status.label)
        body.labels = current.labels
          .filter((label) => !defaultStatuses.some((mapped) =>
            mapped.state === 'open' && mapped.label === label.name.toLowerCase(),
          ))
          .map((label) => label.name)
        if (status.id !== 'backlog') (body.labels as string[]).push(status.label)
        if (current.state === 'closed') body.state = 'open'
      }
    }
    const { data } = await githubResponse(`/repos/${current.full_name}/issues/${number}`, access, {
      method: 'PATCH', body,
    })
    const issue = projectIssueDetail(data, { id: repositoryId, full_name: current.full_name, default_branch: current.default_branch }, repositoryId, number)
    if (titleWrite ? issue.title !== body.title : getIssueStatus(issue).status !== status?.id)
      throw new RepositoryError('github_write_not_applied', 409)
    return issue
  } finally {
    release()
    if (pendingWrites.get(key) === pending) pendingWrites.delete(key)
  }
}
