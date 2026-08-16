import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";

export type AgentRuntime = "codex" | "copilot";
export type TeamState = "active" | "stopped";
export type AgentState = "defined" | "running" | "completed" | "failed" | "stopped";

export interface AgentUsage {
  readonly schema: 1;
  readonly source: "codex-json-v1";
  readonly input_tokens: number;
  readonly cached_input_tokens: number;
  readonly output_tokens: number;
  readonly reasoning_output_tokens: number;
  readonly total_tokens: number;
  readonly budget_outcome: "within" | "exceeded";
}

export interface AgentCompletion {
  readonly schema: 1;
  readonly outcome:
    | "succeeded"
    | "agent_exit_nonzero"
    | "completion_missing"
    | "token_accounting_unavailable"
    | "token_budget_exceeded";
  readonly summary: string;
}

export interface ComposedAgentProfile {
  readonly schema: 1;
  readonly mission: string;
  readonly model: string;
  readonly skills: readonly string[];
  readonly instructions: string;
}

export interface TeamRecord {
  readonly schema: 1;
  readonly team_id: string;
  readonly goal: string;
  readonly workspace: string;
  readonly manager_runtime: AgentRuntime;
  readonly manager_role?: string;
  readonly manager_mission?: string;
  readonly max_agents: number;
  readonly max_depth: number;
  readonly token_budget: number;
  readonly state: TeamState;
}

export interface AgentRecord {
  readonly schema: 1;
  readonly agent_id: string;
  readonly coordination_agent: `agent-${string}`;
  readonly coordination_participant: `agent:${string}`;
  readonly team_id: string;
  readonly parent_agent_id?: string;
  readonly runtime: AgentRuntime;
  readonly role: string;
  readonly profile?: ComposedAgentProfile;
  readonly task: string;
  readonly depth: number;
  readonly can_spawn: boolean;
  readonly token_budget: number;
  readonly usage?: AgentUsage;
  readonly completion?: AgentCompletion;
  readonly state: AgentState;
}

const teamID = /^team-[0-9a-f-]{36}$/u;
const agentID = /^worker-[0-9a-f-]{36}$/u;
const roleName = /^[a-z][a-z0-9-]{0,31}$/u;

export class TeamStore {
  readonly #workspace: string;
  readonly #root: string;

  constructor(workspace: string) {
    if (!isAbsolute(workspace)) throw new TypeError("invalid team workspace");
    const info = lstatSync(workspace);
    if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(workspace) !== workspace)
      throw new TypeError("invalid team workspace");
    this.#workspace = workspace;
    const state = join(workspace, ".yukh");
    mkdirSync(state, { recursive: true, mode: 0o700 });
    if (lstatSync(state).isSymbolicLink()) throw new TypeError("invalid team state path");
    this.#root = join(state, "teams");
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    if (lstatSync(this.#root).isSymbolicLink()) throw new TypeError("invalid team state path");
  }

  create(
    goal: string,
    managerRuntime: AgentRuntime,
    maxAgents = 16,
    maxDepth = 3,
    tokenBudget = 500_000,
    manager?: { readonly role: string; readonly mission: string },
  ): TeamRecord {
    if (
      goal.trim() !== goal ||
      goal.length < 1 ||
      goal.length > 4_096 ||
      !["codex", "copilot"].includes(managerRuntime) ||
      !Number.isInteger(maxAgents) ||
      maxAgents < 1 ||
      maxAgents > 32 ||
      !Number.isInteger(maxDepth) ||
      maxDepth < 1 ||
      maxDepth > 5 ||
      !Number.isSafeInteger(tokenBudget) ||
      tokenBudget < 1_000 ||
      tokenBudget > 10_000_000
    )
      throw new TypeError("invalid team definition");
    if (
      manager &&
      (!roleName.test(manager.role) ||
        manager.mission.trim() !== manager.mission ||
        manager.mission.length < 1 ||
        manager.mission.length > 1_024)
    )
      throw new TypeError("invalid manager profile");
    const record: TeamRecord = {
      schema: 1,
      team_id: `team-${randomUUID()}`,
      goal,
      workspace: this.#workspace,
      manager_runtime: managerRuntime,
      ...(manager ? { manager_role: manager.role, manager_mission: manager.mission } : {}),
      max_agents: maxAgents,
      max_depth: maxDepth,
      token_budget: tokenBudget,
      state: "active",
    };
    const directory = this.#teamDirectory(record.team_id);
    mkdirSync(join(directory, "agents"), { recursive: true, mode: 0o700 });
    this.#write(join(directory, "team.json"), record, true);
    return record;
  }

  spawn(
    id: string,
    input: {
      readonly parent_agent_id?: string;
      readonly runtime: AgentRuntime;
      readonly role: string;
      readonly profile?: ComposedAgentProfile;
      readonly task: string;
      readonly can_spawn?: boolean;
      readonly token_budget: number;
    },
  ): AgentRecord {
    const team = this.#readTeam(id);
    if (team.state !== "active") throw new Error("team_not_active");
    if (team.token_budget < 1_000) throw new Error("team_token_budget_unavailable");
    if (
      !["codex", "copilot"].includes(input.runtime) ||
      !roleName.test(input.role) ||
      input.task.trim() !== input.task ||
      input.task.length < 1 ||
      input.task.length > 4_096 ||
      !Number.isSafeInteger(input.token_budget) ||
      input.token_budget < 1_000 ||
      input.token_budget > 2_000_000
    )
      throw new TypeError("invalid agent definition");
    if (input.profile) this.#validateProfile(input.profile);
    const agents = this.#readAgents(id);
    if (agents.some((agent) => agent.token_budget < 1_000))
      throw new Error("team_token_budget_unavailable");
    if (agents.length >= team.max_agents) throw new Error("team_agent_limit");
    if (
      agents.reduce((total, agent) => total + agent.token_budget, 0) + input.token_budget >
      team.token_budget
    )
      throw new Error("team_token_budget_exceeded");
    const parent = input.parent_agent_id
      ? agents.find((agent) => agent.agent_id === input.parent_agent_id)
      : undefined;
    if (input.parent_agent_id && (!parent || !parent.can_spawn))
      throw new Error("agent_delegation_denied");
    const depth = parent ? parent.depth + 1 : 1;
    if (depth > team.max_depth) throw new Error("team_depth_limit");
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const coordination = `agent-${input.role.slice(0, 32)}-${suffix}` as const;
    const record: AgentRecord = {
      schema: 1,
      agent_id: `worker-${randomUUID()}`,
      coordination_agent: coordination,
      coordination_participant: `agent:${coordination.slice("agent-".length)}`,
      team_id: id,
      ...(parent ? { parent_agent_id: parent.agent_id } : {}),
      runtime: input.runtime,
      role: input.role,
      ...(input.profile ? { profile: input.profile } : {}),
      task: input.task,
      depth,
      can_spawn: input.can_spawn ?? false,
      token_budget: input.token_budget,
      state: "defined",
    };
    this.#write(join(this.#teamDirectory(id), "agents", `${record.agent_id}.json`), record, true);
    return record;
  }

  status(id: string): {
    readonly team: TeamRecord;
    readonly agents: readonly AgentRecord[];
    readonly tokens: {
      readonly budget: number;
      readonly allocated: number;
      readonly observed: number;
      readonly remaining: number;
      readonly pending_agents: number;
      readonly unaccounted_agents: number;
      readonly exceeded_agents: number;
    };
  } {
    const team = this.#readTeam(id);
    const agents = this.#readAgents(id);
    const allocated = agents.reduce((total, agent) => total + agent.token_budget, 0);
    const observed = agents.reduce((total, agent) => total + (agent.usage?.total_tokens ?? 0), 0);
    return {
      team,
      agents,
      tokens: {
        budget: team.token_budget,
        allocated,
        observed,
        remaining: Math.max(0, team.token_budget - observed),
        pending_agents: agents.filter(
          (agent) => !agent.usage && ["defined", "running"].includes(agent.state),
        ).length,
        unaccounted_agents: agents.filter(
          (agent) => !agent.usage && ["completed", "failed"].includes(agent.state),
        ).length,
        exceeded_agents: agents.filter((agent) => agent.usage?.budget_outcome === "exceeded")
          .length,
      },
    };
  }

  teams(): readonly ReturnType<TeamStore["status"]>[] {
    return readdirSync(this.#root)
      .filter((name) => teamID.test(name))
      .sort()
      .map((name) => this.status(name));
  }

  agent(id: string, worker: string): AgentRecord {
    return this.#readAgent(id, worker);
  }

  transition(id: string, worker: string, state: AgentState): AgentRecord {
    const current = this.#readAgent(id, worker);
    const allowed: Readonly<Record<AgentState, readonly AgentState[]>> = {
      defined: ["running", "failed", "stopped"],
      running: ["completed", "failed", "stopped"],
      completed: [],
      failed: [],
      stopped: [],
    };
    if (!allowed[current.state].includes(state)) throw new Error("invalid_agent_transition");
    const updated: AgentRecord = { ...current, state };
    this.#write(join(this.#teamDirectory(id), "agents", `${worker}.json`), updated, false);
    return updated;
  }

  finish(id: string, worker: string, completion: AgentCompletion, usage?: AgentUsage): AgentRecord {
    const current = this.#readAgent(id, worker);
    if (current.state !== "running") throw new Error("invalid_agent_transition");
    this.#validateCompletion(completion);
    if (usage) this.#validateUsage(current, usage);
    const state: AgentState = completion.outcome === "succeeded" ? "completed" : "failed";
    const updated: AgentRecord = { ...current, state, completion, ...(usage ? { usage } : {}) };
    this.#write(join(this.#teamDirectory(id), "agents", `${worker}.json`), updated, false);
    return updated;
  }

  assign(id: string, worker: string, task: string): AgentRecord {
    if (task.length < 1 || task.length > 4_096) throw new TypeError("invalid task");
    const current = this.#readAgent(id, worker);
    if (["completed", "stopped"].includes(current.state)) throw new Error("agent_not_assignable");
    const updated = { ...current, task };
    this.#write(join(this.#teamDirectory(id), "agents", `${worker}.json`), updated, false);
    return updated;
  }

  stop(id: string): TeamRecord {
    const team = this.#readTeam(id);
    const updated: TeamRecord = { ...team, state: "stopped" };
    this.#write(join(this.#teamDirectory(id), "team.json"), updated, false);
    return updated;
  }

  #teamDirectory(id: string): string {
    if (!teamID.test(id)) throw new TypeError("invalid team id");
    return join(this.#root, id);
  }

  #validateProfile(profile: ComposedAgentProfile): void {
    const token = /^[a-z0-9][a-z0-9._:-]{0,63}$/u;
    if (
      profile.schema !== 1 ||
      profile.mission.trim() !== profile.mission ||
      profile.mission.length < 1 ||
      profile.mission.length > 1_024 ||
      !token.test(profile.model) ||
      !Array.isArray(profile.skills) ||
      profile.skills.length > 16 ||
      new Set(profile.skills).size !== profile.skills.length ||
      profile.skills.some((skill) => !token.test(skill)) ||
      profile.instructions.trim() !== profile.instructions ||
      profile.instructions.length < 1 ||
      profile.instructions.length > 4_096
    )
      throw new TypeError("invalid agent profile");
  }

  #validateCompletion(completion: AgentCompletion): void {
    if (
      completion.schema !== 1 ||
      ![
        "succeeded",
        "agent_exit_nonzero",
        "completion_missing",
        "token_accounting_unavailable",
        "token_budget_exceeded",
      ].includes(completion.outcome) ||
      completion.summary.trim() !== completion.summary ||
      Buffer.byteLength(completion.summary, "utf8") > 4_096
    )
      throw new TypeError("invalid agent completion");
  }

  #validateUsage(agent: AgentRecord, usage: AgentUsage): void {
    const counts = [
      usage.input_tokens,
      usage.cached_input_tokens,
      usage.output_tokens,
      usage.reasoning_output_tokens,
      usage.total_tokens,
    ];
    if (
      usage.schema !== 1 ||
      usage.source !== "codex-json-v1" ||
      counts.some((value) => !Number.isSafeInteger(value) || value < 0) ||
      usage.total_tokens !== usage.input_tokens + usage.output_tokens ||
      usage.cached_input_tokens > usage.input_tokens ||
      usage.reasoning_output_tokens > usage.output_tokens ||
      usage.budget_outcome !== (usage.total_tokens <= agent.token_budget ? "within" : "exceeded")
    )
      throw new TypeError("invalid agent usage");
  }

  #readTeam(id: string): TeamRecord {
    const value = this.#read(join(this.#teamDirectory(id), "team.json")) as TeamRecord;
    return Number.isSafeInteger(value.token_budget) ? value : { ...value, token_budget: 0 };
  }

  #readAgent(id: string, worker: string): AgentRecord {
    if (!agentID.test(worker)) throw new TypeError("invalid agent id");
    const value = this.#read(
      join(this.#teamDirectory(id), "agents", `${worker}.json`),
    ) as AgentRecord;
    const coordinationParticipant =
      `agent:${value.coordination_agent.slice("agent-".length)}` as const;
    return {
      ...value,
      ...(Number.isSafeInteger(value.token_budget) ? {} : { token_budget: 0 }),
      ...(value.coordination_participant
        ? {}
        : { coordination_participant: coordinationParticipant }),
    };
  }

  #readAgents(id: string): AgentRecord[] {
    const directory = join(this.#teamDirectory(id), "agents");
    return readdirSync(directory)
      .filter((name) => /^worker-[0-9a-f-]{36}\.json$/u.test(name))
      .sort()
      .map((name) => this.#readAgent(id, name.slice(0, -".json".length)));
  }

  #read(path: string): unknown {
    const raw = readFileSync(path, "utf8");
    if (raw.length < 2 || raw.length > 16_384) throw new Error("invalid team state");
    return JSON.parse(raw) as unknown;
  }

  #write(path: string, value: object, exclusive: boolean): void {
    const raw = `${JSON.stringify(value)}\n`;
    if (exclusive) {
      writeFileSync(path, raw, { encoding: "utf8", mode: 0o600, flag: "wx" });
      return;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, raw, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  }
}
