# SESSION-2026-08-18-01 — Projects handoff adapter

- Governing issue: https://github.com/nomed/yukh-mcp/issues/245
- Pull request: https://github.com/nomed/yukh-mcp/pull/244
- Status: In progress

## Objective

Consume the provider-neutral manager orchestration handoff emitted by
`yukh-projects` and map it to bounded local Yukh team manager startup.

## Work completed

- Added a closed parser for `yukh-projects-manager-orchestration-handoff-v1`.
- Added `yukh team start-from-handoff`.
- Added dry-run support for preview/control-plane use.
- Mapped MCP/control-plane handoff routes to the existing accounted
  `team start` manager path.

## Evidence and validation

- `npm run typecheck`
- `node --import tsx --test test/runtime/team-start-handoff.test.ts`
- `npm run test:runtime` outside sandbox because loopback listener tests require
  binding to `127.0.0.1`.

## Decisions discovered

`yukh-projects` remains the governance/admission layer. It does not call MCP,
Codex, Copilot, SDKs, or CLIs. `yukh-mcp` is the local adapter that may consume
the admitted handoff and start a bounded manager through existing team-control
runtime supervision.

## Context impact

Future control-plane work should call `yukh team start-from-handoff` or the same
handoff mapping function instead of reinterpreting Projects admission records.

## Risks and unresolved work

- The adapter currently supports `mcp` and `control_plane` routes only.
- SDK-specific Codex/Copilot session startup remains behind the existing team
  worker runtime path.
