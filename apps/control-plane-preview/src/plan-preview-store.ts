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
      };
    } catch {
      return { schema: 1, previews: [], launch_intents: [] };
    }
  }

  #write(document: Document): void {
    const tmp = `${this.#path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.#path);
  }
}
