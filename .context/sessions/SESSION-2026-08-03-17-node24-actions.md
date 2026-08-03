# SESSION-2026-08-03-17 — Node 24 Actions refresh

- Governing issue: https://github.com/nomed/yukh-mcp/issues/54
- Pull request: https://github.com/nomed/yukh-mcp/pull/55
- Status: implementation complete

## Objective

Remove the Pages workflow Node 20 deprecation warning without weakening
immutable pinning or workflow permissions.

## Work completed

- Updated official checkout, Node setup, Python setup, Pages configuration,
  Pages artifact, and Scorecard artifact Actions to current reviewed Node 24
  releases.
- Updated CodeQL init, analyze, and SARIF upload from v3 to v4 on Node 24.
- Applied shared Action updates consistently across all workflows.
- Added a regression test for the reviewed Node 24 pins.

## Evidence and validation

- Release tags and commit objects resolved through the GitHub API.
- Each reviewed Action's `action.yml` declares `node24`; the Pages artifact
  composite pins `actions/upload-artifact` v7 internally.
- `npm run format:check`
- `npm test`

## Decisions discovered

No architecture, runtime, permission, or trust boundary changed. External
Actions remain pinned to full commit SHAs.

## Context impact

Supply-chain maintenance evidence only.

## Risks and unresolved work

The deprecation annotation must be checked on the first post-merge Pages run.
