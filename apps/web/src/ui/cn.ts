import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Custom type tokens must not be mistaken for text colors when composing variants.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            '2xs',
            '2xs-plus',
            'xs-plus',
            'metadata',
            'label',
            'label-emphasis',
            'small',
            'control',
            'ui',
            'input',
            'body',
            'heading',
            'display'
          ]
        }
      ],
      'font-family': [{ font: ['ui', 'mono'] }]
    }
  }
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
