import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runReadOnlyDemo } from "../../apps/demo/src/demo.js";

interface ToolResult {
  readonly status: "succeeded" | "denied" | "failed";
  readonly attempts: number;
  readonly verification: {
    readonly status: "verified" | "not_applicable";
    readonly evidence_refs: readonly string[];
  };
}

function toolResult(response: unknown): ToolResult {
  assert.ok(response && typeof response === "object");
  const structuredContent = (response as { structuredContent?: unknown }).structuredContent;
  assert.ok(structuredContent && typeof structuredContent === "object");
  const result = (structuredContent as { result?: unknown }).result;
  assert.ok(result && typeof result === "object");
  return result as ToolResult;
}

function waitForReady(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let pending = "";
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdout?.off("data", onData);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve();
    };
    const onData = (chunk: string) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      try {
        for (const line of lines) {
          if (line.length === 0) continue;
          const message: unknown = JSON.parse(line);
          if (
            message &&
            typeof message === "object" &&
            (message as { type?: unknown }).type === "ready"
          ) {
            finish();
            return;
          }
        }
      } catch {
        finish(new Error("invalid isolated demo server output"));
      }
    };
    const onExit = () => finish(new Error("isolated demo server exited before readiness"));
    const timeout = setTimeout(
      () => finish(new Error("isolated demo server readiness timed out")),
      timeoutMs,
    );
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", onData);
    child.once("exit", onExit);
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const onExit = (code: number | null) => {
      clearTimeout(timeout);
      resolve(code);
    };
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      reject(new Error("isolated demo server exit timed out"));
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

test("local E2E correlates allow and deny results with policy evidence", async () => {
  const transcript = await runReadOnlyDemo();
  assert.equal(transcript.mode, "local_e2e");
  assert.deepEqual(transcript.transport, {
    protocol: "mcp_streamable_http",
    binding: "127.0.0.1:ephemeral",
    client: "@modelcontextprotocol/client",
    server_process: "isolated_child",
  });
  assert.deepEqual(transcript.discovery.tools, ["node.inspect"]);
  assert.equal((transcript.allowed as { isError?: boolean }).isError, false);
  assert.equal((transcript.denied as { isError?: boolean }).isError, true);
  const allowed = toolResult(transcript.allowed);
  const denied = toolResult(transcript.denied);
  assert.equal(allowed.status, "succeeded");
  assert.equal(allowed.attempts, 1);
  assert.equal(allowed.verification.status, "verified");
  assert.equal(denied.status, "denied");
  assert.equal(denied.attempts, 0);
  assert.equal(denied.verification.status, "not_applicable");
  assert.deepEqual(
    transcript.evidence_projection.map(({ effect }) => effect),
    ["allow", "deny"],
  );
  const [allowEvidence, denyEvidence] = transcript.evidence_projection;
  assert.ok(allowEvidence);
  assert.ok(denyEvidence);
  assert.deepEqual(allowed.verification.evidence_refs, [allowEvidence.evidence_ref]);
  assert.deepEqual(denied.verification.evidence_refs, [denyEvidence.evidence_ref]);
  assert.ok(
    transcript.evidence_projection.every(
      ({ durability, classification }) =>
        durability === "in_memory_demo_only" && classification === "protected",
    ),
  );
  assert.equal(JSON.stringify(transcript).includes("synthetic healthy fixture"), false);
  assert.deepEqual(transcript.cleanup, {
    server_process: "stopped",
    fixture: "removed",
  });
});

test("cleanup removes only the invocation fixture", async () => {
  const concurrentFixture = await mkdtemp(join(tmpdir(), "yukh-demo-"));
  let invocationFixture: string | undefined;
  try {
    await runReadOnlyDemo({
      onFixtureCreated: (root) => {
        invocationFixture = root;
      },
    });
    assert.ok(invocationFixture);
    await assert.rejects(access(invocationFixture), { code: "ENOENT" });
    await access(concurrentFixture);
  } finally {
    await rm(concurrentFixture, { recursive: true, force: true });
  }
});

test("isolated child shuts itself down when its parent IPC channel disconnects", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "yukh-demo-"));
  const serverEntrypoint = fileURLToPath(
    new URL("../../apps/demo/src/server-main.ts", import.meta.url),
  );
  const child = spawn(process.execPath, [...process.execArgv, serverEntrypoint, fixture], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stderr?.resume();
  try {
    await writeFile(join(fixture, "status.txt"), "synthetic healthy fixture\n", "utf8");
    await waitForReady(child, 5_000);
    child.disconnect();
    assert.equal(await waitForExit(child, 2_000), 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, 2_000);
    }
    await rm(fixture, { recursive: true, force: true });
  }
  await assert.rejects(access(fixture), { code: "ENOENT" });
});
