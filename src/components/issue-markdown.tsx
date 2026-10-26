import Markdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

/** Render GFM with syntax highlighting, safe URLs and repository-relative resources. */
export function IssueMarkdown({
  body, fullName, defaultBranch, githubUrl,
}: {
  body: string
  fullName: string
  defaultBranch: string
  githubUrl: string
}) {
  /** Allow web links and mail links, resolving relative files against the repository default branch. */
  function resolveUrl(value: string, key: string) {
    if (!value || Array.from(value).some((character) =>
      character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )) return ''
    const image = key === 'src'
    try {
      let url: URL
      if (value.startsWith('#')) {
        url = new URL(value, githubUrl)
      } else if (value.startsWith('../')) {
        // GitHub issue/comment links use ../blob/REF and ../../../OWNER/REPO/blob/REF.
        url = new URL(value, githubUrl)
      } else if (value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
        url = new URL(value, 'https://github.com')
      } else {
        const branch = encodeURIComponent(defaultBranch)
        url = new URL(value, `https://github.com/${fullName}/${image ? 'raw' : 'blob'}/${branch}/`)
      }
      if (url.username || url.password) return ''
      if (image && url.origin === 'https://github.com')
        url.pathname = url.pathname.replace(/^(\/[^/]+\/[^/]+)\/blob\//, '$1/raw/')
      if (url.protocol === 'https:' || (!image && ['http:', 'mailto:'].includes(url.protocol)))
        return url.href
    } catch {
      return ''
    }
    return ''
  }

  return (
    <div className="issue-markdown min-w-0 text-sm leading-7">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        skipHtml
        urlTransform={resolveUrl}
        components={{
          a: ({ href, children, title }) => href ? (
            <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>
          ) : <span>{children}</span>,
          img: ({ src, alt, title }) => src ? (
            <a href={src} target="_blank" rel="noopener noreferrer">
              <img src={src} alt={alt ?? ''} title={title} loading="lazy" referrerPolicy="no-referrer" />
            </a>
          ) : <a href={githubUrl} target="_blank" rel="noopener noreferrer">{alt || 'GitHub'}</a>,
          table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
        }}
      >
        {body}
      </Markdown>
    </div>
  )
}
