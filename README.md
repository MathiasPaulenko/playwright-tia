# playwright-tia

Test Impact Analysis for Playwright — run only the specs affected by changes in your app's source code, using real per-spec V8 coverage. No instrumentation, no heuristics.

> Status: early development, not yet published.

## Why

`playwright test --only-changed` sees which *test files* changed and what they import — it can't see the app source behind the page. A spec points at a URL and exercises the bundle as a black box, so there's no static graph from spec to source.

There doesn't need to be a graph. The mapping is measurable: record which source files each spec actually executes in the browser (V8 coverage via CDP, resolved through sourcemaps), then replay that mapping against `git diff`.

## How it works

```text
Baseline / incremental (normal runs):
  auto fixture → context.newCDPSession(page)
  → Coverage.startJSCoverage per spec
  → sourcemaps resolve bundle ranges → source files
  → tia-manifest.json: { "spec.ts": ["src/CartService.ts", ...] }

Selection (each PR):
  git diff → changed files
  → lookup manifest → affected specs
  → escape rules: forceRun globs, new specs, uncovered specs → conservative
```

## Install

```bash
npm i -D playwright-tia
```

## Usage

```bash
npx pw-tia affected --base origin/main        # specs to run
npx pw-tia affected --base main --json        # specs + why (which file triggered what)
```

## Limitations

- Frontend JS coverage only — backend/CSS/HTML changes don't show up; use `forceRun` globs for those paths.
- Coverage collection is Chromium-only; the learned mapping applies to runs on all browsers.
- Requires a test build with sourcemaps.
- First run without a manifest runs everything and learns.
- Main-page coverage only; specs spanning multiple pages/iframes are documented limits.

## License

MIT
