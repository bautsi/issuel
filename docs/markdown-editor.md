# Markdown editor (ISL-10)

GitHub body/comment Markdown remains authoritative. `MarkdownEditor` is controlled
by a Markdown string and is shared by issue creation, explicit description saving
and new comments. Titles and existing read-only rendering are separate.

## Extensions and modes

All Tiptap packages are pinned to 3.32.0. StarterKit supplies headings, paragraphs,
bold, italic, strike, inline code, links, lists, quotes, rules, hard breaks
and undo/redo. Underline and automatic trailing nodes are disabled because they
do not have an unambiguous Markdown representation. Official Markdown uses GFM;
TableKit supplies tables/cells/rows/headers; TaskList and nested TaskItem supply
checklists; inline Image displays existing images without upload/resize support.
CodeBlockLowlight replaces StarterKit's code block with syntax highlighting using
lowlight's common languages and the existing read-only Markdown color styles.
Fenced code and its original language remain Markdown document content.

Opening, locking, unlocking or switching an editor does not call `onChange`.
Source mode always shows the exact controlled string. Only source input or an
accepted rich document edit changes that value. Source input can be submitted
directly even when rich conversion is unavailable.

## Conversion protection

`markdown-safety.ts` uses the existing remark GFM parser with direct unified and
remark-parse dependencies. A small supported-node allowlist rejects raw HTML,
reference definitions/links, fence metadata and recognized extension syntax
before the source reaches Tiptap. The original and serialized GFM structures
must match, ignoring positions and list spacing, while retaining text, escaping
semantics, nesting, checked states, heading levels, code languages, table
alignment and link/image destinations. This is deliberately conservative.

Rich edits are checked by a ProseMirror transaction filter. The serialized
Markdown must parse back into the same schema document (ignoring editor-only
empty paragraphs) and contain only allowed GFM. A lossy edit is rejected before
commit, and the editor switches to the last safe source with an explanation.
Unknown or mismatched conversion never replaces the controlled Markdown.

Unsupported or conservative fallbacks include GitHub alerts, raw HTML (including
HTML table-cell breaks), footnotes, reference links/images, math/dollar syntax,
directives, wiki links, highlight syntax and code fence metadata. Some valid GFM
combinations may also use source mode if the Tiptap serializer cannot preserve
their semantics. This guard is not a promise of full GitHub extension coverage.

## Security and draft lifetime

No Markdown is injected with `dangerouslySetInnerHTML`. Raw HTML stays in the
source textarea. Rich paste parses plain clipboard Markdown through the same
conversion guards before inserting blocks. In code, pasted text remains literal.
Clipboard HTML is ignored, and drops/uploads are disabled.
Links allow HTTPS, HTTP, mailto and relative destinations; images allow
HTTPS/relative destinations. Credentials, control characters and unsafe schemes
are rejected before rich parsing. Rendered relative images use GitHub repository
semantics while their original Markdown URLs remain unchanged. Editor links do
not navigate while editing.

Issue creation and comment submission retain the existing explicit, single-flight
Markdown APIs. Failures retain drafts; confirmed comment success clears its draft.
Description editing uses the ISL-11 workflow documented in
`description-autosave.md`. Its raw provider baseline is captured when editing
starts, so background detail refreshes do not overwrite local edits. Drafts
remain in memory; IndexedDB storage is deferred to ISL-12.

Route changes, browser back/forward, logout and unload warn before discarding
drafts. Closing the new-issue dialog retains its draft for reopening. Closing a
modified description requires confirmation. Browser crashes or revoked
sessions cannot provide durable draft recovery; that belongs to ISL-12.

## Manual acceptance

1. Open a disposable test issue and select **Edit description**. Switch between rich and
   source without typing; source must remain byte-for-byte unchanged. Do not
   modify production issues for validation.
2. Edit headings, emphasis, nested lists, checklists, tables and code blocks;
   inspect source, including code language, table alignment, URLs and escaping.
   Change source, then switch back and check the corresponding rich content.
3. Try empty/whitespace content, hard breaks, relative links/images, special
   characters and long code/table content. Check keyboard focus and page width.
4. Paste a GitHub alert, raw HTML, footnote or unsafe URL into source. Attempt
   rich mode: expect an explanation and unchanged, still-editable source.
   Script/event-handler HTML must remain inert.
5. In a disposable repository, create an issue and submit a new comment in both
   modes. Inspect the request/GitHub body as Markdown. Double-click submission,
   simulate failure, and verify no duplicate request and retained failed input.
   Confirm successful comments clear. Existing comment pagination must still work.
6. Modify a local description/comment or new-issue draft; navigate, press Back,
   reload or log out. Cancel departure to keep the draft. Confirm departure only
   when ready to discard. Description UI must claim Saved only after a provider
   read or accepted write confirms the exact source.

Requested checks: `pnpm lint`, `pnpm typecheck`, `pnpm build`, each once. Conversion
checks can use the installed Tiptap/remark packages directly without a new test
framework or any GitHub writes. Browser/GitHub write acceptance is separate from
local conversion and build checks.
