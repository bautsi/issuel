import { createHash } from 'node:crypto'
import { githubResponse, RepositoryError } from './repositories.ts'
import { readIssueOptions } from './issue-detail.ts'
import { defaultStatusMapping, validateStatusMapping } from './issue-status.ts'
import type { StatusMapping } from './issue-status.ts'

const configPath = '.github/issuel-client.yml'
const saving = new Set<number>()

/** Parse a conservative block-mapping YAML subset; reject ambiguous syntax before any write. */
export function parseRepositoryConfig(source: string) {
  if (
    source.length > 64_000 ||
    [...source].some(
      (character) =>
        character.charCodeAt(0) < 32 && !['\r', '\n'].includes(character),
    )
  )
    throw new RepositoryError('config_yaml_invalid', 422)
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/u)
  const entries: {
    indent: number
    key: string
    value: string | null | object | boolean | number
  }[] = []
  const scopes: Set<string>[] = [new Set()]
  let previousIndent = 0
  let previousMapping = false
  let start = -1
  let end = lines.length
  for (const [index, line] of lines.entries()) {
    if (!line.trim() || /^\s*#/u.test(line)) continue
    const match = /^( *)([A-Za-z_][A-Za-z0-9_-]*):(?: +(.*))?$/u.exec(line)
    if (!match) throw new RepositoryError('config_yaml_invalid', 422)
    const indent = match[1].length
    if (
      indent % 2 ||
      (indent > previousIndent &&
        (!previousMapping || indent !== previousIndent + 2))
    )
      throw new RepositoryError('config_yaml_invalid', 422)
    if (indent > previousIndent) scopes.push(new Set())
    while (scopes.length > indent / 2 + 1) scopes.pop()
    const scope = scopes[indent / 2]
    if (!scope || scope.has(match[2]))
      throw new RepositoryError('config_yaml_invalid', 422)
    scope.add(match[2])
    let raw = (match[3] ?? '').trim()
    let value: string | null | object | boolean | number
    if (raw.startsWith('"')) {
      const quoted = /^("(?:[^"\\]|\\.)*")(?:\s+#.*)?$/u.exec(raw)
      if (!quoted) throw new RepositoryError('config_yaml_invalid', 422)
      try {
        value = JSON.parse(quoted[1]) as string
      } catch {
        throw new RepositoryError('config_yaml_invalid', 422)
      }
    } else if (raw.startsWith("'")) {
      const quoted = /^'((?:[^']|'')*)'(?:\s+#.*)?$/u.exec(raw)
      if (!quoted) throw new RepositoryError('config_yaml_invalid', 422)
      value = quoted[1].replaceAll("''", "'")
    } else {
      raw = raw.replace(/(?:^|\s+)#.*$/u, '').trim()
      if (
        raw &&
        (/^[!&*[\]{}>|%@`?,'"-]/u.test(raw) || /:\s|[[\]{}'"\\]/u.test(raw))
      )
        throw new RepositoryError('config_yaml_invalid', 422)
      value = !raw
        ? {}
        : /^(null|~)$/iu.test(raw)
          ? null
          : /^(true|false)$/iu.test(raw)
            ? raw.toLowerCase() === 'true'
            : /^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(raw)
              ? Number(raw)
              : raw
    }
    if (indent === 0 && match[2] === 'statusLabels') start = index
    else if (indent === 0 && start >= 0 && end === lines.length) end = index
    entries.push({ indent, key: match[2], value })
    previousIndent = indent
    previousMapping = typeof value === 'object' && value !== null
  }
  const root = entries.findIndex(
    (entry) => entry.indent === 0 && entry.key === 'statusLabels',
  )
  if (
    root < 0 ||
    typeof entries[root].value !== 'object' ||
    entries[root].value === null
  )
    throw new RepositoryError('config_mapping_invalid', 422)
  const mapping: StatusMapping = {
    backlog: null,
    todo: null,
    inProgress: null,
    inReview: null,
  }
  for (const entry of entries.slice(root + 1)) {
    if (entry.indent === 0) break
    if (
      entry.indent !== 2 ||
      !Object.hasOwn(mapping, entry.key) ||
      !(entry.value === null || typeof entry.value === 'string')
    )
      throw new RepositoryError('config_mapping_invalid', 422)
    mapping[entry.key as keyof StatusMapping] = entry.value
  }
  return { mapping, lines, start, end }
}

/** Confirm Contents access or an empty branch list before accepting a missing config file. */
export async function readRepositoryConfig(
  access: string,
  repositoryId: number,
) {
  const { data } = await githubResponse(`/repositories/${repositoryId}`, access)
  const repository = data as Record<string, unknown>
  if (
    repository.id !== repositoryId ||
    typeof repository.full_name !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository.full_name) ||
    typeof repository.default_branch !== 'string' ||
    !repository.default_branch
  )
    throw new RepositoryError('github_invalid_response', 502)
  const base = `/repos/${repository.full_name}/contents`
  const ref = `?ref=${encodeURIComponent(repository.default_branch)}`
  let file: Record<string, unknown>
  try {
    file = (await githubResponse(`${base}/${configPath}${ref}`, access))
      .data as Record<string, unknown>
  } catch (error) {
    if (!(error instanceof RepositoryError) || error.status !== 404) throw error
    let emptyRepository = false
    // Empty repositories have no default-branch tree; inaccessible Contents can also return 404.
    try {
      await githubResponse(`${base}${ref}`, access)
    } catch (rootError) {
      if (!(rootError instanceof RepositoryError) || rootError.status !== 404)
        throw rootError
      // A successful branches read uses the same token and requires Contents read permission.
      const { data: branches } = await githubResponse(
        `/repos/${repository.full_name}/branches?per_page=1`,
        access,
      )
      if (!Array.isArray(branches))
        throw new RepositoryError('github_invalid_response', 502)
      if (branches.length > 0) throw rootError
      emptyRepository = true
    }
    return {
      mapping: { ...defaultStatusMapping },
      sha: null,
      source: null,
      branch: repository.default_branch,
      fullName: repository.full_name,
      emptyRepository,
      validationErrors: [] as string[],
    }
  }
  if (
    !file ||
    Array.isArray(file) ||
    file.type !== 'file' ||
    file.path !== configPath ||
    file.encoding !== 'base64' ||
    typeof file.content !== 'string' ||
    typeof file.sha !== 'string' ||
    !/^[a-f0-9]{40}$/u.test(file.sha) ||
    typeof file.size !== 'number' ||
    file.size > 64_000
  )
    throw new RepositoryError('config_yaml_invalid', 422)
  const bytes = Buffer.from(file.content, 'base64')
  const sha = createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex')
  if (sha !== file.sha) throw new RepositoryError('config_yaml_invalid', 422)
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new RepositoryError('config_yaml_invalid', 422)
  }
  const { mapping } = parseRepositoryConfig(source)
  const { labels } = await readIssueOptions(access, repositoryId, 'labels')
  const { errors } = validateStatusMapping(
    mapping,
    labels.map((label) => label.name),
  )
  return {
    mapping,
    sha: file.sha,
    source,
    branch: repository.default_branch,
    fullName: repository.full_name,
    emptyRepository: false,
    validationErrors: errors,
  }
}

/** Require a readable and valid config before resolving status-sensitive server operations. */
export async function readStatusMapping(access: string, repositoryId: number) {
  const config = await readRepositoryConfig(access, repositoryId)
  if (config.validationErrors.length)
    throw new RepositoryError('config_mapping_invalid', 422)
  return config.mapping
}

/** Save one explicit mapping using its baseline SHA, preserving all supported unrelated YAML verbatim. */
export async function saveRepositoryConfig(
  access: string,
  repositoryId: number,
  input: unknown,
) {
  const fields = input as Record<string, unknown> | null
  const mapping = fields?.mapping as StatusMapping | undefined
  if (
    !fields ||
    Array.isArray(fields) ||
    Object.keys(fields).some(
      (key) => !['mapping', 'sha', 'branch'].includes(key),
    ) ||
    !(
      fields.sha === null ||
      (typeof fields.sha === 'string' && /^[a-f0-9]{40}$/u.test(fields.sha))
    ) ||
    typeof fields.branch !== 'string' ||
    !mapping ||
    typeof mapping !== 'object' ||
    Array.isArray(mapping) ||
    Object.keys(mapping).length !== 4 ||
    !Object.keys(defaultStatusMapping).every((key) =>
      Object.hasOwn(mapping, key),
    ) ||
    Object.values(mapping).some(
      (value) => !(value === null || typeof value === 'string'),
    )
  )
    throw new RepositoryError('config_mapping_invalid', 422)
  if (saving.has(repositoryId))
    throw new RepositoryError('config_save_pending', 409)
  saving.add(repositoryId)
  try {
    const current = await readRepositoryConfig(access, repositoryId)
    if (current.sha !== fields.sha || current.branch !== fields.branch)
      throw new RepositoryError('config_sha_conflict', 409)
    const { labels } = await readIssueOptions(access, repositoryId, 'labels')
    const { errors } = validateStatusMapping(
      mapping,
      labels.map((label) => label.name),
    )
    if (errors.length) throw new RepositoryError('config_mapping_invalid', 422)
    if (
      current.source !== null &&
      Object.keys(mapping).every(
        (key) =>
          mapping[key as keyof StatusMapping] ===
          current.mapping[key as keyof StatusMapping],
      )
    )
      return current
    const block = [
      'statusLabels:',
      ...Object.entries(mapping).map(
        ([key, value]) => `  ${key}: ${JSON.stringify(value)}`,
      ),
    ]
    let source = `${block.join('\n')}\n`
    if (current.source !== null) {
      const parsed = parseRepositoryConfig(current.source)
      // Preserve comments, whitespace and unrelated top-level fields byte-for-byte.
      const newline = current.source.includes('\r\n') ? '\r\n' : '\n'
      const original = current.source.split(newline)
      const keptComments = original
        .slice(parsed.start + 1, parsed.end)
        .filter((line) => !line.trim() || /^\s*#/u.test(line))
      source = [
        ...original.slice(0, parsed.start),
        ...block,
        ...keptComments,
        ...original.slice(parsed.end),
      ].join(newline)
    }
    let result: unknown
    try {
      result = (
        await githubResponse(
          `/repos/${current.fullName}/contents/${configPath}`,
          access,
          {
            method: 'PUT',
            body: {
              message:
                current.sha === null
                  ? 'chore: initialize issuel status label mapping'
                  : 'chore: update issuel status label mapping',
              content: Buffer.from(source, 'utf8').toString('base64'),
              // Let Contents API create the initial commit on the configured default branch.
              ...(current.emptyRepository ? {} : { branch: current.branch }),
              ...(current.sha === null ? {} : { sha: current.sha }),
            },
          },
        )
      ).data
    } catch (error) {
      if (error instanceof RepositoryError && error.status === 409)
        throw new RepositoryError('config_sha_conflict', 409)
      // A concurrent initial creation can be reported as 422 instead of 409.
      if (error instanceof RepositoryError && error.status === 422) {
        const latest = await readRepositoryConfig(access, repositoryId)
        if (latest.sha !== current.sha)
          throw new RepositoryError('config_sha_conflict', 409)
      }
      throw error
    }
    const content = (result as { content?: { sha?: string } } | null)?.content
    if (
      !content?.sha ||
      content.sha !==
        createHash('sha1')
          .update(`blob ${Buffer.byteLength(source)}\0`)
          .update(source)
          .digest('hex')
    )
      throw new RepositoryError('github_write_uncertain', 502)
    return {
      ...current,
      mapping,
      source,
      sha: content.sha,
      emptyRepository: false,
      validationErrors: [] as string[],
    }
  } finally {
    saving.delete(repositoryId)
  }
}
