import { createCoordinationLauncher } from "../../../packages/coordination-preview/src/launcher.js";
import { ConversationCoordinator } from "../../../packages/conversation-coordinator/src/coordinator.js";
import { createAgentRunner } from "../../../packages/conversation-coordinator/src/runner.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new TypeError("invalid coordinator configuration");
  return value;
};

const launcher = required("YUKH_COORDINATION_LAUNCHER");
const coordinator = new ConversationCoordinator({
  launchers: {
    "agent-a": createCoordinationLauncher({ path: launcher, agent: "agent-a" }),
    "agent-b": createCoordinationLauncher({ path: launcher, agent: "agent-b" }),
  },
  runner: createAgentRunner({
    codex: required("YUKH_CODEX_EXECUTABLE"),
    copilot: required("YUKH_COPILOT_EXECUTABLE"),
    workspace: required("YUKH_CONVERSATION_WORKSPACE"),
  }),
  maxTurns: 20,
  lifetimeMs: 4 * 60 * 60 * 1_000,
});

for (;;) {
  const outcome = await coordinator.tick();
  process.stdout.write(`${JSON.stringify({ schema: 1, event: "coordinator_tick", outcome })}\n`);
  if (outcome === "complete") break;
  await new Promise((resolve) => setTimeout(resolve, outcome === "idle" ? 2_000 : 250));
}
