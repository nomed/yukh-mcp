import assert from "node:assert/strict";
import test from "node:test";
import {
  createNodeInspectCapability,
  type NodeInspectRequest,
} from "../../packages/capabilities/src/node-inspect.js";

const validRequest: NodeInspectRequest = {
  request_version: 1,
  request_id: "req_boundary1",
  capability: { id: "node.inspect", version: "1.0.0" },
  resource: { kind: "node", ref: "node-local" },
  environment: "development",
  input: { path: "status.txt" },
  idempotency_key: null,
};

test("invalid input fails before authorization and provider invocation", async () => {
  let authorizations = 0;
  let invocations = 0;
  const capability = createNodeInspectCapability({
    authorize: async () => {
      authorizations += 1;
      return { allowed: true, evidence_ref: "evidence_unused1" };
    },
    provider: {
      async inspect() {
        invocations += 1;
        throw new Error("must not run");
      },
    },
  });
  const malformed = { ...validRequest, input: { path: "status.txt", extra: "rejected" } };
  const response = await capability.invoke(malformed as NodeInspectRequest);
  assert.equal((response.error as { code: string } | null)?.code, "schema_validation_failed");
  assert.equal(response.attempts, 0);
  assert.equal(authorizations, 0);
  assert.equal(invocations, 0);
});

test("invalid provider output is withheld", async () => {
  const capability = createNodeInspectCapability({
    authorize: async () => ({ allowed: true, evidence_ref: "evidence_allow2" }),
    provider: {
      async inspect() {
        return {
          source: { node_ref: "node-local", relative_path: "status.txt" },
          observed_at: "invalid",
          freshness_seconds: 0,
          entry: { kind: "file", size_bytes: 1, modified_at: "invalid" },
        };
      },
    },
  });
  const response = await capability.invoke(validRequest);
  assert.equal((response.error as { code: string } | null)?.code, "provider_protocol_error");
  assert.equal(response.output, null);
});
