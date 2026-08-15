import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { TeamStore } from "../../../packages/team-control/src/store.js";
import { TeamSupervisor } from "../../../packages/team-control/src/supervisor.js";

const id = z.string().regex(/^team-[0-9a-f-]{36}$/u);

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: { result: value },
  };
}

export function createTeamControlServer(store: TeamStore, supervisor: TeamSupervisor): McpServer {
  const server = new McpServer(
    { name: "yukh-team-control", version: "0.1.0-preview" },
    {
      capabilities: { tools: { listChanged: false } },
      instructions:
        "Create and inspect bounded local agent teams from explicit user goals. Team state is persistent; creating a team does not yet start workers.",
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
          max_agents: z.number().int().min(1).max(32).default(16),
          max_depth: z.number().int().min(1).max(5).default(3),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    ({ goal, manager_runtime, max_agents, max_depth }) =>
      result(store.create(goal, manager_runtime, max_agents, max_depth)),
  );

  server.registerTool(
    "team.status",
    {
      title: "Inspect a local team",
      description: "Read persistent team and worker state",
      inputSchema: z.object({ team_id: id }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    ({ team_id }) => result(store.status(team_id)),
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
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    (input) => {
      const agent = store.spawn(input.team_id, {
        ...(input.parent_agent_id ? { parent_agent_id: input.parent_agent_id } : {}),
        runtime: input.runtime,
        role: input.role,
        task: input.task,
        can_spawn: input.can_spawn,
      });
      const pid = supervisor.launch(agent);
      return result({ agent, pid });
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
    ({ team_id, agent_id }) => result(store.agent(team_id, agent_id)),
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
    ({ team_id, agent_id, task }) => result(store.assign(team_id, agent_id, task)),
  );

  server.registerTool(
    "team.stop",
    {
      title: "Stop a local team",
      description: "Mark a team stopped; worker process termination is added with the supervisor",
      inputSchema: z.object({ team_id: id }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    ({ team_id }) => result(store.stop(team_id)),
  );
  return server;
}
