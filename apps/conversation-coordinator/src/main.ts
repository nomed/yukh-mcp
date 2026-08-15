import { createCoordinationLauncher } from "../../../packages/coordination-preview/src/launcher.js";
import { ConversationCoordinator } from "../../../packages/conversation-coordinator/src/coordinator.js";
import { createLifecycleRecorder } from "../../../packages/conversation-coordinator/src/lifecycle.js";
import { createAgentRunner } from "../../../packages/conversation-coordinator/src/runner.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new TypeError("invalid coordinator configuration");
  return value;
};

const launcher = required("YUKH_COORDINATION_LAUNCHER");
const workspace = required("YUKH_CONVERSATION_WORKSPACE");
const lifecycle = createLifecycleRecorder(workspace);
const coordinator = new ConversationCoordinator({
  launchers: {
    "agent-a": createCoordinationLauncher({ path: launcher, agent: "agent-a" }),
    "agent-b": createCoordinationLauncher({ path: launcher, agent: "agent-b" }),
  },
  runner: createAgentRunner({
    codex: required("YUKH_CODEX_EXECUTABLE"),
    copilot: required("YUKH_COPILOT_EXECUTABLE"),
    workspace,
  }),
  maxTurns: 20,
  lifetimeMs: 4 * 60 * 60 * 1_000,
  observe: (event) => {
    lifecycle.record(event);
    process.stdout.write(`${JSON.stringify(event)}\n`);
  },
});
let unavailable = false;

const availability = (event: "coordinator_unavailable" | "coordinator_recovered") => {
  const record = { schema: 1, event };
  lifecycle.record(record);
  process.stdout.write(`${JSON.stringify(record)}\n`);
};

for (;;) {
  let outcome;
  try {
    outcome = await coordinator.tick();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "coordination_unavailable") throw error;
    if (!unavailable) availability("coordinator_unavailable");
    unavailable = true;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    continue;
  }
  if (unavailable) availability("coordinator_recovered");
  unavailable = false;
  if (outcome === "complete") {
    const event = { schema: 1, event: "conversation_complete" };
    lifecycle.record(event);
    process.stdout.write(`${JSON.stringify(event)}\n`);
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, outcome === "idle" ? 2_000 : 250));
}
