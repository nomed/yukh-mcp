# SESSION 2026-08-19 — Control Plane worker observation

## Outcome

Added Control Plane worker observation snapshots after a provider runner is
attached.

## Scope

- Reads the attached worker from the existing TeamStore.
- Records worker state, launch state, completion outcome, observed tokens,
  budget outcome and log path.
- Exposes observation snapshots through API and UI.
- Does not relaunch provider workers.

## Token guardrail

Observation is read-only against the team runtime. Repeated observations create
snapshots and do not spend model tokens.

## Next

Add log tailing/openable log artifacts so the operator can inspect what the
worker is doing without leaving the Control Plane.
