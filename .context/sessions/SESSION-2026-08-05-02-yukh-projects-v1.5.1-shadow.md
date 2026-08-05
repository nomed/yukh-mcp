# Session — Yukh Projects v1.5.1 shadow qualification

- Date: 2026-08-05
- Governing issue: https://github.com/nomed/yukh-mcp/issues/27
- Related migration gate: https://github.com/nomed/yukh-projects/issues/125
- Branch: `agent/issue-27-yukh-projects-v151`
- Status: shadow-only pin update prepared for review

## Objective

Replace the v1.4.0 shadow pin with immutable corrected release v1.5.1 and rerun one bounded read-only comparison before any controlled plan approval.

## Work completed

- Verified release tag `v1.5.1` resolves to commit `d58837397bc5856923e0e742458be34d8e5a27d6`.
- Verified the protected publisher completed and published checksums, SPDX SBOM, and provenance attestations.
- Updated only the manual shadow workflow pin, its supply-chain assertion, and migration guidance.
- Preserved `workflow_dispatch`, read-only permissions, one-issue scope, one-day redacted evidence, and the absence of apply inputs or write credentials.

## Evidence and validation

- Producer correction: https://github.com/nomed/yukh-projects/pull/126
- Producer issue: https://github.com/nomed/yukh-projects/issues/121
- Immutable release: https://github.com/nomed/yukh-projects/releases/tag/v1.5.1
- Publication run: https://github.com/nomed/yukh-projects/actions/runs/30999840785
- Consumer tests and PR checks are recorded in the governing pull request.

## Decisions discovered

No new architecture or security decision. This change applies the existing owner-aware routing and read-only shadow contracts. GitHub reports the repository as user-owned, so Project `Work Type` fallback must match controlled planning.

## Context impact

No MCP capability, authentication, authorization, deployment, or mutation boundary changes. No RFC or threat-model update is required.

## Risks and unresolved work

- The shadow must be manually rerun for issue #27 after merge and compared with a fresh controlled plan.
- No Project mutation, apply, legacy removal, deployment, or migration completion is authorized.
- A GitHub Actions job is not durable coordination; resumable apply requires a separately governed host.
