import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

export type ControlPlaneWorkerLaunchPreflightRecord = {
  readonly schema: 1;
  readonly worker_launch_preflight_id: string;
  readonly worker_delegation_approval_id: string;
  readonly worker_delegation_plan_id: string;
  readonly manager_ready_receipt_id: string;
  readonly manager_process_id: string;
  readonly manager_run_id: string;
  readonly approved_worker_count: number;
  readonly approved_worker_token_budget: number;
  readonly outcome: "blocked_until_provider_runtime_probe";
  readonly provider_runtime_check: "requires_provider_runtime_probe";
  readonly policy_check: "local_approval_present";
  readonly budget_check: "within_approved_worker_budget";
  readonly capability_check: "requires_provider_capability_inventory";
  readonly worker_launch: "not_performed";
  readonly coordination_write: "not_performed";
  readonly projects_write: "not_performed";
  readonly created_at: string;
  readonly next_required_action: "probe_provider_runtime";
};

export type ControlPlaneWorkerLaunchPreflightStatus = {
  readonly schema: "yukh-control-plane-worker-launch-preflights-v1";
  readonly source: "local-control-plane-store";
  readonly preflights: readonly ControlPlaneWorkerLaunchPreflightRecord[];
};

export type ControlPlaneProviderRuntimeProbeRecord = {
  readonly schema: 1;
  readonly provider_runtime_probe_id: string;
  readonly worker_launch_preflight_id: string;
  readonly worker_delegation_approval_id: string;
  readonly worker_delegation_plan_id: string;
  readonly manager_process_id: string;
  readonly manager_run_id: string;
  readonly provider: string;
  readonly probe_scope: "local_control_plane_configuration";
  readonly provider_adapter: "configured" | "not_configured";
  readonly executable_check:
    "executable_found" | "executable_missing" | "not_performed" | "not_required";
  readonly capability_inventory: "local_inventory_available" | "not_requested";
  readonly outcome:
    | "ready_for_worker_launch"
    | "blocked_provider_adapter_not_configured"
    | "blocked_provider_executable_missing";
  readonly worker_launch: "not_performed";
  readonly coordination_write: "not_performed";
  readonly projects_write: "not_performed";
  readonly created_at: string;
  readonly next_required_action:
    "launch_workers" | "configure_provider_adapter" | "fix_provider_executable";
};

export type ControlPlaneProviderRuntimeProbeStatus = {
  readonly schema: "yukh-control-plane-provider-runtime-probes-v1";
  readonly source: "local-control-plane-store";
  readonly probes: readonly ControlPlaneProviderRuntimeProbeRecord[];
};

export type ControlPlaneProviderAdapterRecord = {
  readonly schema: 1;
  readonly provider_adapter_id: string;
  readonly provider: string;
  readonly adapter_kind: "cli" | "sdk";
  readonly executable_path?: string;
  readonly models: readonly string[];
  readonly max_run_token_budget: number;
  readonly command_policy: "bounded_control_plane_only";
  readonly configured_at: string;
};

export type ControlPlaneProviderAdapterStatus = {
  readonly schema: "yukh-control-plane-provider-adapters-v1";
  readonly source: "local-control-plane-store";
  readonly adapters: readonly ControlPlaneProviderAdapterRecord[];
};

export type ControlPlaneProviderAdapterInput = {
  readonly provider: string;
  readonly adapter_kind: "cli" | "sdk";
  readonly executable_path?: string;
  readonly models: readonly string[];
  readonly max_run_token_budget: number;
};

export type ControlPlaneProviderCapabilityInventoryRecord = {
  readonly schema: 1;
  readonly provider_capability_inventory_id: string;
  readonly provider_adapter_id: string;
  readonly provider: string;
  readonly adapter_kind: "cli" | "sdk";
  readonly models: readonly {
    readonly model: string;
    readonly source: "configured_adapter";
    readonly max_run_token_budget: number;
  }[];
  readonly command_policy: "bounded_control_plane_only";
  readonly inventory_source: "local_provider_adapter_config";
  readonly provider_call: "not_performed";
  readonly created_at: string;
};

export type ControlPlaneProviderCapabilityInventoryStatus = {
  readonly schema: "yukh-control-plane-provider-capability-inventories-v1";
  readonly source: "local-control-plane-store";
  readonly inventories: readonly ControlPlaneProviderCapabilityInventoryRecord[];
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
  readonly worker_launch_preflights?: readonly ControlPlaneWorkerLaunchPreflightRecord[];
  readonly provider_runtime_probes?: readonly ControlPlaneProviderRuntimeProbeRecord[];
  readonly provider_adapters?: readonly ControlPlaneProviderAdapterRecord[];
  readonly provider_capability_inventories?: readonly ControlPlaneProviderCapabilityInventoryRecord[];
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

function validateProviderAdapterInput(input: ControlPlaneProviderAdapterInput): void {
  if (
    !validProvider.has(input.provider) ||
    !["cli", "sdk"].includes(input.adapter_kind) ||
    (input.adapter_kind === "cli" &&
      (!input.executable_path || !isAbsolute(input.executable_path))) ||
    (input.executable_path !== undefined &&
      (input.executable_path.length < 1 ||
        input.executable_path.length > 4_096 ||
        !isAbsolute(input.executable_path))) ||
    !Array.isArray(input.models) ||
    input.models.length < 1 ||
    input.models.length > 20 ||
    input.models.some(
      (model) =>
        typeof model !== "string" ||
        model.trim() !== model ||
        model.length < 1 ||
        model.length > 128,
    ) ||
    !Number.isSafeInteger(input.max_run_token_budget) ||
    input.max_run_token_budget < 1_000 ||
    input.max_run_token_budget > 10_000_000
  ) {
    throw new TypeError("invalid provider adapter input");
  }
}

function executableCheck(
  adapter: ControlPlaneProviderAdapterRecord,
): ControlPlaneProviderRuntimeProbeRecord["executable_check"] {
  if (adapter.adapter_kind === "sdk") return "not_required";
  if (!adapter.executable_path) return "executable_missing";
  try {
    accessSync(adapter.executable_path, constants.X_OK);
    return "executable_found";
  } catch {
    return "executable_missing";
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

  workerLaunchPreflights(): ControlPlaneWorkerLaunchPreflightStatus {
    return {
      schema: "yukh-control-plane-worker-launch-preflights-v1",
      source: "local-control-plane-store",
      preflights: this.#read().worker_launch_preflights ?? [],
    };
  }

  providerRuntimeProbes(): ControlPlaneProviderRuntimeProbeStatus {
    return {
      schema: "yukh-control-plane-provider-runtime-probes-v1",
      source: "local-control-plane-store",
      probes: this.#read().provider_runtime_probes ?? [],
    };
  }

  providerAdapters(): ControlPlaneProviderAdapterStatus {
    return {
      schema: "yukh-control-plane-provider-adapters-v1",
      source: "local-control-plane-store",
      adapters: this.#read().provider_adapters ?? [],
    };
  }

  providerCapabilityInventories(): ControlPlaneProviderCapabilityInventoryStatus {
    return {
      schema: "yukh-control-plane-provider-capability-inventories-v1",
      source: "local-control-plane-store",
      inventories: this.#read().provider_capability_inventories ?? [],
    };
  }

  inventoryProviderCapabilities(): ControlPlaneProviderCapabilityInventoryRecord {
    const document = this.#read();
    const adapter = document.provider_adapters?.[0];
    if (!adapter) {
      throw new TypeError("missing provider adapter");
    }
    const existing = document.provider_capability_inventories?.find(
      (inventory) => inventory.provider_adapter_id === adapter.provider_adapter_id,
    );
    if (existing) return existing;
    const record: ControlPlaneProviderCapabilityInventoryRecord = {
      schema: 1,
      provider_capability_inventory_id: `provider-capability-inventory-${randomUUID()}`,
      provider_adapter_id: adapter.provider_adapter_id,
      provider: adapter.provider,
      adapter_kind: adapter.adapter_kind,
      models: adapter.models.map((model) => ({
        model,
        source: "configured_adapter",
        max_run_token_budget: adapter.max_run_token_budget,
      })),
      command_policy: "bounded_control_plane_only",
      inventory_source: "local_provider_adapter_config",
      provider_call: "not_performed",
      created_at: new Date().toISOString(),
    };
    this.#write({
      ...document,
      provider_capability_inventories: [
        record,
        ...(document.provider_capability_inventories ?? []),
      ].slice(0, 20),
    });
    return record;
  }

  configureProviderAdapter(
    input: ControlPlaneProviderAdapterInput,
  ): ControlPlaneProviderAdapterRecord {
    validateProviderAdapterInput(input);
    const document = this.#read();
    const record: ControlPlaneProviderAdapterRecord = {
      schema: 1,
      provider_adapter_id: `provider-adapter-${randomUUID()}`,
      provider: input.provider,
      adapter_kind: input.adapter_kind,
      ...(input.executable_path ? { executable_path: input.executable_path } : {}),
      models: [...input.models],
      max_run_token_budget: input.max_run_token_budget,
      command_policy: "bounded_control_plane_only",
      configured_at: new Date().toISOString(),
    };
    const retained = (document.provider_adapters ?? []).filter(
      (adapter) => adapter.provider !== input.provider,
    );
    this.#write({
      ...document,
      provider_adapters: [record, ...retained].slice(0, 20),
      provider_capability_inventories: (document.provider_capability_inventories ?? []).filter(
        (inventory) => inventory.provider !== input.provider,
      ),
    });
    return record;
  }

  probeProviderRuntime(): ControlPlaneProviderRuntimeProbeRecord {
    const document = this.#read();
    const preflight = document.worker_launch_preflights?.[0];
    if (!preflight) {
      throw new TypeError("missing worker launch preflight");
    }
    const existing = document.provider_runtime_probes?.find(
      (probe) => probe.worker_launch_preflight_id === preflight.worker_launch_preflight_id,
    );
    if (existing) return existing;
    const plan = document.worker_delegation_plans?.find(
      (candidate) => candidate.worker_delegation_plan_id === preflight.worker_delegation_plan_id,
    );
    if (!plan) {
      throw new TypeError("missing worker delegation plan");
    }
    const adapter = document.provider_adapters?.find(
      (candidate) => candidate.provider === plan.provider,
    );
    const check = adapter ? executableCheck(adapter) : "not_performed";
    const ready =
      adapter !== undefined && (check === "executable_found" || check === "not_required");
    const record: ControlPlaneProviderRuntimeProbeRecord = {
      schema: 1,
      provider_runtime_probe_id: `provider-runtime-probe-${randomUUID()}`,
      worker_launch_preflight_id: preflight.worker_launch_preflight_id,
      worker_delegation_approval_id: preflight.worker_delegation_approval_id,
      worker_delegation_plan_id: preflight.worker_delegation_plan_id,
      manager_process_id: preflight.manager_process_id,
      manager_run_id: preflight.manager_run_id,
      provider: plan.provider,
      probe_scope: "local_control_plane_configuration",
      provider_adapter: adapter ? "configured" : "not_configured",
      executable_check: check,
      capability_inventory: adapter ? "local_inventory_available" : "not_requested",
      outcome: ready
        ? "ready_for_worker_launch"
        : adapter
          ? "blocked_provider_executable_missing"
          : "blocked_provider_adapter_not_configured",
      worker_launch: "not_performed",
      coordination_write: "not_performed",
      projects_write: "not_performed",
      created_at: new Date().toISOString(),
      next_required_action: ready
        ? "launch_workers"
        : adapter
          ? "fix_provider_executable"
          : "configure_provider_adapter",
    };
    this.#write({
      ...document,
      provider_runtime_probes: [record, ...(document.provider_runtime_probes ?? [])].slice(0, 20),
    });
    return record;
  }

  preflightApprovedWorkerLaunch(): ControlPlaneWorkerLaunchPreflightRecord {
    const document = this.#read();
    const approval = document.worker_delegation_approvals?.[0];
    if (!approval) {
      throw new TypeError("missing worker delegation approval");
    }
    const existing = document.worker_launch_preflights?.find(
      (preflight) =>
        preflight.worker_delegation_approval_id === approval.worker_delegation_approval_id,
    );
    if (existing) return existing;
    const record: ControlPlaneWorkerLaunchPreflightRecord = {
      schema: 1,
      worker_launch_preflight_id: `worker-launch-preflight-${randomUUID()}`,
      worker_delegation_approval_id: approval.worker_delegation_approval_id,
      worker_delegation_plan_id: approval.worker_delegation_plan_id,
      manager_ready_receipt_id: approval.manager_ready_receipt_id,
      manager_process_id: approval.manager_process_id,
      manager_run_id: approval.manager_run_id,
      approved_worker_count: approval.approved_worker_count,
      approved_worker_token_budget: approval.approved_worker_token_budget,
      outcome: "blocked_until_provider_runtime_probe",
      provider_runtime_check: "requires_provider_runtime_probe",
      policy_check: "local_approval_present",
      budget_check: "within_approved_worker_budget",
      capability_check: "requires_provider_capability_inventory",
      worker_launch: "not_performed",
      coordination_write: "not_performed",
      projects_write: "not_performed",
      created_at: new Date().toISOString(),
      next_required_action: "probe_provider_runtime",
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
      worker_delegation_approvals: document.worker_delegation_approvals ?? [],
      worker_launch_preflights: [record, ...(document.worker_launch_preflights ?? [])].slice(0, 20),
      provider_runtime_probes: document.provider_runtime_probes ?? [],
    });
    return record;
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
      worker_launch_preflights: document.worker_launch_preflights ?? [],
      provider_runtime_probes: document.provider_runtime_probes ?? [],
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
      worker_launch_preflights: document.worker_launch_preflights ?? [],
      provider_runtime_probes: document.provider_runtime_probes ?? [],
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
      worker_launch_preflights: document.worker_launch_preflights ?? [],
      provider_runtime_probes: document.provider_runtime_probes ?? [],
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
      worker_launch_preflights: document.worker_launch_preflights ?? [],
      provider_runtime_probes: document.provider_runtime_probes ?? [],
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
      worker_launch_preflights: document.worker_launch_preflights ?? [],
      provider_runtime_probes: document.provider_runtime_probes ?? [],
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
      worker_launch_preflights: document.worker_launch_preflights ?? [],
      provider_runtime_probes: document.provider_runtime_probes ?? [],
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
      worker_launch_preflights: document.worker_launch_preflights ?? [],
      provider_runtime_probes: document.provider_runtime_probes ?? [],
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
      worker_launch_preflights: document.worker_launch_preflights ?? [],
      provider_runtime_probes: document.provider_runtime_probes ?? [],
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
        worker_launch_preflights: Array.isArray(parsed.worker_launch_preflights)
          ? parsed.worker_launch_preflights.filter((item) => item?.schema === 1)
          : [],
        provider_runtime_probes: Array.isArray(parsed.provider_runtime_probes)
          ? parsed.provider_runtime_probes.filter((item) => item?.schema === 1)
          : [],
        provider_adapters: Array.isArray(parsed.provider_adapters)
          ? parsed.provider_adapters.filter((item) => item?.schema === 1)
          : [],
        provider_capability_inventories: Array.isArray(parsed.provider_capability_inventories)
          ? parsed.provider_capability_inventories.filter((item) => item?.schema === 1)
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
        worker_launch_preflights: [],
        provider_runtime_probes: [],
        provider_adapters: [],
        provider_capability_inventories: [],
      };
    }
  }

  #write(document: Document): void {
    const current = this.#read();
    const normalized: Document = {
      ...document,
      provider_adapters: document.provider_adapters ?? current.provider_adapters ?? [],
      provider_capability_inventories:
        document.provider_capability_inventories ?? current.provider_capability_inventories ?? [],
    };
    const tmp = `${this.#path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.#path);
  }
}
