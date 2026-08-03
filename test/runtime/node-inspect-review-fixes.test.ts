import assert from "node:assert/strict";
import test from "node:test";
import {
  createNodeInspectCapability,
  type NodeInspectRequest,
} from "../../packages/capabilities/src/node-inspect.js";

const request: NodeInspectRequest = {
  request_version: 1,
  request_id: "req_review1",
  capability: { id: "node.inspect", version: "1.0.0" },
  resource: { kind: "node", ref: "node-local" },
  environment: "development",
  input: { path: "status.txt" },
  idempotency_key: null,
};

test("provider timeout fails closed with no output", async () => {
  const capability = createNodeInspectCapability({
    authorize: async () => ({ allowed: true, evidence_ref: "evidence_allow3" }),
    providerTimeoutMs: 5,
    provider: {
      async inspect() {
        return await new Promise(() => undefined);
      },
    },
  });
  const response = await capability.invoke(request);
  assert.equal((response.error as { code: string } | null)?.code, "execution_timeout");
  assert.equal(response.output, null);
  assert.equal(response.attempts, 1);
});

test("validation failure does not claim nonexistent evidence", async () => {
  const capability = createNodeInspectCapability({
    authorize: async () => {
      throw new Error("must not run");
    },
    provider: {
      async inspect() {
        throw new Error("must not run");
      },
    },
  });
  const malformed = { ...request, input: { path: "" } } as NodeInspectRequest;
  const response = await capability.invoke(malformed);
  assert.equal((response.error as { code: string } | null)?.code, "schema_validation_failed");
  assert.deepEqual(response.verification.evidence_refs, []);
});
