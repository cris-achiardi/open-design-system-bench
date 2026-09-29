# astryx-app

**This file lives beside the template, not inside it.** Everything in
`fixtures/astryx-app/` is copied verbatim into the agent's workspace, and this
document discusses grading, scoring caveats and what the dimensions measure.
An agent that read it would be reading the answer key.


Local fixture template for the `astryx` system (`@astryxdesign/core` +
`@astryxdesign/theme-neutral`). Gitignored, like every system-specific template.

## Consumption mode

`consume: "source"` in the system config, but the aliases point at the **built**
package rather than at `packages/core/src`. Astryx component styles are StyleX
(`stylex.create`) compiled at build time into `dist/astryx.css`, and the public
types are the emitted `dist/*.d.ts`. Aliasing at source would put the StyleX
compiler in the fixture's pipeline and make `tsc` grade the library instead of
the agent's use of it.

This mirrors `apps/example-nextjs` in the astryx repo, which its README calls
"the simplest way to get started": pre-built dist, three CSS imports, no StyleX
build plugin.

## Prerequisite: the system must be built

Both the fixture and token extraction read build artifacts:

- `packages/core/dist/` (JS, `.d.ts`, `astryx.css`)
- `packages/themes/neutral/dist/` (`neutral.js`, `theme.css`)

Run `pnpm build` at the astryx repo root before `extract` or `run`. A stale or
missing `dist/` fails every cell at the compile gate.

## Deviations from the stock template, and why

| Deviation | Reason |
|---|---|
| No Tailwind | Astryx ships an opt-in Tailwind bridge (`core/tailwind-theme.css`) that the reference apps do not load. Leaving Tailwind in would hand the agent a styling escape hatch its consumers do not have. |
| `@stylexjs/stylex` is a dependency | It is a real peer dependency of `@astryxdesign/core` — every dist consumer installs it, and `dist/*.js` imports it at runtime. Not an added escape hatch. |
| `Theme` provider lives in `src/App.tsx` | Astryx components read tokens from the `[data-astryx-theme]` scope the provider establishes. Without it every task renders unthemed and the agent is graded on a setup step it was not asked to do. |
| React and `@types/react` pinned to astryx's own versions (19.2.7 / 19.2.17) | One React instance across app and library. |
| TypeScript 5.9, not the 6.x the astryx example apps pin | The compile gate should fail on the agent's mistakes, not on compiler-version strictness. Worth revisiting if astryx's public `.d.ts` ever needs 6.x. |

## Known scoring caveat

The `imports` dimension allows only `componentsPkg`, `foundationsPkg`, React and
Vite. Idiomatic astryx product code reaches for `@stylexjs/stylex` for
app-level layout (AGENTS.md: "PATTERN: dynamic/runtime values ->
stylex.create"), and that import is scored as a violation. Decide per run
whether to allow it via a task's `mechanicalOverrides.extraAllowedImports`, and
record the choice in the report's methodology section.
