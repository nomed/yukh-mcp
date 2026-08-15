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
const supervisor = new TeamSupervisor({
  node: process.execPath,
  worker: fileURLToPath(new URL("../../team-worker/src/main.js", import.meta.url)),
  coordinationMcp: fileURLToPath(
    new URL("../../coordination-preview/src/main.js", import.meta.url),
  ),
  launcher,
  codex,
  copilot,
  workspace,
});

serveStdio(() => createTeamControlServer(store, supervisor), {
  legacy: "serve",
  onerror: () => undefined,
});
