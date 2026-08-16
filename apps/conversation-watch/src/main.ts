import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCoordinationLauncher } from "../../../packages/coordination-preview/src/launcher.js";
import { TeamStore } from "../../../packages/team-control/src/store.js";
import {
  lifecycleRecords,
  recordIsVisible,
  renderLifecycle,
  renderRecord,
  renderTeamChanges,
  watchRecords,
} from "../../../packages/conversation-watch/src/watch.js";

const launcherPath = process.env.YUKH_COORDINATION_LAUNCHER;
if (!launcherPath) throw new TypeError("invalid watcher configuration");
const unknown = process.argv
  .slice(2)
  .filter((value) => value !== "--verbose" && value !== "--full");
if (unknown.length > 0) throw new TypeError("invalid watcher arguments");
const verbose = process.argv.includes("--verbose");
const full = process.argv.includes("--full");
const launcher = createCoordinationLauncher({ path: launcherPath, agent: "agent-a" });
let sequence = 0;
let lifecycleOffset = 0;
const workspace = process.env.YUKH_CONVERSATION_WORKSPACE;
const lifecyclePath = workspace
  ? join(workspace, ".yukh", "conversation-lifecycle.jsonl")
  : undefined;
const present = new Set<string>();
const teamView = new Map<string, string>();
const teamStore = workspace ? new TeamStore(workspace) : undefined;
let unavailable = false;
let lastReplayFailure = "";

process.stdout.write(
  "Yukh conversation — watching verified transcript\nPress Ctrl+C to stop. Use --full for complete message bodies.\n\n",
);

for (;;) {
  let output;
  try {
    output = await launcher.invoke("events replay");
    if (output.status === "error" && output.code !== "YKC-UNAVAILABLE-001") {
      const bootstrap = await launcher.invoke("session bootstrap");
      if (bootstrap.status !== "ok") {
        const key = `bootstrap:${bootstrap.code}`;
        if (lastReplayFailure !== key) {
          process.stdout.write(
            `WATCHER  COORDINATION BOOTSTRAP FAILED code=${bootstrap.code ?? "unknown"} — RETRYING\n\n`,
          );
          lastReplayFailure = key;
        }
        throw new Error("coordination_unavailable");
      }
      output = await launcher.invoke("events replay");
    }
    if (output.status === "error" && output.code === "YKC-UNAVAILABLE-001")
      throw new Error("coordination_unavailable");
    if (output.status === "error") {
      const key = `replay:${output.code}`;
      if (lastReplayFailure !== key) {
        process.stdout.write(
          `WATCHER  COORDINATION REPLAY FAILED code=${output.code ?? "unknown"} — RETRYING\n\n`,
        );
        lastReplayFailure = key;
      }
      throw new Error("coordination_unavailable");
    }
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "coordination_unavailable") throw error;
    if (!unavailable)
      process.stdout.write("WATCHER  COORDINATION TEMPORARILY UNAVAILABLE — RETRYING\n\n");
    unavailable = true;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    continue;
  }
  if (unavailable) process.stdout.write("WATCHER  COORDINATION RECOVERED\n\n");
  unavailable = false;
  lastReplayFailure = "";
  if (!output) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    continue;
  }
  for (const record of watchRecords(output, sequence)) {
    sequence = record.sequence;
    if (!recordIsVisible(record, present)) continue;
    process.stdout.write(`${renderRecord(record, verbose, full)}\n\n`);
  }
  if (lifecyclePath) {
    let raw = "";
    try {
      raw = readFileSync(lifecyclePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const records = lifecycleRecords(raw, lifecycleOffset);
    for (const record of records) process.stdout.write(`${renderLifecycle(record)}\n\n`);
    lifecycleOffset += records.length;
  }
  if (teamStore) {
    for (const line of renderTeamChanges(teamStore.teams(), teamView))
      process.stdout.write(`${line}\n\n`);
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
