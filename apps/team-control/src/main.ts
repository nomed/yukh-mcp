import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { TeamStore } from "../../../packages/team-control/src/store.js";
import { createTeamControlServer } from "./server.js";

const workspace = process.env.YUKH_TEAM_WORKSPACE;
if (!workspace) throw new TypeError("invalid team control configuration");
const store = new TeamStore(workspace);

serveStdio(() => createTeamControlServer(store), {
  legacy: "serve",
  onerror: () => undefined,
});
