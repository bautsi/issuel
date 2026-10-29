import { githubResponse, RepositoryError } from './repositories.ts'
import {
  projectIssueComment,
  projectIssueDetail,
  readIssueDetail,
} from './issue-detail.ts'
import { defaultStatuses, getIssueStatus } from './issue-status.ts'

const pendingWrites = new Map<string, Promise<unknown>>()

/** Resolve a required Open label, creating it only for an explicit write and never retrying POST. */
async function ensureStatusLabel(
  access: string,
  fullName: string,
  name: string,
) {
  const path = `/repos/${fullName}/labels/${encodeURIComponent(name)}`
  try {
    await githubResponse(path, access)
    return
  } catch (error) {
    if (!(error instanceof RepositoryError) || error.status !== 404) throw error
  }
  try {
    await githubResponse(`/repos/${fullName}/labels`, access, {
      method: 'POST',
      body: { name, color: '6e7681' },
    })
  } catch (error) {
    // Another request may have created this exact label; verify it rather than replaying POST.
    if (!(error instanceof RepositoryError) || error.status !== 422) throw error
    await githubResponse(path, access)
  }
}

/** Create one issue from validated fields and confirm the status using the provider response. */
export async function createIssue(
  access: string,
  repositoryId: number,
  input: unknown,
) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new RepositoryError('invalid_issue_write', 400)
  const fields = input as Record<string, unknown>
  const status = defaultStatuses.find(
    (item) => item.id === fields.status && item.state === 'open',
  )
  if (
    typeof fields.title !== 'string' ||
    !fields.title.trim() ||
    !(fields.body === undefined || typeof fields.body === 'string') ||
    status?.state !== 'open' ||
    Object.keys(fields).some(
      (key) => !['title', 'body', 'status'].includes(key),
    )
  )
    throw new RepositoryError('invalid_issue_write', 400)
  const { data: repository } = await githubResponse(
    `/repositories/${repositoryId}`,
    access,
  )
  const metadata = repository as Record<string, unknown>
  if (
    metadata.id !== repositoryId ||
    typeof metadata.full_name !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(metadata.full_name) ||
    typeof metadata.default_branch !== 'string' ||
    !metadata.default_branch
  )
    throw new RepositoryError('github_invalid_response', 502)
  if (status.id !== 'backlog')
    await ensureStatusLabel(access, metadata.full_name, status.label)
  const { data } = await githubResponse(
    `/repos/${metadata.full_name}/issues`,
    access,
    {
      method: 'POST',
      body: {
        title: fields.title.trim(),
        body: fields.body ?? '',
        labels: status.id === 'backlog' ? [] : [status.label],
      },
    },
  )
  const number =
    data && typeof data === 'object' && 'number' in data
      ? Number(data.number)
      : NaN
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new RepositoryError('github_write_uncertain', 502)
  const issue = projectIssueDetail(data, repository, repositoryId, number)
  if (
    getIssueStatus(issue).status !== status.id ||
    issue.title !== fields.title.trim()
  )
    throw new RepositoryError('github_write_not_applied', 409)
  return issue
}

/** Serialize issue writes, compare raw description baselines and patch only the requested fields. */
export async function updateIssue(
  access: string,
  repositoryId: number,
  number: number,
  input: unknown,
) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new RepositoryError('invalid_issue_write', 400)
  const fields = input as Record<string, unknown>
  const descriptionWrite =
    Object.keys(fields).length === 2 &&
    typeof fields.body === 'string' &&
    typeof fields.baseline === 'string'
  const titleWrite =
    Object.keys(fields).length === 1 &&
    typeof fields.title === 'string' &&
    !!fields.title.trim()
  const labelWrite =
    Object.keys(fields).length === 2 &&
    typeof fields.label === 'string' &&
    !!fields.label.trim() &&
    typeof fields.remove === 'boolean'
  const assigneeWrite =
    Object.keys(fields).length === 2 &&
    typeof fields.assignee === 'string' &&
    !!fields.assignee.trim() &&
    typeof fields.remove === 'boolean'
  if (
    labelWrite &&
    defaultStatuses.some(
      (status) =>
        status.state === 'open' &&
        status.label === (fields.label as string).toLowerCase(),
    )
  )
    throw new RepositoryError('status_label_protected', 422)
  const status = defaultStatuses.find((item) => item.id === fields.status)
  if (
    !descriptionWrite &&
    !titleWrite &&
    !labelWrite &&
    !assigneeWrite &&
    (!status ||
      Object.keys(fields).some(
        (key) => !['status', 'duplicateNumber'].includes(key),
      ) ||
      (status.id === 'duplicate'
        ? !Number.isSafeInteger(fields.duplicateNumber) ||
          Number(fields.duplicateNumber) <= 0 ||
          fields.duplicateNumber === number
        : fields.duplicateNumber !== undefined))
  )
    throw new RepositoryError('invalid_issue_write', 400)
  const key = `${repositoryId}:${number}`
  const previous = pendingWrites.get(key)
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  pendingWrites.set(key, pending)
  await previous
  try {
    const current = await readIssueDetail(access, repositoryId, number)
    if (descriptionWrite) {
      const latestRemote = current.body ?? ''
      // A retry after an uncertain response may already have reached GitHub.
      if (latestRemote === fields.body) return current
      if (latestRemote !== fields.baseline)
        throw new RepositoryError('description_conflict', 409)
      // Best effort only: GitHub does not offer an atomic body compare-and-swap here.
      const { data } = await githubResponse(
        `/repos/${current.full_name}/issues/${number}`,
        access,
        {
          method: 'PATCH',
          body: { body: fields.body },
        },
      )
      const accepted = projectIssueDetail(
        data,
        {
          id: repositoryId,
          full_name: current.full_name,
          default_branch: current.default_branch,
        },
        repositoryId,
        number,
      )
      if ((accepted.body ?? '') !== fields.body)
        throw new RepositoryError('github_write_not_applied', 409)
      return accepted
    }
    if (labelWrite || assigneeWrite) {
      const base = `/repos/${current.full_name}/issues/${number}`
      if (labelWrite) {
        // A definition must already exist; this UI never creates repository labels.
        if (!fields.remove)
          await githubResponse(
            `/repos/${current.full_name}/labels/${encodeURIComponent(fields.label as string)}`,
            access,
          )
        await githubResponse(
          `${base}/labels${fields.remove ? `/${encodeURIComponent(fields.label as string)}` : ''}`,
          access,
          {
            method: fields.remove ? 'DELETE' : 'POST',
            body: fields.remove ? {} : { labels: [fields.label] },
          },
        )
      } else {
        const { data } = await githubResponse(`${base}/assignees`, access, {
          method: fields.remove ? 'DELETE' : 'POST',
          body: { assignees: [fields.assignee] },
        })
        const accepted = projectIssueDetail(
          data,
          {
            id: repositoryId,
            full_name: current.full_name,
            default_branch: current.default_branch,
          },
          repositoryId,
          number,
        )
        const assigned = accepted.assignees.some(
          (user) =>
            user.login.toLowerCase() ===
            (fields.assignee as string).toLowerCase(),
        )
        if (assigned === fields.remove)
          throw new RepositoryError('assignee_not_applied', 422)
        return accepted
      }
      const accepted = await readIssueDetail(access, repositoryId, number)
      const labeled = accepted.labels.some(
        (label) =>
          label.name.toLowerCase() === (fields.label as string).toLowerCase(),
      )
      if (labeled === fields.remove)
        throw new RepositoryError('github_write_not_applied', 409)
      return accepted
    }
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
          const target = await readIssueDetail(
            access,
            repositoryId,
            Number(fields.duplicateNumber),
          )
          if (target.id === current.id)
            throw new RepositoryError('invalid_duplicate_target', 400)
          body.duplicate_issue_id = target.id
        }
      } else {
        if (getIssueStatus(current).status === 'conflict')
          throw new RepositoryError('status_mapping_conflict', 409)
        if (
          current.state === 'open' &&
          getIssueStatus(current).status === status.id
        )
          return current
        if (status.id !== 'backlog')
          await ensureStatusLabel(access, current.full_name, status.label)
        body.labels = current.labels
          .filter(
            (label) =>
              !defaultStatuses.some(
                (mapped) =>
                  mapped.state === 'open' &&
                  mapped.label === label.name.toLowerCase(),
              ),
          )
          .map((label) => label.name)
        if (status.id !== 'backlog')
          (body.labels as string[]).push(status.label)
        if (current.state === 'closed') body.state = 'open'
      }
    }
    const { data } = await githubResponse(
      `/repos/${current.full_name}/issues/${number}`,
      access,
      {
        method: 'PATCH',
        body,
      },
    )
    const issue = projectIssueDetail(
      data,
      {
        id: repositoryId,
        full_name: current.full_name,
        default_branch: current.default_branch,
      },
      repositoryId,
      number,
    )
    if (
      titleWrite
        ? issue.title !== body.title
        : getIssueStatus(issue).status !== status?.id
    )
      throw new RepositoryError('github_write_not_applied', 409)
    return issue
  } finally {
    release()
    if (pendingWrites.get(key) === pending) pendingWrites.delete(key)
  }
}

/** Create a comment once after checking issue access; return only validated GitHub content. */
export async function createIssueComment(
  access: string,
  repositoryId: number,
  number: number,
  input: unknown,
) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !('body' in input) ||
    typeof input.body !== 'string' ||
    !input.body.trim()
  )
    throw new RepositoryError('invalid_comment', 422)
  const issue = await readIssueDetail(access, repositoryId, number)
  const { data } = await githubResponse(
    `/repos/${issue.full_name}/issues/${number}/comments`,
    access,
    {
      method: 'POST',
      body: { body: input.body },
    },
  )
  try {
    return projectIssueComment(data, issue.html_url)
  } catch {
    throw new RepositoryError('github_write_uncertain', 502)
  }
}
