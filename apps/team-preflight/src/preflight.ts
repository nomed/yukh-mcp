import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { roleProfilePolicy } from "../../team-control/src/server.js";
import { TeamStore } from "../../../packages/team-control/src/store.js";
import type { AgentRuntime } from "../../../packages/team-control/src/store.js";
import type { TeamWorkProfile } from "../../team-control/src/server.js";
import { runtimeTokenFloor, type RuntimeTokenFloor } from "./runtime-floor.js";

export interface EngagePreflightArguments {
  readonly workspace?: string;
  readonly goal: string;
  readonly role: string;
  readonly workProfile: TeamWorkProfile;
  readonly preferredRuntime?: AgentRuntime;
  readonly teamBudget: number;
  readonly managerBudget: number;
  readonly workerBudget?: number;
  readonly workerMaxCommands?: number;
  readonly workerTimeoutMs?: number;
  readonly codexModels: readonly string[];
  readonly copilotModels: readonly string[];
  readonly codexSkills: readonly string[];
  readonly copilotSkills: readonly string[];
}

export interface EngagePreflightOutput {
  readonly schema: 1;
  readonly status: "ok";
  readonly command: "team preflight-engage";
  readonly workspace: string;
  readonly provider_tokens_observed: 0;
  readonly provider_runtime_launched: false;
  readonly provider_launchable: boolean;
  readonly approval_digest: `sha-256:${string}`;
  readonly team: ReturnType<TeamStore["createManaged"]>["team"];
  readonly manager: ReturnType<TeamStore["createManaged"]>["manager"];
  readonly policy: ReturnType<typeof roleProfilePolicy>;
  readonly planned_worker: ReturnType<TeamStore["spawn"]>;
  readonly runtime_token_floor?: RuntimeTokenFloor;
  readonly budget: ReturnType<TeamStore["status"]>["tokens"];
  readonly next_real_action: string;
}

function runtimeSet(values: readonly string[]): ReadonlySet<string> {
  return new Set(values);
}

function concise(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function workerInstructions(workProfile: TeamWorkProfile): string {
  if (workProfile === "readonly")
    return "Run at most one compact read-only probe. Do not mutate files, install dependencies, start services, call the network, or list dependency/build/runtime trees. Keep command output and final summary short.";
  return "Execute only the approved task, stay within the approved runtime bounds, keep output concise, and report any missing context instead of guessing.";
}

export function approvalDigest(input: {
  readonly team_id: string;
  readonly manager_agent_id: string;
  readonly worker_agent_id: string;
  readonly runtime: string;
  readonly role: string;
  readonly model: string;
  readonly skills: readonly string[];
  readonly token_budget: number;
  readonly tool_mode?: string;
  readonly max_commands?: number;
  readonly timeout_ms?: number;
}): `sha-256:${string}` {
  const stable = {
    schema: 1,
    team_id: input.team_id,
    manager_agent_id: input.manager_agent_id,
    worker_agent_id: input.worker_agent_id,
    runtime: input.runtime,
    role: input.role,
    model: input.model,
    skills: [...input.skills].sort(),
    token_budget: input.token_budget,
    tool_mode: input.tool_mode ?? "default",
    max_commands: input.max_commands ?? 8,
    timeout_ms: input.timeout_ms ?? 300_000,
  };
  return `sha-256:${createHash("sha256").update(JSON.stringify(stable)).digest("hex")}`;
}

export function preflightApprovalDigest(
  output: Pick<EngagePreflightOutput, "team" | "manager" | "planned_worker">,
): `sha-256:${string}` {
  const worker = output.planned_worker;
  return approvalDigest({
    team_id: output.team.team_id,
    manager_agent_id: output.manager.agent_id,
    worker_agent_id: worker.agent_id,
    runtime: worker.runtime,
    role: worker.role,
    model: worker.profile?.model ?? "default",
    skills: worker.profile?.skills ?? [],
    token_budget: worker.token_budget,
    ...(worker.model_tool_mode ? { tool_mode: worker.model_tool_mode } : {}),
    ...(worker.max_commands !== undefined ? { max_commands: worker.max_commands } : {}),
    ...(worker.timeout_ms !== undefined ? { timeout_ms: worker.timeout_ms } : {}),
  });
}

export function runEngagePreflight(args: EngagePreflightArguments): EngagePreflightOutput {
  const workspace = realpathSync(args.workspace ?? mkdtempSync(join(tmpdir(), "yukh-preflight-")));
  const store = new TeamStore(workspace);
  const managed = store.createManaged(args.goal, "codex", 3, 2, args.teamBudget, {
    role: "delivery-manager",
    profile: {
      schema: 1,
      mission: "Preflight dynamic worker engagement without launching a provider runtime.",
      model: "default",
      skills: ["testing"],
      instructions:
        "Compute policy, reserve budget, and prove the worker can be composed without launching Codex or Copilot.",
    },
    task: "Preflight policy.profile then agent.engage without provider execution.",
    token_budget: args.managerBudget,
    required_actions: ["policy.profile", "agent.engage"],
    max_commands: 0,
    timeout_ms: 60_000,
  });
  const basePolicy = roleProfilePolicy(
    {
      models: {
        codex: runtimeSet(args.codexModels),
        copilot: runtimeSet(args.copilotModels),
      },
      skills: {
        codex: runtimeSet(args.codexSkills),
        copilot: runtimeSet(args.copilotSkills),
      },
      dynamicExecution: true,
    },
    args.role,
    args.workProfile,
    args.preferredRuntime,
  );
  const policy = {
    ...basePolicy,
    recommendation: {
      ...basePolicy.recommendation,
      ...(args.workerBudget !== undefined ? { token_budget: args.workerBudget } : {}),
      ...(args.workerMaxCommands !== undefined ? { max_commands: args.workerMaxCommands } : {}),
      ...(args.workerTimeoutMs !== undefined ? { runtime_timeout_ms: args.workerTimeoutMs } : {}),
    },
  };
  const worker = store.spawn(managed.team.team_id, {
    parent_agent_id: managed.manager.agent_id,
    runtime: policy.recommendation.runtime,
    role: policy.role,
    profile: {
      schema: 1,
      mission: concise(args.goal, 1_024),
      model: policy.recommendation.model,
      skills: policy.recommendation.skills,
      instructions: workerInstructions(args.workProfile),
    },
    task: args.goal,
    can_spawn: false,
    token_budget: policy.recommendation.token_budget,
    model_tool_mode: policy.recommendation.tool_mode,
    max_commands: policy.recommendation.max_commands,
    timeout_ms: policy.recommendation.runtime_timeout_ms,
  });
  const floor = runtimeTokenFloor(worker);
  const budget = store.status(managed.team.team_id).tokens;
  const providerLaunchable = !floor || worker.token_budget >= floor.minimum_token_budget;
  const output = {
    schema: 1 as const,
    status: "ok" as const,
    command: "team preflight-engage" as const,
    workspace,
    provider_tokens_observed: 0 as const,
    provider_runtime_launched: false as const,
    provider_launchable: providerLaunchable,
    approval_digest: "sha-256:" as `sha-256:${string}`,
    team: managed.team,
    manager: managed.manager,
    policy,
    planned_worker: worker,
    ...(floor ? { runtime_token_floor: floor } : {}),
    budget,
    next_real_action: providerLaunchable
      ? "Run a managed manager or agent.engage from Team Control only after approving this policy and budget."
      : "Do not launch this worker with the current CLI runtime budget. Use an SDK/lean worker runtime or raise the worker budget to the measured runtime floor.",
  };
  return { ...output, approval_digest: preflightApprovalDigest(output) };
}
