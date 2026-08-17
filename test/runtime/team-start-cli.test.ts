import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseArguments, startManager } from "../../apps/team-start/src/main.js";

test("team start launches an accounted root manager from a human goal", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "yukh-team-start-cli-"));
  try {
    const args = parseArguments([
      "--workspace",
      workspace,
      "--goal",
      "Plan one safe increment",
      "--launcher",
      "/usr/bin/true",
      "--codex",
      "/usr/bin/true",
      "--copilot",
      "/usr/bin/true",
      "--codex-models",
      "default",
      "--copilot-models",
      "default",
      "--format",
      "json",
    ]);
    const output = startManager(args);
    assert.equal(output.status, "ok");
    assert.equal(output.command, "team start");
    assert.match(output.team.team_id, /^team-/u);
    assert.equal(output.manager.kind, "manager");
    assert.equal(output.manager.output_contract, "team-plan-v1");
    assert.deepEqual(output.manager.required_actions, []);
    assert.equal(output.receipt.action, "manager.start");
    assert.ok(output.runtime.pid > 0);
    assert.match(output.runtime.log, /worker-.*\.log$/u);
    assert.match(output.watch_command, /yukh conversation watch --full/u);
    assert.match(output.status_command, new RegExp(output.team.team_id, "u"));
    assert.equal(output.team_status.tokens.allocated, 40_000);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("team start requires explicit dynamic-worker authority for delegate mode", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "yukh-team-start-denied-"));
  try {
    const args = parseArguments([
      "--workspace",
      workspace,
      "--goal",
      "Implement one tiny change",
      "--mode",
      "delegate",
      "--launcher",
      "/usr/bin/true",
      "--codex",
      "/usr/bin/true",
      "--copilot",
      "/usr/bin/true",
      "--codex-models",
      "default",
      "--copilot-models",
      "default",
      "--format",
      "json",
    ]);
    assert.throws(
      () => startManager(args),
      /dynamic workers require --allow-dynamic-workers true/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
