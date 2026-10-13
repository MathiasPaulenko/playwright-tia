# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x (latest) | ✅ |
| older | ❌ |

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/MathiasPaulenko/playwright-tia/security/advisories/new)
instead of opening a public issue.

Things worth reporting: a bug that lets an attacker **skip tests that should run** (selection integrity), arbitrary file reads/writes outside the project root through `pw-tia`, or unsafe handling of coverage data.

Not in scope: coverage collection slowing down your tests, or selection being *too* conservative — those are bugs, not vulnerabilities.

You can expect an acknowledgement within a few days.
