import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorkerActivityEmitter } from "../../apps/team-worker/src/activity.js";
import { ControlPlanePlanPreviewStore } from "../../apps/control-plane-preview/src/plan-preview-store.js";
import { inheritedWorkerActivityEnvironment } from "../../packages/team-control/src/profile-environment.js";
import {
  encodeWorkerActivityEvent,
  validateWorkerActivityEvent,
  WORKER_ACTIVITY_MAX_PAYLOAD_BYTES,
  WORKER_ACTIVITY_SCHEMA,
  WORKER_ACTIVITY_STREAM,
  workerActivitySubject,
  type WorkerActivityEvent,
  type WorkerActivityEventBus,
  type WorkerActivityPublishReceipt,
} from "../../packages/runtime-events/src/worker-activity.js";
import type { AgentRecord } from "../../packages/team-control/src/store.js";

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

const agent = (): AgentRecord => ({
  schema: 1,
  agent_id: "worker-22222222-2222-4222-8222-222222222222",
  kind: "worker",
  coordination_agent: "agent-worker-22222222-2222-4222-8222-222222222222",
  coordination_participant: "agent:worker-22222222-2222-4222-8222-222222222222",
  team_id: "team-11111111-1111-4111-8111-111111111111",
  runtime: "codex",
  role: "backend-developer",
  task: "Implement a bounded worker activity probe.",
  depth: 1,
  can_spawn: false,
  token_budget: 20_000,
  required_actions: [],
  state: "running",
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

test("team worker activity emitter publishes running, token and terminal events", async () => {
  const events: WorkerActivityEvent[] = [];
  const emitter = createWorkerActivityEmitter(
    agent(),
    new (class implements WorkerActivityEventBus {
      async publish(event: WorkerActivityEvent): Promise<WorkerActivityPublishReceipt> {
        validateWorkerActivityEvent(event);
        events.push(event);
        return { stream: WORKER_ACTIVITY_STREAM, sequence: events.length, duplicate: false };
      }

      async recent() {
        return events;
      }

      async close() {
        return;
      }
    })(),
  );

  await emitter.running();
  await emitter.tokens({
    schema: 1,
    source: "codex-python-app-server-v1",
    input_tokens: 1_200,
    cached_input_tokens: 900,
    output_tokens: 300,
    reasoning_output_tokens: 100,
    total_tokens: 1_500,
    budget_outcome: "within",
  });
  await emitter.terminal("completed", "Worker completed with a short public summary.");
  await emitter.close();

  assert.deepEqual(
    events.map((event) => [event.data.sequence, event.data.activity_kind, event.data.worker_state]),
    [
      [1, "status-changed", "running"],
      [2, "tokens-observed", "running"],
      [3, "status-changed", "completed"],
    ],
  );
  assert.equal(events[1]?.data.tokens?.observed, 1_500);
  assert.equal(events[1]?.data.tokens?.budget, 20_000);
  assert.equal(events[0]?.data.producer_id, "team-worker-runtime");
  assert.doesNotMatch(JSON.stringify(events), /Implement a bounded worker activity probe/u);
});

test("team worker activity emitter treats bus publish failures as observability-only", async () => {
  const emitter = createWorkerActivityEmitter(
    agent(),
    new (class implements WorkerActivityEventBus {
      async publish(): Promise<never> {
        throw new Error("nats_down");
      }

      async recent() {
        return [];
      }

      async close() {
        return;
      }
    })(),
  );

  await assert.doesNotReject(async () => {
    await emitter.running();
    await emitter.terminal("failed", "Worker failed.");
    await emitter.close();
  });
});

test("worker activity environment inheritance forwards only runtime activity settings", () => {
  assert.deepEqual(
    inheritedWorkerActivityEnvironment({
      YUKH_WORKER_ACTIVITY_JETSTREAM: "1",
      YUKH_NATS_URL: "nats://127.0.0.1:14222",
      YUKH_WORKER_ACTIVITY_CREATE_STREAM: "0",
      YUKH_RUNTIME_ENV: "local",
      YUKH_TENANT: "tenant-local",
      YUKH_CODEX_EXECUTABLE: "/usr/bin/codex",
      SECRET_TOKEN: "must-not-pass",
    }),
    {
      YUKH_WORKER_ACTIVITY_JETSTREAM: "1",
      YUKH_NATS_URL: "nats://127.0.0.1:14222",
      YUKH_WORKER_ACTIVITY_CREATE_STREAM: "0",
      YUKH_RUNTIME_ENV: "local",
      YUKH_TENANT: "tenant-local",
    },
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
