import { githubResponse, RepositoryError } from './repositories.ts'
import {
  projectIssueComment,
  projectIssueDetail,
  readIssueDetail,
} from './issue-detail.ts'
import {
  defaultStatusMapping,
  getStatuses,
  getIssueStatus,
} from './issue-status.ts'
import type { OpenIssueStatus } from './issue-status.ts'
import { readStatusMapping } from './repository-config.ts'

const pendingWrites = new Map<string, Promise<unknown>>()

/** Reuse mapped labels and create a missing default only for an explicit issue write. */
async function resolveStatusLabel(
  access: string,
  fullName: string,
  status: { id: OpenIssueStatus; label: string | null },
) {
  const label = status.label
  if (label === null) return null

  const labelsPath = `/repos/${fullName}/labels`
  const labelPath = `${labelsPath}/${encodeURIComponent(label)}`
  try {
    await githubResponse(labelPath, access)
    return label
  } catch (error) {
    if (!(error instanceof RepositoryError) || error.status !== 404) throw error
  }

  if (status.id === 'backlog') return null
  if (label.toLowerCase() !== defaultStatusMapping[status.id]?.toLowerCase())
    throw new RepositoryError('mapped_label_missing', 422)

  try {
    await githubResponse(labelsPath, access, {
      method: 'POST',
      body: { name: label, color: '6e7681' },
    })
  } catch (error) {
    if (!(error instanceof RepositoryError) || error.status !== 422) throw error
    // Another issue write may have created this label first.
    try {
      await githubResponse(labelPath, access)
    } catch (lookupError) {
      if (lookupError instanceof RepositoryError && lookupError.status === 404)
        throw error
      throw lookupError
    }
  }
  return label
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
  const mapping = await readStatusMapping(access, repositoryId)
  const status = getStatuses(mapping).find(
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
  const statusLabel = await resolveStatusLabel(
    access,
    metadata.full_name,
    status,
  )
  const { data } = await githubResponse(
    `/repos/${metadata.full_name}/issues`,
    access,
    {
      method: 'POST',
      body: {
        title: fields.title.trim(),
        body: fields.body ?? '',
        labels: statusLabel === null ? [] : [statusLabel],
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
    getIssueStatus(issue, mapping).status !== status.id ||
    issue.title !== fields.title.trim()
  )
    throw new RepositoryError('github_write_not_applied', 409)
  return issue
}

/** Serialize issue writes, using the mapped label when explicitly changing status. */
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
  const mapping =
    labelWrite ||
    getStatuses().some(
      (status) => status.state === 'open' && status.id === fields.status,
    )
      ? await readStatusMapping(access, repositoryId)
      : defaultStatusMapping
  const statuses = getStatuses(mapping)
  if (
    labelWrite &&
    statuses.some(
      (status) =>
        status.state === 'open' &&
        status.label?.toLowerCase() === (fields.label as string).toLowerCase(),
    )
  )
    throw new RepositoryError('status_label_protected', 422)
  const status = statuses.find((item) => item.id === fields.status)
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
        if (getIssueStatus(current, mapping).status === 'conflict')
          throw new RepositoryError('status_mapping_conflict', 409)
        if (
          current.state === 'open' &&
          getIssueStatus(current, mapping).status === status.id
        )
          return current
        const statusLabel = await resolveStatusLabel(
          access,
          current.full_name,
          status,
        )
        body.labels = current.labels
          .filter(
            (label) =>
              !statuses.some(
                (mapped) =>
                  mapped.state === 'open' &&
                  mapped.label?.toLowerCase() === label.name.toLowerCase(),
              ),
          )
          .map((label) => label.name)
        if (statusLabel !== null) (body.labels as string[]).push(statusLabel)
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
        : getIssueStatus(issue, mapping).status !== status?.id
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

/** Verify parent and session author, then explicitly edit or delete one comment without replaying writes. */
export async function changeIssueComment(
  access: string,
  userId: string,
  repositoryId: number,
  number: number,
  commentId: number,
  input: unknown,
  remove: boolean,
) {
  const fields = input as Record<string, unknown> | null
  if (
    !remove &&
    (!fields ||
      Array.isArray(fields) ||
      Object.keys(fields).length !== 2 ||
      typeof fields.body !== 'string' ||
      !fields.body.trim() ||
      typeof fields.baseline !== 'string')
  )
    throw new RepositoryError('invalid_comment', 422)
  const key = `${repositoryId}:comment:${commentId}`
  const previous = pendingWrites.get(key)
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  pendingWrites.set(key, pending)
  await previous
  try {
    const issue = await readIssueDetail(access, repositoryId, number)
    const path = `/repos/${issue.full_name}/issues/comments/${commentId}`
    const { data } = await githubResponse(path, access)
    const raw = data as Record<string, unknown>
    if (
      raw?.id !== commentId ||
      raw.issue_url !==
        `https://api.github.com/repos/${issue.full_name}/issues/${number}`
    )
      throw new RepositoryError('comment_not_found', 404)
    const current = projectIssueComment(data, issue.html_url)
    if (String(current.author?.id) !== userId)
      throw new RepositoryError('comment_author_required', 403)
    if (!remove) {
      // A prior uncertain save may already have applied this exact body.
      if ((current.body ?? '') === fields!.body) return { comment: current }
      if ((current.body ?? '') !== fields!.baseline)
        throw new RepositoryError('comment_conflict', 409)
      // GET → compare → PATCH is best effort; GitHub offers no atomic body compare-and-swap.
      const { data: updated } = await githubResponse(path, access, {
        method: 'PATCH',
        body: { body: fields!.body },
      })
      const accepted = projectIssueComment(updated, issue.html_url)
      if (accepted.id !== commentId || accepted.body !== fields!.body)
        throw new RepositoryError('github_write_uncertain', 502)
      return { comment: accepted }
    }
    try {
      await githubResponse(path, access, { method: 'DELETE', body: {} })
    } catch (error) {
      if (
        !(error instanceof RepositoryError) ||
        error.message !== 'github_write_uncertain'
      )
        throw error
      // Verify an ambiguous DELETE once. Never resend it or mistake lost access for deletion.
      try {
        await githubResponse(path, access)
      } catch (verification) {
        if (
          verification instanceof RepositoryError &&
          verification.status === 404
        ) {
          await readIssueDetail(access, repositoryId, number)
          return { deletedId: commentId }
        }
        throw error
      }
      throw error
    }
    return { deletedId: commentId }
  } finally {
    release()
    if (pendingWrites.get(key) === pending) pendingWrites.delete(key)
  }
}
