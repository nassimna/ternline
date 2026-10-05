# Desktop design system

All desktop UI uses the project-owned shadcn/Radix components in
[`apps/web/src/ui`](../apps/web/src/ui/index.ts), styled by the semantic tokens in
[`packages/design-tokens`](../packages/design-tokens/src/tokens.css).
This is the same system for settings, workspace chrome, sidebar tools, agent and
remote-session views, dialogs, and notifications. The marketing website is a
separate surface.

## Component choices

| UI need                  | Shared component                                                  |
| ------------------------ | ----------------------------------------------------------------- |
| Action / icon action     | `Button` / `IconButton`                                           |
| Text / multiline field   | `Input` / `Textarea` with `Label`                                 |
| Choice / boolean / radio | `Select` / `Checkbox` / `RadioGroup`                              |
| Content surface          | `Card`, with optional header, title, description, content, footer |
| Status or metadata chip  | `Badge`                                                           |
| Progress                 | `Progress` (`value={null}` for indeterminate)                     |
| Error or warning message | `Alert`                                                           |
| Modal or text request    | `Dialog` / `requestText`, `confirmAction`, `showMessage`          |
| Menu / context actions   | `DropdownMenu` / `ContextMenu`                                    |
| View switching           | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`                  |
| Command palette          | `Command`, `CommandInput`, `CommandList`, `CommandItem`           |
| Hover help / separator   | `Tooltip` / `Separator`                                           |

Keyboard hints use `Kbd`; notification toasts use the shared `Toaster` and `toast`.

Import from `src/ui` or its individual component files. Import Radix, cmdk, and Sonner
only inside `src/ui`. Plain semantic layout elements such as sections, headings,
paragraphs, lists, forms, and fieldsets remain appropriate. Terminal canvases,
OS-owned prompts, native window menus, and isolated external browser content
retain their platform behavior.

## Appearance and composition

- Keep the current Basalt theme. Colors, type, radius, spacing, control sizes,
  motion, and elevation come from `--aw-*` tokens and their Tailwind aliases.
  Theme and density changes update those tokens; do not duplicate per-theme
  control rules in screen CSS.
- Keep the rem root at `--aw-font-size-root` (16px). Density changes control and
  type tokens; changing the root to a UI text size scales those tokens twice.
- Shared components own borders, backgrounds, type, focus, hover, selected,
  invalid, and disabled states. Screen CSS owns placement and responsive layout.
  Add a named variant to the shared component when a new reusable treatment is
  required. Do not restyle a Button, Input, Select, Card, or Badge per feature.
- `Button` uses `primary` for the main action, `secondary` for normal actions,
  `ghost` for chrome/navigation, and `destructive` for destructive actions.
  Use `small`, `default`, `icon`, or `iconSmall`; sizes follow the density tokens.
- `Card` uses `default` for content, `compact` for dense sidebar records, and
  `interactive` for selectable workspace cards. These share the same surface,
  radius, and color vocabulary. Use `asChild` to preserve an article, form, or list
  item's semantics without an extra wrapper.
- `Badge` uses semantic `info`, `success`, `warning`, and `destructive` variants.
  Keep text/icons so color is never the only status signal. Attention also uses
  dotted/dashed borders from the shared component.
- Use `Input variant="embedded"` only inside an already bordered composite
  field, such as the browser address bar. Keep its parent focus indicator.
  `controlSize="small"` fits pane chrome; `Textarea variant="code"` provides
  shared monospace styling for file editing.
- Tabs use the shared primitive even where domain behavior must remain custom:
  async unsaved-file confirmation, persisted selection, and draggable pane tabs.
  Preserve the existing IDs, focus restoration, and server mutation ordering.
- The command palette keeps application ranking and capability filtering, while
  cmdk owns selection, disabled options, keyboard navigation, and ARIA IDs.
- Workspace creation uses visible ghost action rows with trailing keyboard hints.
  Saved layouts keep Apply visible; save/import and per-layout export/delete use
  shared menus so controls remain usable in a narrow sidebar.

## Adding UI

1. Read this contract and reuse an existing shared component/variant.
2. If a component is missing, adapt its official shadcn source in `src/ui` using
   the current Radix versions and project tokens. Do not introduce another UI
   library, a parallel token set, or a new global theme.
3. Keep screen styles to layout and domain content. Define any new shared visual
   token in `packages/design-tokens`, including both themes when appropriate.
4. Run `pnpm lint:design-system`, web typecheck, and relevant behavior checks.
5. Exercise affected paths in Electron at normal and narrow window sizes, light
   and dark themes, and both supported control densities. Check keyboard focus,
   popup stacking, disabled states, and persistence where relevant.

`pnpm lint` and therefore `pnpm validate` include the design-system boundary
check. It rejects native renderer controls, direct primitive-library imports,
raw tab/selector semantics, hard-coded CSS theme colors/radii, and screen-level
appearance overrides for shared controls and migrated surfaces. The check is a
regression guard; visual review remains necessary for new compositions.
