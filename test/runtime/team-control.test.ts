import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { TeamStore } from "../../packages/team-control/src/store.js";
import { TeamSupervisor } from "../../packages/team-control/src/supervisor.js";
import { RuntimeOutput } from "../../packages/team-control/src/runtime-output.js";
import { assertProfileAvailable, awaitAgent } from "../../apps/team-control/src/server.js";

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
      token_budget: 100_000,
    });
    const testWorker = store.spawn(team.team_id, {
      parent_agent_id: backend.agent_id,
      runtime: "copilot",
      role: "api-tester",
      task: "Test the API",
      token_budget: 50_000,
    });
    assert.equal(testWorker.parent_agent_id, backend.agent_id);
    assert.deepEqual(backend.profile?.skills, ["api-design", "testing"]);
    assert.equal(testWorker.depth, 2);
    assert.notEqual(testWorker.coordination_agent, backend.coordination_agent);
    assert.equal(backend.coordination_participant, `agent:${backend.coordination_agent.slice(6)}`);
    assert.equal(store.status(team.team_id).agents.length, 2);
    assert.equal(store.status(team.team_id).tokens.allocated, 150_000);
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
          token_budget: 50_000,
        }),
      /team_not_active/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("team store reserves budgets and persists bounded completion usage", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-team-budget-")));
  try {
    const store = new TeamStore(root);
    const team = store.create("Bound token use", "codex", 3, 1, 100_000);
    const agent = store.spawn(team.team_id, {
      runtime: "codex",
      role: "bounded-analyst",
      task: "Return a concise result",
      token_budget: 40_000,
    });
    const exceeded = store.spawn(team.team_id, {
      runtime: "codex",
      role: "second-analyst",
      task: "Record an overrun",
      token_budget: 40_000,
    });
    assert.throws(
      () =>
        store.spawn(team.team_id, {
          runtime: "codex",
          role: "third-analyst",
          task: "Exceed the allocation",
          token_budget: 30_000,
        }),
      /team_token_budget_exceeded/u,
    );
    assert.equal(await awaitAgent(store, team.team_id, agent.agent_id, 0), undefined);
    store.transition(team.team_id, agent.agent_id, "running");
    const usage = {
      schema: 1 as const,
      source: "codex-json-v1" as const,
      input_tokens: 10_000,
      cached_input_tokens: 5_000,
      output_tokens: 1_000,
      reasoning_output_tokens: 250,
      total_tokens: 11_000,
      budget_outcome: "within" as const,
    };
    const finished = store.finish(
      team.team_id,
      agent.agent_id,
      { schema: 1, outcome: "succeeded", summary: "Evidence-based result" },
      usage,
    );
    assert.equal(finished.state, "completed");
    assert.equal(finished.completion?.summary, "Evidence-based result");
    assert.equal(store.status(team.team_id).tokens.observed, 11_000);
    assert.equal((await awaitAgent(store, team.team_id, agent.agent_id, 0))?.state, "completed");

    store.transition(team.team_id, exceeded.agent_id, "running");
    const overrunUsage = {
      ...usage,
      input_tokens: 40_000,
      cached_input_tokens: 10_000,
      output_tokens: 5_000,
      reasoning_output_tokens: 1_000,
      total_tokens: 45_000,
      budget_outcome: "exceeded" as const,
    };
    const failed = store.finish(
      team.team_id,
      exceeded.agent_id,
      { schema: 1, outcome: "token_budget_exceeded", summary: "Stopped after reported overrun" },
      overrunUsage,
    );
    assert.equal(failed.state, "failed");
    assert.equal(store.status(team.team_id).tokens.exceeded_agents, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("managed teams reserve root usage and require server-issued action receipts", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-root-manager-budget-")));
  try {
    const store = new TeamStore(root);
    const managed = store.createManaged("Improve the suite", "codex", 3, 2, 60_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Plan and verify one bounded increment",
        model: "default",
        skills: ["product", "testing"],
        instructions: "Use receipts as evidence and keep output bounded.",
      },
      task: "Engage one reviewer and wait for its completion",
      token_budget: 20_000,
      required_actions: ["agent.engage", "agent.await"],
    });
    assert.equal(managed.manager.kind, "manager");
    assert.equal(managed.manager.depth, 0);
    const started = store.receipt(
      managed.team.team_id,
      "manager.start",
      undefined,
      managed.manager.agent_id,
    );
    assert.equal(started.action, "manager.start");
    assert.equal(store.status(managed.team.team_id).tokens.allocated, 20_000);
    assert.throws(
      () =>
        store.spawn(managed.team.team_id, {
          parent_agent_id: managed.manager.agent_id,
          runtime: "codex",
          role: "oversized-worker",
          task: "Cannot consume beyond the team reservation",
          token_budget: 50_000,
        }),
      /team_token_budget_exceeded/u,
    );
    const worker = store.spawn(managed.team.team_id, {
      parent_agent_id: managed.manager.agent_id,
      runtime: "codex",
      role: "bounded-reviewer",
      task: "Review the proposal",
      token_budget: 20_000,
    });
    store.receipt(managed.team.team_id, "agent.engage", managed.manager.agent_id, worker.agent_id);
    store.transition(managed.team.team_id, managed.manager.agent_id, "running");
    const usage = {
      schema: 1 as const,
      source: "codex-json-v1" as const,
      input_tokens: 5_000,
      cached_input_tokens: 3_000,
      output_tokens: 500,
      reasoning_output_tokens: 100,
      total_tokens: 5_500,
      budget_outcome: "within" as const,
    };
    assert.throws(
      () =>
        store.finish(
          managed.team.team_id,
          managed.manager.agent_id,
          { schema: 1, outcome: "succeeded", summary: "Plausible but unverified plan" },
          usage,
        ),
      /required_action_missing/u,
    );
    store.receipt(managed.team.team_id, "agent.await", managed.manager.agent_id, worker.agent_id);
    const completed = store.finish(
      managed.team.team_id,
      managed.manager.agent_id,
      { schema: 1, outcome: "succeeded", summary: "Verified manager result" },
      usage,
    );
    assert.equal(completed.state, "completed");
    assert.equal(store.status(managed.team.team_id).tokens.observed, 5_500);
    assert.deepEqual(
      store.missingRequiredActions(managed.team.team_id, managed.manager.agent_id),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("managed team rejects a manager budget above the team budget", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-root-manager-overrun-")));
  try {
    const store = new TeamStore(root);
    assert.throws(
      () =>
        store.createManaged("Reject invalid reservation", "codex", 2, 1, 10_000, {
          role: "delivery-manager",
          profile: {
            schema: 1,
            mission: "Stay bounded",
            model: "default",
            skills: [],
            instructions: "Do not exceed the team budget.",
          },
          task: "Plan",
          token_budget: 11_000,
          required_actions: [],
        }),
      /invalid manager definition/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime output extracts Codex completion and refuses invented Copilot token usage", () => {
  const codex = new RuntimeOutput("codex");
  codex.line(
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Concise completion" },
    }),
  );
  codex.line(
    JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 10_000,
        cached_input_tokens: 4_000,
        output_tokens: 750,
        reasoning_output_tokens: 200,
      },
    }),
  );
  assert.equal(codex.summary(), "Concise completion");
  assert.deepEqual(codex.usage(10_000), {
    schema: 1,
    source: "codex-json-v1",
    input_tokens: 10_000,
    cached_input_tokens: 4_000,
    output_tokens: 750,
    reasoning_output_tokens: 200,
    total_tokens: 10_750,
    budget_outcome: "exceeded",
  });

  const copilot = new RuntimeOutput("copilot");
  copilot.line(
    JSON.stringify({
      type: "result",
      usage: { premiumRequests: 1, sessionDurationMs: 100 },
    }),
  );
  assert.equal(copilot.usage(50_000), undefined);

  const malformed = new RuntimeOutput("codex");
  malformed.line(
    JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: -1,
        cached_input_tokens: 0,
        output_tokens: 1,
        reasoning_output_tokens: 0,
      },
    }),
  );
  malformed.line(
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "x".repeat(4_097) },
    }),
  );
  assert.equal(malformed.usage(50_000), undefined);
  assert.equal(malformed.summary(), "");
});

test("legacy teams stay readable but cannot bypass explicit token allocation", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-team-legacy-budget-")));
  try {
    const store = new TeamStore(root);
    const team = store.create("Legacy state", "codex", 2, 1, 100_000);
    const agent = store.spawn(team.team_id, {
      runtime: "codex",
      role: "legacy-worker",
      task: "Existing work",
      token_budget: 20_000,
    });
    const teamPath = join(root, ".yukh", "teams", team.team_id, "team.json");
    const agentPath = join(
      root,
      ".yukh",
      "teams",
      team.team_id,
      "agents",
      `${agent.agent_id}.json`,
    );
    const legacyTeam = JSON.parse(await readFile(teamPath, "utf8")) as Record<string, unknown>;
    const legacyAgent = JSON.parse(await readFile(agentPath, "utf8")) as Record<string, unknown>;
    delete legacyTeam.token_budget;
    delete legacyAgent.token_budget;
    delete legacyAgent.coordination_participant;
    await writeFile(teamPath, `${JSON.stringify(legacyTeam)}\n`);
    await writeFile(agentPath, `${JSON.stringify(legacyAgent)}\n`);

    const status = store.status(team.team_id);
    assert.equal(status.team.token_budget, 0);
    assert.equal(status.agents[0]?.token_budget, 0);
    assert.match(status.agents[0]?.coordination_participant ?? "", /^agent:legacy-worker-/u);
    assert.throws(
      () =>
        store.spawn(team.team_id, {
          runtime: "codex",
          role: "new-worker",
          task: "Must recreate the team first",
          token_budget: 20_000,
        }),
      /team_token_budget_unavailable/u,
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
      token_budget: 100_000,
    });
    assert.throws(
      () =>
        store.spawn(team.team_id, {
          parent_agent_id: parent.agent_id,
          runtime: "copilot",
          role: "ui-worker",
          task: "Build UI",
          token_budget: 50_000,
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
      token_budget: 50_000,
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
      token_budget: 50_000,
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
      token_budget: 50_000,
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
    await writeFile(
      executable,
      `#!/bin/sh
touch ${marker}
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Ready after Coordination recovered"}}'
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":50,"output_tokens":20,"reasoning_output_tokens":5}}'
`,
      { mode: 0o700 },
    );
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
      token_budget: 50_000,
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
    assert.equal(store.agent(team.team_id, agent.agent_id).usage?.total_tokens, 120);
    assert.equal(
      store.agent(team.team_id, agent.agent_id).completion?.summary,
      "Ready after Coordination recovered",
    );
    assert.equal((await readFile(marker)).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("worker fails closed when its runtime exposes no token accounting", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-team-accounting-deny-")));
  try {
    const executable = join(root, "agent-cli");
    const launcher = join(root, "launcher");
    const support = join(root, "support.mjs");
    await writeFile(
      executable,
      `#!/bin/sh
printf '%s\n' '{"type":"result","exitCode":0,"usage":{"premiumRequests":1,"sessionDurationMs":100}}'
`,
      { mode: 0o700 },
    );
    await writeFile(
      launcher,
      '#!/bin/sh\ncat >/dev/null\nprintf \'{"schema":1,"status":"ok","command":"test"}\\n\'\n',
      { mode: 0o700 },
    );
    await writeFile(support, "", { mode: 0o600 });
    const store = new TeamStore(root);
    const team = store.create("Require exact accounting", "copilot");
    const agent = store.spawn(team.team_id, {
      runtime: "copilot",
      role: "credit-only-worker",
      task: "Do not mislabel credits as tokens",
      token_budget: 50_000,
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
    const failed = store.agent(team.team_id, agent.agent_id);
    assert.equal(failed.state, "failed");
    assert.equal(failed.completion?.outcome, "token_accounting_unavailable");
    assert.equal(failed.usage, undefined);
    assert.equal(store.status(team.team_id).tokens.unaccounted_agents, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("root manager fails closed when a required action has no receipt", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-manager-receipt-deny-")));
  try {
    const executable = join(root, "agent-cli");
    const launcher = join(root, "launcher");
    const support = join(root, "support.mjs");
    await writeFile(
      executable,
      `#!/bin/sh
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"I claim the team was inspected"}}'
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5}}'
`,
      { mode: 0o700 },
    );
    await writeFile(
      launcher,
      '#!/bin/sh\ncat >/dev/null\nprintf \'{"schema":1,"status":"ok","command":"test"}\\n\'\n',
      { mode: 0o700 },
    );
    await writeFile(support, "", { mode: 0o600 });
    const store = new TeamStore(root);
    const managed = store.createManaged("Require action evidence", "codex", 2, 1, 10_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Inspect the team through its bounded tool",
        model: "default",
        skills: [],
        instructions: "Do not substitute prose for a receipt.",
      },
      task: "Call team.status and summarize",
      token_budget: 5_000,
      required_actions: ["team.status"],
    });
    const child = spawn(
      process.execPath,
      ["--import", tsxLoader, workerMain, managed.team.team_id, managed.manager.agent_id],
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
    const failed = store.agent(managed.team.team_id, managed.manager.agent_id);
    assert.equal(failed.state, "failed");
    assert.equal(failed.completion?.outcome, "required_action_missing");
    assert.equal(failed.usage?.total_tokens, 120);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
