import { Card } from '../ui/card'
import { Label } from '../ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { Checkbox } from '../ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { AlertCircle, Check, ChevronDown, LoaderCircle, Monitor, Moon, Sun } from 'lucide-react'
import { configurationUpdateParamsSchema } from '@agent-workspace/protocol-client'

import type {
  ConfigurationSnapshot,
  ConfigurationUpdate,
  DiagnosticBundlePreview
} from '@agent-workspace/protocol-client'

import type { DesktopUpdateState } from '@agent-workspace/contracts/desktop/desktop-bridge'
import { useConfigurationStore } from '../configuration-store'
import { messages } from '../messages'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

export interface ConfigurationSettingsHandle {
  flush(): Promise<boolean>
}

interface ConfigurationSettingsProps {
  activeSection: ConfigurationSettingsSection
  configurationV2: boolean
  nodePreview?: boolean
  ref?: Ref<ConfigurationSettingsHandle>
  readOnly?: boolean
  open: boolean
}

export type ConfigurationSettingsSection =
  'appearance' | 'terminal' | 'notifications' | 'updates' | 'advanced'

const editableSections = ['appearance', 'terminal', 'notifications', 'updates', 'logging'] as const

function sectionChanged(
  current: ConfigurationSnapshot,
  baseline: ConfigurationSnapshot,
  section: (typeof editableSections)[number]
): boolean {
  return JSON.stringify(current[section]) !== JSON.stringify(baseline[section])
}

export function ConfigurationSettings({
  activeSection,
  configurationV2,
  nodePreview = false,
  ref,
  readOnly = false,
  open
}: ConfigurationSettingsProps): React.JSX.Element {
  const config = useConfigurationStore((state) => state.config)
  const configurationStatus = useConfigurationStore((state) => state.status)
  const [draft, setDraft] = useState<ConfigurationSnapshot | null>(null)
  const draftRef = useRef<ConfigurationSnapshot | null>(null)
  const baselineRef = useRef<ConfigurationSnapshot | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const savingRef = useRef<Promise<boolean> | null>(null)
  const [updateState, setUpdateState] = useState<DesktopUpdateState | null>(null)
  const [diagnosticPreview, setDiagnosticPreview] = useState<DiagnosticBundlePreview | null>(null)
  const [diagnosticBusy, setDiagnosticBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    void useConfigurationStore.getState().initialize(window.desktopBridge)
  }, [open])

  useEffect(() => {
    if (!open || !config) return
    queueMicrotask(() => {
      const next = structuredClone(config)
      const previous = baselineRef.current
      const current = draftRef.current
      if (previous && current) {
        for (const section of editableSections) {
          if (sectionChanged(current, previous, section)) {
            Object.assign(next, { [section]: current[section] })
          }
        }
      }
      baselineRef.current = config
      draftRef.current = next
      setDraft(next)
    })
  }, [config, open])

  const adoptDraft = (next: ConfigurationSnapshot): void => {
    draftRef.current = next
    setDraft(next)
  }

  const updateDraft = (update: (current: ConfigurationSnapshot) => ConfigurationSnapshot): void => {
    const current = draftRef.current
    if (!current) return
    setSaveFailed(false)
    setStatus(null)
    adoptDraft(update(current))
  }

  useEffect(() => {
    if (!open) return
    const bridge = window.desktopBridge
    let active = true
    let receivedEvent = false
    const remove = bridge.onUpdateState?.((state) => {
      receivedEvent = true
      if (active) setUpdateState(state)
    })
    if (bridge.getUpdateState) {
      void bridge
        .getUpdateState()
        .then((state) => {
          if (active && !receivedEvent) setUpdateState(state)
        })
        .catch(() => {
          if (active) setStatus(messages.settings.updater.actionFailed)
        })
    }
    return () => {
      active = false
      remove?.()
    }
  }, [open])

  const flush = useCallback(async (): Promise<boolean> => {
    while (savingRef.current) {
      if (!(await savingRef.current)) return false
    }
    const bridge = window.desktopBridge
    const currentConfig = useConfigurationStore.getState().config
    const currentDraft = draftRef.current
    if (readOnly || !currentConfig || !currentDraft) return true
    const update: ConfigurationUpdate = {}
    for (const section of editableSections) {
      if (sectionChanged(currentDraft, baselineRef.current ?? currentConfig, section)) {
        Object.assign(update, { [section]: currentDraft[section] })
      }
    }
    if (Object.keys(update).length === 0) return true
    const params = { expectedRevision: currentConfig.revision, update }
    if (!configurationUpdateParamsSchema.safeParse(params).success) {
      setStatus(messages.settings.invalidValues)
      setSaveFailed(true)
      return false
    }
    if (!bridge.updateConfiguration) return false
    setSaving(true)
    setStatus(null)
    const operation = (async (): Promise<boolean> => {
      try {
        const result = await bridge.updateConfiguration!(params)
        const next = structuredClone(result.config)
        const latestDraft = draftRef.current
        if (latestDraft) {
          for (const section of editableSections) {
            if (sectionChanged(latestDraft, currentDraft, section)) {
              Object.assign(next, { [section]: latestDraft[section] })
            }
          }
        }
        baselineRef.current = result.config
        adoptDraft(next)
        useConfigurationStore.getState().apply(result.config)
        setSaveFailed(false)
        setStatus(messages.settings.saved)
        return true
      } catch (error) {
        await useConfigurationStore.getState().refresh()
        setSaveFailed(true)
        setStatus(
          error instanceof Error && /conflict|revision|stale/iu.test(error.message)
            ? messages.settings.conflict
            : messages.settings.saveFailed
        )
        return false
      } finally {
        savingRef.current = null
        setSaving(false)
      }
    })()
    savingRef.current = operation
    return operation
  }, [readOnly])

  useImperativeHandle(ref, () => ({ flush }), [flush])

  const dirty = Boolean(
    config && draft && editableSections.some((section) => sectionChanged(draft, config, section))
  )
  useEffect(() => {
    if (!open || !dirty || readOnly || saveFailed || saving) return
    const timer = window.setTimeout(() => void flush(), 350)
    return () => window.clearTimeout(timer)
  }, [draft, dirty, flush, open, readOnly, saveFailed, saving])

  const runUpdateAction = async (
    action: 'checkForUpdate' | 'downloadUpdate' | 'installUpdate'
  ): Promise<void> => {
    const operation = window.desktopBridge[action]
    if (!operation) return
    setStatus(null)
    try {
      const result = await operation()
      if (result) setUpdateState(result)
    } catch {
      setStatus(messages.settings.updater.actionFailed)
    }
  }

  const previewDiagnostics = async (): Promise<void> => {
    if (!window.desktopBridge.previewDiagnostics || diagnosticBusy) return
    setDiagnosticBusy(true)
    setStatus(null)
    try {
      setDiagnosticPreview(await window.desktopBridge.previewDiagnostics())
    } catch {
      setDiagnosticPreview(null)
      setStatus(messages.lifecycle.actionFailed)
    } finally {
      setDiagnosticBusy(false)
    }
  }

  const exportDiagnostics = async (): Promise<void> => {
    if (!window.desktopBridge.exportDiagnostics || !diagnosticPreview || diagnosticBusy) return
    setDiagnosticBusy(true)
    setStatus(null)
    try {
      const result = await window.desktopBridge.exportDiagnostics(diagnosticPreview)
      if (result !== null) setDiagnosticPreview(null)
      setStatus(
        result === null
          ? messages.lifecycle.diagnosticsExportCancelled
          : messages.lifecycle.diagnosticsExported
      )
    } catch {
      setDiagnosticPreview(null)
      setStatus(messages.lifecycle.actionFailed)
    } finally {
      setDiagnosticBusy(false)
    }
  }

  if (!draft) {
    const unavailable = configurationStatus === 'unavailable'
    const failed = configurationStatus === 'error'
    return status ? (
      <p className="configuration-status" role="status">
        {status}
      </p>
    ) : (
      <p className="configuration-status" role="status">
        {unavailable
          ? messages.settings.configurationUnavailable
          : failed
            ? messages.settings.loadFailed
            : messages.settings.loading}
      </p>
    )
  }

  const interfaceFontFamily =
    draft.appearance.fontFamily === "system-ui, 'Segoe UI', 'Cantarell', 'Ubuntu', sans-serif"
      ? 'Geist'
      : draft.appearance.fontFamily

  return (
    <div className="configuration-settings">
      {readOnly ? (
        <p className="configuration-status" role="status">
          {messages.settings.configurationReadOnly}
        </p>
      ) : null}
      {!readOnly ? (
        <div className="configuration-status" data-error={saveFailed} role="status">
          {saveFailed ? (
            <AlertCircle aria-hidden="true" size={14} />
          ) : saving || dirty ? (
            <LoaderCircle aria-hidden="true" size={14} />
          ) : !status || status === messages.settings.saved ? (
            <Check aria-hidden="true" size={14} />
          ) : null}
          <span>
            {saving || (dirty && !saveFailed)
              ? messages.settings.saving
              : (status ?? messages.settings.autoSave)}
          </span>
          {saveFailed ? (
            <Button onClick={() => void flush()} size="small" variant="ghost">
              {messages.settings.retry}
            </Button>
          ) : null}
        </div>
      ) : null}
      <fieldset className="configuration-read-only-fields" disabled={readOnly}>
        <SettingsSection
          activeSection={activeSection}
          section="appearance"
          title={messages.settings.appearance}
        >
          <p className="appearance-group-label">{messages.settings.fields.theme}</p>
          <div
            className="appearance-theme-picker"
            role="group"
            aria-label={messages.settings.fields.theme}
          >
            {(['system', 'light', 'dark'] as const).map((theme) => {
              const Icon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon
              return (
                <Button
                  aria-pressed={draft.appearance.theme === theme}
                  className="appearance-theme-option"
                  key={theme}
                  onClick={() =>
                    updateDraft((current) => ({
                      ...current,
                      appearance: { ...current.appearance, theme }
                    }))
                  }
                  variant="ghost"
                >
                  <span
                    className="appearance-theme-preview"
                    data-preview-theme={theme}
                    aria-hidden="true"
                  >
                    <span className="appearance-preview-sidebar">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="appearance-preview-content">
                      <i />
                      <i />
                      <i />
                    </span>
                  </span>
                  <span className="appearance-theme-label">
                    <Icon size={15} />
                    {messages.settings.options[theme]}
                    <Check className="appearance-theme-check" size={14} />
                  </span>
                </Button>
              )
            })}
          </div>
          <Field
            label={messages.settings.fields.density}
            description={messages.settings.densityDescription}
          >
            <Select
              onValueChange={(value) => {
                const density = value as ConfigurationSnapshot['appearance']['density']
                updateDraft((current) => ({
                  ...current,
                  appearance: { ...current.appearance, density }
                }))
              }}
              value={draft.appearance.density}
            >
              <SelectTrigger aria-label={messages.settings.fields.density}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="compact">{messages.settings.options.compact}</SelectItem>
                <SelectItem value="comfortable">{messages.settings.options.comfortable}</SelectItem>
                {configurationV2 ? (
                  <SelectItem value="expanded">{messages.settings.options.expanded}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label={messages.settings.fields.interfaceFontFamily}
            description={messages.settings.interfaceFontBehavior}
          >
            <div className="configuration-font-control">
              <Input
                aria-label={messages.settings.fields.interfaceFontFamily}
                autoComplete="off"
                onChange={(event) => {
                  const fontFamily = event.currentTarget.value
                  updateDraft((current) => ({
                    ...current,
                    appearance: { ...current.appearance, fontFamily }
                  }))
                }}
                spellCheck={false}
                value={interfaceFontFamily}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button aria-label="Choose interface font" size="icon">
                    <ChevronDown aria-hidden="true" size={14} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {['Geist', 'JetBrains Mono Variable', 'system-ui'].map((fontFamily) => (
                    <DropdownMenuItem
                      key={fontFamily}
                      onSelect={() =>
                        updateDraft((current) => ({
                          ...current,
                          appearance: { ...current.appearance, fontFamily }
                        }))
                      }
                    >
                      {fontFamily}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </Field>
          <Card asChild>
            <div
              className="appearance-font-preview"
              style={{ fontFamily: `${interfaceFontFamily}, sans-serif` }}
            >
              <span>{messages.settings.fontPreview}</span>
              <strong>The quick brown fox jumps over the lazy dog.</strong>
              <p>Aa Bb Cc · 0123456789 · &amp; @ #</p>
            </div>
          </Card>
        </SettingsSection>

        <SettingsSection
          activeSection={activeSection}
          section="terminal"
          title={messages.settings.terminal}
        >
          <Field label={messages.settings.fields.shellPath}>
            <Input
              autoComplete="off"
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  terminal: {
                    ...current.terminal,
                    shellPath: event.currentTarget.value || null
                  }
                }))
              }
              placeholder={messages.settings.fields.shellPlaceholder}
              spellCheck={false}
              value={draft.terminal.shellPath ?? ''}
            />
          </Field>
          {nodePreview && readOnly ? (
            <DeferredNotice>{messages.settings.nodeShellUnavailable}</DeferredNotice>
          ) : (
            <DeferredNotice>{messages.settings.shellBehavior}</DeferredNotice>
          )}
          <Field label={messages.settings.fields.fontFamily}>
            <Input
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  terminal: { ...current.terminal, fontFamily: event.currentTarget.value }
                }))
              }
              value={draft.terminal.fontFamily}
            />
          </Field>
          <Field label={messages.settings.fields.fontSize}>
            <Input
              max={72}
              min={6}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  terminal: { ...current.terminal, fontSize: event.currentTarget.valueAsNumber }
                }))
              }
              type="number"
              value={Number.isNaN(draft.terminal.fontSize) ? '' : draft.terminal.fontSize}
            />
          </Field>
          <Field label={messages.settings.fields.scrollback}>
            <Input
              max={1_000_000}
              min={100}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  terminal: { ...current.terminal, scrollback: event.currentTarget.valueAsNumber }
                }))
              }
              type="number"
              value={Number.isNaN(draft.terminal.scrollback) ? '' : draft.terminal.scrollback}
            />
          </Field>
          <CheckField
            checked={draft.terminal.multilinePasteProtection}
            label={messages.settings.fields.multilinePaste}
            onChange={(checked) =>
              updateDraft((current) => ({
                ...current,
                terminal: { ...current.terminal, multilinePasteProtection: checked }
              }))
            }
          />
        </SettingsSection>

        <SettingsSection
          activeSection={activeSection}
          note={messages.settings.deferred.browser}
          section="advanced"
          title={messages.settings.browser}
        >
          <Field label={messages.settings.fields.profileName}>
            <Input disabled value={draft.browser.profileName} />
          </Field>
          <Field label={messages.settings.fields.profilePartition}>
            <Input disabled value={draft.browser.partition} />
          </Field>
          <Field label={messages.settings.fields.privacy}>
            <Select disabled value={draft.browser.privacy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">{messages.settings.options.standard}</SelectItem>
                <SelectItem value="strict">{messages.settings.options.strict}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </SettingsSection>

        <SettingsSection
          activeSection={activeSection}
          section="notifications"
          title={messages.settings.notifications}
        >
          <CheckField
            checked={draft.notifications.systemEnabled}
            label={messages.settings.fields.systemNotifications}
            onChange={(systemEnabled) =>
              updateDraft((current) => ({
                ...current,
                notifications: { ...current.notifications, systemEnabled }
              }))
            }
          />
          <CheckField
            checked={draft.notifications.includeBody}
            disabled={!draft.notifications.systemEnabled}
            label={messages.settings.fields.notificationBody}
            onChange={(includeBody) =>
              updateDraft((current) => ({
                ...current,
                notifications: { ...current.notifications, includeBody }
              }))
            }
          />
        </SettingsSection>

        <SettingsSection
          activeSection={activeSection}
          section="advanced"
          title={messages.settings.logging}
        >
          <Field label={messages.settings.fields.logLevel}>
            <Select
              onValueChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  logging: { level: value as typeof current.logging.level }
                }))
              }
              value={draft.logging.level}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="error">{messages.settings.options.error}</SelectItem>
                <SelectItem value="warn">{messages.settings.options.warn}</SelectItem>
                <SelectItem value="info">{messages.settings.options.info}</SelectItem>
                <SelectItem value="debug">{messages.settings.options.debug}</SelectItem>
                <SelectItem value="trace">{messages.settings.options.trace}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <DeferredNotice>{messages.settings.loggingBehavior}</DeferredNotice>
        </SettingsSection>

        <SettingsSection activeSection={activeSection} section="advanced" title="Diagnostics">
          <p>{messages.lifecycle.diagnosticsPrivacy}</p>
          <div className="configuration-update-actions">
            <Button
              disabled={diagnosticBusy}
              onClick={() => void previewDiagnostics()}
              size="small"
            >
              {messages.lifecycle.previewDiagnostics}
            </Button>
            <Button
              disabled={diagnosticBusy || diagnosticPreview === null}
              onClick={() => void exportDiagnostics()}
              size="small"
            >
              {messages.lifecycle.exportDiagnostics}
            </Button>
          </div>
          {diagnosticPreview ? (
            <div className="configuration-update-status" role="status">
              {diagnosticPreview.entries.length} entries · {diagnosticPreview.totalBytes} bytes ·{' '}
              {diagnosticPreview.redactionCount} redactions
            </div>
          ) : null}
        </SettingsSection>

        <SettingsSection
          activeSection={activeSection}
          note={messages.settings.updater.automaticDescription}
          section="updates"
          title={messages.settings.updates}
        >
          <Field label={messages.settings.fields.updateChannel}>
            <Select
              onValueChange={(value) =>
                updateDraft((current) => ({
                  ...current,
                  updates: {
                    ...current.updates,
                    channel: value as 'alpha'
                  }
                }))
              }
              value={draft.updates.channel === 'alpha' ? 'alpha' : ''}
            >
              <SelectTrigger>
                <SelectValue placeholder={messages.settings.updater.chooseAlpha} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alpha">{messages.settings.options.alpha}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <CheckField
            checked={draft.updates.automatic === true}
            label={messages.settings.updater.automatic}
            onChange={(automatic) =>
              updateDraft((current) => ({
                ...current,
                updates: { ...current.updates, automatic }
              }))
            }
          />

          {updateState ? (
            <div className="configuration-update-status" role="status">
              {updateStateMessage(updateState)}
            </div>
          ) : null}
          {updateState?.status === 'downloaded' ? (
            <p className="configuration-update-status">
              {messages.settings.updater.restartDescription}
            </p>
          ) : null}
          <div className="configuration-update-actions">
            {updateState &&
            (updateState.status === 'idle' ||
              updateState.status === 'up-to-date' ||
              updateState.status === 'error') ? (
              <Button onClick={() => void runUpdateAction('checkForUpdate')} size="small">
                {messages.settings.updater.check}
              </Button>
            ) : null}
            {updateState?.status === 'available' ? (
              <Button onClick={() => void runUpdateAction('downloadUpdate')} size="small">
                {messages.settings.updater.download}
              </Button>
            ) : null}
            {updateState?.status === 'downloaded' ? (
              <Button onClick={() => void runUpdateAction('installUpdate')} size="small">
                {messages.settings.updater.install}
              </Button>
            ) : null}
          </div>
        </SettingsSection>
      </fieldset>
    </div>
  )
}

function updateStateMessage(state: DesktopUpdateState): string {
  const copy = messages.settings.updater
  switch (state.status) {
    case 'unconfigured':
      return copy.unconfigured
    case 'development':
      return copy.development
    case 'unsupported':
      return copy.unsupported
    case 'idle':
      return copy.idle
    case 'checking':
      return copy.checking
    case 'up-to-date':
      return copy.upToDate
    case 'available':
      return `${copy.available} ${state.version}`
    case 'downloading':
      return `${copy.downloading}: ${state.progress.toFixed(0)}%`
    case 'downloaded':
      return copy.downloaded
    case 'error':
      return state.message
  }
}

function SettingsSection({
  activeSection,
  children,
  note,
  section,
  title
}: {
  activeSection: ConfigurationSettingsSection
  children: React.ReactNode
  note?: string
  section: ConfigurationSettingsSection
  title: string
}): React.JSX.Element {
  return (
    <section className="configuration-section" hidden={activeSection !== section}>
      {title !== messages.settings[section] ? (
        <h3 className="configuration-section-title">{title}</h3>
      ) : null}
      {note ? <DeferredNotice>{note}</DeferredNotice> : null}
      <div className="configuration-fields">{children}</div>
    </section>
  )
}

function Field({
  children,
  label,
  description
}: {
  children: React.ReactNode
  label: string
  description?: string
}): React.JSX.Element {
  return (
    <Label className="configuration-field">
      <span className="configuration-field-label">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      {children}
    </Label>
  )
}

function CheckField({
  checked,
  disabled = false,
  label,
  onChange = () => undefined
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange?: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <Label className="configuration-check">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(checked) => onChange(checked === true)}
      />
      <span>{label}</span>
    </Label>
  )
}

function DeferredNotice({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="configuration-deferred">{children}</p>
}
