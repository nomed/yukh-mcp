import assert from "node:assert/strict";
import test from "node:test";
import {
  CoordinationConsumerError,
  createCoordinationConsumer,
  type CoordinationBinding,
  type CoordinationConsumerDriver,
} from "../../packages/coordination-consumer/src/contract.js";

const binding: CoordinationBinding = {
  binding_version: 1,
  operation_ref: "operation-1",
  subject_ref: "subject-1",
  capability_ref: "service.restart@1.0.0",
  resource_set_digest: `sha256:${"1".repeat(64)}`,
  environment_ref: "staging",
  plan_digest: `sha256:${"2".repeat(64)}`,
  approval_digest: `sha256:${"3".repeat(64)}`,
};

const bindingDigest = `sha256:${"4".repeat(64)}`;
const now = new Date("2026-08-03T15:00:00.000Z");

function driver(overrides: Partial<CoordinationConsumerDriver> = {}): CoordinationConsumerDriver {
  const lease = (outcome: "acquired" | "active" | "renewed") => ({
    response_version: 1,
    operation_ref: binding.operation_ref,
    binding_digest: bindingDigest,
    evidence_ref: "evidence-lease-1",
    outcome,
    lease_ref: "lease-1",
    lease_handle: "sealed-lease-handle",
    fencing_token: "7",
    expires_at: "2026-08-03T15:00:30.000Z",
  });
  return {
    consumeNonce: async () => ({
      response_version: 1,
      operation_ref: binding.operation_ref,
      binding_digest: bindingDigest,
      evidence_ref: "evidence-nonce-1",
      outcome: "consumed",
      consumed_at: now.toISOString(),
    }),
    acquireLease: async () => lease("acquired"),
    inspectLease: async () => lease("active"),
    renewLease: async () => lease("renewed"),
    releaseLease: async () => ({
      response_version: 1,
      operation_ref: binding.operation_ref,
      binding_digest: bindingDigest,
      evidence_ref: "evidence-release-1",
      outcome: "released",
      lease_ref: "lease-1",
      fencing_token: "7",
      released_at: now.toISOString(),
    }),
    ...overrides,
  };
}

function consumer(overrides: Partial<CoordinationConsumerDriver> = {}) {
  return createCoordinationConsumer({
    driver: driver(overrides),
    digestBinding: () => bindingDigest,
    now: () => now,
  });
}

test("network-free fake satisfies the five closed consumer operations", async () => {
  const port = consumer();
  const nonce = await port.consumeNonce({
    request_version: 1,
    binding,
    nonce: "one-time-nonce-value",
  });
  assert.equal(nonce.outcome, "consumed");

  const acquired = await port.acquireLease({
    request_version: 1,
    binding,
    holder_digest: `sha256:${"5".repeat(64)}`,
    ttl_ms: 30_000,
  });
  assert.equal(acquired.fencing_token, "7");

  const handleRequest = {
    request_version: 1 as const,
    binding,
    lease_handle: acquired.lease_handle,
  };
  assert.equal((await port.inspectLease(handleRequest)).outcome, "active");
  assert.equal((await port.renewLease({ ...handleRequest, ttl_ms: 30_000 })).outcome, "renewed");
  assert.equal((await port.releaseLease(handleRequest)).outcome, "released");
});

test("malformed requests fail before the driver", async () => {
  let calls = 0;
  const port = consumer({
    consumeNonce: async () => {
      calls += 1;
      return {};
    },
  });
  await assert.rejects(
    port.consumeNonce({ request_version: 1, binding, nonce: "short" }),
    (error: unknown) =>
      error instanceof CoordinationConsumerError && error.code === "coordination_request_invalid",
  );
  assert.equal(calls, 0);
});

test("unknown fields and operation outcomes fail closed", async () => {
  const port = consumer({
    acquireLease: async () => ({
      response_version: 1,
      operation_ref: binding.operation_ref,
      binding_digest: bindingDigest,
      evidence_ref: "evidence-1",
      outcome: "acquired",
      lease_ref: "lease-1",
      lease_handle: "sealed-lease-handle",
      fencing_token: "7",
      expires_at: "2026-08-03T15:00:30.000Z",
      provider_debug: "must not cross boundary",
    }),
  });
  await assert.rejects(
    port.acquireLease({
      request_version: 1,
      binding,
      holder_digest: `sha256:${"5".repeat(64)}`,
      ttl_ms: 30_000,
    }),
    (error: unknown) =>
      error instanceof CoordinationConsumerError && error.code === "coordination_response_invalid",
  );
});

test("cross-operation substitution and stale leases fail closed", async () => {
  const mismatched = consumer({
    inspectLease: async () => ({
      ...((await driver().inspectLease({
        request_version: 1,
        binding,
        lease_handle: "sealed-lease-handle",
      })) as object),
      operation_ref: "another-operation",
    }),
  });
  await assert.rejects(
    mismatched.inspectLease({
      request_version: 1,
      binding,
      lease_handle: "sealed-lease-handle",
    }),
    (error: unknown) =>
      error instanceof CoordinationConsumerError && error.code === "coordination_binding_mismatch",
  );

  const stale = consumer({
    inspectLease: async () => ({
      ...((await driver().inspectLease({
        request_version: 1,
        binding,
        lease_handle: "sealed-lease-handle",
      })) as object),
      expires_at: now.toISOString(),
    }),
  });
  await assert.rejects(
    stale.inspectLease({
      request_version: 1,
      binding,
      lease_handle: "sealed-lease-handle",
    }),
    (error: unknown) =>
      error instanceof CoordinationConsumerError && error.code === "coordination_receipt_stale",
  );
});

test("dependency errors are normalized without leaking their message", async () => {
  const port = consumer({
    consumeNonce: async () => {
      throw new Error("sensitive upstream detail");
    },
  });
  await assert.rejects(
    port.consumeNonce({
      request_version: 1,
      binding,
      nonce: "one-time-nonce-value",
    }),
    (error: unknown) =>
      error instanceof CoordinationConsumerError &&
      error.code === "coordination_unavailable" &&
      !error.message.includes("sensitive"),
  );
});

test("an unresponsive dependency times out without retry", async () => {
  let calls = 0;
  const port = createCoordinationConsumer({
    driver: driver({
      consumeNonce: async () => {
        calls += 1;
        return await new Promise(() => undefined);
      },
    }),
    digestBinding: () => bindingDigest,
    now: () => now,
    driverTimeoutMs: 5,
  });
  await assert.rejects(
    port.consumeNonce({
      request_version: 1,
      binding,
      nonce: "one-time-nonce-value",
    }),
    (error: unknown) =>
      error instanceof CoordinationConsumerError && error.code === "coordination_unavailable",
  );
  assert.equal(calls, 1);
});
