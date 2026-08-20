import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createRealProjectReadiness,
  type RealProjectReadinessPlanReader,
  type RealProjectReadinessStatus,
} from "../../control-plane-preview/src/real-project-readiness.js";
import {
  createPreviewRuntimeCheck,
  type PreviewRuntimeCheck,
} from "../../control-plane-preview/src/preview-runtime-status.js";
import type {
  ControlPlaneProviderAdapterStatus,
  ControlPlaneProviderCapabilityInventoryStatus,
  ControlPlaneProviderRunnerAttachmentStatus,
  ControlPlaneWorkerActivityStatus,
} from "../../control-plane-preview/src/plan-preview-store.js";

type ReadinessCliOptions = {
  readonly repoRoot: string;
  readonly workspace?: string;
  readonly format: "json" | "text";
};

type PlanPreviewDocument = {
  readonly schema?: number;
  readonly provider_adapters?: readonly { readonly schema?: number }[];
  readonly provider_capability_inventories?: readonly { readonly schema?: number }[];
  readonly provider_runner_attachments?: readonly { readonly schema?: number }[];
  readonly worker_activities?: readonly { readonly type?: string }[];
};

export function parseArguments(argv: readonly string[]): ReadinessCliOptions {
  const options: { repoRoot: string; workspace?: string; format: "json" | "text" } = {
    repoRoot: process.cwd(),
    format: "text",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--workspace") {
      const value = argv[index + 1];
      if (!value) throw new Error("missing --workspace value");
      options.workspace = value;
      index += 1;
    } else if (argument === "--repo-root") {
      const value = argv[index + 1];
      if (!value) throw new Error("missing --repo-root value");
      options.repoRoot = value;
      index += 1;
    } else if (argument === "--format") {
      const value = argv[index + 1];
      if (value !== "json" && value !== "text") throw new Error("invalid --format value");
      options.format = value;
      index += 1;
    } else {
      throw new Error(`invalid readiness argument: ${argument}`);
    }
  }
  return options;
}

function readDocument(workspace: string): PlanPreviewDocument {
  const path = join(workspace, ".yukh", "control-plane", "plan-previews.json");
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PlanPreviewDocument;
    return parsed.schema === 1 ? parsed : {};
  } catch {
    return {};
  }
}

export function createReadOnlyPlanReader(workspace: string): RealProjectReadinessPlanReader {
  const read = () => readDocument(workspace);
  return {
    providerAdapters(): ControlPlaneProviderAdapterStatus {
      return {
        schema: "yukh-control-plane-provider-adapters-v1",
        source: "local-control-plane-store",
        adapters: (read().provider_adapters ?? []).filter((item) => item.schema === 1) as never,
      };
    },
    providerCapabilityInventories(): ControlPlaneProviderCapabilityInventoryStatus {
      return {
        schema: "yukh-control-plane-provider-capability-inventories-v1",
        source: "local-control-plane-store",
        inventories: (read().provider_capability_inventories ?? []).filter(
          (item) => item.schema === 1,
        ) as never,
      };
    },
    providerRunnerAttachments(): ControlPlaneProviderRunnerAttachmentStatus {
      return {
        schema: "yukh-control-plane-provider-runner-attachments-v1",
        source: "local-control-plane-store",
        attachments: (read().provider_runner_attachments ?? []).filter(
          (item) => item.schema === 1,
        ) as never,
      };
    },
    async workerActivities(): Promise<ControlPlaneWorkerActivityStatus> {
      return {
        schema: "yukh-control-plane-worker-activities-v1",
        source: "worker.activity.v1-preview-adapter",
        activities: (read().worker_activities ?? []).filter(
          (item) => item.type === "worker.activity.v1",
        ) as never,
      };
    },
  };
}

export async function createReadinessReport(
  options: ReadinessCliOptions,
  previewRuntimeCheck: PreviewRuntimeCheck = createPreviewRuntimeCheck({
    repoRoot: options.repoRoot,
  }),
): Promise<RealProjectReadinessStatus> {
  return createRealProjectReadiness({
    repoRoot: options.repoRoot,
    previewRuntime: previewRuntimeCheck(),
    ...(options.workspace ? { planPreviewStore: createReadOnlyPlanReader(options.workspace) } : {}),
  });
}

export function renderReadinessText(status: RealProjectReadinessStatus): string {
  const gates = status.gates
    .map((gate) => `- ${gate.gate}: ${gate.status} — ${gate.detail}`)
    .join("\n");
  return [
    `Yukh real project readiness: ${status.outcome}`,
    gates,
    `Next: ${status.next_required_action}`,
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    const options = parseArguments(argv);
    const status = await createReadinessReport(options);
    process.stdout.write(
      options.format === "json"
        ? `${JSON.stringify(status)}\n`
        : `${renderReadinessText(status)}\n`,
    );
    if (status.outcome === "blocked") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "readiness failed"}\n`);
    process.exitCode = 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
