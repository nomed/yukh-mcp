import { randomUUID } from "node:crypto";
import type {
  AgentState,
  AgentUsage,
  AgentRecord,
} from "../../../packages/team-control/src/store.js";
import {
  WORKER_ACTIVITY_SCHEMA,
  WorkerActivityJetStreamBus,
  workerActivitySubject,
  type WorkerActivityEvent,
  type WorkerActivityEventBus,
} from "../../../packages/runtime-events/src/worker-activity.js";

const DEFAULT_ENV = "local";
const DEFAULT_TENANT = "tenant-local";
const PRODUCER_ID = "team-worker-runtime";

export interface WorkerActivityEmitter {
  running(): Promise<void>;
  tokens(usage: AgentUsage): Promise<void>;
  terminal(
    state: Extract<AgentState, "completed" | "failed" | "stopped">,
    summary?: string,
  ): Promise<void>;
  close(): Promise<void>;
}

export function createNoopWorkerActivityEmitter(): WorkerActivityEmitter {
  return {
    async running() {
      return;
    },
    async tokens() {
      return;
    },
    async terminal() {
      return;
    },
    async close() {
      return;
    },
  };
}

export async function createConfiguredWorkerActivityEmitter(
  agent: AgentRecord,
  env: NodeJS.ProcessEnv,
): Promise<WorkerActivityEmitter> {
  if (env.YUKH_WORKER_ACTIVITY_JETSTREAM !== "1") return createNoopWorkerActivityEmitter();
  try {
    const bus = await WorkerActivityJetStreamBus.connect({
      servers: env.YUKH_NATS_URL ?? "nats://127.0.0.1:4222",
      createStream: env.YUKH_WORKER_ACTIVITY_CREATE_STREAM !== "0",
    });
    return createWorkerActivityEmitter(agent, bus, {
      env: runtimeEnvironment(env.YUKH_RUNTIME_ENV),
      tenant: env.YUKH_TENANT ?? DEFAULT_TENANT,
    });
  } catch (error) {
    process.stderr.write(`yukh-team-worker: worker activity bus unavailable: ${message(error)}\n`);
    return createNoopWorkerActivityEmitter();
  }
}

export function createWorkerActivityEmitter(
  agent: AgentRecord,
  bus: WorkerActivityEventBus,
  options: { readonly env?: "local" | "dev" | "staging" | "prod"; readonly tenant?: string } = {},
): WorkerActivityEmitter {
  let sequence = 0;
  const publish = async (
    activityKind: WorkerActivityEvent["data"]["activity_kind"],
    data: Partial<WorkerActivityEvent["data"]>,
  ): Promise<void> => {
    const event = workerActivityEvent(agent, {
      env: options.env ?? DEFAULT_ENV,
      tenant: options.tenant ?? DEFAULT_TENANT,
      sequence: ++sequence,
      activityKind,
      data,
    });
    try {
      await bus.publish(event);
    } catch (error) {
      process.stderr.write(
        `yukh-team-worker: worker activity publish skipped: ${message(error)}\n`,
      );
    }
  };
  return {
    async running() {
      await publish("status-changed", {
        worker_state: "running",
        summary: "Worker entered running state.",
      });
    },
    async tokens(usage) {
      await publish("tokens-observed", {
        worker_state: "running",
        summary: "Observed bounded token usage.",
        tokens: {
          observed: usage.total_tokens,
          budget: agent.token_budget,
          budget_outcome: usage.budget_outcome,
        },
      });
    },
    async terminal(state, summary) {
      await publish("status-changed", {
        worker_state: state,
        summary: boundedSummary(summary ?? `Worker ${state}.`),
      });
    },
    async close() {
      try {
        await bus.close();
      } catch {
        // Observability must not change worker outcome.
      }
    },
  };
}

export function workerActivityEvent(
  agent: AgentRecord,
  input: {
    readonly env: "local" | "dev" | "staging" | "prod";
    readonly tenant: string;
    readonly sequence: number;
    readonly activityKind: WorkerActivityEvent["data"]["activity_kind"];
    readonly data: Partial<WorkerActivityEvent["data"]>;
  },
): WorkerActivityEvent {
  const now = new Date().toISOString();
  return {
    specversion: "1.0",
    id: randomUUID(),
    source: `yukh://runtime/local-preview/worker/${agent.agent_id}`,
    type: "worker.activity.v1",
    subject: workerActivitySubject({
      env: input.env,
      tenant: input.tenant,
      workerId: agent.agent_id,
      kind: input.activityKind,
    }),
    time: now,
    datacontenttype: "application/json",
    dataschema: WORKER_ACTIVITY_SCHEMA,
    correlationid: agent.team_id,
    causationid: agent.agent_id,
    data: {
      aggregate_type: "WorkerSession",
      aggregate_id: agent.agent_id,
      producer_id: PRODUCER_ID,
      sequence: input.sequence,
      activity_kind: input.activityKind,
      observed_at: now,
      ...input.data,
    },
  };
}

function runtimeEnvironment(value: string | undefined): "local" | "dev" | "staging" | "prod" {
  return value === "dev" || value === "staging" || value === "prod" ? value : "local";
}

function boundedSummary(value: string): string {
  return value.length <= 2_048 ? value : `${value.slice(0, 2_045)}...`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
