import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { fileURLToPath } from "node:url";
import { TeamStore } from "../../../packages/team-control/src/store.js";
import { TeamSupervisor } from "../../../packages/team-control/src/supervisor.js";
import { createTeamControlServer } from "./server.js";

const workspace = process.env.YUKH_TEAM_WORKSPACE;
const launcher = process.env.YUKH_COORDINATION_LAUNCHER;
const codex = process.env.YUKH_CODEX_EXECUTABLE;
const copilot = process.env.YUKH_COPILOT_EXECUTABLE;
if (!workspace || !launcher || !codex || !copilot)
  throw new TypeError("invalid team control configuration");
const store = new TeamStore(workspace);
const callerTeamId = process.env.YUKH_CALLER_TEAM_ID;
const callerAgentId = process.env.YUKH_CALLER_AGENT_ID;
if ((callerTeamId && !callerAgentId) || (!callerTeamId && callerAgentId))
  throw new TypeError("invalid team control caller");
const supervisor = new TeamSupervisor({
  node: process.execPath,
  worker: fileURLToPath(new URL("../../team-worker/src/main.js", import.meta.url)),
  coordinationMcp: fileURLToPath(
    new URL("../../coordination-preview/src/main.js", import.meta.url),
  ),
  teamControlMcp: fileURLToPath(new URL("./main.js", import.meta.url)),
  launcher,
  codex,
  copilot,
  workspace,
});

serveStdio(
  () =>
    createTeamControlServer(store, supervisor, {
      ...(callerTeamId && callerAgentId
        ? { caller: { team_id: callerTeamId, agent_id: callerAgentId } }
        : {}),
    }),
  { legacy: "serve", onerror: () => undefined },
);
