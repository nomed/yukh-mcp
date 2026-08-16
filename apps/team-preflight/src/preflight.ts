import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { roleProfilePolicy } from "../../team-control/src/server.js";
import { TeamStore } from "../../../packages/team-control/src/store.js";
import type { AgentRuntime } from "../../../packages/team-control/src/store.js";
import type { TeamWorkProfile } from "../../team-control/src/server.js";

export interface EngagePreflightArguments {
  readonly workspace?: string;
  readonly goal: string;
  readonly role: string;
  readonly workProfile: TeamWorkProfile;
  readonly preferredRuntime?: AgentRuntime;
  readonly teamBudget: number;
  readonly managerBudget: number;
  readonly codexModels: readonly string[];
  readonly copilotModels: readonly string[];
  readonly codexSkills: readonly string[];
  readonly copilotSkills: readonly string[];
}

function runtimeSet(values: readonly string[]): ReadonlySet<string> {
  return new Set(values);
}

export function runEngagePreflight(args: EngagePreflightArguments) {
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
  const policy = roleProfilePolicy(
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
  const worker = store.spawn(managed.team.team_id, {
    parent_agent_id: managed.manager.agent_id,
    runtime: policy.recommendation.runtime,
    role: policy.role,
    profile: {
      schema: 1,
      mission: `Preflighted ${policy.role}`,
      model: policy.recommendation.model,
      skills: policy.recommendation.skills,
      instructions:
        "This worker was composed by preflight only. A real run must be launched separately.",
    },
    task: "Preflight only: no provider runtime launched.",
    can_spawn: false,
    token_budget: policy.recommendation.token_budget,
    model_tool_mode: policy.recommendation.tool_mode,
    max_commands: policy.recommendation.max_commands,
    timeout_ms: policy.recommendation.runtime_timeout_ms,
  });
  const budget = store.status(managed.team.team_id).tokens;
  return {
    schema: 1 as const,
    status: "ok" as const,
    command: "team preflight-engage" as const,
    workspace,
    provider_tokens_observed: 0,
    provider_runtime_launched: false,
    team: managed.team,
    manager: managed.manager,
    policy,
    planned_worker: worker,
    budget,
    next_real_action:
      "Run a managed manager or agent.engage from Team Control only after approving this policy and budget.",
  };
}
