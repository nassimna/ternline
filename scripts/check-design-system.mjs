import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import ts from 'typescript'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const renderer = join(repository, 'apps/web/src')
const nativeControls = new Set([
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'details',
  'summary',
  'dialog',
  'datalist',
  'progress',
  'meter',
  'hr',
  'kbd'
])
const controlRoles = new Set([
  'tab',
  'tablist',
  'tabpanel',
  'combobox',
  'listbox',
  'option',
  'progressbar'
])
const sharedAppearance = new Set([
  'Button',
  'IconButton',
  'Input',
  'Textarea',
  'SelectTrigger',
  'Card',
  'Badge',
  'Alert',
  'Label',
  'DialogContent',
  'TabsTrigger',
  'CommandItem'
])
const appearanceProperties =
  /^(?:color|background(?:-color)?|border(?:-(?:color|radius|width|style))?|box-shadow|outline(?:-offset)?|font(?:-(?:family|size|weight))?|line-height)$/u
const componentClasses = [
  'workspace-card',
  'surface-card',
  'agent-session-card',
  'task-state',
  'attention-badge',
  'workspace-activity',
  'workspace-chip',
  'notification-item',
  'notification-severity',
  'command-result',
  'pane-tab-select',
  'workspace-row',
  'workspace-drag',
  'workspace-remove',
  'workspace-open-path',
  'tab-close',
  'tab-keyboard-move',
  'tab-drag',
  'tab-split',
  'tab-drop-actions-control',
  'terminal-tools-close',
  'appearance-theme-option',
  'surface-button-danger',
  'appearance-font-preview',
  'mutation-error',
  'legacy-over-limit',
  'right-sidebar-error',
  'notification-navigation-error',
  'dialog-field-error',
  'browser-address-error',
  'terminal-exit'
]

function primitiveSelector(selector, extraClasses = []) {
  return (
    /(?:\b(?:button|input|textarea|select)|\[data-slot=['"](?:button|input|textarea|select-trigger|card|badge)['"]\])(?:\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?)*$/u.test(
      selector
    ) ||
    [...componentClasses, ...extraClasses].some((name) =>
      new RegExp(`\\.${name}(?:\\.[\\w-]+)*(?:\\[[^\\]]*\\]|:[\\w-]+(?:\\([^)]*\\))?)*$`, 'u').test(
        selector
      )
    )
  )
}

export function inspectComponent(source, file = 'Component.tsx', primitive = false) {
  const issues = []
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const report = (node, message) => {
    const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1
    issues.push(`${file}:${line}: ${message}`)
  }
  const walk = (node) => {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.attributes.properties.some(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === 'asChild'
      )
    ) {
      const children = node.children.filter(
        (child) => !ts.isJsxText(child) || child.text.trim().length > 0
      )
      if (children.length !== 1)
        report(
          node,
          'asChild requires one element; extra whitespace expressions also count as children.'
        )
    }
    if (
      !primitive &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['window', 'globalThis'].includes(node.expression.expression.getText(tree)) &&
      ['alert', 'confirm', 'prompt'].includes(node.expression.name.text)
    ) {
      report(node, 'Use the shared request-dialog helpers instead of native JavaScript dialogs.')
    }
    if (!primitive && ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (/^(?:@radix-ui\/|radix-ui$|cmdk$|sonner$)/u.test(node.moduleSpecifier.text)) {
        report(node, 'Import the shared ui component; primitive libraries belong in src/ui.')
      }
    }
    if (!primitive && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
      const tag = node.tagName.getText(tree)
      if (nativeControls.has(tag))
        report(node, `Use a shared shadcn component instead of <${tag}>.`)
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue
        const initializer = attribute.initializer
        const classValues = []
        const collectValues = (value) => {
          if (
            ts.isStringLiteral(value) ||
            ts.isNoSubstitutionTemplateLiteral(value) ||
            ts.isTemplateHead(value) ||
            ts.isTemplateMiddle(value) ||
            ts.isTemplateTail(value)
          )
            classValues.push(value.text)
          ts.forEachChild(value, collectValues)
        }
        if (attribute.name.text === 'className' && initializer) collectValues(initializer)
        if (
          sharedAppearance.has(tag) &&
          attribute.name.text === 'className' &&
          classValues.some((value) =>
            /\b(?:bg-|border(?:-|\b)|rounded(?:-|\b)|font-|shadow(?:-|\b)|ring-|text-(?!left\b|right\b|center\b))/u.test(
              value
            )
          )
        ) {
          report(
            attribute,
            'Use a shared component variant for appearance; className may customize layout.'
          )
        }
        if (
          attribute.name.text === 'role' &&
          initializer &&
          ts.isStringLiteral(initializer) &&
          /^[a-z]/u.test(tag) &&
          controlRoles.has(initializer.text)
        ) {
          report(attribute, `Use the shared component that owns role="${initializer.text}".`)
        }
        if (
          attribute.name.text === 'className' &&
          classValues.some((value) =>
            /(?:\b(?:bg|text|border|ring)-(?:white|black|red|blue|gray|slate|zinc|neutral)(?:\b|-)|\b(?:bg|text|border|rounded)-\[)/u.test(
              value
            )
          )
        ) {
          report(
            attribute,
            'Use semantic theme tokens and shared variants for component appearance.'
          )
        }
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(tree)
  return issues
}

export function collectComponentClasses(source) {
  const classes = new Set()
  const tree = ts.createSourceFile(
    'Component.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const collect = (opening) => {
    const attribute = opening.attributes.properties.find(
      (node) => ts.isJsxAttribute(node) && node.name.text === 'className'
    )
    if (!attribute?.initializer) return
    const values = (node) => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        for (const name of node.text.split(/\s+/u))
          if (/^[a-z][\w-]*$/u.test(name)) classes.add(name)
      }
      ts.forEachChild(node, values)
    }
    values(attribute.initializer)
  }
  const walk = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (sharedAppearance.has(node.tagName.getText(tree))) {
        collect(node)
        if (
          ts.isJsxElement(node.parent) &&
          node.attributes.properties.some(
            (attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === 'asChild'
          )
        ) {
          const child = node.parent.children.find(
            (element) => ts.isJsxElement(element) || ts.isJsxSelfClosingElement(element)
          )
          if (child) collect(ts.isJsxElement(child) ? child.openingElement : child)
        }
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(tree)
  return [...classes]
}

export function inspectStyles(source, file = 'styles.css', extraClasses = []) {
  const issues = []
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const selectors = match[1].trim()
    const body = match[2]
    // Forced-colors deliberately uses system colors and !important for accessibility.
    if (body.includes('Highlight !important') || body.includes('forced-color-adjust')) continue
    const controls = selectors
      .split(/,\s*\n/u)
      .some((selector) => primitiveSelector(selector.trim(), extraClasses))
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':')
      if (colon < 0) continue
      const property = declaration.slice(0, colon).trim()
      const value = declaration.slice(colon + 1).trim()
      const line = source.slice(0, match.index).split('\n').length
      if (/\b(?:Highlight|HighlightText|Canvas|CanvasText|ButtonText|GrayText)\b/u.test(value))
        continue
      if (
        file.endsWith('foundation.css') &&
        value === 'inherit' &&
        ['color', 'font'].includes(property)
      )
        continue
      if (controls && appearanceProperties.test(property)) {
        issues.push(`${file}:${line}: ${property} for ${selectors} belongs in src/ui.`)
      }
      if (
        /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(/iu.test(value) ||
        (property === 'border-radius' && /\d(?:px|rem)/u.test(value))
      ) {
        issues.push(`${file}:${line}: Define theme colors and radii in packages/design-tokens.`)
      }
    }
  }
  return issues
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]
  )
}

export function checkDesignSystem() {
  const sourceFiles = files(renderer)
  const classes = sourceFiles
    .filter((file) => file.endsWith('.tsx') && !file.includes('/ui/') && !file.includes('.test.'))
    .flatMap((file) => collectComponentClasses(readFileSync(file, 'utf8')))
  return sourceFiles.flatMap((file) => {
    const name = relative(repository, file)
    if (/\.test\.[cm]?[jt]sx?$/u.test(file) || file.includes('/test/')) return []
    if (file.endsWith('.tsx') || file.endsWith('.ts'))
      return inspectComponent(readFileSync(file, 'utf8'), name, file.includes('/ui/'))
    if (file.endsWith('.css') && !file.includes('/ui/'))
      return inspectStyles(readFileSync(file, 'utf8'), name, classes)
    return []
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = checkDesignSystem()
  if (issues.length) {
    process.stderr.write(`${issues.join('\n')}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write('Desktop design-system boundaries passed.\n')
  }
}
