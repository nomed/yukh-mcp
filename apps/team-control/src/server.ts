import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { TeamStore } from "../../../packages/team-control/src/store.js";
import { TeamSupervisor } from "../../../packages/team-control/src/supervisor.js";
import type { AgentRecord } from "../../../packages/team-control/src/store.js";

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
        "Create bounded local teams with explicit token budgets. The team already exists for delegated workers: they must not call team.create. Engage children with smaller budgets, use returned coordination_participant identifiers exactly, wait with agent.await, and consume every successful completion before synthesis. Team state is persistent; creating a team does not start workers.",
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
      return result(store.status(team_id));
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
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    (input) => {
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
        });
        const runtime = supervisor.launch(agent);
        return result({ agent, ...runtime });
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
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    (input) => {
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
      return agent ? result(agent) : failure("agent_wait_timeout");
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
