import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
} from "node:fs";
import { Agent, request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { isAbsolute } from "node:path";
import { Readable } from "node:stream";
import { checkServerIdentity } from "node:tls";
import { inspect } from "node:util";
import {
  CoordinationConsumerError,
  type CoordinationConsumer,
  type LeaseAcquireRequest,
  type LeaseHandleRequest,
  type LeaseRenewRequest,
  type NonceConsumeRequest,
} from "./contract.js";
import {
  createHttpsCoordinationConsumer,
  type CoordinationTransport,
  type RequestAuthenticator,
} from "./https-adapter.js";

export const PRIVATE_COORDINATION_PROFILE = "yukh-mcp/private-coordination-staging-v1";
const ROUTES = new Set([
  "/coordination-primitives/v1/nonces:consume",
  "/coordination-primitives/v1/leases:acquire",
  "/coordination-primitives/v1/leases:inspect",
  "/coordination-primitives/v1/leases:renew",
  "/coordination-primitives/v1/leases:release",
]);
const MAX_TOKEN_BYTES = 512;
const MAX_KEY_BYTES = 8_192;
const MAX_TRUST_BYTES = 64 * 1_024;

export interface PrivateCoordinationProfileConfig {
  readonly profile: typeof PRIVATE_COORDINATION_PROFILE;
  readonly baseUri: string;
  readonly trustBundlePath: string;
  readonly serverName: string;
  readonly tokenDescriptor: number;
  readonly privateKeyDescriptor: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly expectedThumbprint: string;
  readonly deadlineMs: number;
  readonly epoch: number;
  readonly environmentRef: string;
}

function unavailable(): never {
  throw new CoordinationConsumerError("coordination_unavailable");
}

function exactOrigin(value: string) {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    throw new TypeError("invalid private coordination profile");
  return parsed;
}

function safeFile(path: string, maximum: number) {
  try {
    if (!isAbsolute(path) || realpathSync(path) !== path)
      throw new TypeError("invalid private coordination profile");
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o022) !== 0 ||
      stat.size < 1 ||
      stat.size > maximum
    )
      throw new TypeError("invalid private coordination profile");
    return readFileSync(path);
  } catch {
    throw new TypeError("invalid private coordination profile");
  }
}

function descriptorBytes(descriptor: number, maximum: number) {
  if (!Number.isInteger(descriptor) || descriptor < 3)
    throw new TypeError("invalid private coordination profile");
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum)
      throw new TypeError("invalid private coordination profile");
    const value = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < value.length) {
      const count = readSync(descriptor, value, offset, value.length - offset, offset);
      if (count === 0) unavailable();
      offset += count;
    }
    return value;
  } catch {
    throw new TypeError("invalid private coordination profile");
  } finally {
    try {
      closeSync(descriptor);
    } catch {
      throw new TypeError("invalid private coordination profile");
    }
  }
}

function b64(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

// Hashing the RFC 7638 canonical public JWK does not require a signing key.
function publicThumbprint(jwk: JsonWebKey) {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) unavailable();
  return createHash("sha256")
    .update(JSON.stringify({ crv: "P-256", kty: "EC", x: jwk.x, y: jwk.y }))
    .digest("base64url");
}

class SecretMaterial {
  #token: Buffer;
  #key: KeyObject;
  readonly publicJwk: JsonWebKey;
  closed = false;

  constructor(token: Buffer, keyBytes: Buffer, expectedThumbprint: string) {
    try {
      this.#key = createPrivateKey({ key: keyBytes, format: "der", type: "pkcs8" });
      if (
        this.#key.asymmetricKeyType !== "ec" ||
        this.#key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
      )
        unavailable();
      this.publicJwk = createPublicKey(this.#key).export({ format: "jwk" });
      if (publicThumbprint(this.publicJwk) !== expectedThumbprint) unavailable();
      this.#token = Buffer.from(token);
    } catch {
      unavailable();
    } finally {
      token.fill(0);
      keyBytes.fill(0);
    }
  }

  authenticate(method: "POST", target: string, now: Date) {
    if (this.closed) unavailable();
    const token = this.#token.toString("ascii");
    const protectedHeader = b64(
      JSON.stringify({ alg: "ES256", jwk: this.publicJwk, typ: "dpop+jwt" }),
    );
    const claims = b64(
      JSON.stringify({
        ath: createHash("sha256").update(token, "ascii").digest("base64url"),
        htm: method,
        htu: target,
        iat: Math.floor(now.getTime() / 1000),
        jti: randomBytes(16).toString("base64url"),
      }),
    );
    const input = `${protectedHeader}.${claims}`;
    const signature = createSign("sha256")
      .update(input)
      .sign({ key: this.#key, dsaEncoding: "ieee-p1363" });
    return { credential: `DPoP ${token}`, proof: `${input}.${b64(signature)}` };
  }

  close() {
    this.closed = true;
    this.#token.fill(0);
  }

  toString() {
    return "SecretMaterial{REDACTED}";
  }
  toJSON(): never {
    throw new TypeError("private coordination secret is not serializable");
  }
  [inspect.custom]() {
    return this.toString();
  }
}

export class PrivateCoordinationProfile {
  readonly consumer: CoordinationConsumer;
  #agent: Agent;
  #secret: SecretMaterial;
  #expiresAt: number;
  #now: () => Date;
  #lastClock = 0;
  #closed = false;

  constructor(config: PrivateCoordinationProfileConfig, now: () => Date = () => new Date()) {
    const exactKeys = [
      "baseUri",
      "deadlineMs",
      "environmentRef",
      "epoch",
      "expectedThumbprint",
      "expiresAt",
      "issuedAt",
      "privateKeyDescriptor",
      "profile",
      "serverName",
      "tokenDescriptor",
      "trustBundlePath",
    ];
    if (
      JSON.stringify(Object.keys(config).sort()) !== JSON.stringify(exactKeys) ||
      config.profile !== PRIVATE_COORDINATION_PROFILE ||
      config.tokenDescriptor === config.privateKeyDescriptor ||
      config.deadlineMs < 1 ||
      config.deadlineMs > 2_000 ||
      !Number.isSafeInteger(config.epoch) ||
      config.epoch < 1 ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(config.environmentRef) ||
      !/^[A-Za-z0-9_-]{43}$/.test(config.expectedThumbprint)
    )
      throw new TypeError("invalid private coordination profile");
    const origin = exactOrigin(config.baseUri);
    if (origin.hostname !== config.serverName)
      throw new TypeError("invalid private coordination profile");
    const issuedAt = Date.parse(config.issuedAt);
    const expiresAt = Date.parse(config.expiresAt);
    const current = now().getTime();
    if (
      !Number.isFinite(issuedAt) ||
      !Number.isFinite(expiresAt) ||
      issuedAt > current + 5_000 ||
      expiresAt <= current ||
      expiresAt - issuedAt > 15 * 60_000
    )
      throw new TypeError("invalid private coordination profile");
    const trust = safeFile(config.trustBundlePath, MAX_TRUST_BYTES);
    let token: Buffer | undefined;
    let key: Buffer | undefined;
    let keyDescriptorAttempted = false;
    try {
      token = descriptorBytes(config.tokenDescriptor, MAX_TOKEN_BYTES);
      keyDescriptorAttempted = true;
      key = descriptorBytes(config.privateKeyDescriptor, MAX_KEY_BYTES);
      this.#secret = new SecretMaterial(token, key, config.expectedThumbprint);
      this.#agent = new Agent({
        ca: Buffer.from(trust),
        keepAlive: false,
        maxSockets: 1,
        rejectUnauthorized: true,
      });
    } catch {
      if (!keyDescriptorAttempted) {
        try {
          closeSync(config.privateKeyDescriptor);
        } catch {
          // The construction result remains the same closed error.
        }
      }
      throw new TypeError("invalid private coordination profile");
    } finally {
      trust.fill(0);
      token?.fill(0);
      key?.fill(0);
    }
    this.#expiresAt = expiresAt;
    this.#now = now;
    this.#lastClock = current;

    const authenticate: RequestAuthenticator = async ({ method, target }) => {
      const instant = this.#now();
      if (!this.readyAt(instant)) unavailable();
      return this.#secret.authenticate(method, target, instant);
    };
    const consumer = createHttpsCoordinationConsumer({
      baseUri: origin.href,
      deadlineMs: config.deadlineMs,
      authenticate,
      transport: this.transport(origin, config.serverName),
    });
    const binding = <T extends { binding: { epoch: number; environment_ref: string } }>(
      request: T,
    ) => {
      if (
        request.binding.epoch !== config.epoch ||
        request.binding.environment_ref !== config.environmentRef
      )
        throw new CoordinationConsumerError("coordination_request_invalid");
      return request;
    };
    this.consumer = Object.freeze({
      consumeNonce: (request: NonceConsumeRequest) => consumer.consumeNonce(binding(request)),
      acquireLease: (request: LeaseAcquireRequest) => consumer.acquireLease(binding(request)),
      inspectLease: (request: LeaseHandleRequest) => consumer.inspectLease(binding(request)),
      renewLease: (request: LeaseRenewRequest) => consumer.renewLease(binding(request)),
      releaseLease: (request: LeaseHandleRequest) => consumer.releaseLease(binding(request)),
    });
  }

  private readyAt(instant: Date) {
    const time = instant.getTime();
    if (
      this.#closed ||
      !Number.isFinite(time) ||
      time < this.#lastClock - 5_000 ||
      time >= this.#expiresAt
    )
      return false;
    this.#lastClock = Math.max(this.#lastClock, time);
    return true;
  }

  ready() {
    return this.readyAt(this.#now());
  }

  private transport(origin: URL, serverName: string): CoordinationTransport {
    return async (target, init) => {
      if (this.#closed) unavailable();
      const parsed = new URL(target);
      if (
        parsed.origin !== origin.origin ||
        !ROUTES.has(parsed.pathname) ||
        parsed.search ||
        parsed.hash
      )
        unavailable();
      return await new Promise<Response>((resolve, reject) => {
        let settled = false;
        const request = httpsRequest(
          parsed,
          {
            agent: this.#agent,
            method: "POST",
            headers: {
              ...Object.fromEntries(new Headers(init.headers).entries()),
              "accept-encoding": "identity",
            },
            servername: isIP(serverName) ? undefined : serverName,
            checkServerIdentity,
            signal: init.signal ?? undefined,
          },
          (response) => {
            if (settled) return;
            settled = true;
            resolve(
              new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
                status: response.statusCode ?? 500,
                headers: response.headers as Record<string, string>,
              }),
            );
          },
        );
        request.once("error", (error) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
        request.end(init.body as string);
      });
    };
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#agent.destroy();
    this.#secret.close();
  }

  toString() {
    return "PrivateCoordinationProfile{REDACTED}";
  }
  toJSON(): never {
    throw new TypeError("private coordination profile is not serializable");
  }
  [inspect.custom]() {
    return this.toString();
  }
}
