import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { TeamStore } from "../../../packages/team-control/src/store.js";

const id = z.string().regex(/^team-[0-9a-f-]{36}$/u);

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: { result: value },
  };
}

export function createTeamControlServer(store: TeamStore): McpServer {
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
