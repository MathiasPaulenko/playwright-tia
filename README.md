# playwright-tia

[![test](https://github.com/MathiasPaulenko/playwright-tia/actions/workflows/test.yml/badge.svg)](https://github.com/MathiasPaulenko/playwright-tia/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/playwright-tia)](https://www.npmjs.com/package/playwright-tia)

Test Impact Analysis for Playwright — run only the specs affected by changes in your app's source code, using real per-spec V8 coverage. No instrumentation, no heuristics.

## Why

`playwright test --only-changed` sees which *test files* changed and what they import — it can't see the app source behind the page. A spec points at a URL and exercises the bundle as a black box, so there's no static graph from spec to source.

There doesn't need to be a graph. The mapping is measurable: record which source files each spec actually executes in the browser (V8 coverage via CDP, resolved through sourcemaps), then replay that mapping against `git diff`.

## How it works

```text
Learn (baseline + incremental runs):
  auto fixture → context.newCDPSession(page)
  → Profiler.startPreciseCoverage per spec
  → sourcemaps resolve executed bundle ranges → source files
  → .tia/fragments/*.jsonl (parallel-safe) → pw-tia collect → tia-manifest.json

Select (each PR):
  git diff --name-only <base>...HEAD (+ worktree)
  → lookup manifest → affected specs
  → escape rules: forceRun globs, new specs, uncovered specs → run everything
```

You commit `tia-manifest.json` like a lockfile — it drifts with your app and keeps learning on every coverage-enabled run.

## Install

```bash
npm i -D playwright-tia
```

Requires Node 18+ and `@playwright/test` as a peer. Coverage collection is Chromium-only (CDP), but the learned manifest applies to runs on all browsers.

## Setup

**1. Import `test`/`expect` from `playwright-tia` instead of `@playwright/test`:**

```ts
import { expect, test } from 'playwright-tia';

test('checks out', async ({ page }) => { /* same API */ });
```

The `tia` fixture is automatic — when coverage collection is enabled it wraps every spec with CDP coverage and records the sources it executed. When disabled it does nothing. Collection never fails a test: errors degrade to a warning, failed/skipped specs are not recorded (their coverage would be partial), and scripts without a usable sourcemap produce a `pw-tia:` warning and leave the spec conservative.

**2. Gitignore the working dir** — coverage fragments are intermediate artifacts:

```gitignore
.tia/
```

**3. Run with collection enabled:**

```bash
PW_TIA_COLLECT=1 npx playwright test   # or just run it in CI — CI=true enables it
npx pw-tia collect                     # merge fragments → tia-manifest.json
```

Coverage overhead is ~5–15%, so it's opt-in locally (`PW_TIA_COLLECT=1`) and on by default in CI. Commit `tia-manifest.json` to your repo.

**4. Select on each PR:**

```bash
npx playwright test $(npx pw-tia affected --base origin/main)
```

## CLI

### `pw-tia affected`

Prints the spec paths to run — one per line on **stdout**, so it composes directly into `playwright test <args>` (Playwright treats positional args as filters). Explanations go to **stderr**.

```bash
npx pw-tia affected --base origin/main          # spec list
npx pw-tia affected --base main --json          # full result with reasons
npx pw-tia affected --all                       # bypass selection, list everything
```

Example stderr:

```text
pw-tia: 3 affected spec(s) from 1 changed file(s)
  src/cart.ts → tests/cart.spec.ts, tests/checkout.spec.ts, tests/orders.spec.ts
  shared: src/shell.ts is covered by 4 spec(s) — wide selection expected
```

### `pw-tia collect`

Merges `.tia/fragments/*.jsonl` into `tia-manifest.json` and prunes records for specs that no longer exist. Run it after every coverage-enabled suite.

### `pw-tia doctor`

Diagnoses the setup — config, git, manifest health, specs with no coverage, stale records, and files shared by most of the suite:

```text
config: playwright-tia.config.json
git: repository ok
manifest: 4 spec record(s)
specs on disk: 4 (via specGlob)
shared files (>=0.8):
    src/shell.ts (4 specs)
```

## Configuration

Optional `playwright-tia.config.json` in your project root:

```json
{
  "manifestPath": "tia-manifest.json",
  "baseRef": "origin/main",
  "forceRun": ["infra/**", "src/**/*.css"],
  "coverage": { "filter": ["!**/generated/**"] },
  "sharedThreshold": 0.8,
  "specGlob": ["e2e/**/*.spec.ts"]
}
```

| Field | Default | Purpose |
| --- | --- | --- |
| `manifestPath` | `tia-manifest.json` | Where the spec ↔ source map lives. |
| `baseRef` | `origin/main` | Git ref `affected` diffs against. |
| `forceRun` | `["playwright.config.*", "package.json", "*lock*", ".github/**"]` | Changed files matching these globs run the whole suite — for things coverage can't see (infra, CSS, backend). |
| `coverage.enabled` | `false` | Collect coverage on every run even without `PW_TIA_COLLECT`/`CI`. |
| `coverage.filter` | `["!**/node_modules/**"]` | Exclusion globs applied to resolved sources. `node_modules` is always excluded. |
| `coverage.serveRoot` | project root | FS dir your dev server's URL root maps to (e.g. `"dist"`) — needed when served files don't sit at the root. |
| `sharedThreshold` | `0.8` | Files covered by ≥ this fraction of specs are "shared" — reported explicitly instead of silently selecting everything. |
| `specGlob` | `["**/*.spec.*", "**/*.test.*"]` | Identifies spec files for the new-spec/spec-changed rules. Scope it to your e2e dir to avoid matching unit tests. |

### Environment variables

| Variable | Effect |
| --- | --- |
| `PW_TIA_COLLECT=1` | Enable collection locally (auto-on in CI). |
| `PW_TIA_COLLECT=0` | Disable collection even in CI. |
| `PW_TIA_ROOT` | Override the project root the collector resolves paths against (defaults to `process.cwd()`). |

## Selection rules

| Situation | Result |
| --- | --- |
| A spec's source file changed | That spec runs (`changed-source`) |
| A spec file itself changed | That spec runs (`spec-changed`) |
| A spec exists with no manifest record | Runs (`new-spec`) |
| A spec has a record but zero sources | Runs (`no-sources`, conservative) |
| A shared file (≥ `sharedThreshold`) changed | Covering specs run, flagged `shared-file` |
| A changed file matches `forceRun` | Everything runs |
| Manifest missing/empty/corrupt | Everything runs |
| `git diff` fails (bad ref, not a repo) | Everything runs |

Unmatched changes (docs, README) select nothing. Monorepos work: run `pw-tia` from the project subdirectory — paths are re-relativized against the git root.

## CI recipe (GitHub Actions)

```yaml
- run: PW_TIA_COLLECT=1 npx playwright test   # collect coverage (auto-on in CI)
- run: npx pw-tia collect                      # update tia-manifest.json, commit it

# on PR jobs:
- run: npx playwright test $(npx pw-tia affected --base origin/${{ github.base_ref }})
```

See [`examples/demo-app`](examples/demo-app) for a working project and [`demo.yml`](.github/workflows/demo.yml) for a CI job that asserts the exact selection.

## Limitations

- **Frontend JS coverage only.** Backend, CSS, HTML and infra changes are invisible to JS coverage — put them in `forceRun` globs.
- **Collection is Chromium-only** (CDP). The manifest applies to runs on all browsers.
- **Sourcemaps required.** Your test build must emit them (inline or external `.map`). Scripts without a resolvable map are ignored, leaving the spec conservative — it runs more often, never less.
- **Discrimination follows code-splitting.** Coverage attributes the chunks a spec loaded, so lazy-loaded routes give sharp attribution; a single flat bundle attributes everything it contains and `sharedThreshold` becomes your main signal.
- **Iframes and workers.** Coverage spans every page/popup in the spec's browser context, but not OOPIF iframes or service workers — specs relying on them get broader attribution.
- **First run runs everything.** Without a manifest there is nothing to select with — it runs the whole suite and learns.

## License

MIT
