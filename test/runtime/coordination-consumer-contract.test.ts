import assert from "node:assert/strict";
import test from "node:test";
import {
  COORDINATION_MEDIA_TYPE,
  createHttpsCoordinationConsumer,
  type CoordinationTransport,
} from "../../packages/coordination-consumer/src/https-adapter.js";
import {
  CoordinationConsumerError,
  type CoordinationBinding,
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
  epoch: 7,
  expires_at: "2099-08-03T15:00:30.000Z",
};

function response(value: object, status = 200, headers: Record<string, string> = {}) {
  const body = JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))),
  );
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": COORDINATION_MEDIA_TYPE,
      ...headers,
    },
  });
}

function adapter(transport: CoordinationTransport) {
  return createHttpsCoordinationConsumer({
    baseUri: "https://127.0.0.1/",
    deadlineMs: 100,
    authenticate: async ({ target, body_digest }) => {
      assert.match(target, /^https:\/\/127\.0\.0\.1\/coordination-primitives\/v1\//);
      assert.match(body_digest, /^[0-9a-f]{64}$/);
      return { credential: "synthetic-credential", proof: "synthetic-proof" };
    },
    transport,
  });
}

test("maps MCP bindings to one closed acquire request without raw identities", async () => {
  let calls = 0;
  const consumer = adapter(async (target, init) => {
    calls += 1;
    assert.equal(target, "https://127.0.0.1/coordination-primitives/v1/leases:acquire");
    assert.equal(init.redirect, "manual");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), ["epoch", "expires_at", "holder_digest", "scope_digest"]);
    assert.equal(body.epoch, 7);
    assert.match(String(body.scope_digest), /^[0-9a-f]{64}$/);
    assert.match(String(body.holder_digest), /^[0-9a-f]{64}$/);
    assert.equal(String(init.body).includes("subject-1"), false);
    return response({
      expires_at: binding.expires_at,
      fencing_token: 9,
      lease_capability: "opaque-synthetic-capability",
      outcome: "acquired",
      specversion: "1",
    });
  });
  const acquired = await consumer.acquireLease({ request_version: 1, binding });
  assert.equal(acquired.outcome, "acquired");
  assert.equal(acquired.fencing_token, 9);
  assert.equal(String(acquired.lease_capability), "LeaseCapability{REDACTED}");
  assert.throws(() => JSON.stringify(acquired.lease_capability));
  assert.equal(calls, 1);
});

test("uses the opaque capability only in fixed inspect renew and release bodies", async () => {
  const observed: string[] = [];
  const consumer = adapter(async (target, init) => {
    observed.push(target);
    if (target.endsWith("leases:acquire"))
      return response({
        expires_at: binding.expires_at,
        fencing_token: 1,
        lease_capability: "opaque-synthetic-capability",
        outcome: "acquired",
        specversion: "1",
      });
    if (target.endsWith("leases:inspect")) return response({ outcome: "valid", specversion: "1" });
    if (target.endsWith("leases:renew"))
      return response({
        expires_at: binding.expires_at,
        fencing_token: 2,
        lease_capability: "replacement-capability",
        outcome: "renewed",
        specversion: "1",
      });
    assert.equal(JSON.parse(String(init.body)).lease_capability, "replacement-capability");
    return response({ outcome: "released", specversion: "1" });
  });
  const acquired = await consumer.acquireLease({ request_version: 1, binding });
  assert.equal(
    (
      await consumer.inspectLease({
        request_version: 1,
        binding,
        lease_capability: acquired.lease_capability,
      })
    ).outcome,
    "valid",
  );
  const renewed = await consumer.renewLease({
    request_version: 1,
    binding,
    lease_capability: acquired.lease_capability,
    expires_at: binding.expires_at,
  });
  assert.equal(
    (
      await consumer.releaseLease({
        request_version: 1,
        binding,
        lease_capability: renewed.lease_capability,
      })
    ).outcome,
    "released",
  );
  assert.equal(observed.length, 4);
});

test("maps normative conflict and replay to closed fail-closed codes", async () => {
  const conflict = adapter(async () =>
    response(
      {
        code: "conflict",
        status: 409,
        title: "conflict",
        type: "urn:yukh:coordination-primitives:problem:conflict",
      },
      409,
    ),
  );
  await assert.rejects(
    conflict.acquireLease({ request_version: 1, binding }),
    (error: unknown) =>
      error instanceof CoordinationConsumerError && error.code === "coordination_conflict",
  );

  const replay = adapter(async () => response({ outcome: "replayed", specversion: "1" }));
  await assert.rejects(
    replay.consumeNonce({ request_version: 1, binding, nonce: "synthetic-one-shot-nonce" }),
    (error: unknown) =>
      error instanceof CoordinationConsumerError && error.code === "coordination_replayed",
  );
});

test("rejects malformed framing, redirects, unknown fields, and dependency detail", async () => {
  const malformed = adapter(async () =>
    response({ outcome: "consumed", provider_secret: "hidden", specversion: "1" }),
  );
  await assert.rejects(
    malformed.consumeNonce({ request_version: 1, binding, nonce: "synthetic-one-shot-nonce" }),
    (error: unknown) =>
      error instanceof CoordinationConsumerError && error.code === "coordination_response_invalid",
  );

  const unavailable = adapter(async () => {
    throw new Error("sensitive upstream detail");
  });
  await assert.rejects(
    unavailable.acquireLease({ request_version: 1, binding }),
    (error: unknown) =>
      error instanceof CoordinationConsumerError &&
      error.code === "coordination_unavailable" &&
      !error.message.includes("sensitive"),
  );
});

test("configuration and stale bindings fail before transport", async () => {
  assert.throws(() =>
    createHttpsCoordinationConsumer({
      baseUri: "http://127.0.0.1/",
      deadlineMs: 10,
      authenticate: async () => ({ credential: "x", proof: "y" }),
      transport: async () => response({}),
    }),
  );
  let calls = 0;
  const consumer = adapter(async () => {
    calls += 1;
    return response({});
  });
  await assert.rejects(
    consumer.acquireLease({
      request_version: 1,
      binding: { ...binding, expires_at: "2020-01-01T00:00:00.000Z" },
    }),
    (error: unknown) =>
      error instanceof CoordinationConsumerError && error.code === "coordination_request_invalid",
  );
  assert.equal(calls, 0);
});

test("deadline covers authentication and performs no transport retry", async () => {
  let transports = 0;
  const consumer = createHttpsCoordinationConsumer({
    baseUri: "https://127.0.0.1/",
    deadlineMs: 5,
    authenticate: async () => await new Promise(() => undefined),
    transport: async () => {
      transports += 1;
      return response({});
    },
  });
  await assert.rejects(
    consumer.acquireLease({ request_version: 1, binding }),
    (error: unknown) =>
      error instanceof CoordinationConsumerError && error.code === "coordination_unavailable",
  );
  assert.equal(transports, 0);
});
