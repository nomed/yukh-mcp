import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TeamStore } from "../../packages/team-control/src/store.js";

test("team store creates dynamic workers and bounded delegated children", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-team-control-")));
  try {
    const store = new TeamStore(root);
    const team = store.create("Build a task board", "codex", 3, 2);
    const backend = store.spawn(team.team_id, {
      runtime: "codex",
      role: "backend-developer",
      task: "Implement the API",
      can_spawn: true,
    });
    const testWorker = store.spawn(team.team_id, {
      parent_agent_id: backend.agent_id,
      runtime: "copilot",
      role: "api-tester",
      task: "Test the API",
    });
    assert.equal(testWorker.parent_agent_id, backend.agent_id);
    assert.equal(testWorker.depth, 2);
    assert.notEqual(testWorker.coordination_agent, backend.coordination_agent);
    assert.equal(store.status(team.team_id).agents.length, 2);
    assert.equal(
      store.assign(team.team_id, backend.agent_id, "Implement and document API").task,
      "Implement and document API",
    );
    assert.equal(store.stop(team.team_id).state, "stopped");
    assert.throws(
      () =>
        store.spawn(team.team_id, {
          runtime: "copilot",
          role: "frontend-developer",
          task: "Implement UI",
        }),
      /team_not_active/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("team store denies undelegated and over-depth children", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-team-bounds-")));
  try {
    const store = new TeamStore(root);
    const team = store.create("Bound delegation", "copilot", 4, 2);
    const parent = store.spawn(team.team_id, {
      runtime: "copilot",
      role: "frontend-lead",
      task: "Lead frontend",
      can_spawn: false,
    });
    assert.throws(
      () =>
        store.spawn(team.team_id, {
          parent_agent_id: parent.agent_id,
          runtime: "copilot",
          role: "ui-worker",
          task: "Build UI",
        }),
      /agent_delegation_denied/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
