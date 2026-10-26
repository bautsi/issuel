// Pure Issuel product defaults shared by the API and UI; repository settings remain future work.
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

/** Resolve Closed by GitHub reason and Open by mapped labels, retaining explicit Open conflicts. */
export function getIssueStatus<Label extends { name: string }>(issue: {
  state: 'open' | 'closed'
  state_reason?: string | null
  labels: Label[]
}) {
  const mapped = defaultStatuses.filter(
    (status) =>
      status.state === 'open' && status.label !== null &&
      issue.labels.some((label) => label.name.toLowerCase() === status.label),
  )
  const labels = issue.labels.filter(
    (label) =>
      !mapped.some((status) => label.name.toLowerCase() === status.label),
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
