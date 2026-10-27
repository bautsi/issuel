import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Editor, JSONContent } from '@tiptap/core'

const parser = unified().use(remarkParse).use(remarkGfm)
const supported = new Set([
  'root', 'paragraph', 'heading', 'text', 'strong', 'emphasis', 'delete',
  'inlineCode', 'code', 'break', 'thematicBreak', 'blockquote', 'list',
  'listItem', 'link', 'image', 'table', 'tableRow', 'tableCell',
])

/** Restrict rendered destinations to web/mail links and repository-relative paths. */
export function isSafeMarkdownUrl(value: string, image = false) {
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) return false
  try {
    const url = new URL(value, 'https://github.com')
    return !url.username && !url.password &&
      (url.protocol === 'https:' || (!image && ['http:', 'mailto:'].includes(url.protocol)))
  } catch { return false }
}

/** Resolve display URLs without replacing the original relative Markdown destinations. */
export function markdownDisplayUrl(value: string, image: boolean, fullName: string, branch: string, githubUrl: string) {
  if (!isSafeMarkdownUrl(value, image)) return ''
  const base = value.startsWith('#') || value.startsWith('../') ? githubUrl
    : value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value) ? 'https://github.com'
      : `https://github.com/${fullName}/${image ? 'raw' : 'blob'}/${encodeURIComponent(branch)}/`
  const url = new URL(value, base)
  if (image && url.origin === 'https://github.com')
    url.pathname = url.pathname.replace(/^(\/[^/]+\/[^/]+)\/blob\//, '$1/raw/')
  return url.href
}

/** Compare only supported GFM semantics; unknown constructs fail closed before Tiptap parses HTML. */
function markdownSemantics(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(markdownSemantics)
  if (!value || typeof value !== 'object') return value
  const node = value as Record<string, unknown>
  if (typeof node.type === 'string' && !supported.has(node.type)) throw new Error('Unsupported Markdown')
  if (node.type === 'code' && node.meta) throw new Error('Code fence metadata')
  if (typeof node.url === 'string' && !isSafeMarkdownUrl(node.url, node.type === 'image'))
    throw new Error('Unsafe URL')
  if (node.type === 'text' && typeof node.value === 'string' &&
    /\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]|\[\^|\[\[|\$|(?:^|\n)\s*:::|==[^=]+==/.test(node.value))
    throw new Error('Extended Markdown requires source mode')
  return Object.fromEntries(Object.entries(node)
    .filter(([key]) => key !== 'position' && key !== 'spread')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => [key, markdownSemantics(entry)]))
}

/** Ignore editor-only empty paragraphs while retaining all meaningful node attributes and marks. */
function documentSemantics(node: JSONContent): unknown {
  return {
    ...node,
    content: (node.content ?? []).filter((child) => child.type !== 'paragraph' || child.content?.length)
      .map(documentSemantics),
  }
}

/** Reject rich edits that cannot serialize and reparse into the same meaningful editor document. */
export function serializeMarkdown(editor: Editor, document: JSONContent) {
  if (!editor.markdown) throw new Error('Markdown unavailable')
  const markdown = editor.markdown.serialize(document)
  markdownSemantics(parser.parse(markdown))
  const reparsed = editor.schema.nodeFromJSON(editor.markdown.parse(markdown)).toJSON() as JSONContent
  if (JSON.stringify(documentSemantics(document)) !== JSON.stringify(documentSemantics(reparsed)))
    throw new Error('Lossy Markdown serialization')
  return markdown
}

/** Verify original-source semantics independently of Tiptap before accepting a rich representation. */
export function parseMarkdown(editor: Editor, source: string) {
  const original = JSON.stringify(markdownSemantics(parser.parse(source)))
  if (!editor.markdown) throw new Error('Markdown unavailable')
  const document = editor.schema.nodeFromJSON(editor.markdown.parse(source)).toJSON() as JSONContent
  const serialized = serializeMarkdown(editor, document)
  if (original !== JSON.stringify(markdownSemantics(parser.parse(serialized))))
    throw new Error('Lossy Markdown conversion')
  return document
}
