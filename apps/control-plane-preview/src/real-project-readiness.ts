import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ControlPlanePlanPreviewStore } from "./plan-preview-store.js";
import type { PreviewRuntimeStatusResponse } from "./preview-runtime-status.js";

export type RealProjectReadinessPlanReader = Pick<
  ControlPlanePlanPreviewStore,
  | "providerAdapters"
  | "providerCapabilityInventories"
  | "providerRunnerAttachments"
  | "workerActivities"
>;

export type RealProjectReadinessStatus = {
  readonly schema: "yukh-control-plane-real-project-readiness-v1";
  readonly source: "control-plane-preview";
  readonly generated_at: string;
  readonly outcome: "ready-for-micro-task" | "blocked";
  readonly gates: readonly {
    readonly gate: string;
    readonly status: "pass" | "warning" | "blocked";
    readonly detail: string;
  }[];
  readonly next_required_action: string;
};

function projectPolicyGate(repoRoot: string): RealProjectReadinessStatus["gates"][number] {
  const path = join(repoRoot, ".yukh", "project.yaml");
  if (!existsSync(path)) {
    return {
      gate: "project_policy",
      status: "blocked",
      detail: ".yukh/project.yaml is missing.",
    };
  }
  const source = readFileSync(path, "utf8");
  const requiredMarkers = [
    "version: 1",
    "repository: yukh-mcp",
    "marker: yukh",
    "overwrite_human_values: false",
  ];
  const missing = requiredMarkers.filter((marker) => !source.includes(marker));
  return missing.length === 0
    ? {
        gate: "project_policy",
        status: "pass",
        detail: "Project policy is present and keeps human values protected.",
      }
    : {
        gate: "project_policy",
        status: "blocked",
        detail: `Project policy is present but missing ${missing.join(", ")}.`,
      };
}

function runtimeGate(
  runtime: PreviewRuntimeStatusResponse,
): RealProjectReadinessStatus["gates"][number] {
  if (runtime.status === "attention-required") {
    return {
      gate: "preview_runtime",
      status: "blocked",
      detail: `Preview runtime needs attention: ${runtime.problems.length} problems.`,
    };
  }
  if (runtime.status === "ok-with-warnings") {
    return {
      gate: "preview_runtime",
      status: "warning",
      detail: `Preview runtime is usable with ${runtime.warnings.length} warnings.`,
    };
  }
  return {
    gate: "preview_runtime",
    status: "pass",
    detail: "Preview runtime is ready.",
  };
}

export async function createRealProjectReadiness(
  input: {
    readonly repoRoot: string;
    readonly previewRuntime: PreviewRuntimeStatusResponse;
    readonly planPreviewStore?: RealProjectReadinessPlanReader;
  },
  now = new Date(),
): Promise<RealProjectReadinessStatus> {
  const gates: RealProjectReadinessStatus["gates"][number][] = [
    projectPolicyGate(input.repoRoot),
    runtimeGate(input.previewRuntime),
  ];

  if (!input.planPreviewStore) {
    gates.push({
      gate: "control_plane_workspace",
      status: "blocked",
      detail: "Control Plane workspace is not configured.",
    });
  } else {
    const adapters = input.planPreviewStore.providerAdapters().adapters;
    const inventories = input.planPreviewStore.providerCapabilityInventories().inventories;
    const attachments = input.planPreviewStore.providerRunnerAttachments().attachments;
    const activities = await input.planPreviewStore.workerActivities();
    gates.push({
      gate: "provider_adapter",
      status: adapters.length > 0 ? "pass" : "blocked",
      detail:
        adapters.length > 0
          ? `${adapters.length} provider adapter configured.`
          : "Configure at least one provider adapter before real project use.",
    });
    gates.push({
      gate: "provider_capabilities",
      status: inventories.length > 0 ? "pass" : "warning",
      detail:
        inventories.length > 0
          ? `${inventories.length} provider capability inventory recorded.`
          : "No provider capability inventory recorded yet; guided run can create it.",
    });
    gates.push({
      gate: "runner_attachment",
      status: attachments.length > 0 ? "pass" : "warning",
      detail:
        attachments.length > 0
          ? `${attachments.length} provider runner attachment observed.`
          : "No provider runner attachment observed yet; first guided run will qualify this.",
    });
    gates.push({
      gate: "worker_activity",
      status: activities.activities.length > 0 ? "pass" : "warning",
      detail:
        activities.activities.length > 0
          ? `${activities.activities.length} worker.activity.v1 events available from ${activities.source}.`
          : "No worker activity observed yet; first guided run should record a snapshot.",
    });
  }

  const blocked = gates.some((gate) => gate.status === "blocked");
  return {
    schema: "yukh-control-plane-real-project-readiness-v1",
    source: "control-plane-preview",
    generated_at: now.toISOString(),
    outcome: blocked ? "blocked" : "ready-for-micro-task",
    gates,
    next_required_action: blocked
      ? (gates.find((gate) => gate.status === "blocked")?.detail ?? "Resolve blocked gates.")
      : "Run one bounded real micro-task through the guided Control Plane flow.",
  };
}
