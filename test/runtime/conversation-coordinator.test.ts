import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConversationCoordinator } from "../../packages/conversation-coordinator/src/coordinator.js";
import { createLifecycleRecorder } from "../../packages/conversation-coordinator/src/lifecycle.js";
import { createAgentRunner } from "../../packages/conversation-coordinator/src/runner.js";
import type { CoordinationLauncher } from "../../packages/coordination-preview/src/launcher.js";

const questionId = "019fffc0-06d7-7bbf-8f28-a60641591e1f";
const answerId = "019fffc0-ffef-7e44-b392-bf7a62f9b665";

test("coordinator reuses lifecycle state without truncating it", async () => {
  const root = await mkdtemp(join(tmpdir(), "yukh-conversation-lifecycle-"));
  const directory = join(root, ".yukh");
  const path = join(directory, "conversation-lifecycle.jsonl");
  await mkdir(directory);
  await writeFile(path, '{"schema":1,"event":"existing"}\n');
  try {
    const lifecycle = createLifecycleRecorder(root);
    lifecycle.record({ schema: 1, event: "new" });
    lifecycle.close();
    assert.equal(
      await readFile(path, "utf8"),
      '{"schema":1,"event":"existing"}\n{"schema":1,"event":"new"}\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function replay(answered = false) {
  return {
    schema: 1 as const,
    status: "ok" as const,
    command: "events replay",
    result: {
      records: [
        { event: { id: questionId, type: "question", data: { requested_from: ["agent:b"] } } },
        ...(answered
          ? [{ event: { id: answerId, type: "answer", data: { question_event_id: questionId } } }]
          : []),
      ],
    },
  };
}

test("coordinator wakes the addressed agent once and excludes answered work", async () => {
  const prompts: string[] = [];
  const commands: string[] = [];
  const lifecycle: string[] = [];
  let output = replay();
  const launcher: CoordinationLauncher = {
    invoke: async (command) => {
      commands.push(command);
      return output;
    },
  };
  const coordinator = new ConversationCoordinator({
    launchers: { "agent-a": launcher, "agent-b": launcher },
    runner: {
      run: async (agent, prompt) => {
        assert.equal(agent, "agent-b");
        prompts.push(prompt);
        output = replay(true);
      },
    },
    maxTurns: 2,
    lifetimeMs: 10_000,
    now: () => 1_000,
    observe: (event) => lifecycle.push(event.event),
  });
  assert.equal(await coordinator.tick(), "handled");
  assert.equal(await coordinator.tick(), "idle");
  assert.equal(prompts.length, 1);
  assert.deepEqual(commands, [
    "events replay",
    "session bootstrap",
    "session join",
    "events replay",
    "events replay",
  ]);
  assert.match(prompts[0] ?? "", new RegExp(questionId));
  assert.match(prompts[0] ?? "", /Complete the requested work/u);
  assert.deepEqual(lifecycle, ["agent_started", "answer_verified"]);
});

test("coordinator explicitly recovers replay authentication without retrying publications", async () => {
  const commands: string[] = [];
  const launcher: CoordinationLauncher = {
    invoke: async (command) => {
      commands.push(command);
      if (commands.length === 1)
        return { schema: 1, status: "error", command, code: "YKC-AUTH-001" };
      if (command === "session bootstrap")
        return { schema: 1, status: "ok", command, result: { outcome: "bootstrapped" } };
      return replay(true);
    },
  };
  const coordinator = new ConversationCoordinator({
    launchers: { "agent-a": launcher, "agent-b": launcher },
    runner: { run: async () => assert.fail("answered question must not wake an agent") },
    maxTurns: 1,
    lifetimeMs: 10_000,
  });
  assert.equal(await coordinator.tick(), "idle");
  assert.deepEqual(commands, ["events replay", "session bootstrap", "events replay"]);
});

test("coordinator records replay bootstrap failures with the Yukh code", async () => {
  const lifecycle: unknown[] = [];
  const launcher: CoordinationLauncher = {
    invoke: async (command) =>
      command === "session bootstrap"
        ? { schema: 1, status: "error", command, code: "YKC-CUSTODY-001" }
        : { schema: 1, status: "error", command, code: "YKC-AUTH-001" },
  };
  const coordinator = new ConversationCoordinator({
    launchers: { "agent-a": launcher, "agent-b": launcher },
    runner: { run: async () => assert.fail() },
    maxTurns: 1,
    lifetimeMs: 10_000,
    observe: (event) => lifecycle.push(event),
  });
  await assert.rejects(coordinator.tick(), /coordination_unavailable/u);
  assert.deepEqual(lifecycle, [
    {
      schema: 1,
      event: "coordinator_coordination_failed",
      coordination_action: "bootstrap",
      ykc_code: "YKC-CUSTODY-001",
    },
  ]);
});

test("coordinator fails the agent before launch when target bootstrap is unavailable", async () => {
  const lifecycle: unknown[] = [];
  const commands: string[] = [];
  const launcher: CoordinationLauncher = {
    invoke: async (command) => {
      commands.push(command);
      if (command === "events replay") return replay(false);
      if (command === "session bootstrap")
        return { schema: 1, status: "error", command, code: "YKC-UNAVAILABLE-001" };
      return { schema: 1, status: "error", command, code: "YKC-AUTH-001" };
    },
  };
  const coordinator = new ConversationCoordinator({
    launchers: { "agent-a": launcher, "agent-b": launcher },
    runner: { run: async () => assert.fail("agent must not launch without bootstrap") },
    maxTurns: 1,
    lifetimeMs: 10_000,
    observe: (event) => lifecycle.push(event),
  });
  assert.equal(await coordinator.tick(), "handled");
  assert.deepEqual(commands, ["events replay", "session bootstrap", "session join"]);
  assert.deepEqual(lifecycle, [
    {
      schema: 1,
      event: "agent_started",
      agent: "agent-b",
      question_event_id: questionId,
      turn: 1,
    },
    {
      schema: 1,
      event: "coordinator_coordination_failed",
      coordination_action: "bootstrap",
      ykc_code: "YKC-UNAVAILABLE-001",
    },
    {
      schema: 1,
      event: "coordinator_coordination_failed",
      coordination_action: "join",
      ykc_code: "YKC-AUTH-001",
    },
    {
      schema: 1,
      event: "agent_failed",
      agent: "agent-b",
      question_event_id: questionId,
      turn: 1,
      failure_code: "agent_coordination_failed",
    },
  ]);
});

test("coordinator launches when repeated bootstrap fails but join succeeds", async () => {
  const lifecycle: unknown[] = [];
  const commands: string[] = [];
  let launched = false;
  let output = replay(false);
  const launcher: CoordinationLauncher = {
    invoke: async (command) => {
      commands.push(command);
      if (command === "events replay") return output;
      if (command === "session bootstrap")
        return { schema: 1, status: "error", command, code: "YKC-UNAVAILABLE-001" };
      return { schema: 1, status: "ok", command, result: { event_id: answerId } };
    },
  };
  const coordinator = new ConversationCoordinator({
    launchers: { "agent-a": launcher, "agent-b": launcher },
    runner: {
      run: async () => {
        launched = true;
        output = replay(true);
      },
    },
    maxTurns: 1,
    lifetimeMs: 10_000,
    observe: (event) => lifecycle.push(event),
  });
  assert.equal(await coordinator.tick(), "handled");
  assert.equal(launched, true);
  assert.deepEqual(commands, [
    "events replay",
    "session bootstrap",
    "session join",
    "events replay",
  ]);
  assert.deepEqual(lifecycle, [
    {
      schema: 1,
      event: "agent_started",
      agent: "agent-b",
      question_event_id: questionId,
      turn: 1,
    },
    {
      schema: 1,
      event: "answer_verified",
      agent: "agent-b",
      question_event_id: questionId,
      turn: 1,
    },
  ]);
});

test("coordinator fails the agent before launch when target join is unavailable", async () => {
  const lifecycle: unknown[] = [];
  const launcher: CoordinationLauncher = {
    invoke: async (command) => {
      if (command === "events replay") return replay(false);
      if (command === "session bootstrap")
        return { schema: 1, status: "ok", command, result: { outcome: "bootstrapped" } };
      return { schema: 1, status: "error", command, code: "YKC-CUSTODY-001" };
    },
  };
  const coordinator = new ConversationCoordinator({
    launchers: { "agent-a": launcher, "agent-b": launcher },
    runner: { run: async () => assert.fail("agent must not launch without Coordination") },
    maxTurns: 1,
    lifetimeMs: 10_000,
    observe: (event) => lifecycle.push(event),
  });
  assert.equal(await coordinator.tick(), "handled");
  assert.deepEqual(lifecycle, [
    {
      schema: 1,
      event: "agent_started",
      agent: "agent-b",
      question_event_id: questionId,
      turn: 1,
    },
    {
      schema: 1,
      event: "coordinator_coordination_failed",
      coordination_action: "join",
      ykc_code: "YKC-CUSTODY-001",
    },
    {
      schema: 1,
      event: "agent_failed",
      agent: "agent-b",
      question_event_id: questionId,
      turn: 1,
      failure_code: "agent_coordination_failed",
    },
  ]);
});

test("coordinator fails closed on malformed transcript and enforces lifetime", async () => {
  const launcher: CoordinationLauncher = {
    invoke: async () => ({
      schema: 1,
      status: "ok",
      command: "events replay",
      result: { records: [{}] },
    }),
  };
  let now = 0;
  const coordinator = new ConversationCoordinator({
    launchers: { "agent-a": launcher, "agent-b": launcher },
    runner: { run: async () => assert.fail() },
    maxTurns: 1,
    lifetimeMs: 1_000,
    now: () => now,
  });
  await assert.rejects(coordinator.tick(), /coordination_protocol_error/u);
  now = 1_000;
  assert.equal(await coordinator.tick(), "complete");
});

test("coordinator reports adapter success without a verified answer", async () => {
  const lifecycle: string[] = [];
  const launcher: CoordinationLauncher = { invoke: async () => replay(false) };
  const coordinator = new ConversationCoordinator({
    launchers: { "agent-a": launcher, "agent-b": launcher },
    runner: { run: async () => undefined },
    maxTurns: 1,
    lifetimeMs: 10_000,
    observe: (event) => lifecycle.push(event.event),
  });
  assert.equal(await coordinator.tick(), "handled");
  assert.deepEqual(lifecycle, ["agent_started", "agent_completed_without_answer"]);
});

test("coordinator reports a stable agent failure code", async () => {
  const lifecycle: Array<{ event: string; failure_code?: string }> = [];
  const launcher: CoordinationLauncher = { invoke: async () => replay(false) };
  const coordinator = new ConversationCoordinator({
    launchers: { "agent-a": launcher, "agent-b": launcher },
    runner: { run: async () => Promise.reject(new Error("agent_exit_nonzero")) },
    maxTurns: 1,
    lifetimeMs: 10_000,
    observe: (event) => lifecycle.push(event),
  });
  assert.equal(await coordinator.tick(), "handled");
  assert.deepEqual(lifecycle.at(-1), {
    schema: 1,
    event: "agent_failed",
    agent: "agent-b",
    question_event_id: questionId,
    turn: 1,
    failure_code: "agent_exit_nonzero",
  });
});

test("agent runner uses fixed workspace Codex and autonomous Copilot arguments", async () => {
  const root = await mkdtemp(join(tmpdir(), "yukh-conversation-runner-"));
  const log = join(root, "calls.jsonl");
  const source = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(1))+"\\n");
`;
  const codex = join(root, "codex-test");
  const copilot = join(root, "copilot-test");
  await writeFile(codex, source, { mode: 0o700 });
  await writeFile(copilot, source, { mode: 0o700 });
  try {
    const runner = createAgentRunner({ codex, copilot, workspace: root, timeoutMs: 5_000 });
    await runner.run("agent-a", "codex prompt");
    await runner.run("agent-b", "copilot prompt");
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(calls[0], [
      codex,
      "exec",
      "--ephemeral",
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "never",
      "codex prompt",
    ]);
    assert.deepEqual(calls[1], [
      copilot,
      "-p",
      "copilot prompt",
      "-s",
      "--no-ask-user",
      "--allow-all",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
