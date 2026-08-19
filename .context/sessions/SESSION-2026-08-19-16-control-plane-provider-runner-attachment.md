# SESSION 2026-08-19 — Control Plane provider runner attachment

## Outcome

Added the Control Plane step that attaches an authorised provider process start
request to the existing team runtime supervisor.

## Scope

- Introduces a provider runner attachment record after
  `provider_worker_process`.
- Exposes the attachment through the Control Plane API and UI.
- Wires local Control Plane startup to `TeamStore` + `TeamSupervisor` when
  `YUKH_COORDINATION_LAUNCHER`, `YUKH_CODEX_EXECUTABLE` and
  `YUKH_COPILOT_EXECUTABLE` are configured.
- Keeps tests on an injected fake runner, so no model tokens are spent in CI.

## Token guardrail

The UI can now request a real runner attachment only in a configured local
runtime. Runtime tests validate the contract with a fake runner and assert
idempotency so repeated operator clicks do not spawn duplicate workers.

## Next

Observe worker completion from the team store and surface log, exit status and
token accounting in the Control Plane.
