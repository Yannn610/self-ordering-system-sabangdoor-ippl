---
name: implementation-workflow
description: Execute scoped changes safely with inspection, incremental implementation, tests, and clear handoffs.
---

# Implementation Workflow

1. Confirm scope, acceptance criteria, and files/components involved.
2. Inspect existing implementation and local conventions.
3. Break work into small, verifiable steps.
4. Implement the smallest coherent change.
5. Keep interfaces and behavior compatible unless change is requested.
6. Add/update tests and documentation where appropriate.
7. Run relevant tests, lint, type checks, builds, or domain-specific validation.
8. Inspect diffs for accidental edits, secrets, generated noise, and unrelated changes.
9. Report exact files changed, checks run, outcomes, and remaining work.

Never report unrun checks as passing.
