import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ControlPlanePlanPreviewStore } from "../../apps/control-plane-preview/src/plan-preview-store.js";
import {
  encodeWorkerActivityEvent,
  validateWorkerActivityEvent,
  WORKER_ACTIVITY_MAX_PAYLOAD_BYTES,
  WORKER_ACTIVITY_SCHEMA,
  WORKER_ACTIVITY_STREAM,
  workerActivitySubject,
  type WorkerActivityEvent,
  type WorkerActivityEventBus,
} from "../../packages/runtime-events/src/worker-activity.js";

const activity = (sequence = 1): WorkerActivityEvent => ({
  specversion: "1.0",
  id: "11111111-1111-4111-8111-111111111111",
  source: "yukh://runtime/local-preview/worker/worker-22222222-2222-4222-8222-222222222222",
  type: "worker.activity.v1",
  subject: workerActivitySubject({
    env: "local",
    tenant: "tenant-local",
    workerId: "worker-22222222-2222-4222-8222-222222222222",
    kind: "tokens-observed",
  }),
  time: "2026-08-19T12:00:00.000Z",
  datacontenttype: "application/json",
  dataschema: WORKER_ACTIVITY_SCHEMA,
  correlationid: "provider-runner-attachment:demo",
  causationid: "provider-worker-process:demo",
  data: {
    aggregate_type: "WorkerSession",
    aggregate_id: "worker-22222222-2222-4222-8222-222222222222",
    producer_id: "control-plane-preview-adapter",
    sequence,
    activity_kind: "tokens-observed",
    observed_at: "2026-08-19T12:00:00.000Z",
    worker_state: "running",
    summary: "Observed bounded token usage.",
    tokens: {
      observed: 12_000,
      budget: 66_000,
      budget_outcome: "within",
    },
  },
});

test("worker activity subject and payload stay within the JetStream policy", () => {
  const event = activity();
  assert.equal(
    event.subject,
    "yukh.local.tenant-local.runtime.worker.worker-22222222-2222-4222-8222-222222222222.tokens-observed.v1",
  );
  assert.doesNotMatch(event.subject, /[*>]/u);
  assert.doesNotMatch(event.subject, /\\/u);
  assert.doesNotThrow(() => validateWorkerActivityEvent(event));
  assert.ok(encodeWorkerActivityEvent(event).byteLength < WORKER_ACTIVITY_MAX_PAYLOAD_BYTES);
  assert.throws(
    () =>
      workerActivitySubject({
        env: "local",
        tenant: "tenant-local",
        workerId: "worker/path",
        kind: "status-changed",
      }),
    /invalid worker activity subject input/u,
  );
});

test("control plane store publishes worker activity to the event bus and reads bus projection", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "yukh-worker-activity-bus-"));
  const store = new ControlPlanePlanPreviewStore(workspace, {
    workerActivityAdapter: async ({ sequence }) => activity(sequence),
    workerActivityBus: new (class implements WorkerActivityEventBus {
      readonly events: WorkerActivityEvent[] = [];

      async publish(event: WorkerActivityEvent) {
        this.events.unshift(event);
        return {
          stream: WORKER_ACTIVITY_STREAM,
          sequence: this.events.length,
          duplicate: false,
        } as const;
      }

      async recent(limit: number) {
        return this.events.slice(0, limit);
      }

      async close() {}
    })(),
  });
  await mkdir(join(workspace, ".yukh", "control-plane"), { recursive: true });
  await writeFile(
    join(workspace, ".yukh", "control-plane", "plan-previews.json"),
    JSON.stringify({
      schema: 1,
      previews: [],
      provider_runner_attachments: [
        {
          schema: 1,
          provider_runner_attachment_id: "provider-runner-attachment:demo",
          provider_worker_process_id: "provider-worker-process:demo",
          worker_launch_receipt_id: "worker-launch-receipt:demo",
          worker_launch_candidate_id: "worker-launch-candidate:demo",
          provider: "Copilot SDK workers",
          runtime: "copilot",
          team_id: "team-11111111-1111-4111-8111-111111111111",
          agent_id: "worker-22222222-2222-4222-8222-222222222222",
          pid: 12345,
          log_path: "/tmp/preview-adapter-only.log",
          token_budget: 66_000,
          provider_process_start: "attached",
          worker_launch: "running",
          coordination_write: "not_performed",
          projects_write: "not_performed",
          created_at: "2026-08-19T12:00:00.000Z",
          next_required_action: "observe_worker_completion",
        },
      ],
    }),
  );

  const recorded = await store.recordWorkerActivity();
  assert.equal(recorded.type, "worker.activity.v1");
  const status = await store.workerActivities();
  assert.equal(status.source, "worker.activity.v1-jetstream");
  assert.equal(status.activities.length, 1);
  assert.equal(status.activities[0]?.id, recorded.id);
});
