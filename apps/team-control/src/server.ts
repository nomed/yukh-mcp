import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { TeamStore } from "../../../packages/team-control/src/store.js";
import { TeamSupervisor } from "../../../packages/team-control/src/supervisor.js";
import type { AgentRecord } from "../../../packages/team-control/src/store.js";
import type { TeamExecutionPlanRecord } from "../../../packages/team-control/src/store.js";

const id = z.string().regex(/^team-[0-9a-f-]{36}$/u);

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: { result: value },
  };
}

function failure(code: string) {
  const value = { schema: 1, status: "error", code };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: { result: value },
    isError: true,
  };
}

function stableFailure(error: unknown, allowed: ReadonlySet<string>, fallback: string) {
  const code = error instanceof Error && allowed.has(error.message) ? error.message : fallback;
  return failure(code);
}

export interface TeamControlOptions {
  readonly caller?: { readonly team_id: string; readonly agent_id: string };
  readonly models?: Readonly<Record<"codex" | "copilot", ReadonlySet<string>>>;
  readonly skills?: Readonly<Record<"codex" | "copilot", ReadonlySet<string>>>;
  readonly dynamicExecution?: boolean;
}

export function dynamicExecutionEnabled(options: TeamControlOptions): boolean {
  return options.dynamicExecution !== false;
}

export function costSafeDeterministicPlan(
  plan: Pick<TeamExecutionPlanRecord, "document">,
): boolean {
  return [...plan.document.workers, plan.document.synthesis].every(
    (agent) => agent.tool_mode === "none" && agent.max_commands === 0,
  );
}

export function assertProfileAvailable(
  options: TeamControlOptions,
  runtime: "codex" | "copilot",
  model: string,
  skills: readonly string[],
): void {
  if (!options.models?.[runtime].has(model)) throw new Error("agent_model_unavailable");
  const availableSkills = options.skills?.[runtime] ?? new Set<string>();
  if (skills.some((skill) => !availableSkills.has(skill)))
    throw new Error("agent_skill_unavailable");
}

export async function awaitAgent(
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

export async function executePlan(
  store: TeamStore,
  supervisor: Pick<TeamSupervisor, "launch">,
  options: TeamControlOptions,
  teamId: string,
  planId: string,
  digest: string,
  timeoutMs: number,
) {
  let plan = store.plan(teamId, planId);
  if (plan.digest !== digest) throw new Error("team_plan_digest_mismatch");
  if (["completed", "failed"].includes(plan.state)) return plan;
  for (const profile of [...plan.document.workers, plan.document.synthesis])
    assertProfileAvailable(options, profile.runtime, profile.model, profile.skills);
  if (plan.state === "proposed") plan = store.reservePlan(teamId, planId, digest);
  const deadline = Date.now() + timeoutMs;
  try {
    if (plan.state === "reserved") {
      for (const agentId of plan.worker_agent_ids) {
        const agent = store.agent(teamId, agentId);
        if (agent.state !== "defined") continue;
        supervisor.launch(agent);
        store.receipt(teamId, "plan.execute", undefined, agentId);
      }
      plan = store.updatePlan(teamId, planId, { state: "running" });
    }
    const completed: AgentRecord[] = [];
    for (const agentId of plan.worker_agent_ids) {
      const terminal = await awaitAgent(store, teamId, agentId, Math.max(0, deadline - Date.now()));
      if (!terminal) throw new Error("team_plan_wait_timeout");
      if (terminal.state !== "completed" || terminal.completion?.outcome !== "succeeded")
        throw new Error("team_plan_worker_failed");
      completed.push(terminal);
    }
    const synthesisInput = JSON.stringify({
      schema: 1,
      worker_completions: completed.map((agent) => ({
        agent_id: agent.agent_id,
        role: agent.role,
        summary: agent.completion?.summary,
      })),
    });
    if (Buffer.byteLength(synthesisInput, "utf8") > 4_096)
      throw new Error("team_plan_synthesis_input_too_large");
    if (!plan.synthesis_agent_id) throw new Error("team_plan_state_invalid");
    const synthesisAgentId = plan.synthesis_agent_id;
    const synthesis = plan.document.synthesis;
    const synthesisTask = `${synthesis.task}\n\nUse only these verified worker completion artifacts:\n${synthesisInput}`;
    if (Buffer.byteLength(synthesisTask, "utf8") > 4_096)
      throw new Error("team_plan_synthesis_input_too_large");
    let synthesizer = store.agent(teamId, synthesisAgentId);
    if (plan.state === "running") {
      if (synthesizer.state !== "defined") throw new Error("team_plan_state_invalid");
      store.assign(teamId, synthesisAgentId, synthesisTask);
      plan = store.updatePlan(teamId, planId, { state: "synthesizing" });
      synthesizer = store.agent(teamId, synthesisAgentId);
      supervisor.launch(synthesizer);
      store.receipt(teamId, "plan.synthesize", undefined, synthesizer.agent_id);
    }
    const terminal = await awaitAgent(
      store,
      teamId,
      synthesizer.agent_id,
      Math.max(0, deadline - Date.now()),
    );
    if (!terminal) throw new Error("team_plan_wait_timeout");
    if (terminal.state !== "completed" || terminal.completion?.outcome !== "succeeded")
      throw new Error("team_plan_synthesis_failed");
    return store.updatePlan(teamId, planId, { state: "completed" });
  } catch (error) {
    const failureCode = error instanceof Error ? error.message : "team_plan_execution_failed";
    store.updatePlan(teamId, planId, { state: "failed", failure_code: failureCode });
    throw error;
  }
}

export function readTeamStatus(
  store: TeamStore,
  teamId: string,
  caller?: { readonly team_id: string; readonly agent_id: string },
):
  | ReturnType<TeamStore["status"]>
  | {
      readonly status: {
        readonly team: {
          readonly team_id: string;
          readonly state: "active" | "stopped";
          readonly max_agents: number;
          readonly max_depth: number;
          readonly token_budget: number;
        };
        readonly agents: readonly {
          readonly agent_id: string;
          readonly kind: "manager" | "worker";
          readonly role: string;
          readonly state: "defined" | "running" | "completed" | "failed" | "stopped";
          readonly token_budget: number;
          readonly max_commands: number;
          readonly timeout_ms: number;
          readonly observed_tokens: number;
          readonly completion: string;
        }[];
        readonly tokens: ReturnType<TeamStore["status"]>["tokens"];
      };
      readonly receipt: ReturnType<TeamStore["receipt"]>;
    } {
  const status = store.status(teamId);
  if (!caller) return status;
  const receipt = store.receipt(teamId, "team.status", caller.agent_id, caller.agent_id);
  return {
    status: {
      team: {
        team_id: status.team.team_id,
        state: status.team.state,
        max_agents: status.team.max_agents,
        max_depth: status.team.max_depth,
        token_budget: status.team.token_budget,
      },
      agents: status.agents.map((agent) => ({
        agent_id: agent.agent_id,
        kind: agent.kind,
        role: agent.role,
        state: agent.state,
        token_budget: agent.token_budget,
        max_commands: agent.max_commands ?? 8,
        timeout_ms: agent.timeout_ms ?? 300_000,
        observed_tokens: agent.usage?.total_tokens ?? 0,
        completion: agent.completion?.outcome ?? "pending",
      })),
      tokens: status.tokens,
    },
    receipt,
  };
}

export function createTeamControlServer(
  store: TeamStore,
  supervisor: TeamSupervisor,
  options: TeamControlOptions = {},
): McpServer {
  const authorizeTeam = (teamId: string): void => {
    if (options.caller && teamId !== options.caller.team_id)
      throw new Error("agent_delegation_denied");
  };
  const server = new McpServer(
    { name: "yukh-team-control", version: "0.1.0-preview" },
    {
      capabilities: { tools: { listChanged: false } },
      instructions:
        "Start a budgeted root manager with manager.start. Direct team.create is a legacy logical-team operation and cannot engage workers from an unaccounted external manager. A launched manager or delegated worker uses returned identifiers exactly, waits with agent.await, and must satisfy every declared required action with server-issued receipts before successful completion.",
    },
  );

  server.registerTool(
    "manager.start",
    {
      title: "Start a budgeted root team manager",
      description: "Create a team, reserve the manager budget, then start its accounted runtime",
      inputSchema: z
        .object({
          goal: z.string().min(1).max(4_096),
          runtime: z.enum(["codex", "copilot"]),
          role: z
            .string()
            .regex(/^[a-z][a-z0-9-]{0,31}$/u)
            .default("delivery-manager"),
          mission: z.string().min(1).max(1_024),
          model: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/u),
          skills: z.array(z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/u)).max(16),
          instructions: z.string().min(1).max(4_096),
          task: z.string().min(1).max(4_096),
          required_actions: z
            .array(z.enum(["team.status", "agent.engage", "agent.await"]))
            .max(3)
            .default([]),
          output_contract: z.enum(["summary", "team-plan-v1"]).default("summary"),
          max_agents: z.number().int().min(1).max(32).default(16),
          max_depth: z.number().int().min(1).max(5).default(3),
          team_token_budget: z.number().int().min(1_000).max(10_000_000),
          manager_token_budget: z.number().int().min(1_000).max(2_000_000),
          max_commands: z.number().int().min(0).max(32).default(8),
          runtime_timeout_ms: z.number().int().min(5_000).max(900_000).default(300_000),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    (input) => {
      if (options.caller) throw new Error("agent_delegation_denied");
      let managed: ReturnType<TeamStore["createManaged"]> | undefined;
      try {
        assertProfileAvailable(options, input.runtime, input.model, input.skills);
        managed = store.createManaged(
          input.goal,
          input.runtime,
          input.max_agents,
          input.max_depth,
          input.team_token_budget,
          {
            role: input.role,
            profile: {
              schema: 1,
              mission: input.mission,
              model: input.model,
              skills: input.skills,
              instructions: input.instructions,
            },
            task: input.task,
            token_budget: input.manager_token_budget,
            required_actions: input.required_actions,
            output_contract: input.output_contract,
            max_commands: input.max_commands,
            timeout_ms: input.runtime_timeout_ms,
          },
        );
        const runtime = supervisor.launch(managed.manager);
        const receipt = store.receipt(
          managed.team.team_id,
          "manager.start",
          undefined,
          managed.manager.agent_id,
        );
        return result({ ...managed, receipt, runtime });
      } catch (error) {
        if (managed) {
          try {
            store.transition(managed.team.team_id, managed.manager.agent_id, "failed");
            store.stop(managed.team.team_id);
          } catch {}
        }
        return stableFailure(
          error,
          new Set(["agent_model_unavailable", "agent_skill_unavailable", "agent_spawn_failed"]),
          "manager_start_failed",
        );
      }
    },
  );

  server.registerTool(
    "plan.status",
    {
      title: "Inspect a deterministic team plan",
      description: "Read the persisted proposal, digest, execution state and assigned agents",
      inputSchema: z
        .object({
          team_id: id,
          plan_id: z.string().regex(/^plan-[0-9a-f-]{36}$/u),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    ({ team_id, plan_id }) => {
      if (options.caller) throw new Error("agent_delegation_denied");
      return result(store.plan(team_id, plan_id));
    },
  );

  server.registerTool(
    "plan.execute",
    {
      title: "Execute an approved deterministic team plan",
      description:
        "Validate the exact proposed digest, run and await all workers, then run one tool-free synthesis",
      inputSchema: z
        .object({
          team_id: id,
          plan_id: z.string().regex(/^plan-[0-9a-f-]{36}$/u),
          approved_digest: z.string().regex(/^sha-256:[0-9a-f]{64}$/u),
          timeout_ms: z.number().int().min(1_000).max(300_000).default(300_000),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ team_id, plan_id, approved_digest, timeout_ms }) => {
      if (options.caller) throw new Error("agent_delegation_denied");
      if (
        !dynamicExecutionEnabled(options) &&
        !costSafeDeterministicPlan(store.plan(team_id, plan_id))
      )
        return failure("dynamic_worker_cost_boundary_unavailable");
      try {
        return result(
          await executePlan(
            store,
            supervisor,
            options,
            team_id,
            plan_id,
            approved_digest,
            timeout_ms,
          ),
        );
      } catch (error) {
        return stableFailure(
          error,
          new Set([
            "team_plan_digest_mismatch",
            "team_plan_manager_incomplete",
            "agent_model_unavailable",
            "agent_skill_unavailable",
            "team_agent_limit",
            "team_token_budget_exceeded",
            "team_plan_wait_timeout",
            "team_plan_worker_failed",
            "team_plan_synthesis_input_too_large",
            "team_plan_synthesis_failed",
            "agent_spawn_failed",
          ]),
          "team_plan_execution_failed",
        );
      }
    },
  );

  server.registerTool(
    "team.create",
    {
      title: "Create a persistent local team",
      description: "Create bounded persistent team state for an explicit goal",
      inputSchema: z
        .object({
          goal: z.string().min(1).max(4_096),
          manager_runtime: z.enum(["codex", "copilot"]),
          manager_role: z
            .string()
            .regex(/^[a-z][a-z0-9-]{0,31}$/u)
            .optional(),
          manager_mission: z.string().min(1).max(1_024).optional(),
          max_agents: z.number().int().min(1).max(32).default(16),
          max_depth: z.number().int().min(1).max(5).default(3),
          token_budget: z.number().int().min(1_000).max(10_000_000),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    ({
      goal,
      manager_runtime,
      manager_role,
      manager_mission,
      max_agents,
      max_depth,
      token_budget,
    }) => {
      if (options.caller) throw new Error("agent_delegation_denied");
      return result(
        store.create(goal, manager_runtime, max_agents, max_depth, token_budget, {
          role: manager_role ?? "delivery-manager",
          mission: manager_mission ?? goal,
        }),
      );
    },
  );

  server.registerTool(
    "team.status",
    {
      title: "Inspect a local team",
      description: "Read persistent team and worker state",
      inputSchema: z.object({ team_id: id }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    ({ team_id }) => {
      authorizeTeam(team_id);
      return result(readTeamStatus(store, team_id, options.caller));
    },
  );

  server.registerTool(
    "agent.engage",
    {
      title: "Compose and engage a specialist agent",
      description:
        "Validate a manager-composed role, model, skills and instructions, then start the worker",
      inputSchema: z
        .object({
          team_id: id,
          parent_agent_id: z
            .string()
            .regex(/^worker-[0-9a-f-]{36}$/u)
            .optional(),
          runtime: z.enum(["codex", "copilot"]),
          role: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/u),
          mission: z.string().min(1).max(1_024),
          model: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/u),
          skills: z.array(z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/u)).max(16),
          instructions: z.string().min(1).max(4_096),
          task: z.string().min(1).max(4_096),
          can_spawn: z.boolean().default(false),
          token_budget: z.number().int().min(1_000).max(2_000_000),
          tool_mode: z.enum(["none", "coordination", "team"]).default("team"),
          max_commands: z.number().int().min(0).max(32).default(8),
          runtime_timeout_ms: z.number().int().min(5_000).max(900_000).default(300_000),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    (input) => {
      if (!options.caller) return failure("manager_runtime_required");
      if (!dynamicExecutionEnabled(options))
        return failure("dynamic_worker_cost_boundary_unavailable");
      try {
        assertProfileAvailable(options, input.runtime, input.model, input.skills);
      } catch (error) {
        return stableFailure(
          error,
          new Set(["agent_model_unavailable", "agent_skill_unavailable"]),
          "agent_profile_unavailable",
        );
      }
      if (
        options.caller &&
        (input.team_id !== options.caller.team_id ||
          (input.parent_agent_id !== undefined &&
            input.parent_agent_id !== options.caller.agent_id))
      )
        throw new Error("agent_delegation_denied");
      try {
        const agent = store.spawn(input.team_id, {
          ...(options.caller
            ? { parent_agent_id: options.caller.agent_id }
            : input.parent_agent_id
              ? { parent_agent_id: input.parent_agent_id }
              : {}),
          runtime: input.runtime,
          role: input.role,
          profile: {
            schema: 1,
            mission: input.mission,
            model: input.model,
            skills: input.skills,
            instructions: input.instructions,
          },
          task: input.task,
          can_spawn: input.can_spawn,
          token_budget: input.token_budget,
          model_tool_mode: input.tool_mode,
          max_commands: input.max_commands,
          timeout_ms: input.runtime_timeout_ms,
        });
        const runtime = supervisor.launch(agent);
        const receipt = store.receipt(
          input.team_id,
          "agent.engage",
          options.caller.agent_id,
          agent.agent_id,
        );
        return result({ agent, receipt, ...runtime });
      } catch (error) {
        return stableFailure(
          error,
          new Set([
            "team_not_active",
            "team_agent_limit",
            "team_token_budget_exceeded",
            "team_token_budget_unavailable",
            "agent_delegation_denied",
            "team_depth_limit",
            "agent_spawn_failed",
          ]),
          "agent_engage_failed",
        );
      }
    },
  );

  server.registerTool(
    "agent.spawn",
    {
      title: "Spawn a local team worker",
      description:
        "Create a bounded worker identity and start its detached Codex or Copilot process",
      inputSchema: z
        .object({
          team_id: id,
          parent_agent_id: z
            .string()
            .regex(/^worker-[0-9a-f-]{36}$/u)
            .optional(),
          runtime: z.enum(["codex", "copilot"]),
          role: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/u),
          task: z.string().min(1).max(4_096),
          can_spawn: z.boolean().default(false),
          token_budget: z.number().int().min(1_000).max(2_000_000),
          max_commands: z.number().int().min(0).max(32).default(8),
          runtime_timeout_ms: z.number().int().min(5_000).max(900_000).default(300_000),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    (input) => {
      if (!options.caller) return failure("manager_runtime_required");
      if (!dynamicExecutionEnabled(options))
        return failure("dynamic_worker_cost_boundary_unavailable");
      if (
        options.caller &&
        (input.team_id !== options.caller.team_id ||
          (input.parent_agent_id !== undefined &&
            input.parent_agent_id !== options.caller.agent_id))
      )
        throw new Error("agent_delegation_denied");
      const agent = store.spawn(input.team_id, {
        ...(options.caller
          ? { parent_agent_id: options.caller.agent_id }
          : input.parent_agent_id
            ? { parent_agent_id: input.parent_agent_id }
            : {}),
        runtime: input.runtime,
        role: input.role,
        task: input.task,
        can_spawn: input.can_spawn,
        token_budget: input.token_budget,
        max_commands: input.max_commands,
        timeout_ms: input.runtime_timeout_ms,
      });
      const runtime = supervisor.launch(agent);
      return result({ agent, ...runtime });
    },
  );

  server.registerTool(
    "agent.status",
    {
      title: "Inspect a local team worker",
      description: "Read one persistent worker record",
      inputSchema: z
        .object({ team_id: id, agent_id: z.string().regex(/^worker-[0-9a-f-]{36}$/u) })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    ({ team_id, agent_id }) => {
      authorizeTeam(team_id);
      return result(store.agent(team_id, agent_id));
    },
  );

  server.registerTool(
    "agent.await",
    {
      title: "Wait for a local team worker",
      description:
        "Wait bounded time for a worker terminal state and return its completion artifact",
      inputSchema: z
        .object({
          team_id: id,
          agent_id: z.string().regex(/^worker-[0-9a-f-]{36}$/u),
          timeout_ms: z.number().int().min(0).max(300_000).default(60_000),
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ team_id, agent_id, timeout_ms }) => {
      authorizeTeam(team_id);
      const agent = await awaitAgent(store, team_id, agent_id, timeout_ms);
      if (!agent) return failure("agent_wait_timeout");
      const receipt = options.caller
        ? store.receipt(team_id, "agent.await", options.caller.agent_id, agent_id)
        : undefined;
      return result({ agent, ...(receipt ? { receipt } : {}) });
    },
  );

  server.registerTool(
    "task.assign",
    {
      title: "Assign a worker task",
      description: "Replace the bounded task of a worker that has not completed",
      inputSchema: z
        .object({
          team_id: id,
          agent_id: z.string().regex(/^worker-[0-9a-f-]{36}$/u),
          task: z.string().min(1).max(4_096),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    ({ team_id, agent_id, task }) => {
      authorizeTeam(team_id);
      return result(store.assign(team_id, agent_id, task));
    },
  );

  server.registerTool(
    "team.stop",
    {
      title: "Stop a local team",
      description: "Stop the team and signal its worker wrappers to terminate their agent CLIs",
      inputSchema: z.object({ team_id: id }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    ({ team_id }) => {
      if (options.caller) throw new Error("agent_delegation_denied");
      return result(store.stop(team_id));
    },
  );
  return server;
}
