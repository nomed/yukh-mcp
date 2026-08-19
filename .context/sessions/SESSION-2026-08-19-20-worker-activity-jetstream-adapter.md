# Session 2026-08-19 20 — Worker activity JetStream adapter

## Summary

Adds the first real JetStream adapter for `worker.activity.v1`. The Control
Plane can now publish a bounded worker activity event to `YKR_WORKER_EVENTS_V1`
and read recent worker activity from the same stream when
`YUKH_WORKER_ACTIVITY_JETSTREAM=1` is enabled.

## Boundaries

- JetStream is opt-in for the preview server.
- Local preview activity remains available when JetStream is not configured or
  temporarily unavailable.
- The adapter uses `msgID = event.id` for idempotent publish.
- No raw stdout tailing or node-local path is promoted to a distributed
  contract.

## Next

Move actual provider-worker lifecycle observations into this event bus so the
Control Plane receives activity continuously, not only when the preview button
requests a snapshot.
