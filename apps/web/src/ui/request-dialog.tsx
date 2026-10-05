import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import { Button } from './button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './dialog'
import { Input } from './input'

type DialogRequest = {
  kind: 'confirm' | 'text' | 'message'
  message: string
  initialValue?: string
}

// Serialize requests just as the native modal dialogs did, without blocking the renderer.
let pending: Promise<unknown> = Promise.resolve()

function requestDialog(request: DialogRequest): Promise<string | null> {
  const operation = pending.then(
    () =>
      new Promise<string | null>((resolve) => {
        const container = document.createElement('div')
        document.body.append(container)
        const root = createRoot(container)
        const previousFocus = document.activeElement
        root.render(
          <RequestDialog
            request={request}
            onComplete={(value) => {
              root.unmount()
              container.remove()
              if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
                previousFocus.focus()
              }
              resolve(value)
            }}
          />
        )
      })
  )
  pending = operation
  return operation
}

function RequestDialog({
  request,
  onComplete
}: {
  request: DialogRequest
  onComplete: (value: string | null) => void
}): React.JSX.Element {
  const [value, setValue] = useState(request.initialValue ?? '')
  const [open, setOpen] = useState(true)
  const [result, setResult] = useState<string | null>(null)
  const complete = (next: string | null): void => {
    setResult(next)
    setOpen(false)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) complete(null)
      }}
    >
      <DialogContent
        showClose={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          // FocusScope runs this after unmounting the dialog content.
          queueMicrotask(() => onComplete(result))
        }}
      >
        <DialogTitle>
          {request.kind === 'text'
            ? request.message
            : request.kind === 'confirm'
              ? 'Confirm action'
              : 'Ternline'}
        </DialogTitle>
        <DialogDescription>
          {request.kind === 'text' ? 'Enter a value to continue.' : request.message}
        </DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            complete(request.kind === 'text' ? value : 'confirmed')
          }}
        >
          {request.kind === 'text' ? (
            <Input
              aria-label={request.message}
              autoFocus
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
            />
          ) : null}
          <DialogFooter className="mt-4">
            {request.kind !== 'message' ? (
              <Button autoFocus={request.kind === 'confirm'} onClick={() => complete(null)}>
                Cancel
              </Button>
            ) : null}
            <Button type="submit" variant="primary">
              {request.kind === 'message' ? 'OK' : 'Continue'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export async function confirmAction(message: string): Promise<boolean> {
  return (await requestDialog({ kind: 'confirm', message })) !== null
}

export function requestText(message: string, initialValue = ''): Promise<string | null> {
  return requestDialog({ kind: 'text', message, initialValue })
}

export async function showMessage(message: string): Promise<void> {
  await requestDialog({ kind: 'message', message })
}
