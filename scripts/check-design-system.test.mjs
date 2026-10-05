import assert from 'node:assert/strict'
import test from 'node:test'

import { collectComponentClasses, inspectComponent, inspectStyles } from './check-design-system.mjs'

test('rejects native controls and direct primitive imports in feature code', () => {
  assert.equal(inspectComponent('const view = <select><option>Alpha</option></select>').length, 1)
  assert.equal(inspectComponent('import { Root } from "@radix-ui/react-select"').length, 1)
  assert.equal(inspectComponent('const view = <div role="tablist" />').length, 1)
  assert.ok(inspectComponent('const view = <Button className="bg-blue-500" />').length > 0)
  assert.equal(inspectComponent('const view = <Button className="bg-accent" />').length, 1)
  assert.equal(
    inspectComponent('const view = <Button className={selected ? "bg-accent" : ""} />').length,
    1
  )
  assert.equal(inspectComponent('window.confirm("Delete?")').length, 1)
  assert.equal(inspectComponent('const view = <Card asChild>{" "}<article /></Card>').length, 1)
})

test('allows owned primitives, shared composition, and ordinary semantic markup', () => {
  assert.deepEqual(inspectComponent('const view = <input />', 'ui/input.tsx', true), [])
  assert.deepEqual(
    inspectComponent('const view = <Card><Label>Name<Input /></Label><Button>Save</Button></Card>'),
    []
  )
  assert.deepEqual(
    inspectComponent('const view = <section><h2>Tools</h2><p>Ready</p></section>'),
    []
  )
})

test('rejects control appearance overrides and raw theme values', () => {
  assert.equal(
    inspectStyles('.new-feature button:hover { background: var(--aw-color-accent); }').length,
    1
  )
  assert.equal(
    inspectStyles('.surface-card.selected { border-radius: var(--aw-radius-md); }').length,
    1
  )
  assert.equal(inspectStyles('.panel { color: #123abc; border-radius: 7px; }').length, 2)
})

test('allows layout, semantic tokens, and system-color accessibility overrides', () => {
  assert.deepEqual(inspectStyles('.surface-card { grid-template-columns: 1fr auto; }'), [])
  assert.deepEqual(inspectStyles('.panel { color: var(--aw-color-text-primary); }'), [])
  assert.deepEqual(
    inspectStyles('button:focus-visible { outline: 2px solid Highlight !important; }'),
    []
  )
})

test('checks new component classes while allowing their domain content styles', () => {
  const classes = collectComponentClasses(
    'const view = <Card asChild><article className={`new-card ${selected ? "selected" : ""}`} /></Card>'
  )
  assert.ok(classes.includes('new-card'))
  assert.equal(
    inspectStyles('.new-card:hover { background: var(--aw-color-accent); }', 'styles.css', classes)
      .length,
    1
  )
  assert.deepEqual(
    inspectStyles(
      '.new-card:hover .title { color: var(--aw-color-text-primary); }',
      'styles.css',
      classes
    ),
    []
  )
})
