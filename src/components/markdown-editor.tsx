import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { CommandManager, Extension, InputRule, mergeAttributes } from '@tiptap/core'
import type { ChainedCommands, Editor } from '@tiptap/core'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { canJoin } from '@tiptap/pm/transform'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Paragraph from '@tiptap/extension-paragraph'
import { common, createLowlight } from 'lowlight'
import { Markdown } from '@tiptap/markdown'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { ListItem, TaskItem, TaskList } from '@tiptap/extension-list'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { isSafeMarkdownUrl, markdownDisplayUrl, parseMarkdown, serializeMarkdown } from '@/lib/markdown-safety'

const lowlight = createLowlight(common)

type Props = {
  value: string
  onChange: (markdown: string) => void
  label: string
  disabled?: boolean
  readOnly?: boolean
  fullName: string
  defaultBranch?: string
  githubUrl?: string
}

/** Keep controlled Markdown authoritative and expose rich editing only after a conservative safety check. */
export function MarkdownEditor({ value, onChange, label, disabled = false, readOnly = false,
  fullName, defaultBranch = 'HEAD', githubUrl = `https://github.com/${fullName}/issues/new`,
}: Props) {
  const { t } = useTranslation()
  const id = useId()
  const sourceInput = useRef<HTMLTextAreaElement>(null)
  const synchronized = useRef<string | null>(null)
  const importedEditor = useRef<Editor | null>(null)
  const [mode, setMode] = useState<'rich' | 'source'>('rich')
  const [warning, setWarning] = useState('')
  const [menuContainer, setMenuContainer] = useState<HTMLElement | undefined>()
  const [activeMenu, setActiveMenu] = useState<'paragraph' | 'table' | null>(null)
  const locked = disabled || readOnly
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        underline: false, trailingNode: false, codeBlock: false, paragraph: false, listItem: false,
        link: { openOnClick: false, autolink: false, linkOnPaste: false,
          isAllowedUri: (url) => isSafeMarkdownUrl(url) },
      }),
      Paragraph.extend({
        /** Preserve literal list markers and trailing text spaces while shortcuts are being typed. */
        renderMarkdown(node, helpers, context) {
          const markdown = this.parent?.(node, helpers, context) ?? ''
          const escaped = markdown.replace(/^([ \t]{0,3})-/gm, '$1\\-')
            .replace(/^([ \t]{0,3}\d+)([.)])(?=[ \t]|$)/gm, '$1\\$2')
          return node.content?.at(-1)?.type === 'text'
            ? escaped.replace(/ +$/, (spaces) => '&#32;'.repeat(spaces.length))
            : escaped
        },
      }),
      ListItem.extend({
        /** Keep an empty bullet item parseable during the dash-and-space input shortcut. */
        renderMarkdown(node, helpers, context) {
          if (context.parentType === 'bulletList' && node.content?.length === 1 &&
            node.content[0].type === 'paragraph' && !node.content[0].content?.length) return '-'
          return this.parent?.(node, helpers, context) ?? ''
        },
      }),
      CodeBlockLowlight.configure({ lowlight, enableTabIndentation: true }),
      Markdown.configure({ markedOptions: { gfm: true } }),
      TaskList, TaskItem.extend({
        /** Convert a typed checkbox marker in a bullet item without changing its siblings or nesting. */
        addInputRules() {
          return [new InputRule({
            find: /^\s*\[([ x])?\]\s$/,
            handler: ({ state, range, match }) => {
              const $start = state.doc.resolve(range.from)
              const depth = $start.depth - 2
              if (depth < 1 || range.from !== $start.start() || $start.index(depth + 1) !== 0 ||
                $start.node(depth).type.name !== 'bulletList' || $start.node(depth + 1).type.name !== 'listItem') return null

              const tr = state.tr.delete(range.from, range.to)
              const list = tr.doc.resolve(range.from).node(depth)
              const index = $start.index(depth)
              const item = list.child(index)
              const before = list.content.cutByIndex(0, index)
              const after = list.content.cutByIndex(index + 1, list.childCount)
              const taskList = state.schema.nodes[this.options.taskListTypeName]
              const task = taskList.create(null, this.type.create({ checked: match[1] === 'x' }, item.content, item.marks))
              const position = $start.before(depth)
              const preceding = before.size ? [list.copy(before)] : []
              tr.replaceWith(position, position + list.nodeSize, [
                ...preceding, task, ...(after.size ? [list.copy(after)] : []),
              ])
              tr.setSelection(TextSelection.create(tr.doc, position + (preceding[0]?.nodeSize ?? 0) + 3))

              // Adjacent checklist blocks must merge so their Markdown reparses to the same structure.
              const start = tr.selection.$from.before(depth)
              if (tr.doc.resolve(start).nodeBefore?.type === taskList && canJoin(tr.doc, start)) tr.join(start)
              const end = tr.selection.$from.after(depth)
              if (tr.doc.resolve(end).nodeAfter?.type === taskList && canJoin(tr.doc, end)) tr.join(end)
            },
          }), ...(this.parent?.() ?? [])]
        },
      }).configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }),
      TableKit.configure({ table: { resizable: false } }),
      Image.extend({
        /** Resolve only the rendered image; serialization retains the original destination. */
        renderHTML({ HTMLAttributes }) {
          return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
            src: markdownDisplayUrl(String(HTMLAttributes.src ?? ''), true, fullName, defaultBranch, githubUrl),
            loading: 'lazy', referrerpolicy: 'no-referrer',
          })]
        },
      }).configure({ inline: true, allowBase64: false }),
      Extension.create({
        name: 'markdownSafety',
        /** Refuse lossy transactions before they can replace the last safe Markdown draft. */
        addProseMirrorPlugins() {
          const instance = this.editor
          return [new Plugin({
            /** Check the proposed document before committing a user edit. */
            filterTransaction(transaction) {
              if (!transaction.docChanged || transaction.getMeta('markdownImport')) return true
              try { serializeMarkdown(instance, transaction.doc.toJSON()); return true }
              catch {
                queueMicrotask(() => {
                  setWarning('This change cannot be represented safely in Markdown. The last safe source was retained.')
                  setMode('source')
                })
                return false
              }
            },
          })]
        },
      }),
    ],
    content: '',
    editable: !locked,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': label, 'aria-multiline': 'true', class: 'issue-markdown markdown-rich' },
      /** Parse pasted Markdown safely as blocks, retaining literal text inside code and ignoring clipboard HTML. */
      handlePaste(view, event) {
        const instance = importedEditor.current
        if (!instance?.isEditable) return true
        const text = event.clipboardData?.getData('text/plain')
        if (text === undefined) return true
        event.preventDefault()
        if (!text) return true
        try {
          const transaction = view.state.tr
          const { $from } = view.state.selection
          if (!text.trim() || $from.parent.type.spec.code ||
            (view.state.storedMarks ?? $from.marks()).some((mark) => mark.type.spec.code)) {
            transaction.insertText(text)
          } else {
            const document = parseMarkdown(instance, text)
            const chain = new CommandManager({ editor: instance }).createChain(transaction)
            if (!chain.insertContent(document.content ?? []).run()) throw new Error('Paste unavailable')
          }
          serializeMarkdown(instance, transaction.doc.toJSON())
          view.dispatch(transaction)
          setWarning('')
        } catch {
          setWarning('This change cannot be represented safely in Markdown. The last safe source was retained.')
          setMode('source')
        }
        return true
      },
      handleDrop: () => true,
      handleClick: (_view, _position, event) => {
        if (event.target instanceof Element && event.target.closest('a')) { event.preventDefault(); return true }
        return false
      },
    },
    onUpdate: ({ editor: instance }) => {
      const markdown = serializeMarkdown(instance, instance.getJSON())
      synchronized.current = markdown
      onChange(markdown)
    },
  }, [fullName, defaultBranch, githubUrl])
  // Selection changes must update toolbar state even when the Markdown value stays unchanged.
  useEditorState({ editor, selector: ({ transactionNumber }) => transactionNumber })

  useEffect(() => {
    editor?.setEditable(!locked, false)
    editor?.setOptions({ editorProps: { ...editor.options.editorProps,
      attributes: { role: 'textbox', 'aria-label': label, 'aria-multiline': 'true', 'aria-readonly': String(readOnly),
        'aria-disabled': String(disabled), class: 'issue-markdown markdown-rich' } } })
  }, [editor, locked, label, readOnly, disabled])

  useEffect(() => {
    if (!editor || (synchronized.current === value && importedEditor.current === editor)) return
    synchronized.current = value
    importedEditor.current = editor
    try {
      const document = parseMarkdown(editor, value)
      editor.chain().setContent(document, { emitUpdate: false }).setMeta('markdownImport', true).run()
      queueMicrotask(() => setWarning(''))
    } catch {
      queueMicrotask(() => {
        setWarning('This Markdown cannot be safely converted to rich text. Your original source is preserved and can be submitted unchanged.')
        setMode('source')
      })
    }
  }, [editor, value])

  /** Switch representation without serializing or changing the authoritative source. */
  function switchMode(next: 'rich' | 'source') {
    if (!editor || disabled) return
    if (next === 'rich') {
      try {
        const document = parseMarkdown(editor, value)
        editor.chain().setContent(document, { emitUpdate: false }).setMeta('markdownImport', true).run()
        setWarning('')
      } catch {
        setWarning('This Markdown cannot be safely converted to rich text. Your original source is preserved and can be submitted unchanged.')
        setMode('source')
        sourceInput.current?.focus()
        return
      }
    }
    setMode(next)
    requestAnimationFrame(() => next === 'rich' ? editor.commands.focus() : sourceInput.current?.focus())
  }

  /** Apply validated destinations to the current selection, or remove the selected link. */
  function editLink() {
    if (!editor || locked) return
    const url = window.prompt(t('Link URL (empty to remove)'), String(editor.getAttributes('link').href ?? ''))
    if (url === null) return
    if (!url) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return }
    if (!isSafeMarkdownUrl(url)) { setWarning('Use an HTTPS, HTTP, mailto or repository-relative link.'); return }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  /** Build a command transaction without dispatching it, rejecting Markdown changes that lose meaning. */
  function previewEdit(command: (chain: ChainedCommands) => ChainedCommands) {
    if (!editor || locked) return null
    const transaction = editor.state.tr
    try {
      const chain = new CommandManager({ editor }).createChain(transaction)
      if (!command(chain).run()) return null
      serializeMarkdown(editor, transaction.doc.toJSON())
      return transaction
    } catch { return null }
  }

  /** Recheck the latest selection before applying an enabled menu action and returning keyboard focus. */
  function applyEdit(command: (chain: ChainedCommands) => ChainedCommands) {
    const transaction = previewEdit(command)
    if (!editor || !transaction) return
    editor.view.dispatch(transaction)
    editor.commands.focus()
  }

  /** Check only visible menu actions and keep their portals inside the native issue dialog. */
  function openMenu(menu: 'paragraph' | 'table', open: boolean) {
    setActiveMenu(open ? menu : null)
    if (open && editor) setMenuContainer(editor.view.dom.closest('dialog') ?? undefined)
  }

  const tableActions = [
    { label: 'Add row', command: (chain: ChainedCommands) => chain.addRowAfter(), icon: 'M4 4h16v16H4z M4 10h16 M8 15h8 M12 11v8' },
    { label: 'Add column', command: (chain: ChainedCommands) => chain.addColumnAfter(), icon: 'M4 4h16v16H4z M10 4v16 M11 12h8 M15 8v8' },
    { label: 'Delete row', command: (chain: ChainedCommands) => chain.deleteRow(), icon: 'M4 4h16v16H4z M4 10h16 M8 15h8' },
    { label: 'Delete column', command: (chain: ChainedCommands) => chain.deleteColumn(), icon: 'M4 4h16v16H4z M10 4v16 M12 12h6' },
    { label: 'Delete table', command: (chain: ChainedCommands) => chain.deleteTable(), icon: 'M4 4h16v16H4z M8 8l8 8 M16 8l-8 8' },
  ]

  const tools = editor ? [
    { label: 'Bold', text: 'B', active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { label: 'Italic', text: 'I', active: editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    { label: 'Strikethrough', text: 'S̶', active: editor.isActive('strike'), run: () => editor.chain().focus().toggleStrike().run() },
    { label: 'Inline code', text: '</>', active: editor.isActive('code'), run: () => editor.chain().focus().toggleCode().run() },
    { label: 'Bullet list', text: '•', active: editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: 'Ordered list', text: '1.', active: editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: 'Checklist', text: '☑', active: editor.isActive('taskList'), run: () => editor.chain().focus().toggleTaskList().run() },
    { label: 'Blockquote', text: '❝', active: editor.isActive('blockquote'), run: () => editor.chain().focus().toggleBlockquote().run() },
    { label: 'Link', text: '↗', active: editor.isActive('link'), run: editLink },
    { label: 'Code block', text: '```', active: editor.isActive('codeBlock'), run: () => editor.chain().focus().toggleCodeBlock().run() },
    { label: 'Horizontal rule', text: '―', active: false, run: () => editor.chain().focus().setHorizontalRule().run() },
  ] : []

  return (
    <div className={`markdown-editor min-w-0 rounded-md border bg-background ${disabled ? 'opacity-60' : ''}`}>
      {/* Representation controls never write a normalized version back to the parent. */}
      <div role="group" aria-label={t('Editor mode')} className="flex gap-1 border-b p-1">
        {(['rich', 'source'] as const).map((item) => (
          <button key={item} type="button" aria-pressed={mode === item} disabled={disabled}
            onClick={() => switchMode(item)} className={`editor-control px-3 ${mode === item ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>
            {t(item === 'rich' ? 'Rich text' : 'Markdown source')}
          </button>
        ))}
      </div>

      {/* Compact format controls retain the text selection when clicked. */}
      {mode === 'rich' && editor && !readOnly && (
        <div role="group" aria-label={t('Formatting')} className="flex flex-wrap items-center gap-0.5 border-b p-1">
          <Select disabled={locked} onOpenChange={(open) => openMenu('paragraph', open)}
            value={String([1, 2, 3, 4, 5, 6].find((level) => editor.isActive('heading', { level })) ?? 0)}
            onValueChange={(value) => {
              const level = Number(value) as 1 | 2 | 3 | 4 | 5 | 6
              applyEdit((chain) => level ? chain.setHeading({ level }) : chain.setParagraph())
            }}>
            <SelectTrigger aria-label={t('Heading')} className="editor-control w-28 border-transparent bg-transparent py-0 shadow-none hover:bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent container={menuContainer} align="start" className="min-w-40 rounded-lg shadow-xl"
              onCloseAutoFocus={(event) => { event.preventDefault(); editor.commands.focus() }}>
              <SelectItem value="0" className="text-xs"
                disabled={locked || (activeMenu === 'paragraph' && !editor.isActive('paragraph') && !previewEdit((chain) => chain.setParagraph()))}>
                {t('Paragraph')}
              </SelectItem>
              {([1, 2, 3, 4, 5, 6] as const).map((level) => (
                <SelectItem key={level} value={String(level)} className="text-xs"
                  disabled={locked || (activeMenu === 'paragraph' && !editor.isActive('heading', { level }) && !previewEdit((chain) => chain.setHeading({ level })))}>
                  <span className="font-medium">H{level}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tools.map((tool) => (
            <button key={tool.label} type="button" className="editor-control min-w-7" title={t(tool.label)}
              aria-label={t(tool.label)} aria-pressed={tool.active} disabled={locked}
              onMouseDown={(event) => event.preventDefault()} onClick={tool.run}>{tool.text}</button>
          ))}

          {/* Table actions appear only for a selection inside a table; unsafe edits stay disabled. */}
          {editor.isActive('table') ? (
            <DropdownMenu.Root modal={false} onOpenChange={(open) => openMenu('table', open)}>
              <DropdownMenu.Trigger asChild>
                <button type="button" disabled={locked} aria-label={t('Table')}
                  className="editor-control inline-flex items-center gap-1.5 px-2 text-foreground">
                  <svg aria-hidden="true" className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4h16v16H4z M4 10h16 M10 4v16" /></svg>
                  {t('Table')}
                  <svg aria-hidden="true" className="size-3 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal container={menuContainer}>
                <DropdownMenu.Content align="start" sideOffset={6}
                  className="z-50 min-w-44 rounded-lg border bg-card p-1 text-card-foreground shadow-xl outline-none"
                  onCloseAutoFocus={(event) => { event.preventDefault(); editor.commands.focus() }}>
                  {tableActions.map((action) => (
                    <Fragment key={action.label}>
                      {action.label === 'Delete table' && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
                      <DropdownMenu.Item disabled={locked || (activeMenu === 'table' && !previewEdit(action.command))}
                        onSelect={() => applyEdit(action.command)}
                        className={`flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-2 text-xs outline-none data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40 ${action.label === 'Delete table' ? 'text-destructive' : ''}`}>
                        <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d={action.icon} /></svg>
                        {t(action.label)}
                      </DropdownMenu.Item>
                    </Fragment>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : (
            <button type="button" className="editor-control inline-flex items-center gap-1.5 px-2"
              disabled={!previewEdit((chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyEdit((chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}>
              <svg aria-hidden="true" className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4h16v16H4z M4 10h16 M10 4v16" /></svg>
              {t('Insert table')}
            </button>
          )}

          {/* Code language remains editable without submitting the surrounding composer. */}
          {editor.isActive('codeBlock') && <input aria-label={t('Code language')} placeholder={t('Code language')}
            value={String(editor.getAttributes('codeBlock').language ?? '')} disabled={locked}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); editor.commands.focus() } }}
            onChange={(event) => {
              if (/^[\w+-]*$/.test(event.target.value)) editor.chain().updateAttributes('codeBlock', { language: event.target.value || null }).run()
            }} className="editor-control w-24 border bg-background px-2" />}
        </div>
      )}

      {/* Both editing surfaces share the exact controlled Markdown string. */}
      <div hidden={mode !== 'rich'} className="relative min-w-0">
        {editor?.isEmpty && editor.state.doc.childCount === 1 && editor.state.doc.firstChild?.type.name === 'paragraph' && (
          <span className="pointer-events-none absolute top-3 left-3 text-sm text-muted-foreground">{t('Write something…')}</span>
        )}
        <EditorContent editor={editor} />
      </div>
      {mode === 'source' && <textarea ref={sourceInput} id={id} aria-label={`${label} — ${t('Markdown source')}`}
        rows={8} value={value} disabled={disabled} readOnly={readOnly} spellCheck={false}
        onChange={(event) => { synchronized.current = null; onChange(event.target.value) }}
        placeholder={t('Write Markdown…')} className="block min-h-40 w-full resize-y rounded-b-md bg-transparent p-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" />}

      {/* A failed conversion keeps source editable and never substitutes a lossy result. */}
      {warning && <p role="status" className="border-t px-3 py-2 text-xs text-amber-300">{t(warning)}</p>}
    </div>
  )
}
