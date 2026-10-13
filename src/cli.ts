#!/usr/bin/env node

const USAGE = `pw-tia — Test Impact Analysis for Playwright

Usage:
  pw-tia affected --base <ref> [--json] [--dry-run] [--all]
`;

const command = process.argv[2];

if (command === 'affected') {
  console.error('pw-tia: `affected` is not implemented yet');
  process.exit(1);
}

console.log(USAGE);
