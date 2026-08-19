# SESSION 2026-08-19 — Control Plane provider worker process start

## Outcome

Added the next Control Plane step after an explicit worker launch receipt: a
provider worker process start record.

## Scope

- Records the authorised provider worker process start request.
- Keeps Coordination and Projects writes disabled.
- Keeps provider worker execution detached from the real Codex/Copilot runner
  until runner attachment is explicit and supervised.

## Token guardrail

The record is intentionally local and idempotent. It does not launch a provider
process yet, so the flow can be tested without spending model tokens.

## Next

Attach the provider runner so the recorded start request becomes a supervised
process with stdout/stderr, exit status and token accounting.
