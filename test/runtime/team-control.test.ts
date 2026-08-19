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
import { teamRuntimeEntrypoints } from "../../packages/team-control/src/entrypoints.js";
import { parsePreflightArguments } from "../../apps/team-preflight/src/arguments.js";
import { runCodexPythonWorker } from "../../apps/team-worker/src/codex-python-runner.js";
import { runApprovedPreflight } from "../../apps/team-preflight/src/approved-run.js";
import {
  formatApprovedPlanRun,
  formatApprovedRun,
  formatEngagePreflight,
  formatTeamStatus,
} from "../../apps/team-preflight/src/format.js";
import { runApprovedPlanWithDependencies } from "../../apps/team-preflight/src/plan-execute.js";
import { runEngagePreflight } from "../../apps/team-preflight/src/preflight.js";
import { runtimeTokenFloor } from "../../apps/team-preflight/src/runtime-floor.js";
import { buildWorkerPrompt, isMicroWorker } from "../../apps/team-worker/src/prompt.js";
import { runCopilotSdkWorker } from "../../apps/team-worker/src/copilot-sdk-runner.js";
import {
  copilotModelCatalogFromDiscoveries,
  parseCodexModelCatalog,
  parseCopilotConfigModels,
  parseCopilotSdkModels,
  runtimeModelCatalog,
  runtimeModelCatalogAsync,
  runtimeModels,
  runtimeModelsAsync,
} from "../../packages/team-control/src/model-discovery.js";
import {
  assertProfileAvailable,
  awaitAgent,
  costSafeDeterministicPlan,
  dynamicExecutionEnabled,
  executePlan,
  readTeamStatus,
  roleProfilePolicy,
} from "../../apps/team-control/src/server.js";

test("real dynamic execution can fail closed without changing deterministic helpers", () => {
  assert.equal(dynamicExecutionEnabled({ dynamicExecution: false }), false);
  assert.equal(dynamicExecutionEnabled({ dynamicExecution: true }), true);
  assert.equal(dynamicExecutionEnabled({}), true);
});

test("only zero-command tool-free deterministic plans satisfy the default cost profile", () => {
  const safe = structuredClone(planDocument());
  const record = { document: safe } as unknown as Parameters<typeof costSafeDeterministicPlan>[0];
  safe.workers[0]!.max_commands = 0;
  assert.equal(costSafeDeterministicPlan(record), true);
  safe.workers[0]!.max_commands = 1;
  assert.equal(costSafeDeterministicPlan(record), false);
  safe.workers[0]!.max_commands = 0;
  (safe.workers[0] as { tool_mode: string }).tool_mode = "coordination";
  assert.equal(costSafeDeterministicPlan(record), false);
});

test("suite qualification preset defines the official read-only reviewer profile", () => {
  const args = parsePreflightArguments(["--preset", "suite-qualification"], {
    defaultFormat: "text",
    defaultWorkspace: "/tmp",
  });
  assert.equal(args.role, "suite-qualification-reviewer");
  assert.equal(args.workProfile, "review");
  assert.equal(args.preferredRuntime, "codex");
  assert.equal(args.teamBudget, 260_000);
  assert.equal(args.managerBudget, 180_000);
  assert.equal(args.format, "text");
  assert.match(args.goal, /Review Yukh suite readiness/u);
  assert.match(args.goal, /Do not modify repositories/u);
});

test("suite readonly verifier preset allows bounded read-only inspection", () => {
  const args = parsePreflightArguments(["--preset", "suite-readonly-verifier"], {
    defaultFormat: "text",
    defaultWorkspace: "/tmp",
  });
  assert.equal(args.role, "suite-readonly-verifier");
  assert.equal(args.workProfile, "readonly");
  assert.equal(args.preferredRuntime, "codex");
  assert.equal(args.teamBudget, 340_000);
  assert.equal(args.managerBudget, 180_000);
  assert.equal(args.format, "text");
  assert.match(args.goal, /one compact read-only probe/u);
  assert.match(args.goal, /Do not modify files/u);
  assert.doesNotMatch(args.goal, /250 lines/u);
});

test("micro documentation edit preset uses a narrow worker profile", () => {
  const args = parsePreflightArguments(["--preset", "micro-doc-edit"], {
    defaultFormat: "text",
    defaultWorkspace: "/tmp",
  });
  assert.equal(args.role, "documentation-developer");
  assert.equal(args.workProfile, "implementation");
  assert.equal(args.preferredRuntime, "codex");
  assert.equal(args.teamBudget, 80_000);
  assert.equal(args.managerBudget, 20_000);
  assert.equal(args.workerBudget, 35_000);
  assert.equal(args.workerMaxCommands, 1);
  assert.equal(args.workerTimeoutMs, 120_000);
  assert.match(args.goal, /one small documentation edit/u);
  assert.match(args.goal, /one explicitly named file/u);
  assert.match(args.goal, /at most one focused validation command/u);
});

test("micro code edit preset requires a narrow code path and one validation command", () => {
  const args = parsePreflightArguments(["--preset", "micro-code-edit"], {
    defaultFormat: "text",
    defaultWorkspace: "/tmp",
  });
  assert.equal(args.role, "backend-developer");
  assert.equal(args.workProfile, "implementation");
  assert.equal(args.preferredRuntime, "codex");
  assert.equal(args.teamBudget, 90_000);
  assert.equal(args.managerBudget, 20_000);
  assert.equal(args.workerBudget, 45_000);
  assert.equal(args.workerMaxCommands, 1);
  assert.equal(args.workerTimeoutMs, 180_000);
  assert.match(args.goal, /one small code edit/u);
  assert.match(args.goal, /explicitly named files/u);
  assert.match(args.goal, /exactly one focused validation command/u);
  assert.match(args.goal, /Do not read broad repository context/u);
});

test("preflight rejects invalid role arguments with a focused error", () => {
  for (const role of [
    "Backend Developer",
    "-backend-developer",
    "backend_developer",
    "a".repeat(33),
  ]) {
    assert.throws(
      () => parsePreflightArguments(["--role", role]),
      (error: unknown) => error instanceof TypeError && error.message === "invalid role argument",
    );
  }
});

const usage = {
  schema: 1 as const,
  source: "codex-json-v1" as const,
  input_tokens: 100,
  cached_input_tokens: 20,
  output_tokens: 20,
  reasoning_output_tokens: 5,
  total_tokens: 120,
  budget_outcome: "within" as const,
};

const planDocument = (workerBudget = 2_000, synthesisBudget = 2_000) => ({
  schema: 1,
  workers: [
    {
      runtime: "codex",
      role: "backend-developer",
      mission: "Implement the bounded backend increment",
      model: "default",
      skills: [],
      instructions: "Inspect only relevant files, implement and test the requested increment.",
      task: "Implement and verify the backend increment.",
      context_paths: [],
      tool_mode: "none" as const,
      max_commands: 4,
      timeout_ms: 60_000,
      token_budget: workerBudget,
    },
  ],
  synthesis: {
    runtime: "codex",
    role: "delivery-synthesizer",
    mission: "Produce the final evidence-based delivery summary",
    model: "default",
    skills: [],
    instructions: "Use only supplied verified completion artifacts and remain concise.",
    task: "Synthesize outcome, remaining gaps and the next action.",
    context_paths: [],
    tool_mode: "none" as const,
    max_commands: 0,
    timeout_ms: 60_000,
    token_budget: synthesisBudget,
  },
});

const workerMain = fileURLToPath(new URL("../../apps/team-worker/src/main.ts", import.meta.url));
const tsxLoader = fileURLToPath(import.meta.resolve("tsx"));

test("team runtime entrypoints are resolved centrally for source execution", () => {
  assert.deepEqual(teamRuntimeEntrypoints(), {
    worker: fileURLToPath(new URL("../../apps/team-worker/src/main.ts", import.meta.url)),
    coordinationMcp: fileURLToPath(
      new URL("../../apps/coordination-preview/src/main.ts", import.meta.url),
    ),
    teamControlMcp: fileURLToPath(new URL("../../apps/team-control/src/main.ts", import.meta.url)),
  });
});

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

test("role profile policy maps specialists to allowlisted runtime models skills and budgets", () => {
  const options = {
    models: {
      codex: new Set(["default", "gpt-5.6-sol"]),
      copilot: new Set(["default", "claude-sonnet-5"]),
    },
    skills: {
      codex: new Set(["api-design", "testing", "product"]),
      copilot: new Set(["frontend"]),
    },
  };
  assert.deepEqual(
    roleProfilePolicy(options, "frontend-developer", "implementation").recommendation,
    {
      runtime: "copilot",
      model: "default",
      skills: ["frontend"],
      token_budget: 80_000,
      tool_mode: "none",
      max_commands: 8,
      runtime_timeout_ms: 300_000,
    },
  );
  assert.deepEqual(roleProfilePolicy(options, "backend-developer", "review").recommendation, {
    runtime: "codex",
    model: "default",
    skills: ["api-design", "testing"],
    token_budget: 18_000,
    tool_mode: "none",
    max_commands: 0,
    runtime_timeout_ms: 60_000,
  });
  assert.deepEqual(
    roleProfilePolicy(options, "suite-readonly-verifier", "readonly").recommendation,
    {
      runtime: "codex",
      model: "default",
      skills: ["testing"],
      token_budget: 90_000,
      tool_mode: "none",
      max_commands: 1,
      runtime_timeout_ms: 120_000,
    },
  );
  assert.deepEqual(roleProfilePolicy(options, "security-reviewer", "review").omitted_skills, [
    "security",
  ]);
});

test("micro documentation edit preflight overrides implementation bounds", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-micro-doc-edit-")));
  try {
    const args = parsePreflightArguments(["--preset", "micro-doc-edit"], {
      defaultWorkspace: root,
    });
    const output = runEngagePreflight(args);
    assert.equal(output.policy.work_profile, "implementation");
    assert.equal(output.policy.recommendation.runtime, "codex");
    assert.deepEqual(output.policy.recommendation.skills, ["documentation"]);
    assert.equal(output.policy.recommendation.token_budget, 35_000);
    assert.equal(output.policy.recommendation.tool_mode, "none");
    assert.equal(output.policy.recommendation.max_commands, 1);
    assert.equal(output.policy.recommendation.runtime_timeout_ms, 120_000);
    assert.equal(output.planned_worker.token_budget, 35_000);
    assert.equal(output.planned_worker.max_commands, 1);
    assert.equal(output.planned_worker.timeout_ms, 120_000);
    assert.equal(output.runtime_token_floor?.minimum_token_budget, 120_000);
    assert.equal(output.provider_launchable, false);
    assert.match(output.next_real_action, /SDK\/lean worker runtime/u);
    assert.equal(output.provider_runtime_launched, false);
    assert.equal(output.budget.allocated, 55_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("micro code edit preflight keeps implementation bounded to one command", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-micro-code-edit-")));
  try {
    const args = parsePreflightArguments(["--preset", "micro-code-edit"], {
      defaultWorkspace: root,
    });
    const output = runEngagePreflight(args);
    assert.equal(output.policy.work_profile, "implementation");
    assert.equal(output.policy.recommendation.runtime, "codex");
    assert.deepEqual(output.policy.recommendation.skills, ["api-design", "testing"]);
    assert.equal(output.policy.recommendation.token_budget, 45_000);
    assert.equal(output.policy.recommendation.tool_mode, "none");
    assert.equal(output.policy.recommendation.max_commands, 1);
    assert.equal(output.policy.recommendation.runtime_timeout_ms, 180_000);
    assert.equal(output.planned_worker.token_budget, 45_000);
    assert.equal(output.planned_worker.max_commands, 1);
    assert.equal(output.planned_worker.timeout_ms, 180_000);
    assert.equal(output.runtime_token_floor?.minimum_token_budget, 120_000);
    assert.equal(output.provider_launchable, false);
    assert.match(output.next_real_action, /SDK\/lean worker runtime/u);
    assert.equal(output.provider_runtime_launched, false);
    assert.equal(output.budget.allocated, 65_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("micro workers receive compact prompts without orchestration noise", () => {
  const agent = {
    schema: 1,
    agent_id: "worker-00000000-0000-4000-8000-000000000001",
    kind: "worker",
    coordination_agent: "agent-backend-developer-00000000-0000-4000-8000-000000000001",
    coordination_participant: "agent:backend-developer-00000000-0000-4000-8000-000000000001",
    team_id: "team-00000000-0000-4000-8000-000000000001",
    runtime: "codex",
    role: "backend-developer",
    profile: {
      schema: 1,
      mission: "Implement a tiny code edit",
      model: "default",
      skills: ["api-design", "testing"],
      instructions:
        "Long profile instructions that are useful for a normal agent but wasteful for one-command micro work.",
    },
    task: "Edit apps/team-worker/src/prompt.ts and run one focused test.",
    depth: 1,
    can_spawn: false,
    token_budget: 45_000,
    required_actions: [],
    model_tool_mode: "none",
    max_commands: 1,
    timeout_ms: 180_000,
    state: "defined",
  } as const;
  const prompt = buildWorkerPrompt({
    agent,
    modelToolMode: "none",
    requiredActions: "none",
    modelUsesCoordination: false,
    modelUsesTeamControl: false,
    modelTeamTools: [],
    coordinationInstruction: "",
    teamControlInstruction: "Required receipt-backed actions before success: agent.engage.",
    delegationInstruction: "When engaging a child, use the returned coordination_participant.",
    planConstraintInstruction: "Plan constraints: use only allowlisted models.",
  });
  assert.equal(isMicroWorker(agent), true);
  assert.equal(isMicroWorker({ ...agent, max_commands: 2 }), false);
  assert.ok(prompt.length < 900);
  assert.match(prompt, /Task: Edit apps\/team-worker\/src\/prompt\.ts/u);
  assert.match(prompt, /No context pack was supplied/u);
  assert.doesNotMatch(prompt, /Long profile instructions/u);
  assert.doesNotMatch(prompt, /Required receipt-backed actions/u);
  assert.doesNotMatch(prompt, /Plan constraints/u);
  assert.doesNotMatch(prompt, /coordination_participant/u);
});

test("approved run formatter exposes terminal cached and uncached token usage", () => {
  const text = formatApprovedRun({
    schema: 1,
    status: "ok",
    command: "team run-approved",
    approval_digest: "sha-256:1111111111111111111111111111111111111111111111111111111111111111",
    provider_runtime_launched: true,
    launched_worker: "worker-00000000-0000-4000-8000-000000000001",
    receipt: {
      schema: 1,
      receipt_id: "receipt-00000000-0000-4000-8000-000000000001",
      team_id: "team-00000000-0000-4000-8000-000000000001",
      action: "agent.engage",
      actor_agent_id: "worker-00000000-0000-4000-8000-000000000000",
      subject_agent_id: "worker-00000000-0000-4000-8000-000000000001",
      outcome: "succeeded",
    },
    runtime: { pid: 123, log: "/tmp/worker.log" },
    terminal_agent: {
      schema: 1,
      agent_id: "worker-00000000-0000-4000-8000-000000000001",
      kind: "worker",
      coordination_agent: "agent-backend-developer-00000000-0000-4000-8000-000000000001",
      coordination_participant: "agent:backend-developer-00000000-0000-4000-8000-000000000001",
      team_id: "team-00000000-0000-4000-8000-000000000001",
      runtime: "codex",
      role: "backend-developer",
      task: "Probe token accounting.",
      depth: 1,
      can_spawn: false,
      token_budget: 45_000,
      required_actions: [],
      state: "failed",
      usage: {
        schema: 1,
        source: "codex-json-v1",
        input_tokens: 114_867,
        cached_input_tokens: 89_600,
        output_tokens: 1_846,
        reasoning_output_tokens: 1_259,
        total_tokens: 116_713,
        budget_outcome: "exceeded",
      },
    },
    tokens: {
      budget: 90_000,
      allocated: 65_000,
      observed: 116_713,
      remaining: 0,
      pending_agents: 1,
      unaccounted_agents: 0,
      exceeded_agents: 1,
    },
  } as Parameters<typeof formatApprovedRun>[0]);
  assert.match(text, /terminal cached input: 89600/u);
  assert.match(text, /terminal uncached input: 25267/u);
  assert.match(text, /terminal output: 1846/u);
  assert.match(text, /Terminal worker state: failed/u);
});

test("team status formatter exposes stop and token state without raw JSON", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-team-status-text-")));
  try {
    const store = new TeamStore(root);
    const { team, manager } = store.createManaged("Inspect team status", "codex", 2, 1, 160_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Inspect local team state",
        model: "default",
        skills: ["testing"],
        instructions: "Read compact team state and stop when requested.",
      },
      task: "Manage the local team.",
      token_budget: 40_000,
      required_actions: ["team.status"],
    });
    store.spawn(team.team_id, {
      parent_agent_id: manager.agent_id,
      runtime: "codex",
      role: "suite-readonly-verifier",
      task: "Probe the suite.",
      token_budget: 90_000,
      model_tool_mode: "none",
      max_commands: 1,
      timeout_ms: 120_000,
    });
    store.stop(team.team_id);
    const text = formatTeamStatus(store.status(team.team_id));
    assert.match(text, /Yukh team status/u);
    assert.match(text, /State: stopped/u);
    assert.match(text, /allocated: 130000/u);
    assert.match(text, /suite-readonly-verifier/u);
    assert.doesNotMatch(text, /"agents"/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("engage preflight composes a worker without launching a provider runtime", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-engage-preflight-")));
  try {
    const output = runEngagePreflight({
      workspace: root,
      goal: "Preflight frontend worker",
      role: "frontend-developer",
      workProfile: "implementation",
      preferredRuntime: "copilot",
      teamBudget: 260_000,
      managerBudget: 180_000,
      codexModels: ["default"],
      copilotModels: ["default", "claude-sonnet-5"],
      codexSkills: ["api-design", "testing"],
      copilotSkills: ["frontend", "testing"],
    });
    assert.equal(output.status, "ok");
    assert.equal(output.provider_runtime_launched, false);
    assert.equal(output.provider_launchable, true);
    assert.equal(output.provider_tokens_observed, 0);
    assert.equal(output.policy.recommendation.runtime, "copilot");
    assert.equal(output.policy.recommendation.model, "default");
    assert.deepEqual(output.policy.recommendation.skills, ["frontend"]);
    assert.equal(output.planned_worker.state, "defined");
    assert.equal(output.planned_worker.task, "Preflight frontend worker");
    assert.equal(output.planned_worker.profile?.mission, "Preflight frontend worker");
    assert.equal(output.planned_worker.parent_agent_id, output.manager.agent_id);
    assert.equal(output.planned_worker.model_tool_mode, "none");
    assert.equal(output.budget.allocated, 260_000);
    assert.equal(output.budget.observed, 0);
    assert.equal(output.budget.pending_agents, 2);
    assert.equal(output.runtime_token_floor, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("engage preflight text output shows approval and budget without raw JSON noise", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-engage-preflight-text-")));
  try {
    const output = runEngagePreflight({
      workspace: root,
      goal: "Preflight backend worker",
      role: "backend-reviewer",
      workProfile: "review",
      preferredRuntime: "codex",
      teamBudget: 220_000,
      managerBudget: 180_000,
      codexModels: ["default"],
      copilotModels: ["default"],
      codexSkills: ["api-design", "testing"],
      copilotSkills: ["frontend"],
    });
    const text = formatEngagePreflight(output);
    assert.match(text, /Yukh team preflight/u);
    assert.match(text, new RegExp(output.approval_digest, "u"));
    assert.match(text, /runtime: codex/u);
    assert.match(text, /task: Preflight backend worker/u);
    assert.match(text, /observed provider tokens: 0/u);
    assert.match(text, /runtime token floor: 120000/u);
    assert.match(text, /cached input floor near 90k/u);
    assert.match(text, /provider launchable: no/u);
    assert.match(text, /Next action: Do not launch/u);
    assert.doesNotMatch(text, /Run after approval/u);
    assert.doesNotMatch(text, /"planned_worker"/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approved preflight launches exactly the planned worker after digest approval", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-approved-run-")));
  try {
    const executable = join(root, "agent-cli");
    const launcher = join(root, "launcher");
    const support = join(root, "support.mjs");
    const preflightPath = join(root, "preflight.json");
    await writeFile(
      executable,
      `#!/bin/sh
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"approved worker ran"}}'
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
    const preflight = runEngagePreflight({
      workspace: root,
      goal: "Preflight backend worker",
      role: "backend-reviewer",
      workProfile: "review",
      preferredRuntime: "codex",
      teamBudget: 320_000,
      managerBudget: 180_000,
      workerBudget: 120_000,
      codexModels: ["default"],
      copilotModels: ["default"],
      codexSkills: ["api-design", "testing"],
      copilotSkills: ["frontend"],
    });
    await writeFile(preflightPath, `${JSON.stringify(preflight)}\n`, { mode: 0o600 });
    const output = await runApprovedPreflight({
      preflightPath,
      approvedDigest: preflight.approval_digest,
      launcher,
      codex: executable,
      copilot: executable,
      waitMs: 0,
      codexModels: "default",
      copilotModels: "default",
      codexSkills: "api-design,testing",
      copilotSkills: "frontend",
    });
    assert.equal(output.status, "ok");
    assert.equal(output.provider_runtime_launched, true);
    assert.equal(output.launched_worker, preflight.planned_worker.agent_id);
    assert.equal(output.receipt.action, "agent.engage");
    assert.equal(output.receipt.actor_agent_id, preflight.manager.agent_id);
    assert.equal(output.receipt.subject_agent_id, preflight.planned_worker.agent_id);
    assert.equal(output.terminal_agent, undefined);
    assert.equal(output.tokens.observed, 0);
    assert.equal(output.tokens.unaccounted_agents, 0);
    const text = formatApprovedRun(output);
    assert.match(text, /Yukh approved run/u);
    assert.match(text, /Provider launched: yes/u);
    assert.match(text, /Terminal worker state: not waited/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approved preflight forwards preview runtime to launched worker wrapper", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-approved-preview-runtime-")));
  try {
    const observedRuntime = join(root, "observed-preview-runtime.txt");
    const worker = join(root, "worker.mjs");
    const executable = join(root, "agent-cli");
    const mcp = join(root, "coordination.mjs");
    const teamControlMcp = join(root, "team-control.mjs");
    const previewRuntime = join(root, "preview-runtime");
    await writeFile(
      worker,
      `import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(observedRuntime)}, process.env.YUKH_PREVIEW_RUNTIME ?? "");`,
    );
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await writeFile(mcp, "", { mode: 0o600 });
    await writeFile(teamControlMcp, "", { mode: 0o600 });
    const store = new TeamStore(root);
    const team = store.create("Launch worker", "codex");
    const agent = store.spawn(team.team_id, {
      runtime: "codex",
      role: "backend-reviewer",
      task: "Review backend",
      token_budget: 120_000,
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
      profileEnvironment: { YUKH_PREVIEW_RUNTIME: previewRuntime },
    });
    supervisor.launch(agent);
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        if ((await readFile(observedRuntime, "utf8")) === previewRuntime) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(await readFile(observedRuntime, "utf8"), previewRuntime);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approved preflight blocks micro workers before provider launch without explicit opt-in", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-approved-micro-block-")));
  try {
    const preflightPath = join(root, "preflight.json");
    const preflight = runEngagePreflight({
      workspace: root,
      goal: "Edit one named file and run one focused test",
      role: "backend-developer",
      workProfile: "implementation",
      preferredRuntime: "codex",
      teamBudget: 90_000,
      managerBudget: 20_000,
      workerBudget: 45_000,
      workerMaxCommands: 1,
      workerTimeoutMs: 180_000,
      codexModels: ["default"],
      copilotModels: ["default"],
      codexSkills: ["api-design", "testing"],
      copilotSkills: ["frontend"],
    });
    await writeFile(preflightPath, `${JSON.stringify(preflight)}\n`, { mode: 0o600 });
    await assert.rejects(
      () =>
        runApprovedPreflight({
          preflightPath,
          approvedDigest: preflight.approval_digest,
          launcher: process.execPath,
          codex: process.execPath,
          copilot: process.execPath,
          waitMs: 0,
        }),
      /micro_worker_launch_requires_explicit_allow/u,
    );
    const store = new TeamStore(root);
    const worker = store.agent(preflight.team.team_id, preflight.planned_worker.agent_id);
    assert.equal(worker.state, "defined");
    assert.equal(store.status(preflight.team.team_id).tokens.observed, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approved preflight blocks measured Codex CLI token floors before provider launch", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-approved-runtime-floor-")));
  try {
    const preflightPath = join(root, "preflight.json");
    const preflight = runEngagePreflight({
      workspace: root,
      goal: "Edit one named file and run one focused test",
      role: "backend-developer",
      workProfile: "implementation",
      preferredRuntime: "codex",
      teamBudget: 90_000,
      managerBudget: 20_000,
      workerBudget: 45_000,
      workerMaxCommands: 1,
      workerTimeoutMs: 180_000,
      codexModels: ["default"],
      copilotModels: ["default"],
      codexSkills: ["api-design", "testing"],
      copilotSkills: ["frontend"],
    });
    await writeFile(preflightPath, `${JSON.stringify(preflight)}\n`, { mode: 0o600 });
    await assert.rejects(
      () =>
        runApprovedPreflight({
          preflightPath,
          approvedDigest: preflight.approval_digest,
          launcher: process.execPath,
          codex: process.execPath,
          copilot: process.execPath,
          allowMicroLaunch: true,
          waitMs: 0,
        }),
      /worker_token_budget_below_runtime_floor/u,
    );
    const store = new TeamStore(root);
    const worker = store.agent(preflight.team.team_id, preflight.planned_worker.agent_id);
    assert.equal(worker.state, "defined");
    assert.equal(store.status(preflight.team.team_id).tokens.observed, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex Python app-server opt-in uses the qualified lower token floor", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-codex-python-floor-")));
  const previous = process.env.YUKH_CODEX_WORKER_PROVIDER;
  try {
    const preflight = runEngagePreflight({
      workspace: root,
      goal: "Review one bounded context pack",
      role: "backend-reviewer",
      workProfile: "review",
      preferredRuntime: "codex",
      teamBudget: 90_000,
      managerBudget: 20_000,
      workerBudget: 45_000,
      workerMaxCommands: 1,
      workerTimeoutMs: 180_000,
      codexModels: ["default"],
      copilotModels: ["default"],
      codexSkills: ["api-design", "testing"],
      copilotSkills: ["frontend"],
    });
    assert.equal(runtimeTokenFloor(preflight.planned_worker)?.provider, "cli");
    assert.equal(runtimeTokenFloor(preflight.planned_worker)?.minimum_token_budget, 120_000);

    process.env.YUKH_CODEX_WORKER_PROVIDER = "python-app-server";
    const floor = runtimeTokenFloor(preflight.planned_worker);
    assert.equal(floor?.provider, "python-app-server");
    assert.equal(floor?.minimum_token_budget, 18_000);
    assert.equal(floor?.measured_total_tokens, 10_830);
    assert.match(floor?.reason ?? "", /real Yukh prompt/u);
  } finally {
    if (previous === undefined) delete process.env.YUKH_CODEX_WORKER_PROVIDER;
    else process.env.YUKH_CODEX_WORKER_PROVIDER = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime model discovery parses CLI catalogs and keeps explicit env authoritative", () => {
  assert.deepEqual(
    parseCodexModelCatalog(
      'warning\n{"models":[{"slug":"gpt-5.6-sol"},{"slug":"bad value"},{"slug":"gpt-5.6-terra"}]}\n',
    ),
    ["gpt-5.6-sol", "gpt-5.6-terra"],
  );
  assert.deepEqual(
    parseCopilotConfigModels(`
  \`model\`: AI model to use for Copilot CLI.
    - "claude-sonnet-5"
    - "gpt-5.6-sol"

  \`contextTier\`: context window tier
`),
    ["claude-sonnet-5", "gpt-5.6-sol"],
  );
  assert.deepEqual(
    runtimeModels("default,approved-model", ["fallback"], () => ["ignored"]),
    ["default", "approved-model"],
  );
  assert.deepEqual(
    runtimeModelCatalog("default,approved-model", ["fallback"], () => ["ignored"]),
    { models: ["default", "approved-model"], source: "env" },
  );
  assert.deepEqual(
    runtimeModels(undefined, ["fallback-model"], () => {
      throw new Error("missing cli");
    }),
    ["default", "fallback-model"],
  );
});

test("runtime model discovery accepts Copilot SDK model metadata", () => {
  assert.deepEqual(
    parseCopilotSdkModels([
      {
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        capabilities: {},
      },
      {
        id: "bad value",
        name: "Rejected",
        capabilities: {},
      },
      {
        id: "gpt-5.6-sol",
        name: "GPT 5.6 Sol",
        capabilities: {},
      },
      {
        id: "claude-sonnet-5",
        name: "Duplicate",
        capabilities: {},
      },
    ]),
    ["claude-sonnet-5", "gpt-5.6-sol"],
  );
});

test("async runtime model discovery keeps env authoritative and falls back safely", async () => {
  assert.deepEqual(
    await runtimeModelsAsync("default,approved-model", ["fallback"], async () => {
      throw new Error("must not discover");
    }),
    ["default", "approved-model"],
  );
  assert.deepEqual(
    await runtimeModelCatalogAsync("default,approved-model", ["fallback"], async () => {
      throw new Error("must not discover");
    }),
    { models: ["default", "approved-model"], source: "env" },
  );
  assert.deepEqual(
    await runtimeModelsAsync(undefined, ["fallback-model"], async () => {
      throw new Error("sdk unavailable");
    }),
    ["default", "fallback-model"],
  );
  assert.deepEqual(
    await runtimeModelsAsync(undefined, ["fallback-model"], async () => [
      "claude-sonnet-5",
      "bad value",
    ]),
    ["default", "claude-sonnet-5"],
  );
  assert.deepEqual(
    await runtimeModelCatalogAsync(undefined, ["fallback-model"], async () => [
      "claude-sonnet-5",
      "bad value",
    ]),
    { models: ["default", "claude-sonnet-5"], source: "sdk" },
  );
});

test("Copilot model catalog reports the actual discovery source", async () => {
  assert.deepEqual(
    await copilotModelCatalogFromDiscoveries(
      "default,approved-model",
      ["fallback-model"],
      async () => {
        throw new Error("must not discover sdk");
      },
      () => {
        throw new Error("must not discover cli");
      },
    ),
    { models: ["default", "approved-model"], source: "env" },
  );
  assert.deepEqual(
    await copilotModelCatalogFromDiscoveries(
      undefined,
      ["fallback-model"],
      async () => ["gpt-5.6-sol"],
      () => ["claude-sonnet-5"],
    ),
    { models: ["default", "gpt-5.6-sol"], source: "sdk" },
  );
  assert.deepEqual(
    await copilotModelCatalogFromDiscoveries(
      undefined,
      ["fallback-model"],
      async () => {
        throw new Error("sdk unavailable");
      },
      () => ["claude-sonnet-5"],
    ),
    { models: ["default", "claude-sonnet-5"], source: "cli" },
  );
  assert.deepEqual(
    await copilotModelCatalogFromDiscoveries(
      undefined,
      ["fallback-model"],
      async () => [],
      () => {
        throw new Error("cli unavailable");
      },
    ),
    { models: ["default", "fallback-model"], source: "fallback" },
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

test("managed teams can require a role policy receipt before completion", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-policy-receipt-")));
  try {
    const store = new TeamStore(root);
    const managed = store.createManaged("Choose a bounded frontend worker", "codex", 2, 1, 50_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Inspect policy before engaging specialists",
        model: "default",
        skills: [],
        instructions: "Use policy.profile before claiming completion.",
      },
      task: "Resolve a worker profile",
      token_budget: 20_000,
      required_actions: ["policy.profile"],
    });
    store.transition(managed.team.team_id, managed.manager.agent_id, "running");
    assert.throws(
      () =>
        store.finish(
          managed.team.team_id,
          managed.manager.agent_id,
          { schema: 1, outcome: "succeeded", summary: "Skipped policy lookup" },
          usage,
        ),
      /required_action_missing/u,
    );
    store.receipt(
      managed.team.team_id,
      "policy.profile",
      managed.manager.agent_id,
      managed.manager.agent_id,
    );
    const completed = store.finish(
      managed.team.team_id,
      managed.manager.agent_id,
      { schema: 1, outcome: "succeeded", summary: "Policy checked" },
      usage,
    );
    assert.equal(completed.state, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("context packs retain only bounded verified regular-file content", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-context-pack-")));
  try {
    await writeFile(join(root, "bounded.ts"), "export const bounded = true;\n");
    const store = new TeamStore(root);
    const team = store.create("Prepare bounded context", "codex", 2, 1, 50_000);
    const agent = store.spawn(team.team_id, {
      runtime: "codex",
      role: "context-reviewer",
      task: "Review supplied context only",
      token_budget: 20_000,
      model_tool_mode: "none",
      max_commands: 0,
      timeout_ms: 60_000,
      context_paths: ["bounded.ts"],
    });
    assert.deepEqual(agent.context_pack?.paths, ["bounded.ts"]);
    assert.match(agent.context_pack?.digest ?? "", /^sha-256:[0-9a-f]{64}$/u);
    assert.deepEqual(store.contextPack(team.team_id, agent.agent_id)?.files, [
      { path: "bounded.ts", content: "export const bounded = true;\n" },
    ]);
    assert.throws(
      () =>
        store.spawn(team.team_id, {
          runtime: "codex",
          role: "invalid-context",
          task: "Reject traversal",
          token_budget: 20_000,
          model_tool_mode: "none",
          max_commands: 0,
          timeout_ms: 60_000,
          context_paths: ["../secret"],
        }),
      /invalid agent context paths/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("structured planning contract rejects model-facing manager actions", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-plan-tools-denied-")));
  try {
    const store = new TeamStore(root);
    assert.throws(
      () =>
        store.createManaged("Plan without tool loops", "codex", 3, 1, 10_000, {
          role: "delivery-manager",
          profile: {
            schema: 1,
            mission: "Return one structured plan",
            model: "default",
            skills: [],
            instructions: "Do not invoke operational tools.",
          },
          task: "Plan",
          token_budget: 2_000,
          required_actions: ["team.status"],
          output_contract: "team-plan-v1",
        }),
      /invalid manager definition/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plan token preflight reports deterministic boundaries before worker creation", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-plan-token-preflight-")));
  try {
    const store = new TeamStore(root);
    const managed = store.createManaged("Preflight exact budget", "codex", 3, 1, 90_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Return one structured plan",
        model: "default",
        skills: [],
        instructions: "Declare exact token allocations.",
      },
      task: "Plan",
      token_budget: 1_000,
      required_actions: [],
      output_contract: "team-plan-v1",
    });
    const accepted = store.proposePlan(
      managed.team.team_id,
      managed.manager.agent_id,
      JSON.stringify(planDocument(86_999, 2_000)),
    );
    const acceptedPreflight = store.planTokenBudgetPreflight(
      managed.team.team_id,
      accepted.plan_id,
    );
    assert.deepEqual(
      acceptedPreflight.allocations.map((allocation) => [
        allocation.kind,
        allocation.role,
        allocation.token_budget,
      ]),
      [
        ["existing", "delivery-manager", 1_000],
        ["worker", "backend-developer", 86_999],
        ["synthesis", "delivery-synthesizer", 2_000],
      ],
    );
    assert.equal(acceptedPreflight.total_allocated, 89_999);
    assert.equal(acceptedPreflight.remaining_headroom, 1);
    assert.equal(acceptedPreflight.outcome, "accepted");

    const exact = store.createManaged("Preflight exact ceiling", "codex", 3, 1, 90_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Return one structured plan",
        model: "default",
        skills: [],
        instructions: "Declare exact token allocations.",
      },
      task: "Plan",
      token_budget: 1_000,
      required_actions: [],
      output_contract: "team-plan-v1",
    });
    const exactPlan = store.proposePlan(
      exact.team.team_id,
      exact.manager.agent_id,
      JSON.stringify(planDocument(87_000, 2_000)),
    );
    assert.equal(
      store.planTokenBudgetPreflight(exact.team.team_id, exactPlan.plan_id).outcome,
      "accepted",
    );
    assert.equal(
      store.planTokenBudgetPreflight(exact.team.team_id, exactPlan.plan_id).remaining_headroom,
      0,
    );

    const exceeded = store.createManaged("Preflight over ceiling", "codex", 3, 1, 90_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Return one structured plan",
        model: "default",
        skills: [],
        instructions: "Declare exact token allocations.",
      },
      task: "Plan",
      token_budget: 1_000,
      required_actions: [],
      output_contract: "team-plan-v1",
    });
    const exceededPlan = store.proposePlan(
      exceeded.team.team_id,
      exceeded.manager.agent_id,
      JSON.stringify(planDocument(87_001, 2_000)),
    );
    const exceededPreflight = store.planTokenBudgetPreflight(
      exceeded.team.team_id,
      exceededPlan.plan_id,
    );
    assert.equal(exceededPreflight.total_allocated, 90_001);
    assert.equal(exceededPreflight.remaining_headroom, 0);
    assert.equal(exceededPreflight.outcome, "exceeded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plan execution blocks over-budget proposals before creating workers", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-plan-token-block-")));
  try {
    const store = new TeamStore(root);
    const managed = store.createManaged("Block expensive plan", "codex", 3, 1, 90_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Return one structured plan",
        model: "default",
        skills: [],
        instructions: "Declare exact token allocations.",
      },
      task: "Plan",
      token_budget: 1_000,
      required_actions: [],
      output_contract: "team-plan-v1",
    });
    const plan = store.proposePlan(
      managed.team.team_id,
      managed.manager.agent_id,
      JSON.stringify(planDocument(87_001, 2_000)),
    );
    store.transition(managed.team.team_id, managed.manager.agent_id, "running");
    store.finish(
      managed.team.team_id,
      managed.manager.agent_id,
      { schema: 1, outcome: "succeeded", summary: "Approved plan", plan_id: plan.plan_id },
      usage,
    );
    let launches = 0;
    await assert.rejects(
      () =>
        executePlan(
          store,
          {
            launch: () => {
              launches += 1;
              return { pid: 1, log: "unused" };
            },
          },
          { models: { codex: new Set(["default"]), copilot: new Set(["default"]) } },
          managed.team.team_id,
          plan.plan_id,
          plan.digest,
          1_000,
        ),
      /team_token_budget_exceeded/u,
    );
    assert.equal(launches, 0);
    assert.equal(store.status(managed.team.team_id).agents.length, 1);
    assert.equal(store.plan(managed.team.team_id, plan.plan_id).state, "proposed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plan token preflight rejects malformed persisted allocations fail closed", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-plan-token-invalid-")));
  try {
    const store = new TeamStore(root);
    const managed = store.createManaged("Reject malformed budget", "codex", 3, 1, 90_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Return one structured plan",
        model: "default",
        skills: [],
        instructions: "Declare exact token allocations.",
      },
      task: "Plan",
      token_budget: 1_000,
      required_actions: [],
      output_contract: "team-plan-v1",
    });
    const plan = store.proposePlan(
      managed.team.team_id,
      managed.manager.agent_id,
      JSON.stringify(planDocument(10_000, 2_000)),
    );
    const planPath = join(
      root,
      ".yukh",
      "teams",
      managed.team.team_id,
      "plans",
      `${plan.plan_id}.json`,
    );
    const raw = JSON.parse(await readFile(planPath, "utf8")) as {
      document: { workers: { token_budget?: unknown }[] };
    };
    raw.document.workers[0]!.token_budget = "10000";
    await writeFile(planPath, `${JSON.stringify(raw)}\n`);
    assert.throws(
      () => store.planTokenBudgetPreflight(managed.team.team_id, plan.plan_id),
      /team_plan_token_budget_invalid/u,
    );
    store.transition(managed.team.team_id, managed.manager.agent_id, "running");
    store.finish(
      managed.team.team_id,
      managed.manager.agent_id,
      { schema: 1, outcome: "succeeded", summary: "Malformed plan", plan_id: plan.plan_id },
      usage,
    );
    await assert.rejects(
      () =>
        executePlan(
          store,
          { launch: () => ({ pid: 1, log: "unused" }) },
          { models: { codex: new Set(["default"]), copilot: new Set(["default"]) } },
          managed.team.team_id,
          plan.plan_id,
          plan.digest,
          1_000,
        ),
      /team_plan_token_budget_invalid/u,
    );
    assert.equal(store.status(managed.team.team_id).agents.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("accounted manager receives the exact persisted team status receipt", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-manager-status-receipt-")));
  try {
    const store = new TeamStore(root);
    const managed = store.createManaged("Inspect exact state", "codex", 2, 1, 50_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Inspect one team",
        model: "default",
        skills: [],
        instructions: "Use the returned receipt as evidence.",
      },
      task: "Call team.status",
      token_budget: 40_000,
      required_actions: ["team.status"],
    });
    const external = readTeamStatus(store, managed.team.team_id);
    assert.equal("status" in external, false);
    const accounted = readTeamStatus(
      store,
      managed.team.team_id,
      {
        team_id: managed.team.team_id,
        agent_id: managed.manager.agent_id,
      },
      {
        codex: { models: ["default", "gpt-5.6-sol"], source: "cli" },
        copilot: { models: ["default", "claude-sonnet-5"], source: "sdk" },
      },
    );
    assert.equal("status" in accounted, true);
    if (!("status" in accounted)) throw new Error("missing accounted status");
    assert.equal(accounted.receipt.action, "team.status");
    assert.equal(accounted.receipt.actor_agent_id, managed.manager.agent_id);
    assert.deepEqual(accounted.status.model_catalog?.copilot, {
      models: ["default", "claude-sonnet-5"],
      source: "sdk",
    });
    assert.equal(accounted.status.agents[0]?.runtime, "codex");
    assert.equal(accounted.status.agents[0]?.model, "default");
    assert.equal("profile" in accounted.status.agents[0]!, false);
    assert.equal("task" in accounted.status.agents[0]!, false);
    assert.equal(
      store.status(managed.team.team_id).receipts.at(-1)?.receipt_id,
      accounted.receipt.receipt_id,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compact status marks over-budget summaries as reviewable", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-reviewable-overbudget-")));
  try {
    const store = new TeamStore(root);
    const managed = store.createManaged("Inspect review artifact", "codex", 2, 1, 50_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Inspect one team",
        model: "default",
        skills: [],
        instructions: "Read compact status.",
      },
      task: "Call team.status",
      token_budget: 20_000,
      required_actions: [],
    });
    const worker = store.spawn(managed.team.team_id, {
      parent_agent_id: managed.manager.agent_id,
      runtime: "codex",
      role: "reviewable-worker",
      task: "Return useful output but exceed budget",
      token_budget: 2_000,
    });
    store.transition(managed.team.team_id, worker.agent_id, "running");
    store.finish(
      managed.team.team_id,
      worker.agent_id,
      { schema: 1, outcome: "token_budget_exceeded", summary: "Useful review artifact" },
      {
        schema: 1,
        source: "codex-json-v1",
        input_tokens: 2_500,
        cached_input_tokens: 1_000,
        output_tokens: 200,
        reasoning_output_tokens: 50,
        total_tokens: 2_700,
        budget_outcome: "exceeded",
      },
    );
    const accounted = readTeamStatus(store, managed.team.team_id, {
      team_id: managed.team.team_id,
      agent_id: managed.manager.agent_id,
    });
    if (!("status" in accounted)) throw new Error("missing accounted status");
    const compactWorker = accounted.status.agents.find(
      (agent) => agent.agent_id === worker.agent_id,
    );
    assert.equal(compactWorker?.completion, "token_budget_exceeded");
    assert.equal(compactWorker?.review_summary_available, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime output extracts Codex completion and refuses invented Copilot token usage", () => {
  const codex = new RuntimeOutput("codex");
  codex.line(
    JSON.stringify({ type: "item.started", item: { type: "command_execution", command: "pwd" } }),
  );
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
  assert.equal(codex.commandsStarted(), 1);
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

  copilot.setSummary("SDK completion");
  copilot.addUsage("copilot-sdk-v1", {
    input_tokens: 120,
    cached_input_tokens: 30,
    output_tokens: 40,
    reasoning_output_tokens: 10,
  });
  assert.equal(copilot.summary(), "SDK completion");
  assert.deepEqual(copilot.usage(200), {
    schema: 1,
    source: "copilot-sdk-v1",
    input_tokens: 120,
    cached_input_tokens: 30,
    output_tokens: 40,
    reasoning_output_tokens: 10,
    total_tokens: 160,
    budget_outcome: "within",
  });

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

test("copilot sdk worker runs tool-free empty sessions with shutdown token accounting", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-copilot-sdk-worker-")));
  try {
    const store = new TeamStore(root);
    const team = store.create("SDK probe", "copilot");
    const agent = store.spawn(team.team_id, {
      runtime: "copilot",
      role: "sdk-reviewer",
      task: "Summarize only",
      profile: {
        schema: 1,
        mission: "Review",
        model: "copilot-test-model",
        skills: [],
        instructions: "Be brief",
      },
      model_tool_mode: "none",
      token_budget: 1_000,
    });
    const createdClients: Record<string, unknown>[] = [];
    const createdSessions: Record<string, unknown>[] = [];
    const sdk = {
      RuntimeConnection: {
        forStdio(options: unknown) {
          return { kind: "stdio", options };
        },
      },
      CopilotClient: class {
        constructor(options: Record<string, unknown>) {
          createdClients.push(options);
        }
        async start(): Promise<void> {}
        async stop(): Promise<readonly Error[]> {
          return [];
        }
        async forceStop(): Promise<void> {}
        async createSession(config: Record<string, unknown>) {
          createdSessions.push(config);
          let handler: (event: unknown) => void = () => undefined;
          return {
            on(next: (event: unknown) => void) {
              handler = next;
              return () => undefined;
            },
            async sendAndWait() {
              handler({
                type: "session.shutdown",
                data: {
                  modelMetrics: {
                    "copilot-test-model": {
                      usage: {
                        inputTokens: 80,
                        cacheReadTokens: 20,
                        cacheWriteTokens: 5,
                        outputTokens: 30,
                        reasoningTokens: 7,
                      },
                    },
                  },
                },
              });
              return { data: { content: "SDK worker complete" } };
            },
            async disconnect(): Promise<void> {},
          };
        }
      },
    };
    const outcome = await runCopilotSdkWorker({
      executable: "/bin/copilot",
      workspace: root,
      prompt: "Do the task",
      agent,
      timeoutMs: 1_000,
      sdk,
    });
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.output.summary(), "SDK worker complete");
    assert.deepEqual(outcome.output.usage(1_000), {
      schema: 1,
      source: "copilot-sdk-v1",
      input_tokens: 80,
      cached_input_tokens: 20,
      output_tokens: 30,
      reasoning_output_tokens: 7,
      total_tokens: 110,
      budget_outcome: "within",
    });
    assert.deepEqual(createdClients[0]?.mode, "empty");
    assert.deepEqual(createdSessions[0]?.availableTools, []);
    assert.equal(createdSessions[0]?.model, "copilot-test-model");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("codex python app-server worker captures final response and token accounting", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-codex-python-worker-")));
  try {
    const store = new TeamStore(root);
    const team = store.create("Codex Python probe", "codex");
    const agent = store.spawn(team.team_id, {
      runtime: "codex",
      role: "python-reviewer",
      task: "Summarize only",
      profile: {
        schema: 1,
        mission: "Review",
        model: "codex-test-model",
        skills: [],
        instructions: "Be brief",
      },
      model_tool_mode: "none",
      token_budget: 1_000,
    });
    const outcome = await runCodexPythonWorker({
      executable: "/bin/codex",
      python: process.env.PYTHON ?? "python3",
      workspace: root,
      prompt: "Do the task",
      agent,
      timeoutMs: 1_000,
      workerSource: [
        "import json",
        "import os",
        "required = ['YUKH_CODEX_EXECUTABLE', 'YUKH_CODEX_PYTHON_PROMPT_PATH']",
        "if any(name not in os.environ for name in required): raise SystemExit(2)",
        "print(json.dumps({",
        "  'schema': 1,",
        "  'status': 'completed',",
        "  'final_response': 'Codex Python worker complete',",
        "  'usage_last': {",
        "    'input_tokens': 90,",
        "    'cached_input_tokens': 40,",
        "    'output_tokens': 25,",
        "    'reasoning_output_tokens': 5,",
        "  },",
        "}))",
      ].join("\n"),
    });
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.output.summary(), "Codex Python worker complete");
    assert.deepEqual(outcome.output.usage(1_000), {
      schema: 1,
      source: "codex-python-app-server-v1",
      input_tokens: 90,
      cached_input_tokens: 40,
      output_tokens: 25,
      reasoning_output_tokens: 5,
      total_tokens: 115,
      budget_outcome: "within",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("codex python app-server worker classifies usage limits", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-codex-python-limit-")));
  try {
    const store = new TeamStore(root);
    const team = store.create("Codex Python limit probe", "codex");
    const agent = store.spawn(team.team_id, {
      runtime: "codex",
      role: "python-reviewer",
      task: "Summarize only",
      profile: {
        schema: 1,
        mission: "Review",
        model: "codex-test-model",
        skills: [],
        instructions: "Be brief",
      },
      model_tool_mode: "none",
      token_budget: 1_000,
    });
    const outcome = await runCodexPythonWorker({
      executable: "/bin/codex",
      python: process.env.PYTHON ?? "python3",
      workspace: root,
      prompt: "Do the task",
      agent,
      timeoutMs: 1_000,
      workerSource: [
        "import json",
        "print(json.dumps({",
        "  'schema': 1,",
        "  'status': 'error',",
        "  'error_code': 'provider_usage_limited',",
        "  'error_message': \"You've hit your usage limit for GPT-Test. Switch model, or try again at Aug 23rd, 2026 1:14 AM.\",",
        "}))",
        "raise SystemExit(1)",
      ].join("\n"),
    });
    assert.equal(outcome.exitCode, 1);
    assert.equal(outcome.providerFailure, "provider_usage_limited");
    assert.equal(
      outcome.output.summary(),
      "Provider usage limit reached; retry after Aug 23rd, 2026 1:14 AM.",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
          YUKH_ENABLE_UNSAFE_DYNAMIC_WORKERS: "1",
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
          YUKH_ENABLE_UNSAFE_DYNAMIC_WORKERS: "1",
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

test("worker forwards preview runtime to Coordination launcher", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-team-preview-runtime-")));
  try {
    const observed = join(root, "observed-preview-runtime");
    const previewRuntime = join(root, "preview-runtime");
    const executable = join(root, "agent-cli");
    const launcher = join(root, "launcher");
    const support = join(root, "support.mjs");
    await writeFile(
      executable,
      `#!/bin/sh
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"runtime ok"}}'
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5}}'
`,
      { mode: 0o700 },
    );
    await writeFile(
      launcher,
      `#!/bin/sh
printf '%s' "$YUKH_PREVIEW_RUNTIME" > ${JSON.stringify(observed)}
cat >/dev/null
printf '{"schema":1,"status":"ok","command":"test"}\\n'
`,
      { mode: 0o700 },
    );
    await writeFile(support, "", { mode: 0o600 });
    const store = new TeamStore(root);
    const team = store.create("Forward preview runtime", "codex");
    const agent = store.spawn(team.team_id, {
      runtime: "codex",
      role: "backend-reviewer",
      task: "Verify preview runtime",
      token_budget: 120_000,
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
          YUKH_PREVIEW_RUNTIME: previewRuntime,
        },
      },
    );
    assert.equal(await new Promise<number | null>((resolve) => child.once("close", resolve)), 0);
    assert.equal(await readFile(observed, "utf8"), previewRuntime);
    assert.equal(store.agent(team.team_id, agent.agent_id).state, "completed");
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
          YUKH_ENABLE_UNSAFE_DYNAMIC_WORKERS: "1",
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

test("simple non-delegating worker receives no model-facing MCP configuration", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-simple-worker-tools-")));
  try {
    const executable = join(root, "agent-cli");
    const argumentsFile = join(root, "agent-arguments");
    const launcher = join(root, "launcher");
    const support = join(root, "support.mjs");
    await writeFile(
      executable,
      `#!/bin/sh
printf '%s\n' "$@" >${argumentsFile}
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"simple worker complete"}}'
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
    const team = store.create("Run simple worker", "codex");
    const agent = store.spawn(team.team_id, {
      runtime: "codex",
      role: "documentation-worker",
      task: "Make one bounded documentation edit",
      token_budget: 80_000,
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
    const runtimeArguments = await readFile(argumentsFile, "utf8");
    assert.match(runtimeArguments, /--ignore-user-config/u);
    assert.doesNotMatch(runtimeArguments, /mcp_servers\.yukh-team-control/u);
    assert.doesNotMatch(runtimeArguments, /mcp_servers\.yukh-coordination/u);
    const completed = store.agent(team.team_id, agent.agent_id);
    assert.equal(completed.state, "completed");
    assert.equal(completed.completion?.outcome, "succeeded");
    assert.equal(completed.usage?.total_tokens, 120);
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
    const argumentsFile = join(root, "agent-arguments");
    const launcher = join(root, "launcher");
    const support = join(root, "support.mjs");
    await writeFile(
      executable,
      `#!/bin/sh
printf '%s\n' "$@" >${argumentsFile}
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
          YUKH_ENABLE_UNSAFE_DYNAMIC_WORKERS: "1",
        },
      },
    );
    assert.equal(await new Promise<number | null>((resolve) => child.once("close", resolve)), 1);
    const failed = store.agent(managed.team.team_id, managed.manager.agent_id);
    assert.equal(failed.state, "failed");
    assert.equal(failed.completion?.outcome, "required_action_missing");
    assert.equal(failed.usage?.total_tokens, 120);
    const runtimeArguments = await readFile(argumentsFile, "utf8");
    assert.match(runtimeArguments, /--ignore-user-config/u);
    assert.match(
      runtimeArguments,
      /mcp_servers\.yukh-team-control\.enabled_tools=\["team\.status"\]/u,
    );
    assert.match(
      runtimeArguments,
      /mcp_servers\.yukh-team-control\.env\.YUKH_ENABLE_UNSAFE_DYNAMIC_WORKERS="1"/u,
    );
    assert.doesNotMatch(runtimeArguments, /mcp_servers\.yukh-coordination\.command/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manager engage-only prompt does not force agent await", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-manager-engage-only-")));
  try {
    const executable = join(root, "agent-cli");
    const argumentsFile = join(root, "agent-arguments");
    const launcher = join(root, "launcher");
    const support = join(root, "support.mjs");
    await writeFile(
      executable,
      `#!/bin/sh
printf '%s\n' "$@" >${argumentsFile}
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"engage receipt persisted"}}'
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
    const managed = store.createManaged("Engage child only", "codex", 2, 1, 10_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Engage one worker without awaiting it",
        model: "default",
        skills: [],
        instructions: "Call agent.engage and stop.",
      },
      task: "Call agent.engage only",
      token_budget: 5_000,
      required_actions: ["agent.engage"],
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
          YUKH_ENABLE_UNSAFE_DYNAMIC_WORKERS: "1",
        },
      },
    );
    assert.equal(await new Promise<number | null>((resolve) => child.once("close", resolve)), 1);
    const runtimeArguments = await readFile(argumentsFile, "utf8");
    assert.match(
      runtimeArguments,
      /Required receipt-backed actions before success: agent\.engage/u,
    );
    assert.match(
      runtimeArguments,
      /Do not wait for the child unless the task explicitly requires agent\.await/u,
    );
    assert.doesNotMatch(runtimeArguments, /Wait for each child with agent\.await/u);
    assert.match(
      runtimeArguments,
      /mcp_servers\.yukh-team-control\.enabled_tools=\["agent\.engage"\]/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pure planning manager receives no model-facing MCP configuration", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-manager-tool-free-")));
  try {
    const executable = join(root, "agent-cli");
    const argumentsFile = join(root, "agent-arguments");
    const launcher = join(root, "launcher");
    const support = join(root, "support.mjs");
    await writeFile(
      executable,
      `#!/bin/sh
printf '%s\n' "$@" >${argumentsFile}
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"One-pass plan"}}'
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":20,"reasoning_output_tokens":5}}'
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
    const managed = store.createManaged("Plan once", "codex", 2, 1, 5_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Return one compact plan",
        model: "default",
        skills: [],
        instructions: "Use only supplied facts.",
      },
      task: "Propose the plan",
      token_budget: 2_000,
      required_actions: [],
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
    assert.equal(await new Promise<number | null>((resolve) => child.once("close", resolve)), 0);
    const runtimeArguments = await readFile(argumentsFile, "utf8");
    assert.match(runtimeArguments, /--ignore-user-config/u);
    assert.doesNotMatch(runtimeArguments, /mcp_servers\.yukh-team-control/u);
    assert.doesNotMatch(runtimeArguments, /mcp_servers\.yukh-coordination/u);
    assert.equal(
      store.agent(managed.team.team_id, managed.manager.agent_id).completion?.outcome,
      "succeeded",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("structured planning manager persists a closed digest-bound plan", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-structured-plan-")));
  try {
    const executable = join(root, "agent-cli");
    const argumentsFile = join(root, "agent-arguments");
    const launcher = join(root, "launcher");
    const support = join(root, "support.mjs");
    const document = JSON.stringify(planDocument());
    await writeFile(
      executable,
      `#!/bin/sh
printf '%s\n' "$@" >${argumentsFile}
printf '%s\n' ${JSON.stringify(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: document } }))}
printf '%s\n' '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":20,"reasoning_output_tokens":5}}'
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
    const managed = store.createManaged("Plan deterministically", "codex", 4, 1, 10_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Return one executable structured plan",
        model: "default",
        skills: [],
        instructions: "Select only necessary specialists.",
      },
      task: "Plan one increment",
      token_budget: 2_000,
      required_actions: [],
      output_contract: "team-plan-v1",
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
          YUKH_CODEX_MODELS: "default,reasoning-approved",
          YUKH_COPILOT_MODELS: "default",
        },
      },
    );
    assert.equal(await new Promise<number | null>((resolve) => child.once("close", resolve)), 0);
    const manager = store.agent(managed.team.team_id, managed.manager.agent_id);
    assert.equal(manager.completion?.outcome, "succeeded");
    assert.match(manager.completion?.plan_id ?? "", /^plan-/u);
    const plan = store.plan(managed.team.team_id, manager.completion?.plan_id ?? "invalid");
    assert.match(plan.digest, /^sha-256:[0-9a-f]{64}$/u);
    assert.equal(plan.state, "proposed");
    const runtimeArguments = await readFile(argumentsFile, "utf8");
    assert.match(runtimeArguments, /--output-schema/u);
    assert.match(runtimeArguments, /Every role must be a lowercase slug/u);
    assert.match(runtimeArguments, /token-efficiency-auditor/u);
    assert.match(runtimeArguments, /Codex models: default, reasoning-approved/u);
    assert.match(runtimeArguments, /Prefer model "default"/u);
    assert.match(runtimeArguments, /each file at most 4096 bytes/u);
    assert.match(runtimeArguments, /worker pack at most 12288 bytes/u);
    assert.match(runtimeArguments, /Codex zero-command review\/planning workers/u);
    assert.match(runtimeArguments, /at least 18000 total tokens/u);
    assert.match(runtimeArguments, /tool-free synthesis currently needs at least 16000/u);
    assert.match(runtimeArguments, /Prefer fewer planned agents over under-budgeted agents/u);
    assert.match(runtimeArguments, /completion summary below 4096 UTF-8 bytes/u);
    assert.match(runtimeArguments, /prefer 3500 bytes or less/u);
    assert.doesNotMatch(runtimeArguments, /When engaging a child/u);
    assert.doesNotMatch(runtimeArguments, /Coordination model tools are omitted/u);
    assert.doesNotMatch(runtimeArguments, /mcp_servers\.yukh-team-control/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("worker preempts the provider when its command budget is exceeded", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-command-bound-")));
  try {
    const executable = join(root, "agent-cli");
    const launcher = join(root, "launcher");
    const support = join(root, "support.mjs");
    await writeFile(
      executable,
      `#!/bin/sh
printf '%s\n' '{"type":"item.started","item":{"type":"command_execution","command":"sleep 30"}}'
sleep 30
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
    const managed = store.createManaged("Bound commands", "codex", 2, 1, 5_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Prove command preemption",
        model: "default",
        skills: [],
        instructions: "Stay bounded.",
      },
      task: "Attempt one command",
      token_budget: 2_000,
      required_actions: [],
      max_commands: 0,
      timeout_ms: 60_000,
    });
    const started = Date.now();
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
    assert.notEqual(await new Promise<number | null>((resolve) => child.once("close", resolve)), 0);
    assert.ok(Date.now() - started < 10_000);
    assert.equal(
      store.agent(managed.team.team_id, managed.manager.agent_id).completion?.outcome,
      "command_budget_exceeded",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("worker terminates the provider process group at its runtime deadline", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-runtime-deadline-")));
  try {
    const executable = join(root, "agent-cli");
    const launcher = join(root, "launcher");
    const support = join(root, "support.mjs");
    await writeFile(executable, "#!/bin/sh\nsleep 30 &\nwait\n", { mode: 0o700 });
    await writeFile(
      launcher,
      '#!/bin/sh\ncat >/dev/null\nprintf \'{"schema":1,"status":"ok","command":"test"}\\n\'\n',
      { mode: 0o700 },
    );
    await writeFile(support, "", { mode: 0o600 });
    const store = new TeamStore(root);
    const managed = store.createManaged("Bound runtime", "codex", 2, 1, 5_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Prove deadline preemption",
        model: "default",
        skills: [],
        instructions: "Stay bounded.",
      },
      task: "Wait for the deadline",
      token_budget: 2_000,
      required_actions: [],
      max_commands: 8,
      timeout_ms: 5_000,
    });
    const started = Date.now();
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
    assert.notEqual(await new Promise<number | null>((resolve) => child.once("close", resolve)), 0);
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 4_500 && elapsed < 12_000, `unexpected deadline duration: ${elapsed}`);
    assert.equal(
      store.agent(managed.team.team_id, managed.manager.agent_id).completion?.outcome,
      "runtime_deadline_exceeded",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deterministic executor reserves, runs, awaits and synthesizes without manager relaunch", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-plan-executor-")));
  try {
    const store = new TeamStore(root);
    const managed = store.createManaged("Execute once", "codex", 4, 1, 10_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Plan a bounded increment",
        model: "default",
        skills: [],
        instructions: "Return a closed plan.",
      },
      task: "Plan",
      token_budget: 2_000,
      required_actions: [],
      output_contract: "team-plan-v1",
    });
    store.transition(managed.team.team_id, managed.manager.agent_id, "running");
    const plan = store.proposePlan(
      managed.team.team_id,
      managed.manager.agent_id,
      JSON.stringify(planDocument()),
    );
    store.finish(
      managed.team.team_id,
      managed.manager.agent_id,
      {
        schema: 1,
        outcome: "succeeded",
        summary: JSON.stringify(planDocument()),
        plan_id: plan.plan_id,
      },
      usage,
    );
    const launches: string[] = [];
    const supervisor = {
      launch(agent: ReturnType<TeamStore["agent"]>) {
        launches.push(agent.agent_id);
        store.transition(agent.team_id, agent.agent_id, "running");
        queueMicrotask(() =>
          store.finish(
            agent.team_id,
            agent.agent_id,
            { schema: 1, outcome: "succeeded", summary: `${agent.role} completed` },
            usage,
          ),
        );
        return { pid: 1, log: "test" };
      },
    };
    const options = {
      models: { codex: new Set(["default"]), copilot: new Set(["default"]) },
      skills: { codex: new Set<string>(), copilot: new Set<string>() },
    };
    const completed = await executePlan(
      store,
      supervisor,
      options,
      managed.team.team_id,
      plan.plan_id,
      plan.digest,
      2_000,
    );
    assert.equal(completed.state, "completed");
    assert.equal(launches.length, 2);
    assert.ok(!launches.includes(managed.manager.agent_id));
    assert.equal(
      store.agent(managed.team.team_id, completed.synthesis_agent_id ?? "invalid").model_tool_mode,
      "none",
    );
    assert.deepEqual(
      store
        .status(managed.team.team_id)
        .receipts.map((receipt) => receipt.action)
        .sort(),
      ["plan.execute", "plan.synthesize"],
    );
    assert.equal(store.status(managed.team.team_id).tokens.allocated, 6_000);
    assert.equal(store.status(managed.team.team_id).tokens.observed, 360);
    await executePlan(
      store,
      supervisor,
      options,
      managed.team.team_id,
      plan.plan_id,
      plan.digest,
      2_000,
    );
    assert.equal(launches.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approved plan CLI runner executes workers and synthesis through the deterministic executor", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-plan-cli-runner-")));
  try {
    const store = new TeamStore(root);
    const managed = store.createManaged("Execute plan from CLI", "codex", 4, 1, 10_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Plan one bounded increment",
        model: "default",
        skills: [],
        instructions: "Return a closed plan.",
      },
      task: "Plan",
      token_budget: 2_000,
      required_actions: [],
      output_contract: "team-plan-v1",
    });
    store.transition(managed.team.team_id, managed.manager.agent_id, "running");
    const plan = store.proposePlan(
      managed.team.team_id,
      managed.manager.agent_id,
      JSON.stringify(planDocument()),
    );
    store.finish(
      managed.team.team_id,
      managed.manager.agent_id,
      {
        schema: 1,
        outcome: "succeeded",
        summary: JSON.stringify(planDocument()),
        plan_id: plan.plan_id,
      },
      usage,
    );
    const launches: string[] = [];
    const supervisor = {
      launch(agent: ReturnType<TeamStore["agent"]>) {
        launches.push(agent.agent_id);
        store.transition(agent.team_id, agent.agent_id, "running");
        queueMicrotask(() =>
          store.finish(
            agent.team_id,
            agent.agent_id,
            { schema: 1, outcome: "succeeded", summary: `${agent.role} completed` },
            usage,
          ),
        );
        return { pid: 1, log: "test" };
      },
    };
    const output = await runApprovedPlanWithDependencies(
      {
        workspace: root,
        teamId: managed.team.team_id,
        planId: plan.plan_id,
        approvedDigest: plan.digest,
        launcher: process.execPath,
        codex: process.execPath,
        copilot: process.execPath,
        waitMs: 2_000,
      },
      {
        store,
        supervisor,
        options: {
          dynamicExecution: true,
          models: { codex: new Set(["default"]), copilot: new Set(["default"]) },
          skills: { codex: new Set<string>(), copilot: new Set<string>() },
        },
      },
    );
    assert.equal(output.status, "ok");
    assert.equal(output.plan.state, "completed");
    assert.equal(launches.length, 2);
    assert.equal(output.team.tokens.observed, 360);
    assert.match(formatApprovedPlanRun(output), /Yukh approved plan run/u);
    assert.match(formatApprovedPlanRun(output), /Plan state: completed/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approved plan CLI runner keeps the deterministic cost boundary", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-plan-cli-boundary-")));
  try {
    const store = new TeamStore(root);
    const managed = store.createManaged("Reject unsafe plan from CLI", "codex", 4, 1, 10_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Plan one bounded increment",
        model: "default",
        skills: [],
        instructions: "Return a closed plan.",
      },
      task: "Plan",
      token_budget: 2_000,
      required_actions: [],
      output_contract: "team-plan-v1",
    });
    store.transition(managed.team.team_id, managed.manager.agent_id, "running");
    const unsafe = planDocument();
    unsafe.workers[0]!.max_commands = 1;
    const plan = store.proposePlan(
      managed.team.team_id,
      managed.manager.agent_id,
      JSON.stringify(unsafe),
    );
    store.finish(
      managed.team.team_id,
      managed.manager.agent_id,
      {
        schema: 1,
        outcome: "succeeded",
        summary: JSON.stringify(unsafe),
        plan_id: plan.plan_id,
      },
      usage,
    );
    await assert.rejects(
      runApprovedPlanWithDependencies(
        {
          workspace: root,
          teamId: managed.team.team_id,
          planId: plan.plan_id,
          approvedDigest: plan.digest,
          launcher: process.execPath,
          codex: process.execPath,
          copilot: process.execPath,
          waitMs: 2_000,
        },
        {
          store,
          supervisor: { launch: () => ({ pid: 1, log: "test" }) },
          options: {
            dynamicExecution: false,
            models: { codex: new Set(["default"]), copilot: new Set(["default"]) },
            skills: { codex: new Set<string>(), copilot: new Set<string>() },
          },
        },
      ),
      /dynamic_worker_cost_boundary_unavailable/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deterministic executor resumes reserved state and suppresses synthesis after worker failure", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-plan-resume-failure-")));
  try {
    const store = new TeamStore(root);
    const managed = store.createManaged("Resume failed work", "codex", 4, 1, 10_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Plan one bounded increment",
        model: "default",
        skills: [],
        instructions: "Return a closed plan.",
      },
      task: "Plan",
      token_budget: 2_000,
      required_actions: [],
      output_contract: "team-plan-v1",
    });
    store.transition(managed.team.team_id, managed.manager.agent_id, "running");
    const proposed = store.proposePlan(
      managed.team.team_id,
      managed.manager.agent_id,
      JSON.stringify(planDocument()),
    );
    store.finish(
      managed.team.team_id,
      managed.manager.agent_id,
      {
        schema: 1,
        outcome: "succeeded",
        summary: JSON.stringify(planDocument()),
        plan_id: proposed.plan_id,
      },
      usage,
    );
    const reserved = store.reservePlan(managed.team.team_id, proposed.plan_id, proposed.digest);
    const failedWorker = reserved.worker_agent_ids[0]!;
    store.transition(managed.team.team_id, failedWorker, "running");
    const overrunUsage = {
      schema: 1 as const,
      source: "codex-json-v1" as const,
      input_tokens: 2_500,
      cached_input_tokens: 1_000,
      output_tokens: 200,
      reasoning_output_tokens: 50,
      total_tokens: 2_700,
      budget_outcome: "exceeded" as const,
    };
    store.finish(
      managed.team.team_id,
      failedWorker,
      {
        schema: 1,
        outcome: "token_budget_exceeded",
        summary: "Useful but over-budget worker proposal",
      },
      overrunUsage,
    );
    const launches: string[] = [];
    const options = {
      models: { codex: new Set(["default"]), copilot: new Set(["default"]) },
      skills: { codex: new Set<string>(), copilot: new Set<string>() },
    };
    await assert.rejects(
      executePlan(
        store,
        { launch: (agent) => (launches.push(agent.agent_id), { pid: 1, log: "test" }) },
        options,
        managed.team.team_id,
        proposed.plan_id,
        proposed.digest,
        2_000,
      ),
      /team_plan_worker_failed/u,
    );
    const failed = store.plan(managed.team.team_id, proposed.plan_id);
    assert.equal(failed.state, "failed");
    assert.equal(failed.failure_code, "team_plan_worker_failed");
    assert.deepEqual(launches, []);
    const reviewable = store.agent(managed.team.team_id, failedWorker);
    assert.equal(reviewable.completion?.outcome, "token_budget_exceeded");
    assert.equal(reviewable.completion?.summary, "Useful but over-budget worker proposal");
    assert.equal(reviewable.usage?.total_tokens, 2_700);
    assert.equal(
      store.agent(managed.team.team_id, failed.synthesis_agent_id ?? "invalid").state,
      "defined",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deterministic executor fails before worker creation for malformed, stale and unavailable plans", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "yukh-plan-denials-")));
  try {
    const store = new TeamStore(root);
    const managed = store.createManaged("Deny unsafe plan", "codex", 4, 1, 10_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Plan safely",
        model: "default",
        skills: [],
        instructions: "Use a closed plan.",
      },
      task: "Plan",
      token_budget: 2_000,
      required_actions: [],
      output_contract: "team-plan-v1",
    });
    assert.throws(
      () =>
        store.proposePlan(
          managed.team.team_id,
          managed.manager.agent_id,
          JSON.stringify({ ...planDocument(), unexpected: true }),
        ),
      /invalid team plan/u,
    );
    const duplicateSkills = planDocument();
    (duplicateSkills.workers[0]!.skills as string[]).push("testing", "testing");
    assert.throws(
      () =>
        store.proposePlan(
          managed.team.team_id,
          managed.manager.agent_id,
          JSON.stringify(duplicateSkills),
        ),
      /invalid team plan/u,
    );
    const unbounded = planDocument();
    unbounded.workers[0]!.max_commands = 33;
    assert.throws(
      () =>
        store.proposePlan(
          managed.team.team_id,
          managed.manager.agent_id,
          JSON.stringify(unbounded),
        ),
      /invalid team plan/u,
    );
    const toolUsingSynthesis = planDocument();
    (toolUsingSynthesis.synthesis as { tool_mode: string }).tool_mode = "coordination";
    assert.throws(
      () =>
        store.proposePlan(
          managed.team.team_id,
          managed.manager.agent_id,
          JSON.stringify(toolUsingSynthesis),
        ),
      /invalid team plan/u,
    );
    store.transition(managed.team.team_id, managed.manager.agent_id, "running");
    const unavailable = planDocument();
    unavailable.workers[0]!.model = "unavailable";
    const plan = store.proposePlan(
      managed.team.team_id,
      managed.manager.agent_id,
      JSON.stringify(unavailable),
    );
    store.finish(
      managed.team.team_id,
      managed.manager.agent_id,
      {
        schema: 1,
        outcome: "succeeded",
        summary: JSON.stringify(unavailable),
        plan_id: plan.plan_id,
      },
      usage,
    );
    const supervisor = { launch: () => ({ pid: 1, log: "test" }) };
    const options = {
      models: { codex: new Set(["default"]), copilot: new Set(["default"]) },
      skills: { codex: new Set<string>(), copilot: new Set<string>() },
    };
    await assert.rejects(
      executePlan(
        store,
        supervisor,
        options,
        managed.team.team_id,
        plan.plan_id,
        `sha-256:${"0".repeat(64)}`,
        2_000,
      ),
      /team_plan_digest_mismatch/u,
    );
    await assert.rejects(
      executePlan(
        store,
        supervisor,
        options,
        managed.team.team_id,
        plan.plan_id,
        plan.digest,
        2_000,
      ),
      /agent_model_unavailable/u,
    );
    assert.equal(store.status(managed.team.team_id).agents.length, 1);
    assert.equal(store.plan(managed.team.team_id, plan.plan_id).state, "proposed");

    const overManaged = store.createManaged("Deny over-allocation", "codex", 4, 1, 10_000, {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Plan within the aggregate budget",
        model: "default",
        skills: [],
        instructions: "Reserve planning, work and synthesis.",
      },
      task: "Plan",
      token_budget: 2_000,
      required_actions: [],
      output_contract: "team-plan-v1",
    });
    store.transition(overManaged.team.team_id, overManaged.manager.agent_id, "running");
    const oversizedDocument = planDocument(5_000, 5_000);
    const oversizedPlan = store.proposePlan(
      overManaged.team.team_id,
      overManaged.manager.agent_id,
      JSON.stringify(oversizedDocument),
    );
    store.finish(
      overManaged.team.team_id,
      overManaged.manager.agent_id,
      {
        schema: 1,
        outcome: "succeeded",
        summary: JSON.stringify(oversizedDocument),
        plan_id: oversizedPlan.plan_id,
      },
      usage,
    );
    await assert.rejects(
      executePlan(
        store,
        supervisor,
        options,
        overManaged.team.team_id,
        oversizedPlan.plan_id,
        oversizedPlan.digest,
        2_000,
      ),
      /team_token_budget_exceeded/u,
    );
    assert.equal(store.status(overManaged.team.team_id).agents.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
