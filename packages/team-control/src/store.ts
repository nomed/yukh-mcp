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
  readonly state: TeamState;
}

export interface AgentRecord {
  readonly schema: 1;
  readonly agent_id: string;
  readonly coordination_agent: `agent-${string}`;
  readonly team_id: string;
  readonly parent_agent_id?: string;
  readonly runtime: AgentRuntime;
  readonly role: string;
  readonly profile?: ComposedAgentProfile;
  readonly task: string;
  readonly depth: number;
  readonly can_spawn: boolean;
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
      maxDepth > 5
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
    },
  ): AgentRecord {
    const team = this.#readTeam(id);
    if (team.state !== "active") throw new Error("team_not_active");
    if (
      !["codex", "copilot"].includes(input.runtime) ||
      !roleName.test(input.role) ||
      input.task.trim() !== input.task ||
      input.task.length < 1 ||
      input.task.length > 4_096
    )
      throw new TypeError("invalid agent definition");
    if (input.profile) this.#validateProfile(input.profile);
    const agents = this.#readAgents(id);
    if (agents.length >= team.max_agents) throw new Error("team_agent_limit");
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
      team_id: id,
      ...(parent ? { parent_agent_id: parent.agent_id } : {}),
      runtime: input.runtime,
      role: input.role,
      ...(input.profile ? { profile: input.profile } : {}),
      task: input.task,
      depth,
      can_spawn: input.can_spawn ?? false,
      state: "defined",
    };
    this.#write(join(this.#teamDirectory(id), "agents", `${record.agent_id}.json`), record, true);
    return record;
  }

  status(id: string): { readonly team: TeamRecord; readonly agents: readonly AgentRecord[] } {
    return { team: this.#readTeam(id), agents: this.#readAgents(id) };
  }

  teams(): readonly {
    readonly team: TeamRecord;
    readonly agents: readonly AgentRecord[];
  }[] {
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

  #readTeam(id: string): TeamRecord {
    return this.#read(join(this.#teamDirectory(id), "team.json")) as TeamRecord;
  }

  #readAgent(id: string, worker: string): AgentRecord {
    if (!agentID.test(worker)) throw new TypeError("invalid agent id");
    return this.#read(join(this.#teamDirectory(id), "agents", `${worker}.json`)) as AgentRecord;
  }

  #readAgents(id: string): AgentRecord[] {
    const directory = join(this.#teamDirectory(id), "agents");
    return readdirSync(directory)
      .filter((name) => /^worker-[0-9a-f-]{36}\.json$/u.test(name))
      .sort()
      .map((name) => this.#read(join(directory, name)) as AgentRecord);
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
