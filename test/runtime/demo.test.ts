import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
