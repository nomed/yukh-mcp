import { spawn } from "node:child_process";
import { TeamStore } from "../../../packages/team-control/src/store.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new TypeError("invalid team worker configuration");
  return value;
};

const teamID = process.argv[2];
const agentID = process.argv[3];
if (!teamID || !agentID) throw new TypeError("invalid team worker arguments");
const workspace = required("YUKH_TEAM_WORKSPACE");
const store = new TeamStore(workspace);
const agent = store.agent(teamID, agentID);
store.transition(teamID, agentID, "running");

const node = process.execPath;
const launcher = required("YUKH_COORDINATION_LAUNCHER");
const mcpMain = required("YUKH_COORDINATION_MCP_MAIN");
const mcpEnv = {
  YUKH_COORDINATION_AGENT: agent.coordination_agent,
  YUKH_COORDINATION_LAUNCHER: launcher,
};
const prompt = `You are ${agent.role}, worker ${agent.agent_id} in team ${agent.team_id}. Complete this task: ${agent.task}\nUse yukh-coordination to bootstrap if required, join with your role, replay messages, and communicate blockers or completion. You may create a bounded child team only when explicitly delegated.`;

const command =
  agent.runtime === "codex"
    ? required("YUKH_CODEX_EXECUTABLE")
    : required("YUKH_COPILOT_EXECUTABLE");
const args =
  agent.runtime === "codex"
    ? [
        "exec",
        "--ephemeral",
        "--dangerously-bypass-approvals-and-sandbox",
        "-c",
        `mcp_servers.yukh-coordination.command=${JSON.stringify(node)}`,
        "-c",
        `mcp_servers.yukh-coordination.args=${JSON.stringify([mcpMain])}`,
        "-c",
        `mcp_servers.yukh-coordination.env.YUKH_COORDINATION_AGENT=${JSON.stringify(agent.coordination_agent)}`,
        "-c",
        `mcp_servers.yukh-coordination.env.YUKH_COORDINATION_LAUNCHER=${JSON.stringify(launcher)}`,
        prompt,
      ]
    : [
        "-p",
        prompt,
        "-s",
        "--no-ask-user",
        "--allow-all",
        `--additional-mcp-config=${JSON.stringify({
          mcpServers: {
            "yukh-coordination": {
              type: "stdio",
              command: node,
              args: [mcpMain],
              env: mcpEnv,
              tools: ["*"],
            },
          },
        })}`,
      ];

const exitCode = await new Promise<number>((resolve) => {
  const child = spawn(command, args, {
    cwd: workspace,
    shell: false,
    stdio: "ignore",
    env: { HOME: process.env.HOME ?? "", PATH: process.env.PATH ?? "/usr/bin:/bin" },
  });
  child.once("error", () => resolve(1));
  child.once("close", (code) => resolve(code ?? 1));
});
store.transition(teamID, agentID, exitCode === 0 ? "completed" : "failed");
process.exitCode = exitCode;
