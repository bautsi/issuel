// Status identity and native Closed reasons are shared by the API and UI.
export const defaultStatuses = [
  {
    id: 'inProgress',
    title: 'In Progress',
    state: 'open',
    label: 'status:in-progress',
    defaultExpanded: true,
  },
  {
    id: 'inReview',
    title: 'In Review',
    state: 'open',
    label: 'status:in-review',
    defaultExpanded: true,
  },
  {
    id: 'todo',
    title: 'Todo',
    state: 'open',
    label: 'status:todo',
    defaultExpanded: true,
  },
  {
    id: 'backlog',
    title: 'Backlog',
    state: 'open',
    label: 'status:backlog',
    defaultExpanded: true,
  },
  {
    id: 'done',
    title: 'Done',
    state: 'closed',
    reason: 'completed',
    label: null,
    defaultExpanded: false,
  },
  {
    id: 'canceled',
    title: 'Canceled',
    state: 'closed',
    reason: 'not_planned',
    label: null,
    defaultExpanded: false,
  },
  {
    id: 'duplicate',
    title: 'Duplicate',
    state: 'closed',
    reason: 'duplicate',
    label: null,
    defaultExpanded: false,
  },
] as const

export type IssueStatus = (typeof defaultStatuses)[number]['id']
export type ClosedIssueStatus = Extract<
  (typeof defaultStatuses)[number],
  { state: 'closed' }
>['id']

export type OpenIssueStatus = Exclude<IssueStatus, ClosedIssueStatus>
export type StatusMapping = Record<OpenIssueStatus, string | null>
export const defaultStatusMapping = Object.fromEntries(
  defaultStatuses
    .filter((status) => status.state === 'open')
    .map((status) => [status.id, status.label]),
) as StatusMapping

/** Apply repository labels without changing status identities or native Closed reasons. */
export function getStatuses(mapping: StatusMapping = defaultStatusMapping) {
  return defaultStatuses.map((status) =>
    status.state === 'open' ? { ...status, label: mapping[status.id] } : status,
  )
}

/** Require existing custom labels and warn about missing defaults outside Backlog. */
export function validateStatusMapping(
  mapping: StatusMapping,
  labels: string[],
) {
  const errors: string[] = []
  const missingDefaultLabels: string[] = []
  const existing = new Set(labels.map((label) => label.toLowerCase()))
  const seen = new Set<string>()
  for (const status of getStatuses(mapping)) {
    if (status.state !== 'open') continue
    if (status.label === null && status.id === 'backlog') continue
    if (typeof status.label !== 'string' || !status.label.trim()) {
      errors.push('Every Open status except Backlog requires a label.')
      continue
    }
    const name = status.label.toLowerCase()
    if (!existing.has(name)) {
      if (name !== defaultStatusMapping[status.id]?.toLowerCase()) {
        errors.push(`Mapped label does not exist: ${status.label}`)
      } else if (status.id !== 'backlog') {
        missingDefaultLabels.push(status.label)
      }
    }
    if (seen.has(name)) errors.push('Open statuses must use distinct labels.')
    seen.add(name)
  }
  return { errors, missingDefaultLabels }
}

/** Resolve Closed by GitHub reason and Open by mapped labels, retaining explicit Open conflicts. */
export function getIssueStatus<Label extends { name: string }>(
  issue: {
    state: 'open' | 'closed'
    state_reason?: string | null
    labels: Label[]
  },
  mapping: StatusMapping = defaultStatusMapping,
) {
  const statuses = getStatuses(mapping)
  const mapped = statuses.filter(
    (status) =>
      status.state === 'open' &&
      status.label !== null &&
      issue.labels.some(
        (label) => label.name.toLowerCase() === status.label?.toLowerCase(),
      ),
  )
  const labels = issue.labels.filter(
    (label) =>
      !mapped.some(
        (status) => label.name.toLowerCase() === status.label?.toLowerCase(),
      ),
  )
  if (issue.state === 'closed') {
    const closed = defaultStatuses.find(
      (status) =>
        status.state === 'closed' && status.reason === issue.state_reason,
    )
    const status: IssueStatus | 'conflict' = closed?.id ?? 'conflict'
    return { status, labels, conflictingLabels: [] as string[] }
  }
  // Only Open mappings participate; Closed reasons are native GitHub state.
  const candidates = mapped
  const status: IssueStatus | 'conflict' =
    candidates.length > 1
      ? 'conflict'
      : candidates[0]?.state === issue.state
        ? candidates[0].id
        : 'backlog'
  const conflictingLabels =
    status === 'conflict'
      ? candidates.flatMap((candidate) =>
          candidate.label === null ? [] : [candidate.label],
        )
      : []
  return { status, labels, conflictingLabels }
}
