import { appendFileSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCoordinationLauncher } from "../../../packages/coordination-preview/src/launcher.js";
import { ConversationCoordinator } from "../../../packages/conversation-coordinator/src/coordinator.js";
import { createAgentRunner } from "../../../packages/conversation-coordinator/src/runner.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new TypeError("invalid coordinator configuration");
  return value;
};

const launcher = required("YUKH_COORDINATION_LAUNCHER");
const workspace = required("YUKH_CONVERSATION_WORKSPACE");
const lifecycleDirectory = join(workspace, ".yukh");
const lifecyclePath = join(lifecycleDirectory, "conversation-lifecycle.jsonl");
mkdirSync(lifecycleDirectory, { mode: 0o700 });
if (lstatSync(lifecycleDirectory).isSymbolicLink())
  throw new Error("invalid coordinator lifecycle path");
writeFileSync(lifecyclePath, "", { encoding: "utf8", mode: 0o600 });
const record = (event: object) => {
  appendFileSync(lifecyclePath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
};
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
    record(event);
    process.stdout.write(`${JSON.stringify(event)}\n`);
  },
});

for (;;) {
  const outcome = await coordinator.tick();
  if (outcome === "complete") {
    const event = { schema: 1, event: "conversation_complete" };
    record(event);
    process.stdout.write(`${JSON.stringify(event)}\n`);
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, outcome === "idle" ? 2_000 : 250));
}
