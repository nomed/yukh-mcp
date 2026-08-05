import { inspect } from "node:util";

export const MAX_MATERIALIZER_PACKAGE_BYTES = 64 * 1024;
export const MAX_MATERIALIZER_PACKAGE_LIFETIME_MS = 15 * 60 * 1_000;
export const MIN_MATERIALIZER_REQUEST_RESERVE = 1_000;

const MAX_OPAQUE_MATERIAL_BYTES = 16 * 1_024;
const scopeKeys = ["issue_number", "mode", "owner", "policy_path", "project_number", "repository"];
const bindingKeys = [
  "environment",
  "event_name",
  "operation_set_digest",
  "plan_digest",
  "plan_id",
  "policy_commit",
  "producer_ref",
  "profile",
  "repository_id",
  "run_attempt",
  "run_id",
  "scope",
  "workflow_ref",
];
const mutationKindPattern = /^[a-z][a-z0-9_]{0,63}$/u;
const namePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const opaqueMaterialPattern = /^[A-Za-z0-9._~+/=-]+$/u;
const policyPathPattern = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/u;
const profilePattern = /^[a-z0-9][a-z0-9._/-]{0,127}$/u;
const workflowRefPattern = /^[A-Za-z0-9._/@-]{1,512}$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
const producerRefPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

type JsonRecord = Record<string, unknown>;

export interface MaterializerScope {
  readonly owner: string;
  readonly repository: string;
  readonly projectNumber: number;
  readonly issueNumber: number;
  readonly policyPath: string;
  readonly mode: string;
}

export interface MaterializerPackageBinding {
  readonly profile: string;
  readonly scope: MaterializerScope;
  readonly repositoryId: string;
  readonly workflowRef: string;
  readonly eventName: "workflow_dispatch";
  readonly environment: string;
  readonly runId: string;
  readonly runAttempt: 1;
  readonly policyCommit: string;
  readonly producerRef: string;
  readonly planId: string;
  readonly planDigest: string;
  readonly operationSetDigest: string;
}

export interface MaterializerRequestCeilings {
  readonly graphql: number;
  readonly rest: number;
}

export interface MaterializerPackageExpectation {
  readonly binding: MaterializerPackageBinding;
  readonly allowedMutationKinds: readonly string[];
  readonly requestCeilings: MaterializerRequestCeilings;
}

export interface MaterializerRateLimit {
  readonly reserve: number;
  readonly maxRequests: number;
}

export interface MaterializerHostCapsule {
  readonly enabled: true;
  readonly scope: MaterializerScope;
  readonly coordinationEpoch: number;
  readonly rateLimits: Readonly<{
    readonly graphql: MaterializerRateLimit;
    readonly rest: MaterializerRateLimit;
  }>;
  readonly mutationKinds: readonly string[];
}

export type MaterializerSecretKind =
  | "approval_envelope"
  | "approval_trust_root"
  | "host_capsule_credential"
  | "host_capsule_dpop_private_key"
  | "read_credential"
  | "write_credential";

export interface MaterializerSecret {
  readonly kind: MaterializerSecretKind;
  toString(): "MaterializerSecret{REDACTED}";
  toJSON(): never;
}

export interface MaterializerPackage {
  readonly packageVersion: 1;
  readonly binding: MaterializerPackageBinding;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly receipt: Readonly<{ readonly oneTime: true }>;
  readonly hostCapsule: MaterializerHostCapsule;
  readonly material: Readonly<{
    readonly readCredential: MaterializerSecret;
    readonly writeCredential: MaterializerSecret;
    readonly approvalEnvelope: MaterializerSecret;
    readonly approvalTrustRoot: MaterializerSecret;
    readonly hostCapsuleCredential: MaterializerSecret;
    readonly hostCapsuleDpopPrivateKey: MaterializerSecret;
  }>;
  toString(): "MaterializerPackage{REDACTED}";
  toJSON(): never;
}

export interface MaterializerPackageParser {
  parse(serialized: string): MaterializerPackage;
}

export type MaterializerPackageErrorCode = "materializer_package_invalid";

export class MaterializerPackageError extends Error {
  constructor(readonly code: MaterializerPackageErrorCode = "materializer_package_invalid") {
    super(code);
    this.name = "MaterializerPackageError";
  }
}

function invalid(): never {
  throw new MaterializerPackageError();
}

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function record(value: unknown): JsonRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    invalid();
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  )
    invalid();
}

function text(value: unknown, maximum: number, pattern: RegExp): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    Buffer.byteLength(value, "utf8") > maximum ||
    !pattern.test(value)
  )
    invalid();
  return value;
}

function positiveInteger(value: unknown, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum)
    invalid();
  return value;
}

function parseScope(value: unknown): MaterializerScope {
  const source = record(value);
  exactKeys(source, scopeKeys);
  const policyPath = text(source.policy_path, 256, policyPathPattern);
  if (policyPath.split("/").includes("..")) invalid();
  return frozen({
    owner: text(source.owner, 128, namePattern),
    repository: text(source.repository, 128, namePattern),
    projectNumber: positiveInteger(source.project_number, 9_999_999),
    issueNumber: positiveInteger(source.issue_number, 9_999_999),
    policyPath,
    mode: text(source.mode, 64, /^[a-z][a-z0-9-]{0,63}$/u),
  });
}

function sameScope(left: MaterializerScope, right: MaterializerScope): boolean {
  return (
    left.owner === right.owner &&
    left.repository === right.repository &&
    left.projectNumber === right.projectNumber &&
    left.issueNumber === right.issueNumber &&
    left.policyPath === right.policyPath &&
    left.mode === right.mode
  );
}

function parseBinding(value: unknown): MaterializerPackageBinding {
  const source = record(value);
  exactKeys(source, bindingKeys);
  const profile = text(source.profile, 128, profilePattern);
  if (profile.includes("..")) invalid();
  return frozen({
    profile,
    scope: parseScope(source.scope),
    repositoryId: text(source.repository_id, 20, /^[1-9][0-9]{0,19}$/u),
    workflowRef: text(source.workflow_ref, 512, workflowRefPattern),
    eventName: source.event_name === "workflow_dispatch" ? "workflow_dispatch" : invalid(),
    environment: text(source.environment, 128, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u),
    runId: text(source.run_id, 20, /^[1-9][0-9]{0,19}$/u),
    runAttempt: source.run_attempt === 1 ? 1 : invalid(),
    policyCommit: text(source.policy_commit, 40, commitPattern),
    producerRef: text(source.producer_ref, 256, producerRefPattern),
    planId: text(source.plan_id, 128, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
    planDigest: text(source.plan_digest, 71, digestPattern),
    operationSetDigest: text(source.operation_set_digest, 71, digestPattern),
  });
}

function parseExpectedScope(value: unknown): MaterializerScope {
  const source = record(value);
  exactKeys(source, ["issueNumber", "mode", "owner", "policyPath", "projectNumber", "repository"]);
  const policyPath = text(source.policyPath, 256, policyPathPattern);
  if (policyPath.split("/").includes("..")) invalid();
  return frozen({
    owner: text(source.owner, 128, namePattern),
    repository: text(source.repository, 128, namePattern),
    projectNumber: positiveInteger(source.projectNumber, 9_999_999),
    issueNumber: positiveInteger(source.issueNumber, 9_999_999),
    policyPath,
    mode: text(source.mode, 64, /^[a-z][a-z0-9-]{0,63}$/u),
  });
}

function parseExpectedBinding(value: unknown): MaterializerPackageBinding {
  const source = record(value);
  exactKeys(source, [
    "environment",
    "eventName",
    "operationSetDigest",
    "planDigest",
    "planId",
    "policyCommit",
    "producerRef",
    "profile",
    "repositoryId",
    "runAttempt",
    "runId",
    "scope",
    "workflowRef",
  ]);
  const profile = text(source.profile, 128, profilePattern);
  if (profile.includes("..")) invalid();
  return frozen({
    profile,
    scope: parseExpectedScope(source.scope),
    repositoryId: text(source.repositoryId, 20, /^[1-9][0-9]{0,19}$/u),
    workflowRef: text(source.workflowRef, 512, workflowRefPattern),
    eventName: source.eventName === "workflow_dispatch" ? "workflow_dispatch" : invalid(),
    environment: text(source.environment, 128, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u),
    runId: text(source.runId, 20, /^[1-9][0-9]{0,19}$/u),
    runAttempt: source.runAttempt === 1 ? 1 : invalid(),
    policyCommit: text(source.policyCommit, 40, commitPattern),
    producerRef: text(source.producerRef, 256, producerRefPattern),
    planId: text(source.planId, 128, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
    planDigest: text(source.planDigest, 71, digestPattern),
    operationSetDigest: text(source.operationSetDigest, 71, digestPattern),
  });
}

function sameBinding(left: MaterializerPackageBinding, right: MaterializerPackageBinding): boolean {
  return (
    left.profile === right.profile &&
    sameScope(left.scope, right.scope) &&
    left.repositoryId === right.repositoryId &&
    left.workflowRef === right.workflowRef &&
    left.eventName === right.eventName &&
    left.environment === right.environment &&
    left.runId === right.runId &&
    left.runAttempt === right.runAttempt &&
    left.policyCommit === right.policyCommit &&
    left.producerRef === right.producerRef &&
    left.planId === right.planId &&
    left.planDigest === right.planDigest &&
    left.operationSetDigest === right.operationSetDigest
  );
}

function parseMutationKinds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) invalid();
  const mutationKinds = value.map((item) => text(item, 64, mutationKindPattern));
  const sorted = [...mutationKinds].sort();
  if (
    new Set(mutationKinds).size !== mutationKinds.length ||
    mutationKinds.some((kind, index) => kind !== sorted[index])
  )
    invalid();
  return Object.freeze(mutationKinds);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseRequestCeilings(value: unknown): MaterializerRequestCeilings {
  const source = record(value);
  exactKeys(source, ["graphql", "rest"]);
  return frozen({
    graphql: positiveInteger(source.graphql, 8),
    rest: positiveInteger(source.rest, 8),
  });
}

function parseExpectation(value: MaterializerPackageExpectation): MaterializerPackageExpectation {
  const source = record(value);
  exactKeys(source, ["allowedMutationKinds", "binding", "requestCeilings"]);
  return frozen({
    binding: parseExpectedBinding(source.binding),
    allowedMutationKinds: parseMutationKinds(source.allowedMutationKinds),
    requestCeilings: parseRequestCeilings(source.requestCeilings),
  });
}

function parseTimestamp(value: unknown): Readonly<{ value: string; time: number }> {
  const timestamp = text(value, 24, timestampPattern);
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== timestamp) invalid();
  return frozen({ value: timestamp, time });
}

function parseReceipt(value: unknown): string {
  const source = record(value);
  exactKeys(source, ["id", "one_time"]);
  if (source.one_time !== true) invalid();
  return text(source.id, 256, opaqueMaterialPattern);
}

function opaqueMaterial(value: unknown): string {
  return text(value, MAX_OPAQUE_MATERIAL_BYTES, opaqueMaterialPattern);
}

function parseRateLimit(value: unknown): MaterializerRateLimit {
  const source = record(value);
  exactKeys(source, ["max_requests", "reserve"]);
  return frozen({
    reserve: positiveInteger(source.reserve, 1_000_000),
    maxRequests: positiveInteger(source.max_requests, 8),
  });
}

function parseHostCapsule(
  value: unknown,
  expectation: MaterializerPackageExpectation,
): Readonly<{
  hostCapsule: MaterializerHostCapsule;
  credential: string;
  dpopPrivateKey: string;
}> {
  const source = record(value);
  exactKeys(source, [
    "coordination_epoch",
    "credential",
    "dpop_private_key",
    "enabled",
    "mutation_kinds",
    "rate_limits",
    "scope",
  ]);
  if (source.enabled !== true) invalid();
  const scope = parseScope(source.scope);
  const mutationKinds = parseMutationKinds(source.mutation_kinds);
  const rateLimitsSource = record(source.rate_limits);
  exactKeys(rateLimitsSource, ["graphql", "rest"]);
  const rateLimits = frozen({
    graphql: parseRateLimit(rateLimitsSource.graphql),
    rest: parseRateLimit(rateLimitsSource.rest),
  });
  const credential = opaqueMaterial(source.credential);
  const dpopPrivateKey = opaqueMaterial(source.dpop_private_key);
  if (
    !sameScope(scope, expectation.binding.scope) ||
    !sameStrings(mutationKinds, expectation.allowedMutationKinds) ||
    rateLimits.graphql.reserve < MIN_MATERIALIZER_REQUEST_RESERVE ||
    rateLimits.rest.reserve < MIN_MATERIALIZER_REQUEST_RESERVE ||
    rateLimits.graphql.maxRequests !== expectation.requestCeilings.graphql ||
    rateLimits.rest.maxRequests !== expectation.requestCeilings.rest ||
    credential === dpopPrivateKey
  )
    invalid();
  return frozen({
    hostCapsule: frozen({
      enabled: true,
      scope,
      coordinationEpoch: positiveInteger(source.coordination_epoch, 9_999_999),
      rateLimits,
      mutationKinds,
    }),
    credential,
    dpopPrivateKey,
  });
}

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 32) invalid();
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item, depth + 1)).join(",")}]`;
  const source = record(value);
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key], depth + 1)}`)
    .join(",")}}`;
}

function parseCanonicalJson(serialized: string): unknown {
  if (
    typeof serialized !== "string" ||
    Buffer.byteLength(serialized, "utf8") < 1 ||
    Buffer.byteLength(serialized, "utf8") > MAX_MATERIALIZER_PACKAGE_BYTES
  )
    invalid();
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (canonicalJson(parsed) !== serialized) invalid();
    return parsed;
  } catch (error) {
    if (error instanceof MaterializerPackageError) throw error;
    invalid();
  }
}

class RedactedMaterial implements MaterializerSecret {
  constructor(readonly kind: MaterializerSecretKind) {
    Object.freeze(this);
  }

  toString(): "MaterializerSecret{REDACTED}" {
    return "MaterializerSecret{REDACTED}";
  }

  toJSON(): never {
    throw new TypeError("materializer secret is not serializable");
  }

  [inspect.custom]() {
    return this.toString();
  }
}

class ParsedMaterializerPackage implements MaterializerPackage {
  readonly packageVersion = 1 as const;
  readonly receipt = frozen({ oneTime: true as const });
  readonly material = frozen({
    readCredential: new RedactedMaterial("read_credential"),
    writeCredential: new RedactedMaterial("write_credential"),
    approvalEnvelope: new RedactedMaterial("approval_envelope"),
    approvalTrustRoot: new RedactedMaterial("approval_trust_root"),
    hostCapsuleCredential: new RedactedMaterial("host_capsule_credential"),
    hostCapsuleDpopPrivateKey: new RedactedMaterial("host_capsule_dpop_private_key"),
  });

  constructor(
    readonly binding: MaterializerPackageBinding,
    readonly issuedAt: string,
    readonly expiresAt: string,
    readonly hostCapsule: MaterializerHostCapsule,
  ) {
    Object.freeze(this);
  }

  toString(): "MaterializerPackage{REDACTED}" {
    return "MaterializerPackage{REDACTED}";
  }

  toJSON(): never {
    throw new TypeError("materializer package is not serializable");
  }

  [inspect.custom]() {
    return this.toString();
  }
}

function parsePackage(
  serialized: string,
  expectation: MaterializerPackageExpectation,
  now: () => Date,
): MaterializerPackage {
  const source = record(parseCanonicalJson(serialized));
  exactKeys(source, [
    "approval",
    "binding",
    "credentials",
    "expires_at",
    "host_capsule",
    "issued_at",
    "package_version",
    "receipt",
  ]);
  if (source.package_version !== 1) invalid();
  parseReceipt(source.receipt);
  const binding = parseBinding(source.binding);
  if (!sameBinding(binding, expectation.binding)) invalid();
  const issuedAt = parseTimestamp(source.issued_at);
  const expiresAt = parseTimestamp(source.expires_at);
  let currentTime: number;
  try {
    const current = now();
    currentTime = current instanceof Date ? current.getTime() : Number.NaN;
  } catch {
    invalid();
  }
  if (
    !Number.isFinite(currentTime) ||
    issuedAt.time > currentTime ||
    expiresAt.time <= currentTime ||
    expiresAt.time <= issuedAt.time ||
    expiresAt.time - issuedAt.time > MAX_MATERIALIZER_PACKAGE_LIFETIME_MS
  )
    invalid();
  const credentials = record(source.credentials);
  exactKeys(credentials, ["read", "write"]);
  const readCredential = opaqueMaterial(credentials.read);
  const writeCredential = opaqueMaterial(credentials.write);
  const approval = record(source.approval);
  exactKeys(approval, ["envelope", "trust_root"]);
  opaqueMaterial(approval.envelope);
  opaqueMaterial(approval.trust_root);
  const capsule = parseHostCapsule(source.host_capsule, expectation);
  if (
    new Set([readCredential, writeCredential, capsule.credential, capsule.dpopPrivateKey]).size !==
    4
  )
    invalid();
  return new ParsedMaterializerPackage(
    binding,
    issuedAt.value,
    expiresAt.value,
    capsule.hostCapsule,
  );
}

export function createMaterializerPackageParser(
  expectation: MaterializerPackageExpectation,
  now: () => Date = () => new Date(),
): MaterializerPackageParser {
  const normalizedExpectation = parseExpectation(expectation);
  let attempted = false;
  return Object.freeze({
    parse(serialized: string): MaterializerPackage {
      if (attempted) invalid();
      attempted = true;
      return parsePackage(serialized, normalizedExpectation, now);
    },
  });
}
