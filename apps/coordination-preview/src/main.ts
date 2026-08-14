import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  createCoordinationLauncher,
  validateAgent,
} from "../../../packages/coordination-preview/src/launcher.js";
import { createCoordinationPreviewServer } from "./server.js";

const launcherPath = process.env.YUKH_COORDINATION_LAUNCHER;
const agentName = process.env.YUKH_COORDINATION_AGENT;
if (!launcherPath || !agentName) throw new Error("invalid Coordination preview configuration");
const agent = validateAgent(agentName);
const launcher = createCoordinationLauncher({ path: launcherPath, agent });

serveStdio(() => createCoordinationPreviewServer({ agent, launcher }), {
  legacy: "serve",
  onerror: () => undefined,
});
