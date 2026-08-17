import { realpathSync } from "node:fs";
import {
  costSafeDeterministicPlan,
  dynamicExecutionEnabled,
  executePlan,
} from "../../team-control/src/server.js";
import type { TeamControlOptions } from "../../team-control/src/server.js";
import { teamRuntimeEntrypoints } from "../../../packages/team-control/src/entrypoints.js";
import { TeamStore } from "../../../packages/team-control/src/store.js";
import { TeamSupervisor } from "../../../packages/team-control/src/supervisor.js";

export interface ApprovedPlanRunArguments {
  readonly workspace: string;
  readonly teamId: string;
  readonly planId: string;
  readonly approvedDigest: string;
  readonly launcher: string;
  readonly codex: string;
  readonly copilot: string;
  readonly waitMs: number;
  readonly codexModels?: string;
  readonly copilotModels?: string;
  readonly codexSkills?: string;
  readonly copilotSkills?: string;
}

function list(value: string | undefined, fallback: readonly string[]): readonly string[] {
  return value ? value.split(",").filter(Boolean) : fallback;
}

function allowlist(value: string | undefined, fallback: readonly string[]): ReadonlySet<string> {
  return new Set(list(value, fallback));
}

function profileEnvironment(args: ApprovedPlanRunArguments): Readonly<Record<string, string>> {
  const env: Record<string, string> = { YUKH_ENABLE_UNSAFE_DYNAMIC_WORKERS: "1" };
  if (args.codexModels) env.YUKH_CODEX_MODELS = args.codexModels;
  if (args.copilotModels) env.YUKH_COPILOT_MODELS = args.copilotModels;
  if (args.codexSkills) env.YUKH_CODEX_SKILLS = args.codexSkills;
  if (args.copilotSkills) env.YUKH_COPILOT_SKILLS = args.copilotSkills;
  if (process.env.YUKH_CODEX_WORKER_PROVIDER === "python-app-server")
    env.YUKH_CODEX_WORKER_PROVIDER = "python-app-server";
  if (process.env.YUKH_CODEX_PYTHON_EXECUTABLE)
    env.YUKH_CODEX_PYTHON_EXECUTABLE = process.env.YUKH_CODEX_PYTHON_EXECUTABLE;
  if (process.env.YUKH_COPILOT_WORKER_PROVIDER === "sdk") env.YUKH_COPILOT_WORKER_PROVIDER = "sdk";
  if (process.env.YUKH_PREVIEW_RUNTIME) env.YUKH_PREVIEW_RUNTIME = process.env.YUKH_PREVIEW_RUNTIME;
  return env;
}

export async function runApprovedPlan(args: ApprovedPlanRunArguments) {
  return runApprovedPlanWithDependencies(args);
}

export async function runApprovedPlanWithDependencies(
  args: ApprovedPlanRunArguments,
  dependencies?: {
    readonly store: TeamStore;
    readonly supervisor: Pick<TeamSupervisor, "launch">;
    readonly options: TeamControlOptions;
  },
) {
  const workspace = realpathSync(args.workspace);
  const store = dependencies?.store ?? new TeamStore(workspace);
  const supervisor =
    dependencies?.supervisor ??
    (() => {
      const entrypoints = teamRuntimeEntrypoints();
      return new TeamSupervisor({
        node: process.execPath,
        worker: entrypoints.worker,
        coordinationMcp: entrypoints.coordinationMcp,
        teamControlMcp: entrypoints.teamControlMcp,
        launcher: realpathSync(args.launcher),
        codex: realpathSync(args.codex),
        copilot: realpathSync(args.copilot),
        workspace,
        profileEnvironment: profileEnvironment(args),
      });
    })();
  const options =
    dependencies?.options ??
    ({
      dynamicExecution: process.env.YUKH_ENABLE_UNSAFE_DYNAMIC_WORKERS === "1",
      models: {
        codex: allowlist(args.codexModels, ["default"]),
        copilot: allowlist(args.copilotModels, ["default"]),
      },
      skills: {
        codex: allowlist(args.codexSkills, [
          "api-design",
          "testing",
          "product",
          "documentation",
          "security",
        ]),
        copilot: allowlist(args.copilotSkills, ["frontend", "testing"]),
      },
    } satisfies TeamControlOptions);
  const plan = store.plan(args.teamId, args.planId);
  if (!dynamicExecutionEnabled(options) && !costSafeDeterministicPlan(plan))
    throw new Error("dynamic_worker_cost_boundary_unavailable");
  const completed = await executePlan(
    store,
    supervisor,
    options,
    args.teamId,
    args.planId,
    args.approvedDigest,
    args.waitMs,
  );
  return {
    schema: 1 as const,
    status: "ok" as const,
    command: "team run-plan-approved" as const,
    provider_runtime_launched: true,
    plan: completed,
    team: store.status(args.teamId),
  };
}
