# Control Plane provider model discovery

Date: 2026-08-19

## Outcome

Added a read-only provider model discovery hook for Control Plane capability inventory.

## Scope

- Reused the existing team-control model discovery module.
- Added a provider model discoverer dependency to the Control Plane plan preview store.
- Wired the preview server to discover Codex CLI and Copilot SDK worker model catalogs when an adapter has an executable path.
- Kept model inventory constrained by the configured adapter allowlist.
- Preserved local adapter config inventory as the fallback when discovery is unavailable.

## Safety boundary

This increment does not launch workers and does not write to Coordination or Projects.
Provider discovery is only reached from the explicit capability inventory action.
Discovered models are filtered through the configured adapter allowlist.

## Validation

- `npm run format:check`
- `npm run typecheck`
- `npm run build`
- `node --import tsx --test test/runtime/control-plane-preview.test.ts`
- `git diff --check`
