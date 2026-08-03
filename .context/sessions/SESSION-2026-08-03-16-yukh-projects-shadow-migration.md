# Session — Yukh Projects shadow migration

- Date: 2026-08-03
- Governing issue: https://github.com/nomed/yukh-mcp/issues/27
- Branch: `agent/issue-27-yukh-projects-shadow`
- Status: shadow-only migration implementation prepared

## Outcome

Added a manual, one-issue successor workflow pinned to immutable Yukh Projects
v1.3.4 with its explicit `legacy-shadow` adapter. The workflow has read-only
repository permissions, exposes no apply
input, uploads only the successor's redacted report for one day, and records
bounded aggregate outputs. Existing legacy workflows remain untouched.

## Validation and boundary

Supply-chain tests bind the exact successor commit and reject an apply surface
or automatic issue trigger. A local authorized shadow probe uses GraphQL-zero
behavior and records only aggregate evidence. No Project mutation, controlled
apply, legacy removal, deployment, private consumer reference, or credential is
introduced.

## Context impact

No architecture, public MCP capability, authentication, authorization, runtime,
provider, or deployment trust boundary changes. No RFC or threat-model delta is
required for this read-only repository-governance workflow.

## Remaining work

Review the exact successor report against the last verified legacy dry-run.
Controlled apply and a second zero-operation apply remain separately gated.
