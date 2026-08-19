import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export type ControlPlanePlanPreviewState = "proposed" | "approved-preview";

export type ControlPlanePlanPreviewRecord = {
  readonly schema: 1;
  readonly preview_id: string;
  readonly receipt_id?: string;
  readonly state: ControlPlanePlanPreviewState;
  readonly goal_digest: `sha-256:${string}`;
  readonly mode: string;
  readonly provider: string;
  readonly token_budget: number;
  readonly manager_reserve: number;
  readonly worker_reserve: number;
  readonly safety_reserve: number;
  readonly proposed_workers: readonly {
    readonly role: string;
    readonly token_budget: number;
  }[];
  readonly created_at: string;
  readonly approved_at?: string;
};

export type ControlPlanePlanPreviewStoreStatus = {
  readonly schema: "yukh-control-plane-plan-previews-v1";
  readonly source: "local-control-plane-store";
  readonly previews: readonly ControlPlanePlanPreviewRecord[];
};

export type ControlPlaneLaunchReadinessStatus = {
  readonly schema: "yukh-control-plane-launch-readiness-v1";
  readonly source: "local-control-plane-store";
  readonly outcome: "ready" | "blocked";
  readonly preview?: ControlPlanePlanPreviewRecord;
  readonly reasons: readonly {
    readonly code:
      | "missing_plan_preview"
      | "plan_not_approved"
      | "missing_preview_receipt"
      | "invalid_budget"
      | "missing_workers";
    readonly message: string;
  }[];
};

export type ControlPlaneLaunchIntentRecord = {
  readonly schema: 1;
  readonly launch_intent_id: string;
  readonly preview_id: string;
  readonly preview_receipt_id: string;
  readonly readiness_outcome: "ready";
  readonly token_budget: number;
  readonly manager_reserve: number;
  readonly worker_reserve: number;
  readonly safety_reserve: number;
  readonly proposed_workers: readonly {
    readonly role: string;
    readonly token_budget: number;
  }[];
  readonly created_at: string;
};

export type ControlPlaneLaunchIntentStatus = {
  readonly schema: "yukh-control-plane-launch-intents-v1";
  readonly source: "local-control-plane-store";
  readonly intents: readonly ControlPlaneLaunchIntentRecord[];
};

export type ControlPlaneManagerRunRecord = {
  readonly schema: 1;
  readonly manager_run_id: string;
  readonly receipt_id: string;
  readonly state: "planned";
  readonly launch_intent_id: string;
  readonly preview_id: string;
  readonly provider: string;
  readonly manager_token_budget: number;
  readonly team_token_budget: number;
  readonly worker_count: number;
  readonly created_at: string;
  readonly next_required_action: "connect_manager_runtime";
};

export type ControlPlaneManagerRunStatus = {
  readonly schema: "yukh-control-plane-manager-runs-v1";
  readonly source: "local-control-plane-store";
  readonly runs: readonly ControlPlaneManagerRunRecord[];
};

export type ControlPlaneManagerRuntimeConnectionRecord = {
  readonly schema: 1;
  readonly runtime_connection_id: string;
  readonly receipt_id: string;
  readonly state: "connected";
  readonly manager_run_id: string;
  readonly launch_intent_id: string;
  readonly provider: string;
  readonly manager_token_budget: number;
  readonly command_policy: "not_started";
  readonly created_at: string;
  readonly next_required_action: "start_manager_process";
};

export type ControlPlaneManagerRuntimeConnectionStatus = {
  readonly schema: "yukh-control-plane-manager-runtime-connections-v1";
  readonly source: "local-control-plane-store";
  readonly connections: readonly ControlPlaneManagerRuntimeConnectionRecord[];
};

export type ControlPlaneManagerProcessRecord = {
  readonly schema: 1;
  readonly manager_process_id: string;
  readonly receipt_id: string;
  readonly state: "starting";
  readonly runtime_connection_id: string;
  readonly manager_run_id: string;
  readonly provider: string;
  readonly hard_token_cap: number;
  readonly provider_process: "pending_provider_runner";
  readonly worker_delegation: "disabled_until_manager_receipt";
  readonly created_at: string;
  readonly next_required_action: "record_manager_ready_receipt";
};

export type ControlPlaneManagerProcessStatus = {
  readonly schema: "yukh-control-plane-manager-processes-v1";
  readonly source: "local-control-plane-store";
  readonly processes: readonly ControlPlaneManagerProcessRecord[];
};

export type ControlPlaneManagerReadyReceiptRecord = {
  readonly schema: 1;
  readonly manager_ready_receipt_id: string;
  readonly manager_process_id: string;
  readonly manager_run_id: string;
  readonly provider: string;
  readonly hard_token_cap: number;
  readonly readiness: "ready_for_worker_delegation";
  readonly coordination_write: "not_performed";
  readonly projects_write: "not_performed";
  readonly created_at: string;
  readonly next_required_action: "prepare_worker_delegation_plan";
};

export type ControlPlaneManagerReadyReceiptStatus = {
  readonly schema: "yukh-control-plane-manager-ready-receipts-v1";
  readonly source: "local-control-plane-store";
  readonly receipts: readonly ControlPlaneManagerReadyReceiptRecord[];
};

export type ControlPlaneWorkerDelegationPlanRecord = {
  readonly schema: 1;
  readonly worker_delegation_plan_id: string;
  readonly manager_ready_receipt_id: string;
  readonly manager_process_id: string;
  readonly manager_run_id: string;
  readonly launch_intent_id: string;
  readonly provider: string;
  readonly total_worker_token_budget: number;
  readonly worker_launch: "not_performed";
  readonly coordination_write: "not_performed";
  readonly projects_write: "not_performed";
  readonly workers: readonly {
    readonly role: string;
    readonly provider: string;
    readonly model: string;
    readonly model_source: "deferred_to_provider_inventory";
    readonly token_budget: number;
    readonly input_digest: `sha-256:${string}`;
    readonly command_policy: "not_started";
    readonly status: "planned";
  }[];
  readonly created_at: string;
  readonly next_required_action: "approve_worker_delegation_plan";
};

export type ControlPlaneWorkerDelegationPlanStatus = {
  readonly schema: "yukh-control-plane-worker-delegation-plans-v1";
  readonly source: "local-control-plane-store";
  readonly plans: readonly ControlPlaneWorkerDelegationPlanRecord[];
};

export type ControlPlaneWorkerDelegationApprovalRecord = {
  readonly schema: 1;
  readonly worker_delegation_approval_id: string;
  readonly worker_delegation_plan_id: string;
  readonly manager_ready_receipt_id: string;
  readonly manager_process_id: string;
  readonly manager_run_id: string;
  readonly approved_worker_count: number;
  readonly approved_worker_token_budget: number;
  readonly approval_scope: "local_control_plane_only";
  readonly worker_launch: "not_performed";
  readonly coordination_write: "not_performed";
  readonly projects_write: "not_performed";
  readonly created_at: string;
  readonly next_required_action: "launch_approved_workers";
};

export type ControlPlaneWorkerDelegationApprovalStatus = {
  readonly schema: "yukh-control-plane-worker-delegation-approvals-v1";
  readonly source: "local-control-plane-store";
  readonly approvals: readonly ControlPlaneWorkerDelegationApprovalRecord[];
};

export type ControlPlanePlanPreviewInput = {
  readonly goal: string;
  readonly mode: string;
  readonly provider: string;
  readonly token_budget: number;
  readonly state?: ControlPlanePlanPreviewState;
};

type Document = {
  readonly schema: 1;
  readonly previews: readonly ControlPlanePlanPreviewRecord[];
  readonly launch_intents?: readonly ControlPlaneLaunchIntentRecord[];
  readonly manager_runs?: readonly ControlPlaneManagerRunRecord[];
  readonly manager_runtime_connections?: readonly ControlPlaneManagerRuntimeConnectionRecord[];
  readonly manager_processes?: readonly ControlPlaneManagerProcessRecord[];
  readonly manager_ready_receipts?: readonly ControlPlaneManagerReadyReceiptRecord[];
  readonly worker_delegation_plans?: readonly ControlPlaneWorkerDelegationPlanRecord[];
  readonly worker_delegation_approvals?: readonly ControlPlaneWorkerDelegationApprovalRecord[];
};

const validMode = new Set(["plan-first", "delegate, explicit workers"]);
const validProvider = new Set(["Copilot SDK workers", "Codex manager CLI", "Codex SDK, planned"]);

function digest(value: string): `sha-256:${string}` {
  return `sha-256:${createHash("sha256").update(value).digest("hex")}`;
}

function workersForGoal(
  goal: string,
  workerReserve: number,
): ControlPlanePlanPreviewRecord["proposed_workers"] {
  const normalized = goal.toLowerCase();
  const roles = [
    normalized.includes("ui") || normalized.includes("control plane")
      ? "frontend-control-plane-worker"
      : "implementation-worker",
    normalized.includes("test") || normalized.includes("verify")
      ? "qa-verification-worker"
      : "runtime-verification-worker",
  ];
  const unique = [...new Set(roles)];
  const perWorker = unique.length > 0 ? Math.floor(workerReserve / unique.length) : 0;
  return unique.map((role) => ({ role, token_budget: perWorker }));
}

function modelForProvider(provider: string): string {
  if (provider === "Copilot SDK workers") return "copilot-sdk-default";
  if (provider === "Codex SDK, planned") return "codex-sdk-default";
  return "codex-cli-default";
}

function validateInput(input: ControlPlanePlanPreviewInput): void {
  if (
    input.goal.trim() !== input.goal ||
    input.goal.length < 1 ||
    input.goal.length > 4_096 ||
    !validMode.has(input.mode) ||
    !validProvider.has(input.provider) ||
    !Number.isSafeInteger(input.token_budget) ||
    input.token_budget < 1_000 ||
    input.token_budget > 10_000_000 ||
    (input.state !== undefined && !["proposed", "approved-preview"].includes(input.state))
  ) {
    throw new TypeError("invalid plan preview input");
  }
}

export class ControlPlanePlanPreviewStore {
  readonly #path: string;

  constructor(workspace: string) {
    if (!isAbsolute(workspace)) throw new TypeError("invalid control plane workspace");
    const root = join(workspace, ".yukh", "control-plane");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.#path = join(root, "plan-previews.json");
  }

  status(): ControlPlanePlanPreviewStoreStatus {
    return {
      schema: "yukh-control-plane-plan-previews-v1",
      source: "local-control-plane-store",
      previews: this.#read().previews,
    };
  }

  launchReadiness(): ControlPlaneLaunchReadinessStatus {
    const preview = this.#read().previews[0];
    if (!preview) {
      return {
        schema: "yukh-control-plane-launch-readiness-v1",
        source: "local-control-plane-store",
        outcome: "blocked",
        reasons: [
          {
            code: "missing_plan_preview",
            message: "Create and approve a manager plan preview before launch readiness can pass.",
          },
        ],
      };
    }
    const reasons: ControlPlaneLaunchReadinessStatus["reasons"] = [
      ...(preview.state !== "approved-preview"
        ? [
            {
              code: "plan_not_approved" as const,
              message: "The latest manager plan preview has not been approved.",
            },
          ]
        : []),
      ...(!preview.receipt_id
        ? [
            {
              code: "missing_preview_receipt" as const,
              message: "The latest manager plan preview has no local approval receipt.",
            },
          ]
        : []),
      ...(preview.token_budget < 1_000 ||
      preview.manager_reserve < 1 ||
      preview.worker_reserve < 1 ||
      preview.safety_reserve < 0
        ? [
            {
              code: "invalid_budget" as const,
              message: "The token budget split is invalid.",
            },
          ]
        : []),
      ...(preview.proposed_workers.length < 1 ||
      preview.proposed_workers.some((worker) => worker.token_budget < 1)
        ? [
            {
              code: "missing_workers" as const,
              message: "The manager plan preview has no budgeted workers.",
            },
          ]
        : []),
    ];
    return {
      schema: "yukh-control-plane-launch-readiness-v1",
      source: "local-control-plane-store",
      outcome: reasons.length === 0 ? "ready" : "blocked",
      preview,
      reasons,
    };
  }

  launchIntents(): ControlPlaneLaunchIntentStatus {
    return {
      schema: "yukh-control-plane-launch-intents-v1",
      source: "local-control-plane-store",
      intents: this.#read().launch_intents ?? [],
    };
  }

  managerRuns(): ControlPlaneManagerRunStatus {
    return {
      schema: "yukh-control-plane-manager-runs-v1",
      source: "local-control-plane-store",
      runs: this.#read().manager_runs ?? [],
    };
  }

  managerRuntimeConnections(): ControlPlaneManagerRuntimeConnectionStatus {
    return {
      schema: "yukh-control-plane-manager-runtime-connections-v1",
      source: "local-control-plane-store",
      connections: this.#read().manager_runtime_connections ?? [],
    };
  }

  managerProcesses(): ControlPlaneManagerProcessStatus {
    return {
      schema: "yukh-control-plane-manager-processes-v1",
      source: "local-control-plane-store",
      processes: this.#read().manager_processes ?? [],
    };
  }

  managerReadyReceipts(): ControlPlaneManagerReadyReceiptStatus {
    return {
      schema: "yukh-control-plane-manager-ready-receipts-v1",
      source: "local-control-plane-store",
      receipts: this.#read().manager_ready_receipts ?? [],
    };
  }

  workerDelegationPlans(): ControlPlaneWorkerDelegationPlanStatus {
    return {
      schema: "yukh-control-plane-worker-delegation-plans-v1",
      source: "local-control-plane-store",
      plans: this.#read().worker_delegation_plans ?? [],
    };
  }

  workerDelegationApprovals(): ControlPlaneWorkerDelegationApprovalStatus {
    return {
      schema: "yukh-control-plane-worker-delegation-approvals-v1",
      source: "local-control-plane-store",
      approvals: this.#read().worker_delegation_approvals ?? [],
    };
  }

  approveWorkerDelegationPlan(): ControlPlaneWorkerDelegationApprovalRecord {
    const document = this.#read();
    const plan = document.worker_delegation_plans?.[0];
    if (!plan) {
      throw new TypeError("missing worker delegation plan");
    }
    const existing = document.worker_delegation_approvals?.find(
      (approval) => approval.worker_delegation_plan_id === plan.worker_delegation_plan_id,
    );
    if (existing) return existing;
    const record: ControlPlaneWorkerDelegationApprovalRecord = {
      schema: 1,
      worker_delegation_approval_id: `worker-delegation-approval-${randomUUID()}`,
      worker_delegation_plan_id: plan.worker_delegation_plan_id,
      manager_ready_receipt_id: plan.manager_ready_receipt_id,
      manager_process_id: plan.manager_process_id,
      manager_run_id: plan.manager_run_id,
      approved_worker_count: plan.workers.length,
      approved_worker_token_budget: plan.total_worker_token_budget,
      approval_scope: "local_control_plane_only",
      worker_launch: "not_performed",
      coordination_write: "not_performed",
      projects_write: "not_performed",
      created_at: new Date().toISOString(),
      next_required_action: "launch_approved_workers",
    };
    this.#write({
      schema: 1,
      previews: document.previews,
      launch_intents: document.launch_intents ?? [],
      manager_runs: document.manager_runs ?? [],
      manager_runtime_connections: document.manager_runtime_connections ?? [],
      manager_processes: document.manager_processes ?? [],
      manager_ready_receipts: document.manager_ready_receipts ?? [],
      worker_delegation_plans: document.worker_delegation_plans ?? [],
      worker_delegation_approvals: [record, ...(document.worker_delegation_approvals ?? [])].slice(
        0,
        20,
      ),
    });
    return record;
  }

  prepareWorkerDelegationPlan(): ControlPlaneWorkerDelegationPlanRecord {
    const document = this.#read();
    const readyReceipt = document.manager_ready_receipts?.[0];
    if (!readyReceipt) {
      throw new TypeError("missing manager ready receipt");
    }
    const existing = document.worker_delegation_plans?.find(
      (plan) => plan.manager_ready_receipt_id === readyReceipt.manager_ready_receipt_id,
    );
    if (existing) return existing;
    const managerRun = document.manager_runs?.find(
      (run) => run.manager_run_id === readyReceipt.manager_run_id,
    );
    const launchIntent = document.launch_intents?.find(
      (intent) => intent.launch_intent_id === managerRun?.launch_intent_id,
    );
    if (!managerRun || !launchIntent) {
      throw new TypeError("missing launch intent");
    }
    const workers = launchIntent.proposed_workers.map((worker) => ({
      role: worker.role,
      provider: readyReceipt.provider,
      model: modelForProvider(readyReceipt.provider),
      model_source: "deferred_to_provider_inventory" as const,
      token_budget: worker.token_budget,
      input_digest: digest(
        `${launchIntent.preview_receipt_id}:${readyReceipt.manager_ready_receipt_id}:${worker.role}`,
      ),
      command_policy: "not_started" as const,
      status: "planned" as const,
    }));
    const record: ControlPlaneWorkerDelegationPlanRecord = {
      schema: 1,
      worker_delegation_plan_id: `worker-delegation-plan-${randomUUID()}`,
      manager_ready_receipt_id: readyReceipt.manager_ready_receipt_id,
      manager_process_id: readyReceipt.manager_process_id,
      manager_run_id: readyReceipt.manager_run_id,
      launch_intent_id: launchIntent.launch_intent_id,
      provider: readyReceipt.provider,
      total_worker_token_budget: workers.reduce((total, worker) => total + worker.token_budget, 0),
      worker_launch: "not_performed",
      coordination_write: "not_performed",
      projects_write: "not_performed",
      workers,
      created_at: new Date().toISOString(),
      next_required_action: "approve_worker_delegation_plan",
    };
    this.#write({
      schema: 1,
      previews: document.previews,
      launch_intents: document.launch_intents ?? [],
      manager_runs: document.manager_runs ?? [],
      manager_runtime_connections: document.manager_runtime_connections ?? [],
      manager_processes: document.manager_processes ?? [],
      manager_ready_receipts: document.manager_ready_receipts ?? [],
      worker_delegation_plans: [record, ...(document.worker_delegation_plans ?? [])].slice(0, 20),
      worker_delegation_approvals: document.worker_delegation_approvals ?? [],
    });
    return record;
  }

  recordManagerReadyReceipt(): ControlPlaneManagerReadyReceiptRecord {
    const document = this.#read();
    const process = document.manager_processes?.[0];
    if (!process) {
      throw new TypeError("missing manager process");
    }
    const existing = document.manager_ready_receipts?.find(
      (receipt) => receipt.manager_process_id === process.manager_process_id,
    );
    if (existing) return existing;
    const record: ControlPlaneManagerReadyReceiptRecord = {
      schema: 1,
      manager_ready_receipt_id: `manager-ready-receipt-${randomUUID()}`,
      manager_process_id: process.manager_process_id,
      manager_run_id: process.manager_run_id,
      provider: process.provider,
      hard_token_cap: process.hard_token_cap,
      readiness: "ready_for_worker_delegation",
      coordination_write: "not_performed",
      projects_write: "not_performed",
      created_at: new Date().toISOString(),
      next_required_action: "prepare_worker_delegation_plan",
    };
    this.#write({
      schema: 1,
      previews: document.previews,
      launch_intents: document.launch_intents ?? [],
      manager_runs: document.manager_runs ?? [],
      manager_runtime_connections: document.manager_runtime_connections ?? [],
      manager_processes: document.manager_processes ?? [],
      manager_ready_receipts: [record, ...(document.manager_ready_receipts ?? [])].slice(0, 20),
      worker_delegation_plans: document.worker_delegation_plans ?? [],
      worker_delegation_approvals: document.worker_delegation_approvals ?? [],
    });
    return record;
  }

  startManagerProcess(): ControlPlaneManagerProcessRecord {
    const document = this.#read();
    const connection = document.manager_runtime_connections?.[0];
    if (!connection) {
      throw new TypeError("missing manager runtime connection");
    }
    const existing = document.manager_processes?.find(
      (process) => process.runtime_connection_id === connection.runtime_connection_id,
    );
    if (existing) return existing;
    const record: ControlPlaneManagerProcessRecord = {
      schema: 1,
      manager_process_id: `manager-process-${randomUUID()}`,
      receipt_id: `manager-process-receipt-${randomUUID()}`,
      state: "starting",
      runtime_connection_id: connection.runtime_connection_id,
      manager_run_id: connection.manager_run_id,
      provider: connection.provider,
      hard_token_cap: connection.manager_token_budget,
      provider_process: "pending_provider_runner",
      worker_delegation: "disabled_until_manager_receipt",
      created_at: new Date().toISOString(),
      next_required_action: "record_manager_ready_receipt",
    };
    this.#write({
      schema: 1,
      previews: document.previews,
      launch_intents: document.launch_intents ?? [],
      manager_runs: document.manager_runs ?? [],
      manager_runtime_connections: document.manager_runtime_connections ?? [],
      manager_processes: [record, ...(document.manager_processes ?? [])].slice(0, 20),
      manager_ready_receipts: document.manager_ready_receipts ?? [],
      worker_delegation_plans: document.worker_delegation_plans ?? [],
      worker_delegation_approvals: document.worker_delegation_approvals ?? [],
    });
    return record;
  }

  connectManagerRuntime(): ControlPlaneManagerRuntimeConnectionRecord {
    const document = this.#read();
    const managerRun = document.manager_runs?.[0];
    if (!managerRun) {
      throw new TypeError("missing manager run");
    }
    const existing = document.manager_runtime_connections?.find(
      (connection) => connection.manager_run_id === managerRun.manager_run_id,
    );
    if (existing) return existing;
    const record: ControlPlaneManagerRuntimeConnectionRecord = {
      schema: 1,
      runtime_connection_id: `manager-runtime-${randomUUID()}`,
      receipt_id: `manager-runtime-receipt-${randomUUID()}`,
      state: "connected",
      manager_run_id: managerRun.manager_run_id,
      launch_intent_id: managerRun.launch_intent_id,
      provider: managerRun.provider,
      manager_token_budget: managerRun.manager_token_budget,
      command_policy: "not_started",
      created_at: new Date().toISOString(),
      next_required_action: "start_manager_process",
    };
    this.#write({
      schema: 1,
      previews: document.previews,
      launch_intents: document.launch_intents ?? [],
      manager_runs: document.manager_runs ?? [],
      manager_runtime_connections: [record, ...(document.manager_runtime_connections ?? [])].slice(
        0,
        20,
      ),
      manager_processes: document.manager_processes ?? [],
      manager_ready_receipts: document.manager_ready_receipts ?? [],
      worker_delegation_plans: document.worker_delegation_plans ?? [],
      worker_delegation_approvals: document.worker_delegation_approvals ?? [],
    });
    return record;
  }

  createManagerRun(): ControlPlaneManagerRunRecord {
    const document = this.#read();
    const launchIntent = document.launch_intents?.[0];
    if (!launchIntent) {
      throw new TypeError("missing launch intent");
    }
    const existing = document.manager_runs?.find(
      (run) => run.launch_intent_id === launchIntent.launch_intent_id,
    );
    if (existing) return existing;
    const preview = document.previews.find((item) => item.preview_id === launchIntent.preview_id);
    if (!preview) {
      throw new TypeError("missing launch preview");
    }
    const record: ControlPlaneManagerRunRecord = {
      schema: 1,
      manager_run_id: `manager-run-${randomUUID()}`,
      receipt_id: `manager-run-receipt-${randomUUID()}`,
      state: "planned",
      launch_intent_id: launchIntent.launch_intent_id,
      preview_id: launchIntent.preview_id,
      provider: preview.provider,
      manager_token_budget: launchIntent.manager_reserve,
      team_token_budget: launchIntent.token_budget,
      worker_count: launchIntent.proposed_workers.length,
      created_at: new Date().toISOString(),
      next_required_action: "connect_manager_runtime",
    };
    this.#write({
      schema: 1,
      previews: document.previews,
      launch_intents: document.launch_intents ?? [],
      manager_runs: [record, ...(document.manager_runs ?? [])].slice(0, 20),
      manager_runtime_connections: document.manager_runtime_connections ?? [],
      manager_processes: document.manager_processes ?? [],
      manager_ready_receipts: document.manager_ready_receipts ?? [],
      worker_delegation_plans: document.worker_delegation_plans ?? [],
      worker_delegation_approvals: document.worker_delegation_approvals ?? [],
    });
    return record;
  }

  createLaunchIntent(): ControlPlaneLaunchIntentRecord {
    const readiness = this.launchReadiness();
    if (readiness.outcome !== "ready" || !readiness.preview?.receipt_id) {
      throw new TypeError("launch readiness blocked");
    }
    const preview = readiness.preview;
    const previewReceiptId = preview.receipt_id;
    if (!previewReceiptId) {
      throw new TypeError("launch readiness blocked");
    }
    const record: ControlPlaneLaunchIntentRecord = {
      schema: 1,
      launch_intent_id: `launch-intent-${randomUUID()}`,
      preview_id: preview.preview_id,
      preview_receipt_id: previewReceiptId,
      readiness_outcome: "ready",
      token_budget: preview.token_budget,
      manager_reserve: preview.manager_reserve,
      worker_reserve: preview.worker_reserve,
      safety_reserve: preview.safety_reserve,
      proposed_workers: preview.proposed_workers,
      created_at: new Date().toISOString(),
    };
    const document = this.#read();
    this.#write({
      schema: 1,
      previews: document.previews,
      launch_intents: [record, ...(document.launch_intents ?? [])].slice(0, 20),
      manager_runs: document.manager_runs ?? [],
      manager_runtime_connections: document.manager_runtime_connections ?? [],
      manager_processes: document.manager_processes ?? [],
      manager_ready_receipts: document.manager_ready_receipts ?? [],
      worker_delegation_plans: document.worker_delegation_plans ?? [],
      worker_delegation_approvals: document.worker_delegation_approvals ?? [],
    });
    return record;
  }

  create(input: ControlPlanePlanPreviewInput): ControlPlanePlanPreviewRecord {
    validateInput(input);
    const managerReserve = Math.floor(input.token_budget * 0.25);
    const workerReserve = Math.floor(input.token_budget * 0.55);
    const safetyReserve = Math.max(0, input.token_budget - managerReserve - workerReserve);
    const now = new Date().toISOString();
    const state = input.state ?? "proposed";
    const record: ControlPlanePlanPreviewRecord = {
      schema: 1,
      preview_id: `preview-${randomUUID()}`,
      ...(state === "approved-preview" ? { receipt_id: `preview-receipt-${randomUUID()}` } : {}),
      state,
      goal_digest: digest(input.goal),
      mode: input.mode,
      provider: input.provider,
      token_budget: input.token_budget,
      manager_reserve: managerReserve,
      worker_reserve: workerReserve,
      safety_reserve: safetyReserve,
      proposed_workers: workersForGoal(input.goal, workerReserve),
      created_at: now,
      ...(state === "approved-preview" ? { approved_at: now } : {}),
    };
    const document = this.#read();
    this.#write({
      schema: 1,
      previews: [record, ...document.previews].slice(0, 20),
      launch_intents: document.launch_intents ?? [],
      manager_runs: document.manager_runs ?? [],
      manager_runtime_connections: document.manager_runtime_connections ?? [],
      manager_processes: document.manager_processes ?? [],
      manager_ready_receipts: document.manager_ready_receipts ?? [],
      worker_delegation_plans: document.worker_delegation_plans ?? [],
      worker_delegation_approvals: document.worker_delegation_approvals ?? [],
    });
    return record;
  }

  #read(): Document {
    try {
      const parsed = JSON.parse(readFileSync(this.#path, "utf8")) as Partial<Document>;
      if (parsed.schema !== 1 || !Array.isArray(parsed.previews)) {
        return { schema: 1, previews: [] };
      }
      return {
        schema: 1,
        previews: parsed.previews.filter((item) => item?.schema === 1),
        launch_intents: Array.isArray(parsed.launch_intents)
          ? parsed.launch_intents.filter((item) => item?.schema === 1)
          : [],
        manager_runs: Array.isArray(parsed.manager_runs)
          ? parsed.manager_runs.filter((item) => item?.schema === 1)
          : [],
        manager_runtime_connections: Array.isArray(parsed.manager_runtime_connections)
          ? parsed.manager_runtime_connections.filter((item) => item?.schema === 1)
          : [],
        manager_processes: Array.isArray(parsed.manager_processes)
          ? parsed.manager_processes.filter((item) => item?.schema === 1)
          : [],
        manager_ready_receipts: Array.isArray(parsed.manager_ready_receipts)
          ? parsed.manager_ready_receipts.filter((item) => item?.schema === 1)
          : [],
        worker_delegation_plans: Array.isArray(parsed.worker_delegation_plans)
          ? parsed.worker_delegation_plans.filter((item) => item?.schema === 1)
          : [],
        worker_delegation_approvals: Array.isArray(parsed.worker_delegation_approvals)
          ? parsed.worker_delegation_approvals.filter((item) => item?.schema === 1)
          : [],
      };
    } catch {
      return {
        schema: 1,
        previews: [],
        launch_intents: [],
        manager_runs: [],
        manager_runtime_connections: [],
        manager_processes: [],
        manager_ready_receipts: [],
        worker_delegation_plans: [],
        worker_delegation_approvals: [],
      };
    }
  }

  #write(document: Document): void {
    const tmp = `${this.#path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.#path);
  }
}
