# demo-app

Tiny multi-page app used to demonstrate `playwright-tia`. `cart.ts` is shared
by three pages (cart, checkout, orders); `profile.ts` is only used by the
profile page — so a change to `src/cart.ts` must select exactly 3 of the 4
specs.

## Try it

```bash
# from the repo root
npm ci && npm run build
cd examples/demo-app
npm install --install-links   # copies the local playwright-tia like a real install

# 1. baseline: a full run learns spec -> source coverage
PW_TIA_COLLECT=1 npx playwright test
npx pw-tia collect            # writes tia-manifest.json

# 2. simulate a PR touching cart.ts
echo "// change" >> src/cart.ts

# 3. what needs to run?
npx pw-tia affected --base HEAD
# tests/cart.spec.ts
# tests/checkout.spec.ts
# tests/orders.spec.ts        <- profile.spec.ts is correctly skipped

# 4. run only those
npx playwright test $(npx pw-tia affected --base HEAD)
```

`--install-links` matters: it makes `file:../..` behave like a published
dependency, so `@playwright/test` resolves to this app's own copy.
