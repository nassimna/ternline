import type { CSSProperties } from 'react'
import { Toaster as Sonner, toast, type ToasterProps } from 'sonner'

function Toaster({ style, ...props }: ToasterProps) {
  return (
    <Sonner
      style={
        {
          '--normal-bg': 'var(--aw-color-surface-overlay)',
          '--normal-text': 'var(--aw-color-text-primary)',
          '--normal-border': 'var(--aw-color-border-default)',
          '--border-radius': 'var(--aw-radius-md)',
          fontFamily: 'var(--aw-font-ui)',
          ...style
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'font-ui text-ui shadow-popup',
          title: 'font-medium text-text-primary',
          description: 'text-text-secondary'
        }
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
