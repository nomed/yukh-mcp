import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  discoverCodexModels,
  discoverCopilotModelCatalog,
  runtimeModelCatalog,
} from "../../../packages/team-control/src/model-discovery.js";
import { teamRuntimeEntrypoints } from "../../../packages/team-control/src/entrypoints.js";
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
const codexCatalog = runtimeModelCatalog(process.env.YUKH_CODEX_MODELS, ["default"], () =>
  discoverCodexModels(codex),
);
const copilotCatalog = await discoverCopilotModelCatalog(copilot);
const codexModels = codexCatalog.models;
const copilotModels = copilotCatalog.models;
const profileEnvironment = {
  YUKH_CODEX_MODELS: codexModels.join(","),
  YUKH_COPILOT_MODELS: copilotModels.join(","),
  YUKH_CODEX_MODEL_SOURCE: codexCatalog.source,
  YUKH_COPILOT_MODEL_SOURCE: copilotCatalog.source,
  ...Object.fromEntries(
    ["YUKH_CODEX_SKILLS", "YUKH_COPILOT_SKILLS", "YUKH_COPILOT_WORKER_PROVIDER"]
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]!] as const),
  ),
};
const entrypoints = teamRuntimeEntrypoints();
const supervisor = new TeamSupervisor({
  node: process.execPath,
  worker: entrypoints.worker,
  coordinationMcp: entrypoints.coordinationMcp,
  teamControlMcp: entrypoints.teamControlMcp,
  launcher,
  codex,
  copilot,
  workspace,
  profileEnvironment,
});
const allowlist = (name: string, fallback: readonly string[] = []): ReadonlySet<string> => {
  const raw = process.env[name];
  return new Set(raw ? raw.split(",").filter(Boolean) : fallback);
};

serveStdio(
  () =>
    createTeamControlServer(store, supervisor, {
      dynamicExecution: process.env.YUKH_ENABLE_UNSAFE_DYNAMIC_WORKERS === "1",
      models: {
        codex: new Set(codexModels),
        copilot: new Set(copilotModels),
      },
      skills: {
        codex: allowlist("YUKH_CODEX_SKILLS"),
        copilot: allowlist("YUKH_COPILOT_SKILLS"),
      },
      modelCatalog: {
        codex: { models: codexModels, source: codexCatalog.source },
        copilot: { models: copilotModels, source: copilotCatalog.source },
      },
      ...(callerTeamId && callerAgentId
        ? { caller: { team_id: callerTeamId, agent_id: callerAgentId } }
        : {}),
    }),
  { legacy: "serve", onerror: () => undefined },
);
