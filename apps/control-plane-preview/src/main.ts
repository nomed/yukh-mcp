import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverCodexModels,
  discoverCopilotModelCatalog,
} from "../../../packages/team-control/src/model-discovery.js";
import { TeamStore } from "../../../packages/team-control/src/store.js";
import { teamRuntimeEntrypoints } from "../../../packages/team-control/src/entrypoints.js";
import { TeamSupervisor } from "../../../packages/team-control/src/supervisor.js";
import { inheritedWorkerActivityEnvironment } from "../../../packages/team-control/src/profile-environment.js";
import {
  WorkerActivityJetStreamBus,
  WORKER_ACTIVITY_PREVIEW_NATS_URL,
  WORKER_ACTIVITY_SCHEMA,
  workerActivitySubject,
} from "../../../packages/runtime-events/src/worker-activity.js";
import {
  ControlPlanePlanPreviewStore,
  type ControlPlaneProviderAdapterInput,
  type ControlPlaneProviderModelDiscoverer,
  type ControlPlaneProviderRunner,
  type ControlPlaneWorkerActivityAdapter,
  type ControlPlanePlanPreviewInput,
} from "./plan-preview-store.js";
import { createTeamStatus } from "./team-status.js";
import { createTopologyStatus } from "./topology-status.js";

type ControlPlaneOptions = {
  readonly host: string;
  readonly port: number;
  readonly staticRoot?: string;
  readonly workspace?: string;
};

const CONTENT_TYPES = new Map([
  ["index.html", "text/html; charset=utf-8"],
  ["styles.css", "text/css; charset=utf-8"],
  ["mock-data.js", "text/javascript; charset=utf-8"],
]);

const API_TOPOLOGY_STATUS_PATH = "/api/topology/status";
const API_TEAM_STATUS_PATH = "/api/teams/status";
const API_PLAN_PREVIEWS_PATH = "/api/manager-plan/previews";
const API_LAUNCH_READINESS_PATH = "/api/manager-plan/launch-readiness";
const API_LAUNCH_INTENTS_PATH = "/api/manager-plan/launch-intents";
const API_MANAGER_RUNS_PATH = "/api/manager-plan/manager-runs";
const API_MANAGER_RUNTIME_CONNECTIONS_PATH = "/api/manager-plan/runtime-connections";
const API_MANAGER_PROCESSES_PATH = "/api/manager-plan/manager-processes";
const API_MANAGER_READY_RECEIPTS_PATH = "/api/manager-plan/manager-ready-receipts";
const API_WORKER_DELEGATION_PLANS_PATH = "/api/manager-plan/worker-delegation-plans";
const API_WORKER_DELEGATION_APPROVALS_PATH = "/api/manager-plan/worker-delegation-approvals";
const API_WORKER_LAUNCH_PREFLIGHTS_PATH = "/api/manager-plan/worker-launch-preflights";
const API_PROVIDER_RUNTIME_PROBES_PATH = "/api/manager-plan/provider-runtime-probes";
const API_PROVIDER_ADAPTERS_PATH = "/api/manager-plan/provider-adapters";
const API_PROVIDER_CAPABILITY_INVENTORIES_PATH =
  "/api/manager-plan/provider-capability-inventories";
const API_WORKER_LAUNCH_CANDIDATES_PATH = "/api/manager-plan/worker-launch-candidates";
const API_WORKER_LAUNCH_RECEIPTS_PATH = "/api/manager-plan/worker-launch-receipts";
const API_PROVIDER_WORKER_PROCESSES_PATH = "/api/manager-plan/provider-worker-processes";
const API_PROVIDER_RUNNER_ATTACHMENTS_PATH = "/api/manager-plan/provider-runner-attachments";
const API_WORKER_ACTIVITIES_PATH = "/api/manager-plan/worker-activities";

export function parseArguments(argv: readonly string[]): ControlPlaneOptions {
  const options = { host: "127.0.0.1", port: 7345 } as {
    host: string;
    port: number;
    staticRoot?: string;
    workspace?: string;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--host" && next) {
      options.host = next;
      i += 1;
    } else if (arg === "--port" && next) {
      const port = Number.parseInt(next, 10);
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new TypeError("invalid control plane port");
      }
      options.port = port;
      i += 1;
    } else if (arg === "--static-root" && next) {
      options.staticRoot = next;
      i += 1;
    } else if (arg === "--workspace" && next) {
      options.workspace = next;
      i += 1;
    } else {
      throw new TypeError("invalid control plane arguments");
    }
  }
  return options;
}

export function defaultStaticRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return normalize(join(here, "..", "static"));
}

function requestedFile(url = "/"): string | null {
  const path = new URL(url, "http://127.0.0.1").pathname;
  if (path === "/" || path === "/index.html") return "index.html";
  if (path === "/styles.css") return "styles.css";
  if (path === "/mock-data.js") return "mock-data.js";
  return null;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 32_768) throw new TypeError("request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export const discoverConfiguredProviderModels: ControlPlaneProviderModelDiscoverer = async (
  adapter,
) => {
  if (!adapter.executable_path) return undefined;
  if (adapter.provider === "Codex manager CLI") {
    return { models: discoverCodexModels(adapter.executable_path), source: "cli" };
  }
  if (adapter.provider === "Copilot SDK workers") {
    const catalog = await discoverCopilotModelCatalog(adapter.executable_path);
    return { models: catalog.models, source: catalog.source };
  }
  return undefined;
};

function runtimeForProvider(provider: string): "codex" | "copilot" {
  return provider === "Copilot SDK workers" ? "copilot" : "codex";
}

function createConfiguredProviderRunner(
  workspace: string,
  teamStore: TeamStore,
): ControlPlaneProviderRunner | undefined {
  const launcher = process.env.YUKH_COORDINATION_LAUNCHER;
  const codex = process.env.YUKH_CODEX_EXECUTABLE;
  const copilot = process.env.YUKH_COPILOT_EXECUTABLE;
  if (!launcher || !codex || !copilot) return undefined;

  const entrypoints = teamRuntimeEntrypoints();
  const supervisor = new TeamSupervisor({
    node: process.execPath,
    worker: entrypoints.worker,
    coordinationMcp: entrypoints.coordinationMcp,
    teamControlMcp: entrypoints.teamControlMcp,
    launcher,
    codex,
    copilot,
    workspace,
    profileEnvironment: {
      ...(process.env.YUKH_PREVIEW_RUNTIME
        ? { YUKH_PREVIEW_RUNTIME: process.env.YUKH_PREVIEW_RUNTIME }
        : {}),
      ...(process.env.YUKH_COPILOT_WORKER_PROVIDER
        ? { YUKH_COPILOT_WORKER_PROVIDER: process.env.YUKH_COPILOT_WORKER_PROVIDER }
        : {}),
      ...(process.env.YUKH_CODEX_WORKER_PROVIDER
        ? { YUKH_CODEX_WORKER_PROVIDER: process.env.YUKH_CODEX_WORKER_PROVIDER }
        : {}),
      ...(process.env.YUKH_CODEX_PYTHON_EXECUTABLE
        ? { YUKH_CODEX_PYTHON_EXECUTABLE: process.env.YUKH_CODEX_PYTHON_EXECUTABLE }
        : {}),
      ...inheritedWorkerActivityEnvironment(),
    },
  });

  return async ({ process: providerProcess }) => {
    const runtime = runtimeForProvider(providerProcess.provider);
    const tokenBudget = providerProcess.approved_worker_token_budget;
    const team = teamStore.create(
      `Control Plane provider runner attachment ${providerProcess.provider_worker_process_id}`,
      runtime,
      Math.max(1, providerProcess.approved_worker_count),
      1,
      tokenBudget,
    );
    const workerBudget = Math.max(
      1_000,
      Math.floor(tokenBudget / providerProcess.approved_worker_count),
    );
    const agent = teamStore.spawn(team.team_id, {
      runtime,
      role: "provider-runner",
      task: "Attach the provider worker runtime to the Yukh Control Plane. Do not modify files. Confirm readiness and report the Coordination identity, runtime and next observable status.",
      can_spawn: false,
      token_budget: workerBudget,
      model_tool_mode: "none",
      max_commands: 0,
      timeout_ms: 60_000,
    });
    const launched = supervisor.launch(agent);
    return {
      runtime,
      team_id: team.team_id,
      agent_id: agent.agent_id,
      pid: launched.pid,
      log_path: launched.log,
    };
  };
}

function createConfiguredWorkerActivityAdapter(
  teamStore: TeamStore,
): ControlPlaneWorkerActivityAdapter {
  return async ({ attachment, sequence }) => {
    const agent = teamStore.agent(attachment.team_id, attachment.agent_id);
    const observed = new Date().toISOString();
    const activityKind = agent.usage ? "tokens-observed" : "status-changed";
    return {
      specversion: "1.0",
      id: randomUUID(),
      source: `yukh://runtime/local-preview/worker/${agent.agent_id}`,
      type: "worker.activity.v1",
      subject: workerActivitySubject({
        env: "local",
        tenant: "tenant-local",
        workerId: agent.agent_id,
        kind: activityKind,
      }),
      time: observed,
      datacontenttype: "application/json",
      dataschema: WORKER_ACTIVITY_SCHEMA,
      correlationid: attachment.provider_runner_attachment_id,
      causationid: attachment.provider_worker_process_id,
      data: {
        aggregate_type: "WorkerSession",
        aggregate_id: agent.agent_id,
        producer_id: "control-plane-preview-adapter",
        sequence,
        activity_kind: activityKind,
        observed_at: observed,
        worker_state: agent.state,
        summary:
          "Preview adapter snapshot; JetStream worker.activity.v1 remains the distributed contract.",
        ...(agent.usage
          ? {
              tokens: {
                observed: agent.usage.total_tokens,
                budget: agent.token_budget,
                budget_outcome: agent.usage.budget_outcome,
              },
            }
          : {}),
      },
    };
  };
}

async function createConfiguredWorkerActivityBus(): Promise<
  WorkerActivityJetStreamBus | undefined
> {
  if (process.env.YUKH_WORKER_ACTIVITY_JETSTREAM !== "1") return undefined;
  try {
    return await WorkerActivityJetStreamBus.connect({
      servers: process.env.YUKH_NATS_URL ?? WORKER_ACTIVITY_PREVIEW_NATS_URL,
      createStream: process.env.YUKH_WORKER_ACTIVITY_CREATE_STREAM !== "0",
    });
  } catch (error) {
    process.stderr.write(
      `Yukh Control Plane worker activity JetStream unavailable; using preview adapter only: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    return undefined;
  }
}

export function createControlPlaneServer(
  staticRoot = defaultStaticRoot(),
  options: {
    readonly teamStore?: Pick<TeamStore, "teams">;
    readonly planPreviewStore?: ControlPlanePlanPreviewStore;
  } = {},
): Server {
  return createServer(async (request, response) => {
    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_LAUNCH_READINESS_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method !== "GET") {
        response.writeHead(405, {
          allow: "GET",
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
        return;
      }
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(options.planPreviewStore.launchReadiness()));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_LAUNCH_INTENTS_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(options.planPreviewStore.launchIntents()));
        return;
      }
      if (request.method === "POST") {
        try {
          const record = options.planPreviewStore.createLaunchIntent();
          response.writeHead(201, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({ schema: 1, status: "ok", launch_intent: record }));
        } catch {
          response.writeHead(409, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({ schema: 1, status: "error", code: "launch_readiness_blocked" }),
          );
        }
        return;
      }
      response.writeHead(405, {
        allow: "GET, POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_PROVIDER_WORKER_PROCESSES_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(options.planPreviewStore.providerWorkerProcesses()));
        return;
      }
      if (request.method === "POST") {
        try {
          const record = options.planPreviewStore.createProviderWorkerProcess();
          response.writeHead(201, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({ schema: 1, status: "ok", provider_worker_process: record }),
          );
        } catch {
          response.writeHead(409, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({
              schema: 1,
              status: "error",
              code: "worker_launch_receipt_required",
            }),
          );
        }
        return;
      }
      response.writeHead(405, {
        allow: "GET, POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_PROVIDER_RUNNER_ATTACHMENTS_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(options.planPreviewStore.providerRunnerAttachments()));
        return;
      }
      if (request.method === "POST") {
        try {
          const record = await options.planPreviewStore.attachProviderRunner();
          response.writeHead(201, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({ schema: 1, status: "ok", provider_runner_attachment: record }),
          );
        } catch (error) {
          const code =
            error instanceof Error && error.message === "provider_runner_unconfigured"
              ? "provider_runner_unconfigured"
              : error instanceof TypeError
                ? "provider_worker_process_required"
                : "provider_runner_attachment_failed";
          response.writeHead(409, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({ schema: 1, status: "error", code }));
        }
        return;
      }
      response.writeHead(405, {
        allow: "GET, POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_WORKER_ACTIVITIES_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(await options.planPreviewStore.workerActivities()));
        return;
      }
      if (request.method === "POST") {
        try {
          const record = await options.planPreviewStore.recordWorkerActivity();
          response.writeHead(201, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({ schema: 1, status: "ok", worker_activity: record }));
        } catch (error) {
          const code =
            error instanceof Error && error.message === "worker_activity_adapter_unconfigured"
              ? "worker_activity_adapter_unconfigured"
              : error instanceof TypeError
                ? "provider_runner_attachment_required"
                : "worker_activity_failed";
          response.writeHead(409, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({ schema: 1, status: "error", code }));
        }
        return;
      }
      response.writeHead(405, {
        allow: "GET, POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_MANAGER_RUNS_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(options.planPreviewStore.managerRuns()));
        return;
      }
      if (request.method === "POST") {
        try {
          const record = options.planPreviewStore.createManagerRun();
          response.writeHead(201, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({ schema: 1, status: "ok", manager_run: record }));
        } catch {
          response.writeHead(409, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({ schema: 1, status: "error", code: "launch_intent_required" }),
          );
        }
        return;
      }
      response.writeHead(405, {
        allow: "GET, POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_MANAGER_RUNTIME_CONNECTIONS_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(options.planPreviewStore.managerRuntimeConnections()));
        return;
      }
      if (request.method === "POST") {
        try {
          const record = options.planPreviewStore.connectManagerRuntime();
          response.writeHead(201, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({ schema: 1, status: "ok", runtime_connection: record }));
        } catch {
          response.writeHead(409, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({ schema: 1, status: "error", code: "manager_run_required" }),
          );
        }
        return;
      }
      response.writeHead(405, {
        allow: "GET, POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_MANAGER_PROCESSES_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(options.planPreviewStore.managerProcesses()));
        return;
      }
      if (request.method === "POST") {
        try {
          const record = options.planPreviewStore.startManagerProcess();
          response.writeHead(201, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({ schema: 1, status: "ok", manager_process: record }));
        } catch {
          response.writeHead(409, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({ schema: 1, status: "error", code: "runtime_connection_required" }),
          );
        }
        return;
      }
      response.writeHead(405, {
        allow: "GET, POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_MANAGER_READY_RECEIPTS_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(options.planPreviewStore.managerReadyReceipts()));
        return;
      }
      if (request.method === "POST") {
        try {
          const record = options.planPreviewStore.recordManagerReadyReceipt();
          response.writeHead(201, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({ schema: 1, status: "ok", manager_ready_receipt: record }));
        } catch {
          response.writeHead(409, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({ schema: 1, status: "error", code: "manager_process_required" }),
          );
        }
        return;
      }
      response.writeHead(405, {
        allow: "GET, POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_WORKER_DELEGATION_PLANS_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(options.planPreviewStore.workerDelegationPlans()));
        return;
      }
      if (request.method === "POST") {
        try {
          const record = options.planPreviewStore.prepareWorkerDelegationPlan();
          response.writeHead(201, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({ schema: 1, status: "ok", worker_delegation_plan: record }));
        } catch {
          response.writeHead(409, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({ schema: 1, status: "error", code: "manager_ready_receipt_required" }),
          );
        }
        return;
      }
      response.writeHead(405, {
        allow: "GET, POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_WORKER_DELEGATION_APPROVALS_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(options.planPreviewStore.workerDelegationApprovals()));
        return;
      }
      if (request.method === "POST") {
        try {
          const record = options.planPreviewStore.approveWorkerDelegationPlan();
          response.writeHead(201, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({ schema: 1, status: "ok", worker_delegation_approval: record }),
          );
        } catch {
          response.writeHead(409, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({
              schema: 1,
              status: "error",
              code: "worker_delegation_plan_required",
            }),
          );
        }
        return;
      }
      response.writeHead(405, {
        allow: "GET, POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_WORKER_LAUNCH_PREFLIGHTS_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(options.planPreviewStore.workerLaunchPreflights()));
        return;
      }
      if (request.method === "POST") {
        try {
          const record = options.planPreviewStore.preflightApprovedWorkerLaunch();
          response.writeHead(201, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({ schema: 1, status: "ok", worker_launch_preflight: record }),
          );
        } catch {
          response.writeHead(409, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({
              schema: 1,
              status: "error",
              code: "worker_delegation_approval_required",
            }),
          );
        }
        return;
      }
      response.writeHead(405, {
        allow: "GET, POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_PROVIDER_RUNTIME_PROBES_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(options.planPreviewStore.providerRuntimeProbes()));
        return;
      }
      if (request.method === "POST") {
        try {
          const record = options.planPreviewStore.probeProviderRuntime();
          response.writeHead(201, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({ schema: 1, status: "ok", provider_runtime_probe: record }));
        } catch {
          response.writeHead(409, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({
              schema: 1,
              status: "error",
              code: "worker_launch_preflight_required",
            }),
          );
        }
        return;
      }
      response.writeHead(405, {
        allow: "GET, POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_PROVIDER_ADAPTERS_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(options.planPreviewStore.providerAdapters()));
        return;
      }
      if (request.method === "POST") {
        try {
          const record = options.planPreviewStore.configureProviderAdapter(
            (await readJsonBody(request)) as ControlPlaneProviderAdapterInput,
          );
          response.writeHead(201, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({ schema: 1, status: "ok", provider_adapter: record }));
        } catch {
          response.writeHead(400, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({
              schema: 1,
              status: "error",
              code: "invalid_provider_adapter",
            }),
          );
        }
        return;
      }
      response.writeHead(405, {
        allow: "GET, POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_PROVIDER_CAPABILITY_INVENTORIES_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(options.planPreviewStore.providerCapabilityInventories()));
        return;
      }
      if (request.method === "POST") {
        try {
          const record = await options.planPreviewStore.inventoryProviderCapabilities();
          response.writeHead(201, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({ schema: 1, status: "ok", provider_capability_inventory: record }),
          );
        } catch {
          response.writeHead(409, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({
              schema: 1,
              status: "error",
              code: "provider_adapter_required",
            }),
          );
        }
        return;
      }
      response.writeHead(405, {
        allow: "GET, POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_WORKER_LAUNCH_CANDIDATES_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(options.planPreviewStore.workerLaunchCandidates()));
        return;
      }
      if (request.method === "POST") {
        try {
          const record = options.planPreviewStore.createWorkerLaunchCandidate();
          response.writeHead(201, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({ schema: 1, status: "ok", worker_launch_candidate: record }),
          );
        } catch {
          response.writeHead(409, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({
              schema: 1,
              status: "error",
              code: "worker_launch_candidate_not_ready",
            }),
          );
        }
        return;
      }
      response.writeHead(405, {
        allow: "GET, POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_WORKER_LAUNCH_RECEIPTS_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(options.planPreviewStore.workerLaunchReceipts()));
        return;
      }
      if (request.method === "POST") {
        try {
          const record = options.planPreviewStore.createWorkerLaunchReceipt();
          response.writeHead(201, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({ schema: 1, status: "ok", worker_launch_receipt: record }));
        } catch {
          response.writeHead(409, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({
              schema: 1,
              status: "error",
              code: "worker_launch_candidate_required",
            }),
          );
        }
        return;
      }
      response.writeHead(405, {
        allow: "GET, POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_PLAN_PREVIEWS_PATH
    ) {
      if (!options.planPreviewStore) {
        response.writeHead(503, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "store_unconfigured" }));
        return;
      }
      if (request.method === "GET") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify(options.planPreviewStore.status()));
        return;
      }
      if (request.method === "POST") {
        try {
          const body = await readJsonBody(request);
          const record = options.planPreviewStore.create(body as ControlPlanePlanPreviewInput);
          response.writeHead(201, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({ schema: 1, status: "ok", preview: record }));
        } catch {
          response.writeHead(400, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({ schema: 1, status: "error", code: "invalid_plan_preview" }),
          );
        }
        return;
      }
      response.writeHead(405, {
        allow: "GET, POST",
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
      return;
    }

    if (request.url && new URL(request.url, "http://127.0.0.1").pathname === API_TEAM_STATUS_PATH) {
      if (request.method !== "GET") {
        response.writeHead(405, {
          allow: "GET",
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
        return;
      }
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(createTeamStatus(options.teamStore)));
      return;
    }

    if (
      request.url &&
      new URL(request.url, "http://127.0.0.1").pathname === API_TOPOLOGY_STATUS_PATH
    ) {
      if (request.method !== "GET") {
        response.writeHead(405, {
          allow: "GET",
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ schema: 1, status: "error", code: "method_not_allowed" }));
        return;
      }
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(createTopologyStatus()));
      return;
    }

    const file = requestedFile(request.url);
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found\n");
      return;
    }
    try {
      const body = await readFile(join(staticRoot, file));
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": CONTENT_TYPES.get(file) ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end("control plane preview asset unavailable\n");
    }
  });
}

export async function startControlPlane(options: ControlPlaneOptions): Promise<Server> {
  const workspace =
    options.workspace ?? process.env.YUKH_CONVERSATION_WORKSPACE ?? process.env.YUKH_TEAM_WORKSPACE;
  const teamStore = workspace ? new TeamStore(workspace) : undefined;
  const providerRunner =
    workspace && teamStore ? createConfiguredProviderRunner(workspace, teamStore) : undefined;
  const workerActivityBus = await createConfiguredWorkerActivityBus();
  const server = createControlPlaneServer(options.staticRoot, {
    ...(teamStore ? { teamStore } : {}),
    ...(workspace && teamStore
      ? {
          planPreviewStore: new ControlPlanePlanPreviewStore(workspace, {
            discoverProviderModels: discoverConfiguredProviderModels,
            ...(providerRunner ? { providerRunner } : {}),
            workerActivityAdapter: createConfiguredWorkerActivityAdapter(teamStore),
            ...(workerActivityBus ? { workerActivityBus } : {}),
          }),
        }
      : {}),
  });
  server.on("close", () => {
    void workerActivityBus?.close();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArguments(argv);
  const server = await startControlPlane(options);
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;
  process.stdout.write(
    `Yukh Control Plane preview: http://${options.host}:${port}\n` +
      "Bounded preview controls only: no provider calls or worker launches are exposed.\n",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
