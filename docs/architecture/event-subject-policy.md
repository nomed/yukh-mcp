# Yukh Event & Subject Policy

Yukh uses event streams as distributed facts, not as a generic log dump. The
policy follows established event-sourcing, CloudEvents and NATS JetStream
patterns, adapted to Yukh bounded contexts.

## Bounded contexts

| Context | Owner | Aggregate root | Stream |
| --- | --- | --- | --- |
| Projects | `yukh-projects` | `WorkItem`, `Roadmap`, `Claim` | `YKP_WORK_EVENTS_V1` |
| Orchestration | `yukh-mcp` | `TeamRun`, `ManagerRun`, `WorkerLaunch` | `YKO_RUN_EVENTS_V1` |
| Coordination | `yukh-coordination` | `ChannelTranscript` | `YKC_CHANNEL_EVENTS_V1` |
| Runtime | provider runner | `WorkerSession` | `YKR_WORKER_EVENTS_V1` |

Each stream is append-only for its bounded context. NATS KV buckets are
rebuildable projections. They are never the source of truth.

## Subject policy

Publish subjects use this shape:

```text
yukh.<env>.<tenant>.<context>.<aggregate_type>.<aggregate_id>.<event_type>.v1
```

Valid examples:

```text
yukh.local.tenant-local.projects.work.work-123.claimed.v1
yukh.local.tenant-local.orchestration.team.team-abc.worker-started.v1
yukh.local.tenant-local.coordination.channel.channel-1.question-asked.v1
yukh.local.tenant-local.runtime.worker.worker-xyz.tokens-observed.v1
```

Rules:

- Subjects are lowercase, dot-separated routing keys.
- Producers never publish to wildcard subjects.
- Subjects never contain prompts, user text, local paths, secrets or credentials.
- Domain meaning belongs in the event body, not in a longer subject.
- Consumers may subscribe with wildcards only inside their authorized scope.

## Event envelope

Events use a CloudEvents-like envelope:

- `specversion`, `id`, `source`, `type`, `subject`, `time`;
- `datacontenttype: application/json`;
- `dataschema` for the payload schema;
- `correlationid` and `causationid` when the event follows another operation;
- `data.aggregate_type`, `data.aggregate_id`, `data.producer_id` and
  aggregate-local `data.sequence`.

`source` plus `id` identifies duplicate deliveries. Aggregate sequence is used
only where the writer owns ordering for one aggregate.

## Runtime activity

Worker runtime activity is represented by `worker.activity.v1` events on
`YKR_WORKER_EVENTS_V1`.

Runtime activity answers “what is this worker process doing?” It does not
replace Coordination, which answers “what did agents say to each other?”

Initial activity kinds:

- `heartbeat`;
- `status-changed`;
- `tokens-observed`;
- `log-chunked`;
- `artifact-recorded`.

Inline log chunks are bounded. Larger outputs are stored as NATS Object Store
objects and referenced from events with `artifact_ref`.

Local files are preview adapters only. A local path may help one-node
development, but it is not a distributed contract and must not be required by
the Control Plane.

The Control Plane can publish and read runtime activity through the JetStream
adapter when explicitly enabled:

```text
YUKH_WORKER_ACTIVITY_JETSTREAM=1
YUKH_NATS_URL=nats://127.0.0.1:14222
YUKH_WORKER_ACTIVITY_CREATE_STREAM=1
```

If the adapter is not enabled, the preview UI keeps using the local preview
adapter and labels the source accordingly. Enabling JetStream creates or uses
`YKR_WORKER_EVENTS_V1` with subject `yukh.*.*.runtime.worker.*.*.v1`; events
are published with `msgID = event.id` for idempotent delivery.

The local Coordination preview exposes JetStream for Control Plane runtime
activity on `127.0.0.1:14222`, leaving `127.0.0.1:4222` free for any existing
host NATS server.

## Resource and resilience policy

- Emit compact activity events; do not publish every stdout byte as an event.
- Sample heartbeats and aggregate token observations.
- Use short retention for verbose runtime activity.
- Use longer retention for Projects and Coordination governance facts.
- Give large artifacts an explicit Object Store TTL.
- Keep KV projections disposable and reconstructable from streams.
- If JetStream is unavailable, consumers surface `unavailable` or `stale`
  rather than pretending the local cache is authoritative.
- If Object Store is unavailable, consumers keep the event visible and mark the
  artifact reference unreadable.
