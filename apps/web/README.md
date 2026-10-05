# Web UI package

The React workspace UI lives here. Electron builds it into `apps/desktop/out/renderer` and exposes
a typed native bridge. Renderer requests pass through Electron main to the Node service using
shared contracts and the client runtime. Domain state belongs to the server; presentation and
transient interaction state belong to the renderer.

This package can build its static assets independently, but the application requires the Electron
bridge at runtime. Use `pnpm dev` from the repository root to run the complete desktop app.

UI changes must follow the shared [desktop design system](../../docs/DESIGN_SYSTEM.md).
Use `src/ui` components and `packages/design-tokens`; run `pnpm lint:design-system`
to check those boundaries before adding or changing UI.
