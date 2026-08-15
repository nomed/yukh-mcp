import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCoordinationLauncher } from "../../../packages/coordination-preview/src/launcher.js";
import {
  lifecycleRecords,
  recordIsVisible,
  renderLifecycle,
  renderRecord,
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

process.stdout.write(
  "Yukh conversation — watching verified transcript\nPress Ctrl+C to stop. Use --full for complete message bodies.\n\n",
);

for (;;) {
  let output = await launcher.invoke("events replay");
  if (output.status === "error" && output.code === "YKC-AUTH-001") {
    const bootstrap = await launcher.invoke("session bootstrap");
    if (bootstrap.status !== "ok") throw new Error("coordination_unavailable");
    output = await launcher.invoke("events replay");
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
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
