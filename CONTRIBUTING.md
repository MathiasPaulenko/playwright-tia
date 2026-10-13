# Contributing

Thanks for helping out. This is a small project — keep changes focused and open an issue first for anything beyond a bugfix.

## Setup

```bash
npm ci
npm run typecheck
npm test                 # unit tests (includes a real Chromium e2e)
npm run build            # tsup: esm + cjs + dts
```

The e2e test launches a real browser — install it once:

```bash
npx playwright install chromium
```

The `examples/demo-app` directory shows the intended end-user flow and powers the `demo` CI job. To run it locally:

```bash
npm run build
cd examples/demo-app
npm install --install-links
PW_TIA_COLLECT=1 npx playwright test
npx pw-tia collect
```

## Ground rules

- **TypeScript strict.** No `any` without a good reason; explicit types on public exports.
- **`@playwright/test` stays a peer dependency** — never a regular dependency.
- **Selection must never under-select.** When in doubt, run more specs, not fewer. New heuristics that can silently skip tests need a very good argument.
- Keep runtime dependencies minimal; prefer Node built-ins (`child_process`, `fs`) over wrapping libraries.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org) in English (`feat:`, `fix:`, `docs:`…), atomic and focused.

## Testing

- `tests/unit` — vitest; fixtures live in `tests/fixtures`.
- `tests/e2e` — Playwright specs that exercise the fixture itself against a bundled app.
- New behavior should land with a failing test first, then the fix.
- Everything green before opening a PR: `typecheck`, `test`, `build`.

## Pull requests

- Keep PRs small and single-purpose.
- Update the README when behavior, config or CLI surface changes.
- CI runs `test` (typecheck + tests + build) and `demo` (asserts real affected-spec selection) — both must pass.
