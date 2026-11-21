---
name: qa-security-review
description: Review a project's changes for functional correctness, regression, security, privacy, and reliability risks.
---

# QA & Security Review

1. Derive a review checklist from the project's requirements and threat model.
2. Inspect changed code and relevant surrounding components.
3. Check normal flows, edge cases, failure paths, and regression risks.
4. Check authorization, validation, injection, secrets, data handling, dependencies, and configuration as relevant.
5. Run safe tests only within authorized scope.
6. Rank findings by severity and likelihood/impact.
7. Include evidence, reproduction steps, affected locations, and actionable fixes.
8. State what could not be tested.

Do not run destructive tests or touch external/production systems without explicit permission.
