// Phase 2 wraps this with an auto fixture driving Coverage.startJSCoverage
// per spec via newCDPSession. Until then the drop-in re-export keeps
// `import { test } from 'playwright-tia'` valid with zero coverage cost.
export { test, expect } from '@playwright/test';
