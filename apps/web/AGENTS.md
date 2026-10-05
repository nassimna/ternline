# Desktop UI rules

Read [the design-system contract](../../docs/DESIGN_SYSTEM.md) before changing UI.

- Use the project-owned shadcn components in `src/ui` for all controls and reusable
  surfaces. Do not use native controls or import Radix/cmdk/Sonner directly in features.
- Reuse shared variants and `packages/design-tokens` for appearance. Feature CSS
  handles layout and domain content; it must not invent new control themes,
  colors, borders, corner radii, typography, or focus/hover/disabled treatments.
- Add missing components or reusable variants centrally in `src/ui`, adapting the
  official shadcn source to the existing tokens and compatible Radix versions.
- Preserve accessible names, focus, keyboard navigation, and server contracts.
- Run `pnpm lint:design-system` plus focused behavior checks and typecheck.
  Verify visible changes in Electron at normal/narrow sizes and both themes.
