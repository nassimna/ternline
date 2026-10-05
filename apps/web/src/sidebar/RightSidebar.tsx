import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Alert } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Card } from '../ui/card'
import { Label } from '../ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Button } from '../ui/button'
import { useEffect, useRef, useState } from 'react'
import {
  BookOpenText,
  FileText,
  FolderTree,
  GitCompareArrows,
  History,
  ListTodo,
  RefreshCw,
  Search as SearchIcon,
  ShieldCheck
} from 'lucide-react'

import type {
  ContentDocumentIssueResult,
  ContentPreview,
  OpaqueDocumentRef,
  RecentlyClosedRecord,
  SafeDiffLine,
  SafeMarkdownNode,
  SearchResult,
  SidebarPlacement,
  SidebarSurface,
  TaskSummary,
  TextBoxDocument,
  WorkspaceDirectoryEntry,
  WorkspaceRootDescriptor
} from '@agent-workspace/protocol-client'
import { messages } from '../messages'
import { confirmAction } from '../ui/request-dialog'

const LABELS: Record<SidebarSurface, string> = messages.sidebarSurfaces.labels
const DESCRIPTIONS: Record<SidebarSurface, string> = messages.sidebarSurfaces.descriptions
const MIN_WIDTH = 240
const MAX_WIDTH = 720
const DEFAULT_WIDTH = 320
const OVERLAY_BREAKPOINT = 700
type NodeToolSurface = 'files' | 'textBox' | 'vault' | 'search' | 'taskManager' | 'recentlyClosed'

interface Props {
  enabled: boolean
  workspaceId: string
  paneId: string
  mode?: 'placement' | 'files'
  encryptedSearchEnabled?: boolean
  recentlyClosedEnabled?: boolean
  nodeTaskListEnabled?: boolean
  nodeTaskDetachEnabled?: boolean
  onClose?: () => void
  onFileDirtyChange?: (dirty: boolean) => void
}

export function RightSidebar({
  enabled,
  workspaceId,
  paneId,
  mode = 'placement',
  encryptedSearchEnabled = false,
  recentlyClosedEnabled = false,
  nodeTaskListEnabled = false,
  nodeTaskDetachEnabled = false,
  onClose,
  onFileDirtyChange
}: Props): React.JSX.Element | null {
  const [placement, setPlacement] = useState<SidebarPlacement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedNodeSurface, setNodeSurface] = useState<NodeToolSurface>('files')
  const nodeSurface: NodeToolSurface =
    selectedNodeSurface === 'files' ||
    selectedNodeSurface === 'textBox' ||
    (encryptedSearchEnabled &&
      (selectedNodeSurface === 'vault' || selectedNodeSurface === 'search')) ||
    (nodeTaskListEnabled && selectedNodeSurface === 'taskManager') ||
    (recentlyClosedEnabled && selectedNodeSurface === 'recentlyClosed')
      ? selectedNodeSurface
      : 'files'
  const [fileDirty, setFileDirty] = useState(false)
  const widthRef = useRef(DEFAULT_WIDTH)
  const dockRef = useRef<HTMLElement>(null)

  useEffect(() => {
    onFileDirtyChange?.(fileDirty)
  }, [fileDirty, onFileDirtyChange])

  useEffect(() => {
    if (!enabled || mode === 'files' || !window.desktopBridge.getSidebarPlacement) return
    let active = true
    void window.desktopBridge
      .getSidebarPlacement()
      .then((value) => {
        if (!active) return
        const width = clampWidth(value.width)
        widthRef.current = width
        setPlacement({ ...value, side: 'right', width })
      })
      .catch((cause: unknown) => {
        if (active) setError(messageOf(cause, messages.sidebarSurfaces.serviceUnavailable))
      })
    return () => {
      active = false
    }
  }, [enabled, mode])

  useEffect(() => {
    if (!enabled) return
    const keepWithinWindow = (): void => {
      setPlacement((current) => {
        if (!current) return current
        const width = clampWidth(current.width)
        widthRef.current = width
        return width === current.width ? current : { ...current, width }
      })
    }
    window.addEventListener('resize', keepWithinWindow)
    return () => window.removeEventListener('resize', keepWithinWindow)
  }, [enabled])

  if (!enabled) return null
  if (mode === 'files') {
    const nodeSurfaces: readonly NodeToolSurface[] = [
      'files',
      'textBox',
      ...(encryptedSearchEnabled ? (['vault', 'search'] as const) : []),
      ...(nodeTaskListEnabled ? (['taskManager'] as const) : []),
      ...(recentlyClosedEnabled ? (['recentlyClosed'] as const) : [])
    ]
    const selectNodeSurface = async (surface: NodeToolSurface): Promise<boolean> => {
      if (
        surface !== nodeSurface &&
        nodeSurface === 'files' &&
        fileDirty &&
        !(await confirmAction('Discard unsaved file changes?'))
      ) {
        return false
      }
      setFileDirty(false)
      setNodeSurface(surface)
      return true
    }
    return (
      <Tabs asChild activationMode="manual" value={nodeSurface}>
        <aside
          aria-label={messages.sidebarSurfaces.title}
          className="right-sidebar right-sidebar-files"
        >
          <header className="right-sidebar-header">
            <div className="right-sidebar-heading">
              <span className="right-sidebar-heading-icon" aria-hidden="true">
                <SurfaceIcon surface={nodeSurface} />
              </span>
              <div>
                <span className="right-sidebar-eyebrow">Workspace tools</span>
                <h2>{LABELS[nodeSurface]}</h2>
              </div>
              <Button
                size="small"
                variant="ghost"
                aria-label="Close tools"
                className="right-sidebar-close"
                onClick={() => {
                  void (async () => {
                    if (fileDirty && !(await confirmAction('Discard unsaved file changes?'))) return
                    onClose?.()
                  })()
                }}
                type="button"
              >
                Close
              </Button>
            </div>
            <p>
              {nodeSurface === 'taskManager'
                ? nodeTaskDetachEnabled
                  ? 'Review running tasks and detach available remote sessions.'
                  : 'Review running tasks.'
                : DESCRIPTIONS[nodeSurface]}
            </p>
          </header>
          <TabsList asChild unstyled>
            <nav aria-label="Tool surfaces" className="right-sidebar-tabs">
              {nodeSurfaces.map((surface, index) => (
                <TabsTrigger
                  value={surface}
                  variant="navigation"
                  aria-controls={`right-sidebar-panel-${surface}`}
                  aria-selected={surface === nodeSurface}
                  data-sidebar-tab="true"
                  id={`right-sidebar-tab-${surface}`}
                  key={surface}
                  onClick={() => void selectNodeSurface(surface)}
                  onKeyDown={(event) => {
                    void (async () => {
                      let nextIndex: number | null = null
                      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                        nextIndex = (index - 1 + nodeSurfaces.length) % nodeSurfaces.length
                      }
                      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                        nextIndex = (index + 1) % nodeSurfaces.length
                      }
                      if (event.key === 'Home') nextIndex = 0
                      if (event.key === 'End') nextIndex = nodeSurfaces.length - 1
                      if (nextIndex === null) return
                      event.preventDefault()
                      const next = nodeSurfaces[nextIndex]
                      if (!next) return
                      const tabs =
                        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                          '[data-sidebar-tab="true"]'
                        )
                      if (!(await selectNodeSurface(next))) return
                      tabs?.[nextIndex]?.focus()
                    })()
                  }}

                  tabIndex={surface === nodeSurface ? 0 : -1}
                  type="button"
                >
                  <SurfaceIcon surface={surface} />
                  <span>{LABELS[surface]}</span>
                </TabsTrigger>
              ))}
            </nav>
          </TabsList>
          <TabsContent asChild value={nodeSurface}>
            <section
              aria-label={LABELS[nodeSurface]}
              aria-labelledby={`right-sidebar-tab-${nodeSurface}`}
              className="right-sidebar-panel"
              id={`right-sidebar-panel-${nodeSurface}`}

              tabIndex={0}
            >
              {nodeSurface === 'files' ? (
                <Files editable onDirtyChange={setFileDirty} />
              ) : (
                <Surface
                  surface={nodeSurface}
                  workspaceId={workspaceId}
                  paneId={paneId}
                  nodeTaskMode
                  nodeTaskDetachEnabled={nodeTaskDetachEnabled}
                />
              )}
            </section>
          </TabsContent>
        </aside>
      </Tabs>
    )
  }
  if (!placement) {
    return (
      <aside
        aria-label={messages.sidebarSurfaces.title}
        className="right-sidebar right-sidebar-loading"
      >
        <Alert asChild variant={error ? 'destructive' : 'default'}>
          <p
            className={error ? 'right-sidebar-error' : undefined}
            role={error ? 'alert' : 'status'}
          >
            {error ?? 'Loading tools…'}
          </p>
        </Alert>
      </aside>
    )
  }
  const effective = placement
  const enabledOrder = effective.order.filter((surface) => effective.enabled.includes(surface))
  const save = async (selected: SidebarSurface, width: number): Promise<void> => {
    if (!window.desktopBridge.saveSidebarPlacement) return
    try {
      const next = await window.desktopBridge.saveSidebarPlacement({
        selected,
        width: clampWidth(width),
        expectedRevision: effective.revision
      })
      widthRef.current = next.width
      setPlacement(next)
      setError(null)
    } catch (cause) {
      setError(messageOf(cause, 'Sidebar preferences were not saved.'))
    }
  }
  const resize = (width: number): void => {
    const next = clampWidth(width)
    widthRef.current = next
    setPlacement({ ...effective, width: next })
  }

  return (
    <Tabs asChild activationMode="manual" value={effective.selected}>
      <aside
        aria-label={messages.sidebarSurfaces.title}
        className="right-sidebar"
        ref={dockRef}
        style={{ width: effective.width }}
      >
        <div
          aria-label={messages.sidebarSurfaces.resize}
          aria-orientation="vertical"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={effective.width}
          className="right-sidebar-resizer"
          role="separator"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const delta = event.key === 'ArrowLeft' ? 12 : -12
            resize(widthRef.current + delta)
            void save(effective.selected, widthRef.current)
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            event.currentTarget.dataset.resizing = 'true'
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.dataset.resizing !== 'true') return
            resize(window.innerWidth - event.clientX)
          }}
          onPointerUp={(event) => {
            delete event.currentTarget.dataset.resizing
            event.currentTarget.releasePointerCapture(event.pointerId)
            void save(effective.selected, widthRef.current)
          }}
        />
        <header className="right-sidebar-header">
          <div className="right-sidebar-heading">
            <span className="right-sidebar-heading-icon" aria-hidden="true">
              <SurfaceIcon surface={effective.selected} />
            </span>
            <div>
              <span className="right-sidebar-eyebrow">Workspace tools</span>
              <h2>{LABELS[effective.selected]}</h2>
            </div>
          </div>
          <p>{DESCRIPTIONS[effective.selected]}</p>
        </header>
        <TabsList asChild unstyled>
          <nav aria-label="Tool surfaces" className="right-sidebar-tabs">
            {enabledOrder.map((surface, index) => (
              <TabsTrigger
                value={surface}
                variant="navigation"
                aria-controls={`right-sidebar-panel-${surface}`}
                aria-selected={surface === effective.selected}
                data-sidebar-tab="true"
                id={`right-sidebar-tab-${surface}`}
                key={surface}
                onClick={() => void save(surface, effective.width)}
                onKeyDown={(event) => {
                  let nextIndex: number | null = null
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                    nextIndex = (index - 1 + enabledOrder.length) % enabledOrder.length
                  }
                  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                    nextIndex = (index + 1) % enabledOrder.length
                  }
                  if (event.key === 'Home') nextIndex = 0
                  if (event.key === 'End') nextIndex = enabledOrder.length - 1
                  if (nextIndex === null) return
                  event.preventDefault()
                  const next = enabledOrder[nextIndex]
                  if (!next) return
                  void save(next, effective.width)
                  const tabs =
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                      '[data-sidebar-tab="true"]'
                    )
                  tabs?.[nextIndex]?.focus()
                }}

                tabIndex={surface === effective.selected ? 0 : -1}
                type="button"
              >
                <SurfaceIcon surface={surface} />
                <span>{LABELS[surface]}</span>
              </TabsTrigger>
            ))}
          </nav>
        </TabsList>
        <TabsContent asChild value={effective.selected}>
          <section
            aria-label={LABELS[effective.selected]}
            aria-labelledby={`right-sidebar-tab-${effective.selected}`}
            className="right-sidebar-panel"
            id={`right-sidebar-panel-${effective.selected}`}

            tabIndex={0}
          >
            {error ? (
              <Alert asChild variant="destructive">
                <p className="right-sidebar-error" role="alert">
                  {error}
                </p>
              </Alert>
            ) : null}
            <Surface surface={effective.selected} workspaceId={workspaceId} paneId={paneId} />
          </section>
        </TabsContent>
      </aside>
    </Tabs>
  )
}

function SurfaceIcon({ surface }: { surface: SidebarSurface }): React.JSX.Element {
  const props = { 'aria-hidden': true as const, size: 15, strokeWidth: 1.75 }
  switch (surface) {
    case 'textBox':
      return <FileText {...props} />
    case 'vault':
      return <ShieldCheck {...props} />
    case 'taskManager':
      return <ListTodo {...props} />
    case 'files':
      return <FolderTree {...props} />
    case 'markdown':
      return <BookOpenText {...props} />
    case 'diff':
      return <GitCompareArrows {...props} />
    case 'search':
      return <SearchIcon {...props} />
    case 'recentlyClosed':
      return <History {...props} />
  }
}

function Surface({
  surface,
  workspaceId,
  paneId,
  nodeTaskMode = false,
  nodeTaskDetachEnabled = false
}: {
  surface: SidebarSurface
  workspaceId: string
  paneId: string
  nodeTaskMode?: boolean
  nodeTaskDetachEnabled?: boolean
}) {
  switch (surface) {
    case 'textBox':
      return <TextBoxes workspaceId={workspaceId} />
    case 'vault':
      return <Vault />
    case 'taskManager':
      return <Tasks nodeMode={nodeTaskMode} nodeDetachEnabled={nodeTaskDetachEnabled} />
    case 'files':
      return <Files />
    case 'markdown':
      return <Markdown />
    case 'diff':
      return <Diff />
    case 'search':
      return <Search />
    case 'recentlyClosed':
      return <RecentlyClosed workspaceId={workspaceId} paneId={paneId} />
  }
}

function TextBoxes({ workspaceId }: { workspaceId: string }) {
  const [documents, setDocuments] = useState<TextBoxDocument[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('Untitled')
  const [text, setText] = useState('')
  const [status, setStatus] = useState('Loading…')
  const selected = documents.find((document) => document.textBoxDocumentId === selectedId)
  const reload = async (): Promise<void> => {
    if (!window.desktopBridge.listTextBoxes) return setStatus('Provider unavailable.')
    try {
      const result = await window.desktopBridge.listTextBoxes()
      setDocuments(result.documents)
      setStatus(result.documents.length ? '' : 'No text boxes yet.')
    } catch (cause) {
      setStatus(messageOf(cause, 'Unable to load text boxes.'))
    }
  }
  useEffect(() => {
    queueMicrotask(() => void reload())
  }, [])
  const edit = (document: TextBoxDocument): void => {
    setSelectedId(document.textBoxDocumentId)
    setTitle(document.title)
    setText(document.text)
    setStatus('')
  }
  const save = async (): Promise<void> => {
    setStatus('Saving…')
    try {
      const result = selected
        ? await window.desktopBridge.saveTextBox?.({
            textBoxDocumentId: selected.textBoxDocumentId,
            expectedRevision: selected.contentRevision,
            title,
            text
          })
        : await window.desktopBridge.createTextBox?.({ workspaceId, title, text })
      if (!result) return setStatus('Provider unavailable.')
      setSelectedId(result.textBoxDocumentId)
      setStatus('Saved.')
      await reload()
    } catch (cause) {
      setStatus(messageOf(cause, 'Save failed. Reload before retrying.'))
    }
  }
  const remove = async (): Promise<void> => {
    if (!selected || !window.desktopBridge.deleteTextBox) return setStatus('Provider unavailable.')
    setStatus('Deleting…')
    try {
      await window.desktopBridge.deleteTextBox({
        textBoxDocumentId: selected.textBoxDocumentId,
        expectedRevision: selected.contentRevision
      })
      setSelectedId(null)
      setTitle('Untitled')
      setText('')
      await reload()
      setStatus('Deleted.')
    } catch (cause) {
      setStatus(messageOf(cause, 'Delete failed.'))
    }
  }
  return (
    <div className="surface-stack">
      <div className="surface-list">
        {documents.map((document) => (
          <Button key={document.textBoxDocumentId} onClick={() => edit(document)} type="button">
            {document.title}
          </Button>
        ))}
      </div>
      <Label>
        Title
        <Input value={title} onChange={(event) => setTitle(event.target.value)} />
      </Label>
      <Label>
        Text
        <Textarea rows={10} value={text} onChange={(event) => setText(event.target.value)} />
      </Label>
      <div className="surface-actions">
        <Button
          onClick={() => {
            setSelectedId(null)
            setTitle('Untitled')
            setText('')
            setStatus('')
          }}
          type="button"
        >
          New
        </Button>
        <Button onClick={() => void save()} type="button">
          Save
        </Button>
        <Button disabled={!selected} onClick={() => void remove()} type="button">
          Delete
        </Button>
      </div>
      <p role="status">{status}</p>
    </div>
  )
}

function Vault() {
  const [authorization, setAuthorization] = useState('')
  const [kind, setKind] = useState<'workspaceFile' | 'agentTranscript'>('workspaceFile')
  const [retention, setRetention] = useState(30)
  const [sourceRevision, setSourceRevision] = useState(1)
  const [status, setStatus] = useState(
    'Nothing is indexed until you explicitly enable a local source.'
  )
  const valid = /^[0-9a-f-]{36}$/iu.test(authorization)
  return (
    <div className="surface-stack">
      <h3>Local search privacy</h3>
      <p>{messages.sidebarSurfaces.localPrivacy}</p>
      <Label>
        Authorized source ID
        <Input value={authorization} onChange={(event) => setAuthorization(event.target.value)} />
      </Label>
      <Label>
        Source
        <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="workspaceFile">Workspace files</SelectItem>
            <SelectItem value="agentTranscript">Agent transcripts</SelectItem>
          </SelectContent>
        </Select>
      </Label>
      <Label>
        Retention days
        <Input
          min={1}
          max={365}
          type="number"
          value={retention}
          onChange={(event) => setRetention(Number(event.target.value))}
        />
      </Label>
      <div className="surface-actions">
        <Button
          disabled={!valid}
          onClick={() =>
            void window.desktopBridge
              .setSearchConsent?.({
                sourceAuthorizationId: authorization,
                sourceKind: kind,
                retentionDays: retention,
                exclusionIds: [],
                expectedRevision: sourceRevision
              })
              .then((result) => {
                setSourceRevision(result.revision)
                setStatus(`Source ${result.state}.`)
              })
              .catch((cause) => setStatus(messageOf(cause, 'Consent update failed.')))
          }
          type="button"
        >
          Enable locally
        </Button>
        <Button
          disabled={!valid}
          onClick={() =>
            void window.desktopBridge
              .excludeSearchSource?.({
                sourceAuthorizationId: authorization,
                expectedRevision: sourceRevision
              })
              .then((result) => {
                setSourceRevision(result.revision)
                setStatus(`Source ${result.state}.`)
              })
              .catch((cause) => setStatus(messageOf(cause, 'Exclude failed.')))
          }
          type="button"
        >
          Exclude
        </Button>
        <Button
          disabled={!valid}
          onClick={() =>
            void window.desktopBridge
              .forgetSearchSource?.({
                sourceAuthorizationId: authorization,
                expectedRevision: sourceRevision
              })
              .then((result) => {
                setSourceRevision(result.revision)
                setStatus(`Source ${result.state}.`)
              })
              .catch((cause) => setStatus(messageOf(cause, 'Forget failed.')))
          }
          type="button"
        >
          Forget data
        </Button>
        <Button
          disabled={!valid}
          onClick={() =>
            void window.desktopBridge
              .rebuildSearchSource?.({
                sourceAuthorizationId: authorization,
                expectedRevision: sourceRevision,
                cancellationId: crypto.randomUUID()
              })
              .then((result) => {
                setSourceRevision(result.revision)
                setStatus(`Source ${result.state}.`)
              })
              .catch((cause) => setStatus(messageOf(cause, 'Rebuild failed.')))
          }
          type="button"
        >
          Rebuild index
        </Button>
        <Button
          disabled={!valid}
          onClick={() => {
            setStatus('Preparing export…')
            void window.desktopBridge
              .exportSearchSource?.({ sourceAuthorizationId: authorization })
              .then((saved) => setStatus(saved ? 'Search data exported.' : 'Export canceled.'))
              .catch((cause) => setStatus(messageOf(cause, 'Export failed.')))
          }}
          type="button"
        >
          Export
        </Button>
      </div>
      <p role="status">{status}</p>
    </div>
  )
}

function Tasks({
  nodeMode = false,
  nodeDetachEnabled = false
}: {
  nodeMode?: boolean
  nodeDetachEnabled?: boolean
}) {
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [status, setStatus] = useState('Loading…')
  const [actingOn, setActingOn] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const loadSequence = useRef(0)
  const load = async (cursor?: string): Promise<void> => {
    const sequence = ++loadSequence.current
    setLoading(true)
    try {
      const result = await window.desktopBridge.listTasks?.({
        limit: 100,
        cancellationId: crypto.randomUUID(),
        ...(cursor ? { cursor } : {})
      })
      if (sequence !== loadSequence.current) return
      setTasks((current) =>
        cursor ? [...current, ...(result?.tasks ?? [])] : (result?.tasks ?? [])
      )
      setNextCursor(result?.nextCursor ?? null)
      setStatus(result?.tasks.length || cursor ? '' : nodeMode ? 'No tasks.' : 'No active tasks.')
    } catch (cause) {
      if (sequence !== loadSequence.current) return
      if (nodeMode) setTasks([])
      setNextCursor(null)
      setStatus(messageOf(cause, 'Task provider unavailable.'))
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }
  useEffect(() => {
    queueMicrotask(() => void load())
    return () => {
      loadSequence.current += 1
    }
  }, [])
  const action = async (
    task: TaskSummary,
    action: 'detach' | 'cancel' | 'terminate' | 'forceTerminate'
  ): Promise<void> => {
    const actionKey = `${task.target.sessionId}:${task.target.generation}:${action}`
    setActingOn(actionKey)
    try {
      const result = await window.desktopBridge.actOnTask?.({ action, target: task.target })
      setStatus(
        result === null
          ? 'Action cancelled.'
          : result
            ? `Task ${result.outcome}.`
            : 'Provider unavailable.'
      )
      await load()
    } catch (cause) {
      setStatus(messageOf(cause, 'Task action failed.'))
    } finally {
      setActingOn(null)
    }
  }
  return (
    <div className="surface-stack task-manager-surface">
      <div className="surface-toolbar">
        <div>
          <span className="surface-kicker">{nodeMode ? 'Task activity' : 'Running now'}</span>
          <strong>
            {tasks.length === 0
              ? nodeMode
                ? 'No tasks'
                : 'No active tasks'
              : nodeMode
                ? `${String(tasks.length)} task${tasks.length === 1 ? '' : 's'}`
                : `${String(tasks.length)} active task${tasks.length === 1 ? '' : 's'}`}
          </strong>
        </div>
        <Button
          aria-label="Refresh tasks"
          disabled={loading}
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={14} />
          Refresh
        </Button>
      </div>
      {tasks.map((task) => (
        <Card key={`${task.target.sessionId}:${task.target.generation}`} asChild variant="compact">
          <article className="surface-card task-card">
            <div className="task-card-heading">
              <strong>{task.label}</strong>
              <Badge
                variant={
                  task.lifecycle === 'running' || task.lifecycle === 'created'
                    ? 'success'
                    : 'secondary'
                }
                className="task-state"
                data-lifecycle={task.lifecycle}
              >
                {task.lifecycle}
              </Badge>
            </div>
            <small className="task-summary">
              {task.kind} · {task.lifecycle} · {task.observation}
            </small>
            {(!nodeMode ||
              (nodeDetachEnabled &&
                task.kind === 'remoteSession' &&
                task.lifecycle === 'running')) && (
              <div className="surface-actions task-primary-actions">
                <Button
                  disabled={actingOn !== null || (nodeMode && loading)}
                  onClick={() => void action(task, 'detach')}
                  type="button"
                >
                  Detach
                </Button>
                {!nodeMode ? (
                  <>
                    <Button
                      disabled={actingOn !== null}
                      onClick={() => void action(task, 'cancel')}
                      type="button"
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      className="surface-button-danger"
                      disabled={actingOn !== null}
                      onClick={() => void action(task, 'terminate')}
                      type="button"
                    >
                      Terminate
                    </Button>
                  </>
                ) : null}
              </div>
            )}
            {!nodeMode ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="task-more-actions">More actions</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>
                    Use force termination only when a task does not respond.
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    destructive
                    disabled={actingOn !== null}
                    onSelect={() => void action(task, 'forceTerminate')}
                  >
                    Force terminate
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </article>
        </Card>
      ))}
      {nodeMode && nextCursor ? (
        <Button disabled={loading} onClick={() => void load(nextCursor)} type="button">
          Load more tasks
        </Button>
      ) : null}
      <p className="surface-status" role="status">
        {status}
      </p>
    </div>
  )
}

function Files({
  editable = false,
  onDirtyChange
}: {
  editable?: boolean
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [roots, setRoots] = useState<WorkspaceRootDescriptor[]>([])
  const [entries, setEntries] = useState<WorkspaceDirectoryEntry[]>([])
  const [trail, setTrail] = useState<{ label: string; descriptorId: string; generation: number }[]>(
    []
  )
  const [preview, setPreview] = useState<{
    name: string
    text: string
    document: OpaqueDocumentRef
    contentRevision: number
    complete: boolean
  } | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('Loading…')
  const draftBytes = draft === null ? 0 : new TextEncoder().encode(draft).byteLength
  useEffect(() => {
    onDirtyChange?.(draft !== null && draft !== preview?.text)
  }, [draft, preview?.text, onDirtyChange])
  useEffect(() => {
    void window.desktopBridge
      .listContentRoots?.()
      .then((result) => {
        setRoots(result.roots)
        setStatus(result.roots.length ? 'Choose a root.' : 'No authorized workspace roots.')
      })
      .catch((cause) => setStatus(messageOf(cause, 'File provider unavailable.')))
  }, [])
  const canLeave = async (): Promise<boolean> =>
    !saving &&
    (draft === null ||
      draft === preview?.text ||
      (await confirmAction('Discard unsaved file changes?')))
  const open = async (nextTrail: typeof trail): Promise<void> => {
    if (!(await canLeave())) return
    const directory = nextTrail.at(-1)
    if (!directory) return
    try {
      const result = await window.desktopBridge.listContentDirectory?.({
        directoryDescriptorId: directory.descriptorId,
        generation: directory.generation,
        limit: 100,
        cancellationId: crypto.randomUUID()
      })
      setTrail(nextTrail)
      setEntries(result?.entries ?? [])
      setPreview(null)
      setDraft(null)
      setStatus(result?.entries.length ? '' : 'This directory is empty.')
    } catch (cause) {
      setStatus(messageOf(cause, 'Directory is unavailable.'))
    }
  }
  const previewFile = async (entry: WorkspaceDirectoryEntry): Promise<void> => {
    if (!(await canLeave())) return
    try {
      const issued = await window.desktopBridge.issueContentDocument?.({
        authorizedDescriptorId: entry.entryDescriptorId,
        descriptorGeneration: entry.generation,
        expectedKind: 'plainText'
      })
      if (!issued) return setStatus('File provider unavailable.')
      const content = await window.desktopBridge.readContent?.({
        document: issued.document,
        offset: 0,
        maxBytes: 65536
      })
      if (!content) return setStatus('File provider unavailable.')
      if (content.kind === 'unavailable') {
        setPreview(null)
        setDraft(null)
        setStatus(`Preview unavailable: ${content.reason}.`)
        return
      }
      setPreview({
        name: content.chunk.displayName,
        text: content.chunk.text,
        document: content.chunk.document,
        contentRevision: content.chunk.contentRevision,
        complete: content.chunk.eof
      })
      setDraft(null)
      setStatus(content.chunk.eof ? '' : 'Preview limited to the first 64 KiB.')
    } catch (cause) {
      setPreview(null)
      setStatus(messageOf(cause, 'File preview is unavailable.'))
    }
  }
  const save = async (): Promise<void> => {
    if (!preview || draft === null || saving || !preview.complete || draftBytes > 256 * 1024) return
    setSaving(true)
    try {
      const saved = await window.desktopBridge.saveContent?.({
        document: preview.document,
        expectedRevision: preview.contentRevision,
        text: draft
      })
      if (!saved) throw new Error('File editing is unavailable.')
      setPreview({
        ...preview,
        document: saved.document,
        contentRevision: saved.contentRevision,
        text: draft
      })
      setDraft(null)
      setStatus('Saved.')
    } catch (cause) {
      const detail = messageOf(cause, '')
      setStatus(
        /stale_revision|changed|conflict/iu.test(detail)
          ? 'This file changed on disk. Copy your edits, then reopen the file before saving.'
          : 'The file was not saved.'
      )
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="surface-stack files-surface">
      <h3>Authorized roots</h3>
      <div className="files-roots">
        {roots.map((root) => (
          <Button
            variant="ghost"
            aria-pressed={trail[0]?.descriptorId === root.directoryDescriptorId}
            className="files-root"
            key={root.rootId}
            onClick={() =>
              void open([
                {
                  label: root.label,
                  descriptorId: root.directoryDescriptorId,
                  generation: root.generation
                }
              ])
            }
            type="button"
          >
            <FolderTree aria-hidden="true" size={14} />
            <span>{root.label}</span>
          </Button>
        ))}
      </div>
      {trail.length ? (
        <div className="surface-toolbar">
          <div>
            <span className="surface-kicker">Directory</span>
            <strong>{trail.map(({ label }) => label).join(' / ')}</strong>
          </div>
          {trail.length > 1 ? (
            <Button onClick={() => void open(trail.slice(0, -1))} type="button">
              Back
            </Button>
          ) : null}
        </div>
      ) : null}
      {entries.length ? (
        <div className="files-entries">
          {entries.map((entry) => (
            <Button
              variant="ghost"
              className="files-entry"
              key={entry.entryDescriptorId}
              onClick={() =>
                void (entry.kind === 'directory'
                  ? open([
                      ...trail,
                      {
                        label: entry.label,
                        descriptorId: entry.entryDescriptorId,
                        generation: entry.generation
                      }
                    ])
                  : previewFile(entry))
              }
              type="button"
            >
              {entry.kind === 'directory' ? (
                <FolderTree aria-hidden="true" size={14} />
              ) : (
                <FileText aria-hidden="true" size={14} />
              )}
              <span>{entry.label}</span>
            </Button>
          ))}
        </div>
      ) : null}
      {preview ? (
        <section aria-label={`Preview ${preview.name}`}>
          <div className="surface-toolbar">
            <h3>{preview.name}</h3>
            {editable && preview.complete ? (
              <div className="surface-actions">
                {draft === null ? (
                  <Button onClick={() => setDraft(preview.text)} type="button">
                    Edit
                  </Button>
                ) : (
                  <>
                    <Button
                      disabled={saving || draft === preview.text || draftBytes > 256 * 1024}
                      onClick={() => void save()}
                      type="button"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </Button>
                    <Button disabled={saving} onClick={() => setDraft(null)} type="button">
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            ) : null}
          </div>
          {draft === null ? (
            <pre className="safe-file-preview">{preview.text}</pre>
          ) : (
            <Label>
              <span className="sr-only">Edit {preview.name}</span>
              <Textarea
                variant="code"
                aria-label={`Edit ${preview.name}`}
                className="safe-file-editor"
                disabled={saving}
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
                value={draft}
              />
              {draftBytes > 256 * 1024 ? <span>Files can be saved up to 256 KiB.</span> : null}
            </Label>
          )}
        </section>
      ) : null}
      {status ? <p role="status">{status}</p> : null}
    </div>
  )
}

function DocumentPicker({ onIssue }: { onIssue: (document: ContentDocumentIssueResult) => void }) {
  const [descriptor, setDescriptor] = useState('')
  const [generation, setGeneration] = useState(1)
  const [status, setStatus] = useState('Paste an authorized opaque file descriptor from Files.')
  return (
    <div className="surface-stack">
      <Label>
        Descriptor ID
        <Input value={descriptor} onChange={(event) => setDescriptor(event.target.value)} />
      </Label>
      <Label>
        Generation
        <Input
          min={1}
          type="number"
          value={generation}
          onChange={(event) => setGeneration(Number(event.target.value))}
        />
      </Label>
      <Button
        onClick={() =>
          void window.desktopBridge
            .issueContentDocument?.({
              authorizedDescriptorId: descriptor,
              descriptorGeneration: generation,
              expectedKind: 'markdown'
            })
            .then((result) => (result ? onIssue(result) : setStatus('Provider unavailable.')))
            .catch((cause) => setStatus(messageOf(cause, 'Document authorization failed.')))
        }
        type="button"
      >
        Authorize document
      </Button>
      <p role="status">{status}</p>
    </div>
  )
}

function Markdown() {
  const [document, setDocument] = useState<ContentDocumentIssueResult | null>(null)
  const [nodes, setNodes] = useState<SafeMarkdownNode[]>([])
  const [status, setStatus] = useState('No document selected.')
  const render = async (issued: ContentDocumentIssueResult): Promise<void> => {
    setDocument(issued)
    try {
      const result = await window.desktopBridge.renderMarkdown?.({ document: issued.document })
      setNodes(result?.nodes ?? [])
      setStatus(result ? '' : 'Provider unavailable.')
    } catch (cause) {
      setStatus(messageOf(cause, 'Markdown is unavailable.'))
    }
  }
  return (
    <div className="surface-stack">
      <DocumentPicker onIssue={(issued) => void render(issued)} />
      {document ? (
        <>
          <h3>{document.displayName}</h3>
          <small>
            Opaque document {document.document.documentId} · identity{' '}
            {document.document.identityVersion}
          </small>
        </>
      ) : null}
      <div className="safe-markdown">
        {nodes.map((node, index) => (
          <SafeMarkdown key={index} node={node} />
        ))}
      </div>
      <p role="status">{status}</p>
    </div>
  )
}

export function SafeMarkdown({ node }: { node: SafeMarkdownNode }): React.JSX.Element {
  const children =
    'children' in node
      ? node.children.map((child, index) => <SafeMarkdown key={index} node={child} />)
      : null
  switch (node.kind) {
    case 'heading': {
      const Tag = `h${node.level}` as keyof React.JSX.IntrinsicElements
      return <Tag>{children}</Tag>
    }
    case 'paragraph':
      return <p>{children}</p>
    case 'list': {
      const Tag = node.ordered ? 'ol' : 'ul'
      return (
        <Tag>
          {node.items.map((item, index) => (
            <SafeMarkdown key={index} node={item} />
          ))}
        </Tag>
      )
    }
    case 'listItem':
      return <li>{children}</li>
    case 'emphasis':
      return <em>{children}</em>
    case 'strong':
      return <strong>{children}</strong>
    case 'link':
      return (
        <a
          href={node.href}
          onClick={(event) => {
            event.preventDefault()
            void window.desktopBridge.openExternal(node.href)
          }}
          rel="noreferrer"
          target="_blank"
        >
          {node.label}
        </a>
      )
    case 'code':
      return <code>{node.text}</code>
    case 'codeBlock':
      return (
        <pre>
          <code>{node.text}</code>
        </pre>
      )
    case 'text':
      return <>{node.text}</>
  }
}

function Diff() {
  const [before, setBefore] = useState('')
  const [after, setAfter] = useState('')
  const [beforeVersion, setBeforeVersion] = useState(1)
  const [afterVersion, setAfterVersion] = useState(1)
  const [lines, setLines] = useState<SafeDiffLine[]>([])
  const [status, setStatus] = useState('Choose two opaque document IDs.')
  const ref = (documentId: string, identityVersion: number): OpaqueDocumentRef => ({
    documentId,
    identityVersion
  })
  return (
    <div className="surface-stack">
      <Label>
        Before document
        <Input value={before} onChange={(event) => setBefore(event.target.value)} />
      </Label>
      <Label>
        After document
        <Input value={after} onChange={(event) => setAfter(event.target.value)} />
      </Label>
      <Label>
        Before identity
        <Input
          min={1}
          type="number"
          value={beforeVersion}
          onChange={(event) => setBeforeVersion(Number(event.target.value))}
        />
      </Label>
      <Label>
        After identity
        <Input
          min={1}
          type="number"
          value={afterVersion}
          onChange={(event) => setAfterVersion(Number(event.target.value))}
        />
      </Label>
      <Button
        onClick={() =>
          void window.desktopBridge
            .diffContent?.({
              before: ref(before, beforeVersion),
              after: ref(after, afterVersion),
              maxBytes: 65536
            })
            .then((result) => {
              setLines(result?.lines ?? [])
              setStatus(result?.truncated ? 'Diff truncated.' : '')
            })
            .catch((cause) => setStatus(messageOf(cause, 'Diff unavailable.')))
        }
        type="button"
      >
        Compare
      </Button>
      <pre className="safe-diff">
        {lines.map((line, index) => (
          <span data-kind={line.kind} key={index}>
            {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
            {line.text}
            {'\n'}
          </span>
        ))}
      </pre>
      <p role="status">{status}</p>
    </div>
  )
}

function Search() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [preview, setPreview] = useState<ContentPreview | null>(null)
  const [status, setStatus] = useState('Search only includes locally consented sources.')
  return (
    <form
      className="surface-stack"
      onSubmit={(event) => {
        event.preventDefault()
        void window.desktopBridge
          .searchContent?.({ query, limit: 100, cancellationId: crypto.randomUUID() })
          .then((result) => {
            setResults(result?.results ?? [])
            setStatus(
              result?.results.length
                ? result.truncated
                  ? 'Results truncated.'
                  : ''
                : 'No matches.'
            )
          })
          .catch((cause) => setStatus(messageOf(cause, 'Search unavailable.')))
      }}
    >
      <Label>
        Search
        <Input value={query} onChange={(event) => setQuery(event.target.value)} />
      </Label>
      <Button type="submit">Search</Button>
      {results.map((result, index) => (
        <Card key={index} asChild variant="compact">
          <article className="surface-card">
            <small>{result.sourceKind}</small>
            <p>{result.snippet}</p>
            <Button
              onClick={() =>
                void window.desktopBridge
                  .readContent?.({ document: result.document, offset: 0, maxBytes: 65536 })
                  .then((content) => content && setPreview(content))
                  .catch((cause) => setStatus(messageOf(cause, 'Search result is unavailable.')))
              }
              type="button"
            >
              Open preview
            </Button>
          </article>
        </Card>
      ))}
      {preview?.kind === 'text' ? (
        <section aria-label={`Preview ${preview.chunk.displayName}`}>
          <h3>{preview.chunk.displayName}</h3>
          <pre className="safe-file-preview">{preview.chunk.text}</pre>
        </section>
      ) : preview?.kind === 'unavailable' ? (
        <p>Preview unavailable: {preview.reason}.</p>
      ) : null}
      <p role="status">{status}</p>
    </form>
  )
}

function RecentlyClosed({ workspaceId, paneId }: { workspaceId: string; paneId: string }) {
  const [records, setRecords] = useState<RecentlyClosedRecord[]>([])
  const [status, setStatus] = useState('Loading…')
  const loadSequence = useRef(0)
  const load = async (successStatus?: string): Promise<void> => {
    const requestId = ++loadSequence.current
    try {
      const result = await window.desktopBridge.listRecentlyClosed?.()
      if (requestId !== loadSequence.current) return
      setRecords(result?.records ?? [])
      setStatus(
        successStatus
          ? result?.records.length
            ? successStatus
            : 'Recently closed changed. Nothing remains.'
          : result?.records.length
            ? ''
            : 'Nothing recently closed.'
      )
    } catch (cause) {
      if (requestId !== loadSequence.current) return
      setStatus(messageOf(cause, 'Recently closed is unavailable.'))
    }
  }
  const reopen = async (record: RecentlyClosedRecord): Promise<void> => {
    try {
      const restore = window.desktopBridge.reopenRecentlyClosed
      if (!restore) throw new Error('Recently closed is unavailable.')
      await restore({
        record: {
          recentlyClosedId: record.recentlyClosedId,
          authorizedDescriptorId: record.authorizedDescriptorId,
          action: record.action,
          expectedRevision: record.revision
        },
        workspaceId,
        paneId
      })
      await load()
    } catch (cause) {
      const detail = messageOf(cause, 'Reopen failed.')
      if (/stale_revision|revision_conflict|idempotency_conflict|conflict/iu.test(detail)) {
        setStatus('Recently closed changed. Refreshing…')
        await load('Recently closed changed. Choose an item again.')
      } else {
        setStatus(detail)
      }
    }
  }
  useEffect(() => {
    queueMicrotask(() => void load())
    return () => {
      loadSequence.current += 1
    }
  }, [])
  return (
    <div className="surface-stack">
      <div className="surface-toolbar">
        <div>
          <span className="surface-kicker">Restore</span>
          <strong>Recently Closed</strong>
        </div>
        <Button aria-label="Refresh recently closed" onClick={() => void load()} type="button">
          <RefreshCw aria-hidden="true" size={14} />
          Refresh
        </Button>
      </div>
      {records.map((record) => (
        <Card key={record.recentlyClosedId} asChild variant="compact">
          <article className="surface-card">
            <strong>{record.label}</strong>
            <small>{record.action}</small>
            <Button onClick={() => void reopen(record)} type="button">
              Reopen
            </Button>
          </article>
        </Card>
      ))}
      <p role="status">{status}</p>
    </div>
  )
}

function clampWidth(width: number): number {
  const viewportWidth = window.innerWidth
  const viewportMaximum =
    viewportWidth <= 0
      ? MAX_WIDTH
      : viewportWidth <= OVERLAY_BREAKPOINT
        ? viewportWidth
        : viewportWidth * 0.45
  return Math.round(
    Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, viewportMaximum), width))
  )
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
