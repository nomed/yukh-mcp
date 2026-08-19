# Session 2026-08-19 19 — Control Plane worker activity adapter

## Summary

Adds a Control Plane preview adapter for the `worker.activity.v1` runtime contract. The UI can now request a bounded worker activity snapshot after a provider runner is attached, and the API persists the resulting CloudEvents-like event in the local preview store.

## Boundaries

- `worker.activity.v1` is the contract shown to the operator.
- The local TeamStore/file-backed snapshot remains a preview adapter only.
- JetStream is still the intended distributed source for worker activity; this increment does not add the JetStream publisher or consumer.
- The Control Plane still does not launch new work from activity reads.

## Next

Replace the preview adapter with a JetStream publisher/consumer path for runtime activity while keeping the same Control Plane activity view.
