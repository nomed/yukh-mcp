import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, relative, sep } from "node:path";

export type AgentRuntime = "codex" | "copilot";
export type AgentKind = "manager" | "worker";
export type ManagerOutputContract = "summary" | "team-plan-v1";
export type ModelToolMode = "none" | "coordination" | "team";
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
    | "team_plan_invalid"
    | "command_budget_exceeded"
    | "runtime_deadline_exceeded"
    | "required_action_missing"
    | "token_accounting_unavailable"
    | "token_budget_exceeded";
  readonly summary: string;
  readonly plan_id?: string;
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
  readonly kind: AgentKind;
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
  readonly required_actions: readonly TeamAction[];
  readonly output_contract?: ManagerOutputContract;
  readonly model_tool_mode?: "default" | ModelToolMode;
  readonly max_commands?: number;
  readonly timeout_ms?: number;
  readonly context_pack?: ContextPackMetadata;
  readonly usage?: AgentUsage;
  readonly completion?: AgentCompletion;
  readonly state: AgentState;
}

export interface ContextPackMetadata {
  readonly schema: 1;
  readonly digest: `sha-256:${string}`;
  readonly byte_length: number;
  readonly paths: readonly string[];
}

export interface ContextPackDocument extends ContextPackMetadata {
  readonly files: readonly { readonly path: string; readonly content: string }[];
}

export type TeamAction =
  | "manager.start"
  | "team.status"
  | "agent.engage"
  | "agent.await"
  | "plan.execute"
  | "plan.synthesize";

export interface PlannedAgent {
  readonly runtime: AgentRuntime;
  readonly role: string;
  readonly mission: string;
  readonly model: string;
  readonly skills: readonly string[];
  readonly instructions: string;
  readonly task: string;
  readonly context_paths: readonly string[];
  readonly tool_mode: ModelToolMode;
  readonly max_commands: number;
  readonly timeout_ms: number;
  readonly token_budget: number;
}

export interface TeamExecutionPlanDocument {
  readonly schema: 1;
  readonly workers: readonly PlannedAgent[];
  readonly synthesis: PlannedAgent;
}

export interface TeamExecutionPlanRecord {
  readonly schema: 1;
  readonly plan_id: string;
  readonly team_id: string;
  readonly manager_agent_id: string;
  readonly digest: `sha-256:${string}`;
  readonly document: TeamExecutionPlanDocument;
  readonly state: "proposed" | "reserved" | "running" | "synthesizing" | "completed" | "failed";
  readonly worker_agent_ids: readonly string[];
  readonly synthesis_agent_id?: string;
  readonly failure_code?: string;
}

export interface TeamActionReceipt {
  readonly schema: 1;
  readonly receipt_id: string;
  readonly team_id: string;
  readonly action: TeamAction;
  readonly actor_agent_id?: string;
  readonly subject_agent_id?: string;
  readonly outcome: "succeeded";
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

  createManaged(
    goal: string,
    managerRuntime: AgentRuntime,
    maxAgents: number,
    maxDepth: number,
    tokenBudget: number,
    manager: {
      readonly role: string;
      readonly profile: ComposedAgentProfile;
      readonly task: string;
      readonly token_budget: number;
      readonly required_actions: readonly TeamAction[];
      readonly output_contract?: ManagerOutputContract;
      readonly max_commands?: number;
      readonly timeout_ms?: number;
    },
  ): {
    readonly team: TeamRecord;
    readonly manager: AgentRecord;
  } {
    if (
      !Number.isSafeInteger(manager.token_budget) ||
      manager.token_budget < 1_000 ||
      manager.token_budget > 2_000_000 ||
      manager.token_budget > tokenBudget ||
      manager.required_actions.length > 3 ||
      new Set(manager.required_actions).size !== manager.required_actions.length ||
      (manager.output_contract === "team-plan-v1" && manager.required_actions.length > 0) ||
      !this.#validRuntimeBounds(manager.max_commands ?? 8, manager.timeout_ms ?? 300_000) ||
      manager.required_actions.some(
        (action) => !["team.status", "agent.engage", "agent.await"].includes(action),
      )
    )
      throw new TypeError("invalid manager definition");
    this.#validateProfile(manager.profile);
    const team = this.create(goal, managerRuntime, maxAgents, maxDepth, tokenBudget, {
      role: manager.role,
      mission: manager.profile.mission,
    });
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const coordination = `agent-${manager.role.slice(0, 32)}-${suffix}` as const;
    const record: AgentRecord = {
      schema: 1,
      agent_id: `worker-${randomUUID()}`,
      kind: "manager",
      coordination_agent: coordination,
      coordination_participant: `agent:${coordination.slice("agent-".length)}`,
      team_id: team.team_id,
      runtime: managerRuntime,
      role: manager.role,
      profile: manager.profile,
      task: manager.task,
      depth: 0,
      can_spawn: true,
      token_budget: manager.token_budget,
      required_actions: manager.required_actions,
      output_contract: manager.output_contract ?? "summary",
      max_commands: manager.max_commands ?? 8,
      timeout_ms: manager.timeout_ms ?? 300_000,
      state: "defined",
    };
    this.#write(
      join(this.#teamDirectory(team.team_id), "agents", `${record.agent_id}.json`),
      record,
      true,
    );
    return { team, manager: record };
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
      readonly model_tool_mode?: "default" | ModelToolMode;
      readonly max_commands?: number;
      readonly timeout_ms?: number;
      readonly context_paths?: readonly string[];
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
      input.token_budget > 2_000_000 ||
      !this.#validRuntimeBounds(input.max_commands ?? 8, input.timeout_ms ?? 300_000)
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
    const context = this.#prepareContextPack(input.context_paths ?? []);
    const record: AgentRecord = {
      schema: 1,
      agent_id: `worker-${randomUUID()}`,
      kind: "worker",
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
      required_actions: [],
      model_tool_mode: input.model_tool_mode ?? "default",
      max_commands: input.max_commands ?? 8,
      timeout_ms: input.timeout_ms ?? 300_000,
      ...(context ? { context_pack: context.metadata } : {}),
      state: "defined",
    };
    this.#write(join(this.#teamDirectory(id), "agents", `${record.agent_id}.json`), record, true);
    if (context)
      this.#write(
        join(this.#teamDirectory(id), "agents", `${record.agent_id}.context.json`),
        context.document,
        true,
      );
    return record;
  }

  contextPack(id: string, agentId: string): ContextPackDocument | undefined {
    const agent = this.#readAgent(id, agentId);
    if (!agent.context_pack) return undefined;
    const document = this.#read(
      join(this.#teamDirectory(id), "agents", `${agentId}.context.json`),
    ) as ContextPackDocument;
    const content = JSON.stringify({ schema: 1, files: document.files });
    const digest = `sha-256:${createHash("sha256").update(content).digest("hex")}`;
    if (
      document.digest !== digest ||
      document.digest !== agent.context_pack.digest ||
      document.byte_length !== agent.context_pack.byte_length ||
      document.paths.join("\n") !== agent.context_pack.paths.join("\n")
    )
      throw new Error("agent_context_pack_invalid");
    return document;
  }

  status(id: string): {
    readonly team: TeamRecord;
    readonly agents: readonly AgentRecord[];
    readonly receipts: readonly TeamActionReceipt[];
    readonly plans: readonly TeamExecutionPlanRecord[];
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
    const receipts = this.#readReceipts(id);
    const plans = this.#readPlans(id);
    const allocated = agents.reduce((total, agent) => total + agent.token_budget, 0);
    const observed = agents.reduce((total, agent) => total + (agent.usage?.total_tokens ?? 0), 0);
    return {
      team,
      agents,
      receipts,
      plans,
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

  proposePlan(id: string, managerAgentId: string, raw: string): TeamExecutionPlanRecord {
    const manager = this.#readAgent(id, managerAgentId);
    if (manager.kind !== "manager" || manager.output_contract !== "team-plan-v1")
      throw new Error("team_plan_not_expected");
    if (this.#readPlans(id).some((plan) => plan.manager_agent_id === managerAgentId))
      throw new Error("team_plan_already_exists");
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new TypeError("invalid team plan");
    }
    const document = this.#validatePlanDocument(value);
    const digest =
      `sha-256:${createHash("sha256").update(JSON.stringify(document)).digest("hex")}` as const;
    const plan: TeamExecutionPlanRecord = {
      schema: 1,
      plan_id: `plan-${randomUUID()}`,
      team_id: id,
      manager_agent_id: managerAgentId,
      digest,
      document,
      state: "proposed",
      worker_agent_ids: [],
    };
    const directory = join(this.#teamDirectory(id), "plans");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.#write(join(directory, `${plan.plan_id}.json`), plan, true);
    return plan;
  }

  plan(id: string, planId: string): TeamExecutionPlanRecord {
    if (!/^plan-[0-9a-f-]{36}$/u.test(planId)) throw new TypeError("invalid plan id");
    return this.#read(
      join(this.#teamDirectory(id), "plans", `${planId}.json`),
    ) as TeamExecutionPlanRecord;
  }

  reservePlan(id: string, planId: string, digest: string): TeamExecutionPlanRecord {
    const plan = this.plan(id, planId);
    if (plan.digest !== digest) throw new Error("team_plan_digest_mismatch");
    if (plan.state !== "proposed") return plan;
    const manager = this.#readAgent(id, plan.manager_agent_id);
    if (
      manager.state !== "completed" ||
      manager.completion?.outcome !== "succeeded" ||
      manager.completion.plan_id !== planId
    )
      throw new Error("team_plan_manager_incomplete");
    const status = this.status(id);
    const allocations = [
      ...plan.document.workers.map((worker) => worker.token_budget),
      plan.document.synthesis.token_budget,
    ];
    if (status.agents.length + allocations.length > status.team.max_agents)
      throw new Error("team_agent_limit");
    if (
      status.tokens.allocated + allocations.reduce((total, value) => total + value, 0) >
      status.team.token_budget
    )
      throw new Error("team_token_budget_exceeded");
    const workers = plan.document.workers.map((worker) =>
      this.spawn(id, {
        parent_agent_id: plan.manager_agent_id,
        runtime: worker.runtime,
        role: worker.role,
        profile: {
          schema: 1,
          mission: worker.mission,
          model: worker.model,
          skills: worker.skills,
          instructions: worker.instructions,
        },
        task: worker.task,
        context_paths: worker.context_paths,
        token_budget: worker.token_budget,
        model_tool_mode: worker.tool_mode,
        max_commands: worker.max_commands,
        timeout_ms: worker.timeout_ms,
      }),
    );
    const synthesis = plan.document.synthesis;
    const synthesizer = this.spawn(id, {
      parent_agent_id: plan.manager_agent_id,
      runtime: synthesis.runtime,
      role: synthesis.role,
      profile: {
        schema: 1,
        mission: synthesis.mission,
        model: synthesis.model,
        skills: synthesis.skills,
        instructions: synthesis.instructions,
      },
      task: "Awaiting deterministic worker completion artifacts.",
      token_budget: synthesis.token_budget,
      model_tool_mode: "none",
      max_commands: synthesis.max_commands,
      timeout_ms: synthesis.timeout_ms,
    });
    return this.updatePlan(id, planId, {
      state: "reserved",
      worker_agent_ids: workers.map((worker) => worker.agent_id),
      synthesis_agent_id: synthesizer.agent_id,
    });
  }

  updatePlan(
    id: string,
    planId: string,
    change: Pick<TeamExecutionPlanRecord, "state"> &
      Partial<
        Pick<TeamExecutionPlanRecord, "worker_agent_ids" | "synthesis_agent_id" | "failure_code">
      >,
  ): TeamExecutionPlanRecord {
    const current = this.plan(id, planId);
    const updated: TeamExecutionPlanRecord = { ...current, ...change };
    this.#write(join(this.#teamDirectory(id), "plans", `${planId}.json`), updated, false);
    return updated;
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
    if (completion.outcome === "succeeded" && this.missingRequiredActions(id, worker).length > 0)
      throw new Error("required_action_missing");
    if (usage) this.#validateUsage(current, usage);
    const state: AgentState = completion.outcome === "succeeded" ? "completed" : "failed";
    const updated: AgentRecord = { ...current, state, completion, ...(usage ? { usage } : {}) };
    this.#write(join(this.#teamDirectory(id), "agents", `${worker}.json`), updated, false);
    return updated;
  }

  missingRequiredActions(id: string, worker: string): readonly TeamAction[] {
    const agent = this.#readAgent(id, worker);
    const completed = new Set(
      this.#readReceipts(id)
        .filter((receipt) => receipt.actor_agent_id === worker)
        .map((receipt) => receipt.action),
    );
    return agent.required_actions.filter((action) => !completed.has(action));
  }

  receipt(
    id: string,
    action: TeamAction,
    actorAgentId?: string,
    subjectAgentId?: string,
  ): TeamActionReceipt {
    this.#readTeam(id);
    if (
      ![
        "manager.start",
        "team.status",
        "agent.engage",
        "agent.await",
        "plan.execute",
        "plan.synthesize",
      ].includes(action)
    )
      throw new TypeError("invalid team action");
    if (actorAgentId) this.#readAgent(id, actorAgentId);
    if (subjectAgentId) this.#readAgent(id, subjectAgentId);
    const receipt: TeamActionReceipt = {
      schema: 1,
      receipt_id: `receipt-${randomUUID()}`,
      team_id: id,
      action,
      ...(actorAgentId ? { actor_agent_id: actorAgentId } : {}),
      ...(subjectAgentId ? { subject_agent_id: subjectAgentId } : {}),
      outcome: "succeeded",
    };
    const directory = join(this.#teamDirectory(id), "receipts");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (this.#readReceipts(id).length >= 256) throw new Error("team_receipt_limit");
    this.#write(join(directory, `${receipt.receipt_id}.json`), receipt, true);
    return receipt;
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
        "team_plan_invalid",
        "command_budget_exceeded",
        "runtime_deadline_exceeded",
        "required_action_missing",
        "token_accounting_unavailable",
        "token_budget_exceeded",
      ].includes(completion.outcome) ||
      completion.summary.trim() !== completion.summary ||
      Buffer.byteLength(completion.summary, "utf8") > 4_096 ||
      (completion.plan_id !== undefined && !/^plan-[0-9a-f-]{36}$/u.test(completion.plan_id))
    )
      throw new TypeError("invalid agent completion");
  }

  #validatePlanDocument(value: unknown): TeamExecutionPlanDocument {
    const exact = (
      candidate: unknown,
      keys: readonly string[],
    ): candidate is Record<string, unknown> =>
      typeof candidate === "object" &&
      candidate !== null &&
      !Array.isArray(candidate) &&
      Object.keys(candidate).sort().join("\n") === [...keys].sort().join("\n");
    if (!exact(value, ["schema", "workers", "synthesis"]) || value.schema !== 1)
      throw new TypeError("invalid team plan");
    if (!Array.isArray(value.workers) || value.workers.length < 1 || value.workers.length > 8)
      throw new TypeError("invalid team plan");
    const normalize = (candidate: unknown): PlannedAgent => {
      const keys = [
        "runtime",
        "role",
        "mission",
        "model",
        "skills",
        "instructions",
        "task",
        "context_paths",
        "tool_mode",
        "max_commands",
        "timeout_ms",
        "token_budget",
      ];
      if (!exact(candidate, keys)) throw new TypeError("invalid team plan");
      const profile = {
        schema: 1 as const,
        mission: candidate.mission,
        model: candidate.model,
        skills: candidate.skills,
        instructions: candidate.instructions,
      };
      if (
        !["codex", "copilot"].includes(String(candidate.runtime)) ||
        typeof candidate.role !== "string" ||
        !roleName.test(candidate.role) ||
        typeof candidate.task !== "string" ||
        candidate.task.trim() !== candidate.task ||
        candidate.task.length < 1 ||
        candidate.task.length > 4_096 ||
        !Array.isArray(candidate.context_paths) ||
        candidate.context_paths.length > 4 ||
        new Set(candidate.context_paths).size !== candidate.context_paths.length ||
        candidate.context_paths.some((path) => !this.#validContextPath(path)) ||
        !["none", "coordination", "team"].includes(String(candidate.tool_mode)) ||
        !this.#validRuntimeBounds(Number(candidate.max_commands), Number(candidate.timeout_ms)) ||
        !Number.isSafeInteger(candidate.token_budget) ||
        Number(candidate.token_budget) < 1_000 ||
        Number(candidate.token_budget) > 2_000_000
      )
        throw new TypeError("invalid team plan");
      try {
        this.#validateProfile(profile as ComposedAgentProfile);
      } catch {
        throw new TypeError("invalid team plan");
      }
      return {
        runtime: candidate.runtime as AgentRuntime,
        role: candidate.role,
        mission: candidate.mission as string,
        model: candidate.model as string,
        skills: candidate.skills as readonly string[],
        instructions: candidate.instructions as string,
        task: candidate.task,
        context_paths: candidate.context_paths as readonly string[],
        tool_mode: candidate.tool_mode as ModelToolMode,
        max_commands: candidate.max_commands as number,
        timeout_ms: candidate.timeout_ms as number,
        token_budget: candidate.token_budget as number,
      };
    };
    const workers = value.workers.map(normalize);
    if (new Set(workers.map((worker) => worker.role)).size !== workers.length)
      throw new TypeError("invalid team plan");
    const synthesis = normalize(value.synthesis);
    if (synthesis.tool_mode !== "none" || synthesis.context_paths.length !== 0)
      throw new TypeError("invalid team plan");
    return { schema: 1, workers, synthesis };
  }

  #validRuntimeBounds(maxCommands: number, timeoutMs: number): boolean {
    return (
      Number.isSafeInteger(maxCommands) &&
      maxCommands >= 0 &&
      maxCommands <= 32 &&
      Number.isSafeInteger(timeoutMs) &&
      timeoutMs >= 5_000 &&
      timeoutMs <= 900_000
    );
  }

  #validContextPath(value: unknown): value is string {
    if (typeof value !== "string" || value.length < 1 || value.length > 256) return false;
    if (isAbsolute(value) || value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value))
      return false;
    const parts = value.split("/");
    return (
      parts.every((part) => part.length > 0 && part !== "." && part !== "..") &&
      ![".git", ".yukh"].includes(parts[0]!)
    );
  }

  #prepareContextPack(
    paths: readonly string[],
  ):
    { readonly metadata: ContextPackMetadata; readonly document: ContextPackDocument } | undefined {
    if (paths.length === 0) return undefined;
    if (
      paths.length > 4 ||
      new Set(paths).size !== paths.length ||
      paths.some((path) => !this.#validContextPath(path))
    )
      throw new TypeError("invalid agent context paths");
    const files = paths.map((path) => {
      let component = this.#workspace;
      for (const part of path.split("/")) {
        component = join(component, part);
        if (lstatSync(component).isSymbolicLink())
          throw new TypeError("invalid agent context file");
      }
      const target = join(this.#workspace, path);
      const info = lstatSync(target);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 4_096)
        throw new TypeError("invalid agent context file");
      const resolved = realpathSync(target);
      const scope = relative(this.#workspace, resolved);
      if (scope.startsWith(`..${sep}`) || scope === ".." || isAbsolute(scope))
        throw new TypeError("invalid agent context file");
      const bytes = readFileSync(resolved);
      const content = bytes.toString("utf8");
      if (!Buffer.from(content, "utf8").equals(bytes))
        throw new TypeError("invalid agent context file");
      return { path, content };
    });
    const byteLength = files.reduce((total, file) => total + Buffer.byteLength(file.content), 0);
    if (byteLength > 12_288) throw new TypeError("agent_context_pack_too_large");
    const canonical = JSON.stringify({ schema: 1, files });
    const digest = `sha-256:${createHash("sha256").update(canonical).digest("hex")}` as const;
    const metadata = { schema: 1 as const, digest, byte_length: byteLength, paths: [...paths] };
    return { metadata, document: { ...metadata, files } };
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
      kind: value.kind ?? "worker",
      required_actions: Array.isArray(value.required_actions) ? value.required_actions : [],
      max_commands:
        typeof value.max_commands === "number" && Number.isSafeInteger(value.max_commands)
          ? value.max_commands
          : 8,
      timeout_ms:
        typeof value.timeout_ms === "number" && Number.isSafeInteger(value.timeout_ms)
          ? value.timeout_ms
          : 300_000,
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

  #readReceipts(id: string): readonly TeamActionReceipt[] {
    const directory = join(this.#teamDirectory(id), "receipts");
    try {
      return readdirSync(directory)
        .filter((name) => /^receipt-[0-9a-f-]{36}\.json$/u.test(name))
        .sort()
        .map((name) => this.#read(join(directory, name)) as TeamActionReceipt);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  #readPlans(id: string): readonly TeamExecutionPlanRecord[] {
    const directory = join(this.#teamDirectory(id), "plans");
    try {
      return readdirSync(directory)
        .filter((name) => /^plan-[0-9a-f-]{36}\.json$/u.test(name))
        .sort()
        .map((name) => this.#read(join(directory, name)) as TeamExecutionPlanRecord);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  #read(path: string): unknown {
    const raw = readFileSync(path, "utf8");
    if (raw.length < 2 || raw.length > 65_536) throw new Error("invalid team state");
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
