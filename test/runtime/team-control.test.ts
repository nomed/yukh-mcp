import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { TeamStore } from "../../packages/team-control/src/store.js";
import { TeamSupervisor } from "../../packages/team-control/src/supervisor.js";
import { assertProfileAvailable } from "../../apps/team-control/src/server.js";

const workerMain = fileURLToPath(new URL("../../apps/team-worker/src/main.ts", import.meta.url));
const tsxLoader = fileURLToPath(import.meta.resolve("tsx"));

test("composed profiles require allowlisted runtime models and skills", () => {
  const options = {
    models: { codex: new Set(["deep-model"]), copilot: new Set(["fast-model"]) },
    skills: { codex: new Set(["api-design", "testing"]), copilot: new Set(["frontend"]) },
  };
  assert.doesNotThrow(() =>
    assertProfileAvailable(options, "codex", "deep-model", ["api-design", "testing"]),
  );
  assert.throws(
    () => assertProfileAvailable(options, "codex", "fast-model", []),
    /agent_model_unavailable/u,
  );
  assert.throws(
    () => assertProfileAvailable(options, "copilot", "fast-model", ["api-design"]),
    /agent_skill_unavailable/u,
  );
});

test("team store creates dynamic workers and bounded delegated children", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-team-control-")));
  try {
    const store = new TeamStore(root);
    const team = store.create("Build a task board", "codex", 3, 2);
    const backend = store.spawn(team.team_id, {
      runtime: "codex",
      role: "backend-developer",
      profile: {
        schema: 1,
        mission: "Own the backend delivery",
        model: "reasoning-model",
        skills: ["api-design", "testing"],
        instructions: "Inspect, implement, test and communicate the API contract.",
      },
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
    assert.deepEqual(backend.profile?.skills, ["api-design", "testing"]);
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

test("stopping a team makes its wrapper terminate the owned agent CLI", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-team-stop-")));
  try {
    const executable = join(root, "agent-cli");
    const launcher = join(root, "launcher");
    const support = join(root, "support.mjs");
    await writeFile(executable, "#!/bin/sh\nsleep 30\n", { mode: 0o700 });
    await writeFile(
      launcher,
      '#!/bin/sh\ncat >/dev/null\nprintf \'{"schema":1,"status":"ok","command":"test"}\\n\'\n',
      { mode: 0o700 },
    );
    await writeFile(support, "", { mode: 0o600 });
    const store = new TeamStore(root);
    const team = store.create("Stop worker", "codex");
    const agent = store.spawn(team.team_id, {
      runtime: "codex",
      role: "backend-developer",
      task: "Wait",
    });
    const child = spawn(
      process.execPath,
      ["--import", tsxLoader, workerMain, team.team_id, agent.agent_id],
      {
        cwd: root,
        stdio: "ignore",
        env: {
          HOME: process.env.HOME ?? "",
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          YUKH_TEAM_WORKSPACE: root,
          YUKH_COORDINATION_LAUNCHER: launcher,
          YUKH_COORDINATION_MCP_MAIN: support,
          YUKH_TEAM_CONTROL_MCP_MAIN: support,
          YUKH_CODEX_EXECUTABLE: executable,
          YUKH_COPILOT_EXECUTABLE: executable,
        },
      },
    );
    for (let attempt = 0; attempt < 50; attempt++) {
      if (store.agent(team.team_id, agent.agent_id).state === "running") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(store.agent(team.team_id, agent.agent_id).state, "running");
    store.stop(team.team_id);
    const exitCode = await new Promise<number | null>((resolve) => child.once("close", resolve));
    assert.equal(exitCode, 0);
    assert.equal(store.agent(team.team_id, agent.agent_id).state, "stopped");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("worker fails closed before agent launch when Coordination cannot join", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-team-coordination-deny-")));
  try {
    const marker = join(root, "agent-started");
    const executable = join(root, "agent-cli");
    const launcher = join(root, "launcher");
    const support = join(root, "support.mjs");
    await writeFile(executable, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o700 });
    await writeFile(
      launcher,
      '#!/bin/sh\ncat >/dev/null\nprintf \'{"schema":1,"status":"error","code":"YKC-AUTH-001"}\\n\'\n',
      { mode: 0o700 },
    );
    await writeFile(support, "", { mode: 0o600 });
    const store = new TeamStore(root);
    const team = store.create("Require Coordination", "codex");
    const agent = store.spawn(team.team_id, {
      runtime: "codex",
      role: "delivery-lead",
      task: "Do not start without Coordination",
    });
    const child = spawn(
      process.execPath,
      ["--import", tsxLoader, workerMain, team.team_id, agent.agent_id],
      {
        cwd: root,
        stdio: "ignore",
        env: {
          HOME: process.env.HOME ?? "",
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          YUKH_TEAM_WORKSPACE: root,
          YUKH_COORDINATION_LAUNCHER: launcher,
          YUKH_COORDINATION_MCP_MAIN: support,
          YUKH_TEAM_CONTROL_MCP_MAIN: support,
          YUKH_CODEX_EXECUTABLE: executable,
          YUKH_COPILOT_EXECUTABLE: executable,
        },
      },
    );
    assert.equal(await new Promise<number | null>((resolve) => child.once("close", resolve)), 1);
    assert.equal(store.agent(team.team_id, agent.agent_id).state, "failed");
    await assert.rejects(readFile(marker), /ENOENT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("worker retries bounded transient Coordination unavailability before launch", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-team-coordination-retry-")));
  try {
    const marker = join(root, "agent-started");
    const counter = join(root, "attempts");
    const executable = join(root, "agent-cli");
    const launcher = join(root, "launcher");
    const support = join(root, "support.mjs");
    await writeFile(executable, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o700 });
    await writeFile(
      launcher,
      `#!/bin/sh
cat >/dev/null
count=0
test ! -f ${counter} || count="$(cat ${counter})"
count=$((count + 1))
printf '%s' "$count" >${counter}
if test "$count" -lt 3; then
  printf '{"schema":1,"status":"error","code":"YKC-UNAVAILABLE-001"}\\n'
  exit 7
fi
printf '{"schema":1,"status":"ok","command":"test"}\\n'
`,
      { mode: 0o700 },
    );
    await writeFile(support, "", { mode: 0o600 });
    const store = new TeamStore(root);
    const team = store.create("Retry Coordination", "codex");
    const agent = store.spawn(team.team_id, {
      runtime: "codex",
      role: "delivery-lead",
      task: "Start after Coordination recovers",
    });
    const child = spawn(
      process.execPath,
      ["--import", tsxLoader, workerMain, team.team_id, agent.agent_id],
      {
        cwd: root,
        stdio: "ignore",
        env: {
          HOME: process.env.HOME ?? "",
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          YUKH_TEAM_WORKSPACE: root,
          YUKH_COORDINATION_LAUNCHER: launcher,
          YUKH_COORDINATION_MCP_MAIN: support,
          YUKH_TEAM_CONTROL_MCP_MAIN: support,
          YUKH_CODEX_EXECUTABLE: executable,
          YUKH_COPILOT_EXECUTABLE: executable,
        },
      },
    );
    assert.equal(await new Promise<number | null>((resolve) => child.once("close", resolve)), 0);
    assert.equal(await readFile(counter, "utf8"), "4");
    assert.equal(store.agent(team.team_id, agent.agent_id).state, "completed");
    assert.equal((await readFile(marker)).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
