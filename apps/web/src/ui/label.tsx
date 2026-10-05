import { forwardRef, type LabelHTMLAttributes } from 'react'

import { cn } from './cn'

const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      data-slot="label"
      className={cn('font-ui text-ui font-medium text-text-secondary', className)}
      {...props}
    />
  )
)
Label.displayName = 'Label'

export { Label }
