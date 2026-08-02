# SESSION-2026-08-02-01 — Foundation and Yukh adoption

- Governing issue: #1
- Pull requests: #14, #21
- Status: completed with handoff

## Objective

Establish Yukh MCP as a public, security-first project; publish its documentation foundation; adopt the repository context system; create the Foundation backlog; and connect issue governance to GitHub Project 5 through Yukh.

## Work completed

- Established the product thesis: **Give agents capability, not custody.**
- Merged PR #14 at `1948b0c3b1da8439eec4aec0c527feaaa9bde386`.
- Added governance, contribution, security, threat-model, brand, MkDocs, Pages, and context foundations.
- Created Foundation initiative #1 and child issues #2–#13.
- Added Yukh contracts with priority, size, estimate, parent, and dependencies to issues #1–#13.
- Added `.yukh/project.yaml` and controlled bootstrap/reconciliation workflows.
- Merged PR #21 at `86d92c729c71fcde2edefd8e3fc7cdcefded111f`, binding workflows directly to Project 5.
- Opened upstream hardening issue `nomed/yukh#94`.
- Triggered a `dry-run` reconciliation for issue #1.

## Evidence and validation

- Documentation workflow passed `mkdocs build --strict`.
- PR #14 was squash-merged and is present on `main`.
- PR #21 was squash-merged and is present on `main`.
- Yukh dry-run reached contract validation and failed reproducibly with:
  - `area must be a non-empty string`;
  - `area is required`;
  - `kind must be a non-empty string`;
  - `kind is required`.
- No Project apply was attempted.

## Decisions discovered

- Project number 5 is public repository configuration and is versioned directly in workflows.
- `YUKH_PROJECT_TOKEN` remains an Actions secret.
- Automatic issue-event reconciliation remains dry-run.
- Project apply requires explicit dispatch confirmation and human review.
- Unrestricted public shell capability remains forbidden.
- The current Yukh release has a supply-chain hardening gap tracked by `nomed/yukh#94`.

## Context impact

- Created and accepted ADR-0001 for repository-owned context.
- Added the first durable session record.
- Created HANDOFF-2026-08-02-01 for remote continuation.

## Risks and unresolved work

- The origin and permission scope of the existing `YUKH_PROJECT_TOKEN` have not been independently verified.
- Contract validation requires `kind` and `area`, but the current yukh-mcp policy and issue contracts omit them.
- Project 5 field compatibility must be discovered before schema apply.
- Yukh v0.7.0 contains a mutable nested `actions/setup-node@v4` reference and uses `npm install`; see `nomed/yukh#94`.
- Pages environment and repository security settings still require administrative verification.
