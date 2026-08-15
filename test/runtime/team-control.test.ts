import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TeamStore } from "../../packages/team-control/src/store.js";
import { TeamSupervisor } from "../../packages/team-control/src/supervisor.js";

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
    assert.equal(store.transition(team.team_id, backend.agent_id, "running").state, "running");
    assert.equal(store.transition(team.team_id, backend.agent_id, "completed").state, "completed");
    assert.throws(
      () => store.transition(team.team_id, backend.agent_id, "running"),
      /invalid_agent_transition/u,
    );
    assert.equal(
      store.assign(team.team_id, testWorker.agent_id, "Test and document API").task,
      "Test and document API",
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

test("team supervisor starts a detached bounded worker wrapper", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-team-supervisor-")));
  try {
    const marker = join(root, "worker-launched");
    const worker = join(root, "worker.mjs");
    const executable = join(root, "agent-cli");
    const mcp = join(root, "coordination.mjs");
    const teamControlMcp = join(root, "team-control.mjs");
    await writeFile(
      worker,
      `import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(" "));`,
    );
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await writeFile(mcp, "", { mode: 0o600 });
    await writeFile(teamControlMcp, "", { mode: 0o600 });
    const store = new TeamStore(root);
    const team = store.create("Launch worker", "codex");
    const agent = store.spawn(team.team_id, {
      runtime: "copilot",
      role: "frontend-developer",
      task: "Build UI",
    });
    const supervisor = new TeamSupervisor({
      node: process.execPath,
      worker,
      launcher: executable,
      coordinationMcp: mcp,
      teamControlMcp,
      codex: executable,
      copilot: executable,
      workspace: root,
    });
    const launchedRuntime = supervisor.launch(agent);
    assert.ok(launchedRuntime.pid > 0);
    assert.equal(
      launchedRuntime.log,
      join(root, ".yukh", "teams", team.team_id, "agents", `${agent.agent_id}.log`),
    );
    let launched = "";
    for (let attempt = 0; attempt < 50 && !launched; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      try {
        launched = await readFile(marker, "utf8");
      } catch {}
    }
    assert.equal(launched, `${team.team_id} ${agent.agent_id}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
