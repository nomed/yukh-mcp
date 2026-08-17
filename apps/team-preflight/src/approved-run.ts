import { readFileSync, realpathSync } from "node:fs";
import { teamRuntimeEntrypoints } from "../../../packages/team-control/src/entrypoints.js";
import { TeamStore } from "../../../packages/team-control/src/store.js";
import { TeamSupervisor } from "../../../packages/team-control/src/supervisor.js";
import type { AgentRecord } from "../../../packages/team-control/src/store.js";
import { preflightApprovalDigest, type EngagePreflightOutput } from "./preflight.js";
import { assertRuntimeTokenFloor } from "./runtime-floor.js";

export interface ApprovedRunArguments {
  readonly preflightPath: string;
  readonly approvedDigest: string;
  readonly launcher: string;
  readonly codex: string;
  readonly copilot: string;
  readonly waitMs: number;
  readonly allowMicroLaunch?: boolean;
  readonly codexModels?: string;
  readonly copilotModels?: string;
  readonly codexSkills?: string;
  readonly copilotSkills?: string;
}

async function awaitAgent(
  store: TeamStore,
  teamId: string,
  agentId: string,
  timeoutMs: number,
): Promise<AgentRecord | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const agent = store.agent(teamId, agentId);
    if (["completed", "failed", "stopped"].includes(agent.state)) return agent;
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now())));
  }
}

function loadPreflight(path: string): EngagePreflightOutput {
  const value = JSON.parse(readFileSync(path, "utf8")) as EngagePreflightOutput;
  if (
    value.schema !== 1 ||
    value.status !== "ok" ||
    value.command !== "team preflight-engage" ||
    value.provider_launchable !==
      (value.runtime_token_floor === undefined ||
        value.planned_worker.token_budget >= value.runtime_token_floor.minimum_token_budget) ||
    value.provider_runtime_launched !== false ||
    value.provider_tokens_observed !== 0
  )
    throw new TypeError("invalid preflight document");
  return value;
}

function profileEnvironment(args: ApprovedRunArguments): Readonly<Record<string, string>> {
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

function microWorkerRequiresExplicitAllow(worker: AgentRecord): boolean {
  return (
    worker.model_tool_mode === "none" && worker.max_commands === 1 && worker.token_budget <= 45_000
  );
}

export async function runApprovedPreflight(args: ApprovedRunArguments) {
  const preflight = loadPreflight(args.preflightPath);
  const digest = preflightApprovalDigest(preflight);
  if (digest !== preflight.approval_digest || digest !== args.approvedDigest)
    throw new Error("approval_digest_mismatch");

  const workspace = realpathSync(preflight.workspace);
  const store = new TeamStore(workspace);
  const team = store.status(preflight.team.team_id).team;
  const worker = store.agent(preflight.team.team_id, preflight.planned_worker.agent_id);
  if (team.state !== "active") throw new Error("team_not_active");
  if (worker.state !== "defined") throw new Error("worker_not_defined");
  if (microWorkerRequiresExplicitAllow(worker) && args.allowMicroLaunch !== true)
    throw new Error("micro_worker_launch_requires_explicit_allow");
  assertRuntimeTokenFloor(worker);

  const entrypoints = teamRuntimeEntrypoints();
  const supervisor = new TeamSupervisor({
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

  const runtime = supervisor.launch(worker);
  const receipt = store.receipt(
    preflight.team.team_id,
    "agent.engage",
    preflight.manager.agent_id,
    worker.agent_id,
  );
  const terminal =
    args.waitMs > 0
      ? await awaitAgent(store, preflight.team.team_id, worker.agent_id, args.waitMs)
      : undefined;
  const status = store.status(preflight.team.team_id);
  return {
    schema: 1 as const,
    status: "ok" as const,
    command: "team run-approved" as const,
    approval_digest: digest,
    provider_runtime_launched: true,
    launched_worker: worker.agent_id,
    receipt,
    runtime,
    terminal_agent: terminal,
    tokens: status.tokens,
  };
}
