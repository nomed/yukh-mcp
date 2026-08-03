import assert from "node:assert/strict";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createNodeInspectCapability } from "../../packages/capabilities/src/node-inspect.js";
import {
  createLocalReadNodeProvider,
  LocalReadProviderError,
} from "../../packages/providers/local-read/src/node-inspect.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "yukh-node-root-"));
  const outside = await mkdtemp(join(tmpdir(), "yukh-node-outside-"));
  await writeFile(join(root, "status.txt"), "bounded fixture\n", "utf8");
  await writeFile(join(outside, "secret.txt"), "must not be observed\n", "utf8");
  return { root, outside };
}

test("local provider returns bounded metadata with source and freshness", async () => {
  const { root } = await fixture();
  const now = new Date("2026-08-03T13:00:00.000Z");
  const provider = await createLocalReadNodeProvider([{ ref: "node-local", root }], {
    now: () => now,
  });
  const output = await provider.inspect("node-local", { path: "status.txt" });
  assert.deepEqual(output.source, { node_ref: "node-local", relative_path: "status.txt" });
  assert.equal(output.entry.kind, "file");
  assert.equal(output.entry.size_bytes, 16);
  assert.equal(output.observed_at, now.toISOString());
  assert.equal(Object.hasOwn(output.entry, "content"), false);
  assert.ok(JSON.stringify(output).length < 1_024);
});

test("traversal, absolute paths, controls, and symlinks fail closed", async () => {
  const { root, outside } = await fixture();
  await symlink(join(outside, "secret.txt"), join(root, "escape"));
  const provider = await createLocalReadNodeProvider([{ ref: "node-local", root }]);
  for (const path of [
    "../secret.txt",
    "/etc/passwd",
    "sub/../status.txt",
    "status.txt\n",
    "escape",
  ])
    await assert.rejects(provider.inspect("node-local", { path }), LocalReadProviderError);
  await assert.rejects(
    provider.inspect("unknown-node", { path: "status.txt" }),
    LocalReadProviderError,
  );
});

test("authorization denies before provider invocation", async () => {
  let invocations = 0;
  const capability = createNodeInspectCapability({
    provider: {
      async inspect() {
        invocations += 1;
        throw new Error("must not run");
      },
    },
    authorize: async () => ({ allowed: false, evidence_ref: "evidence_denied1" }),
    now: () => new Date("2026-08-03T13:00:00.000Z"),
  });
  const response = await capability.invoke(request("req_denied1"));
  assert.equal(response.status, "denied");
  assert.equal(response.attempts, 0);
  assert.equal(invocations, 0);
});

test("authorized invocation returns a structured capability result", async () => {
  const { root } = await fixture();
  const now = () => new Date("2026-08-03T13:00:00.000Z");
  const provider = await createLocalReadNodeProvider([{ ref: "node-local", root }], { now });
  const capability = createNodeInspectCapability({
    provider,
    authorize: async () => ({ allowed: true, evidence_ref: "evidence_allow1" }),
    now,
  });
  const response = await capability.invoke(request("req_allowed1"));
  assert.equal(response.status, "succeeded");
  assert.equal(response.verification.status, "verified");
  assert.deepEqual(response.verification.evidence_refs, ["evidence_allow1"]);
});

function request(request_id: string) {
  return {
    request_version: 1 as const,
    request_id,
    capability: { id: "node.inspect" as const, version: "1.0.0" as const },
    resource: { kind: "node" as const, ref: "node-local" },
    environment: "development",
    input: { path: "status.txt" },
    idempotency_key: null,
  };
}
