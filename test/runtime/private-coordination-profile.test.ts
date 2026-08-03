import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PRIVATE_COORDINATION_PROFILE,
  PrivateCoordinationProfile,
  type PrivateCoordinationProfileConfig,
} from "../../packages/coordination-consumer/src/private-staging-profile.js";
import type { CoordinationBinding } from "../../packages/coordination-consumer/src/contract.js";
import { CoordinationConsumerError } from "../../packages/coordination-consumer/src/contract.js";

const binding: CoordinationBinding = {
  binding_version: 1,
  operation_ref: "synthetic-operation",
  subject_ref: "synthetic-subject",
  capability_ref: "synthetic.capability@1.0.0",
  resource_set_digest: `sha256:${"1".repeat(64)}`,
  environment_ref: "synthetic-staging",
  plan_digest: `sha256:${"2".repeat(64)}`,
  approval_digest: `sha256:${"3".repeat(64)}`,
  epoch: 7,
  expires_at: "2099-08-03T22:10:00.000Z",
};

function thumbprint(jwk: JsonWebKey) {
  return createHash("sha256")
    .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))
    .digest("base64url");
}

test("private profile consumes descriptors and sends one exact TLS DPoP request", async () => {
  const root = mkdtempSync(join(tmpdir(), "yukh-mcp-private-coordination-"));
  chmodSync(root, 0o700);
  const certificatePath = join(root, "server.pem");
  const serverKeyPath = join(root, "server-key.pem");
  const tokenPath = join(root, "token");
  const proofKeyPath = join(root, "proof-key.der");
  let profile: PrivateCoordinationProfile | undefined;
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        serverKeyPath,
        "-out",
        certificatePath,
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
    chmodSync(serverKeyPath, 0o600);
    chmodSync(certificatePath, 0o600);
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const publicJwk = publicKey.export({ format: "jwk" });
    writeFileSync(tokenPath, "synthetic-opaque-token-with-256-bits-minimum");
    writeFileSync(proofKeyPath, privateKey.export({ format: "der", type: "pkcs8" }));
    chmodSync(tokenPath, 0o600);
    chmodSync(proofKeyPath, 0o600);
    const tokenDescriptor = openSync(tokenPath, "r");
    const keyDescriptor = openSync(proofKeyPath, "r");
    let requests = 0;
    let serverPort = 0;
    const server = createServer(
      { cert: readFileSync(certificatePath), key: readFileSync(serverKeyPath) },
      (request, response) => {
        requests += 1;
        const proof = String(request.headers.dpop);
        const [header, claims, signature] = proof.split(".");
        assert(header && claims && signature);
        assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), {
          alg: "ES256",
          jwk: publicJwk,
          typ: "dpop+jwt",
        });
        const decoded = JSON.parse(Buffer.from(claims, "base64url").toString()) as Record<
          string,
          unknown
        >;
        assert.equal(decoded.htm, "POST");
        assert.equal(
          decoded.htu,
          `https://127.0.0.1:${serverPort}/coordination-primitives/v1/nonces:consume`,
        );
        assert.equal(
          decoded.ath,
          createHash("sha256")
            .update("synthetic-opaque-token-with-256-bits-minimum", "ascii")
            .digest("base64url"),
        );
        assert.match(String(decoded.jti), /^[A-Za-z0-9_-]{22}$/);
        assert.equal(
          verify(
            "sha256",
            Buffer.from(`${header}.${claims}`),
            { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" },
            Buffer.from(signature, "base64url"),
          ),
          true,
        );
        assert.equal(
          request.headers.authorization,
          "DPoP synthetic-opaque-token-with-256-bits-minimum",
        );
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/yukh-coordination-primitives+json;version=1",
        });
        response.end('{"outcome":"consumed","specversion":"1"}');
      },
    );
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      assert(address && typeof address === "object");
      serverPort = address.port;
      const now = new Date("2026-08-03T22:00:00.000Z");
      const config: PrivateCoordinationProfileConfig = {
        profile: PRIVATE_COORDINATION_PROFILE,
        baseUri: `https://127.0.0.1:${address.port}/`,
        trustBundlePath: certificatePath,
        serverName: "127.0.0.1",
        tokenDescriptor,
        privateKeyDescriptor: keyDescriptor,
        issuedAt: "2026-08-03T21:59:00.000Z",
        expiresAt: "2026-08-03T22:09:00.000Z",
        expectedThumbprint: thumbprint(publicJwk),
        deadlineMs: 1_000,
        epoch: 7,
        environmentRef: "synthetic-staging",
      };
      profile = new PrivateCoordinationProfile(config, () => now);
      const activeProfile = profile;
      assert.equal(activeProfile.ready(), true);
      assert.throws(() => fstatSync(tokenDescriptor));
      assert.throws(() => fstatSync(keyDescriptor));
      assert.equal(
        (
          await activeProfile.consumer.consumeNonce({
            request_version: 1,
            binding,
            nonce: "synthetic-one-use-nonce",
          })
        ).outcome,
        "consumed",
      );
      assert.equal(requests, 1);
      assert.throws(
        () =>
          activeProfile.consumer.consumeNonce({
            request_version: 1,
            binding: { ...binding, environment_ref: "other-environment" },
            nonce: "synthetic-one-use-nonce",
          }),
        (error: unknown) =>
          error instanceof CoordinationConsumerError &&
          error.code === "coordination_request_invalid",
      );
      assert.equal(requests, 1);
      assert.equal(String(activeProfile), "PrivateCoordinationProfile{REDACTED}");
      assert.throws(() => JSON.stringify(activeProfile));
    } finally {
      profile?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    profile?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("profile is disabled outside explicit construction and fails closed", () => {
  const gateway = readFileSync(new URL("../../apps/gateway/src/main.ts", import.meta.url), "utf8");
  assert.doesNotMatch(gateway, /PrivateCoordinationProfile|private-staging-profile/u);
  assert.throws(
    () =>
      new PrivateCoordinationProfile({
        profile: PRIVATE_COORDINATION_PROFILE,
        baseUri: "http://127.0.0.1/",
        trustBundlePath: "/missing",
        serverName: "127.0.0.1",
        tokenDescriptor: 3,
        privateKeyDescriptor: 4,
        issuedAt: "2026-08-03T21:59:00.000Z",
        expiresAt: "2026-08-03T22:09:00.000Z",
        expectedThumbprint: "a".repeat(43),
        deadlineMs: 1_000,
        epoch: 7,
        environmentRef: "synthetic-staging",
      }),
    /invalid private coordination profile/u,
  );
});
