# SESSION 2026-08-19 — Event and subject policy

## Outcome

Introduced the Yukh event and subject policy before adding distributed worker
activity/log handling.

## Scope

- Documents bounded contexts, aggregate roots, JetStream streams and NATS
  subject naming.
- Adds the first runtime activity contract: `worker.activity.v1`.
- Keeps local log files as preview adapters only.
- Marks KV projections as rebuildable and Object Store as the large-artifact
  target.

## Resource guardrail

Runtime activity is compact by default: bounded log chunks, sampled heartbeats,
aggregated token observations and object references for large payloads.

## Next

Implement Control Plane worker activity against this event contract instead of
promoting node-local log tailing as the distributed interface.
