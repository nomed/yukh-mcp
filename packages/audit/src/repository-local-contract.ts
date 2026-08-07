import { createHash } from "node:crypto";
import {
  AuditError,
  compareAuditTimestamps,
  isValidAuditTimestamp,
  isValidSha256Digest,
  validateAuditCandidate,
  validateProtectedAuditEvent,
  type ProtectedAuditEvent,
} from "./contract.js";
import { validateRecoveryFactShape, type RecoveryFact } from "./lifecycle.js";
import { canonicalAuditJson, computeAuditEventHash, type AuditCommitReceipt } from "./writer.js";

export const REPOSITORY_LOCAL_PROFILE_ID = "yukh-mcp/repository-local-audit-v1";
export const REPOSITORY_LOCAL_RUNTIME_PATH = ".yukh/runtime/audit-v1";
export const REPOSITORY_LOCAL_CHECKPOINT_LIMITATION = "local_unwitnessed_not_complete";
export const REPOSITORY_LOCAL_CHECKPOINT_AUTHORITY = "repository_local_writer_v1";
export const REPOSITORY_LOCAL_CHECKPOINT_ALGORITHM = "sha256_local_checkpoint_v1";
export const REPOSITORY_LOCAL_CANONICALIZATION = "canonical_json_code_unit_v1";
export const REPOSITORY_LOCAL_RECORD_INTEGRITY = "sha256_domain_separated_v1";

export const REPOSITORY_LOCAL_LIMITS = Object.freeze({
  max_primary_commit_record_bytes: 64 * 1024,
  max_recovery_record_bytes: 4 * 1024,
  max_identity_record_bytes: 2 * 1024,
  max_checkpoint_record_bytes: 16 * 1024,
  max_primary_committed_bytes: 64 * 1024 * 1024,
  max_recovery_bytes: 8 * 1024 * 1024,
  max_event_identity_bytes: 16 * 1024 * 1024,
  max_checkpoint_deletion_metadata_bytes: 4 * 1024 * 1024,
  max_completed_export_bytes: 32 * 1024 * 1024,
  max_temporary_bytes: 16 * 1024 * 1024,
  max_streams: 64,
  max_pending_recovery_facts: 512,
  max_acknowledged_recovery_records: 512,
  max_recovery_identities: 512,
  max_event_identities: 8_192,
  recovery_identity_reservation_bytes: 16 * 1024,
  checkpoint_interval: 1_000,
  pending_iterator_max_input_bytes: 8 * 1024 * 1024,
  pending_iterator_max_milliseconds: 30_000,
  pending_max_age_milliseconds: 30 * 24 * 60 * 60 * 1_000,
} as const);

export type RepositoryLocalLimits = typeof REPOSITORY_LOCAL_LIMITS;

export interface RepositoryLocalProfileRecord {
  readonly profile_record_version: 1;
  readonly profile_id: typeof REPOSITORY_LOCAL_PROFILE_ID;
  readonly canonicalization: typeof REPOSITORY_LOCAL_CANONICALIZATION;
  readonly record_integrity: typeof REPOSITORY_LOCAL_RECORD_INTEGRITY;
  readonly event_chain_algorithm: "sha256_chain_v1";
  readonly checkpoint_algorithm: typeof REPOSITORY_LOCAL_CHECKPOINT_ALGORITHM;
  readonly writer_ref: string;
  readonly limits: RepositoryLocalLimits;
  readonly created_at: string;
  readonly profile_record_digest: string;
}

export interface RepositoryLocalWriterLockRecord {
  readonly lock_record_version: 1;
  readonly profile_id: typeof REPOSITORY_LOCAL_PROFILE_ID;
  readonly writer_ref: string;
  readonly owner_token: string;
  readonly acquired_at: string;
  readonly lock_record_digest: string;
}

export interface RepositoryLocalStreamRecord {
  readonly stream_record_version: 1;
  readonly profile_id: typeof REPOSITORY_LOCAL_PROFILE_ID;
  readonly stream_ref: string;
  readonly stream_path_digest: string;
  readonly writer_ref: string;
  readonly created_at: string;
  readonly stream_record_digest: string;
}

export interface RepositoryLocalPrimaryCommitRecord {
  readonly primary_commit_record_version: 1;
  readonly profile_id: typeof REPOSITORY_LOCAL_PROFILE_ID;
  readonly event: ProtectedAuditEvent;
  readonly candidate_digest: string;
  readonly primary_commit_record_digest: string;
}

export interface RepositoryLocalPrimaryIdentityRecord {
  readonly primary_identity_record_version: 1;
  readonly identity_version: 0;
  readonly profile_id: typeof REPOSITORY_LOCAL_PROFILE_ID;
  readonly event_id: string;
  readonly candidate_digest: string;
  readonly stream_ref: string;
  readonly sequence: number;
  readonly previous_event_hash: string;
  readonly event_hash: string;
  readonly committed_at: string;
  readonly writer_ref: string;
  readonly durability: "durable";
  readonly commit_record_digest: string;
  readonly primary_identity_record_digest: string;
}

export interface RepositoryLocalRecoveryPendingRecord {
  readonly recovery_pending_record_version: 1;
  readonly profile_id: typeof REPOSITORY_LOCAL_PROFILE_ID;
  readonly fact: RecoveryFact;
  readonly fact_digest: string;
  readonly appended_at: string;
  readonly recovery_pending_record_digest: string;
}

export interface RepositoryLocalRecoveryIdentityRecord {
  readonly recovery_identity_record_version: 1;
  readonly identity_version: 0;
  readonly profile_id: typeof REPOSITORY_LOCAL_PROFILE_ID;
  readonly recovery_id: string;
  readonly fact_digest: string;
  readonly pending_record_digest: string;
  readonly appended_at: string;
  readonly durability: "durable";
  readonly recovery_identity_record_digest: string;
}

export interface RepositoryLocalCheckpointRecord {
  readonly checkpoint_record_version: 1;
  readonly profile_id: typeof REPOSITORY_LOCAL_PROFILE_ID;
  readonly checkpoint_id: string;
  readonly previous_checkpoint_ref: string | null;
  readonly stream_ref: string;
  readonly range_start: number;
  readonly range_end: number;
  readonly event_count: number;
  readonly terminal_event_hash: string;
  readonly writer_ref: string;
  readonly authority_ref: typeof REPOSITORY_LOCAL_CHECKPOINT_AUTHORITY;
  readonly algorithm: typeof REPOSITORY_LOCAL_CHECKPOINT_ALGORITHM;
  readonly created_at: string;
  readonly limitation: typeof REPOSITORY_LOCAL_CHECKPOINT_LIMITATION;
  readonly checkpoint_record_digest: string;
}

export class RepositoryLocalFormatError extends Error {
  constructor() {
    super("repository_local_format_invalid");
    this.name = "RepositoryLocalFormatError";
  }
}

const REFERENCE_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const RAW_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OWNER_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

const PROFILE_KEYS = [
  "canonicalization",
  "checkpoint_algorithm",
  "created_at",
  "event_chain_algorithm",
  "limits",
  "profile_id",
  "profile_record_digest",
  "profile_record_version",
  "record_integrity",
  "writer_ref",
] as const;
const LIMIT_KEYS = Object.keys(REPOSITORY_LOCAL_LIMITS).sort();
const LOCK_KEYS = [
  "acquired_at",
  "lock_record_digest",
  "lock_record_version",
  "owner_token",
  "profile_id",
  "writer_ref",
] as const;
const STREAM_KEYS = [
  "created_at",
  "profile_id",
  "stream_path_digest",
  "stream_record_digest",
  "stream_record_version",
  "stream_ref",
  "writer_ref",
] as const;
const PRIMARY_COMMIT_KEYS = [
  "candidate_digest",
  "event",
  "primary_commit_record_digest",
  "primary_commit_record_version",
  "profile_id",
] as const;
const PRIMARY_IDENTITY_KEYS = [
  "candidate_digest",
  "commit_record_digest",
  "committed_at",
  "durability",
  "event_hash",
  "event_id",
  "identity_version",
  "previous_event_hash",
  "primary_identity_record_digest",
  "primary_identity_record_version",
  "profile_id",
  "sequence",
  "stream_ref",
  "writer_ref",
] as const;
const RECOVERY_PENDING_KEYS = [
  "appended_at",
  "fact",
  "fact_digest",
  "profile_id",
  "recovery_pending_record_digest",
  "recovery_pending_record_version",
] as const;
const RECOVERY_IDENTITY_KEYS = [
  "appended_at",
  "durability",
  "fact_digest",
  "identity_version",
  "pending_record_digest",
  "profile_id",
  "recovery_id",
  "recovery_identity_record_digest",
  "recovery_identity_record_version",
] as const;
const CHECKPOINT_KEYS = [
  "algorithm",
  "authority_ref",
  "checkpoint_id",
  "checkpoint_record_digest",
  "checkpoint_record_version",
  "created_at",
  "event_count",
  "limitation",
  "previous_checkpoint_ref",
  "profile_id",
  "range_end",
  "range_start",
  "stream_ref",
  "terminal_event_hash",
  "writer_ref",
] as const;

function fail(): never {
  throw new RepositoryLocalFormatError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) return fail();
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return fail();
  }
  return value;
}

function read(record: Record<string, unknown>, key: string): unknown {
  if (!Object.hasOwn(record, key)) return fail();
  return record[key];
}

function reference(value: unknown): string {
  if (typeof value !== "string" || value.length > 128 || !REFERENCE_PATTERN.test(value)) {
    return fail();
  }
  return value;
}

function digest(value: unknown): string {
  if (!isValidSha256Digest(value)) return fail();
  return value;
}

function rawDigest(value: unknown): string {
  if (typeof value !== "string" || !RAW_SHA256_PATTERN.test(value)) return fail();
  return value;
}

function timestamp(value: unknown): string {
  if (!isValidAuditTimestamp(value)) return fail();
  return value;
}

function nonnegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return fail();
  return value as number;
}

function domainDigest(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(canonicalAuditJson(value), "utf8")
    .digest("hex")}`;
}

function digestWithoutField(
  domain: string,
  record: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const { [field]: _digest, ...withoutDigest } = record;
  return domainDigest(domain, withoutDigest);
}

function assertSelfDigest(
  domain: string,
  record: Readonly<Record<string, unknown>>,
  field: string,
): void {
  const stored = digest(record[field]);
  if (stored !== digestWithoutField(domain, record, field)) fail();
}

function validateLimits(value: unknown): RepositoryLocalLimits {
  const record = requireRecord(value, LIMIT_KEYS);
  for (const key of LIMIT_KEYS) {
    if (read(record, key) !== REPOSITORY_LOCAL_LIMITS[key as keyof RepositoryLocalLimits]) fail();
  }
  return REPOSITORY_LOCAL_LIMITS;
}

export function isRepositoryLocalReference(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && REFERENCE_PATTERN.test(value);
}

export function repositoryLocalReferencePathDigest(value: string): string {
  if (!isRepositoryLocalReference(value)) return fail();
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalRepositoryLocalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalAuditJson(value), "utf8");
}

export function parseCanonicalRepositoryLocalBytes(bytes: Uint8Array): unknown {
  let text: string;
  let parsed: unknown;
  try {
    text = UTF8_DECODER.decode(bytes);
    parsed = JSON.parse(text) as unknown;
  } catch (error: unknown) {
    if (error instanceof TypeError || error instanceof SyntaxError) return fail();
    throw error;
  }
  let canonical: Buffer;
  try {
    canonical = canonicalRepositoryLocalBytes(parsed);
  } catch (error: unknown) {
    if (error instanceof AuditError) return fail();
    throw error;
  }
  if (!canonical.equals(Buffer.from(bytes))) return fail();
  return parsed;
}

export function computeProtectedEventCandidateDigest(event: ProtectedAuditEvent): string {
  const candidate = validateAuditCandidate({
    audit_candidate_version: 1,
    event_id: event.event_id,
    event_type: event.event_type,
    occurred_at: event.occurred_at,
    producer: event.producer,
    correlation: event.correlation,
    causation: event.causation,
    subject: event.subject,
    capability: event.capability,
    scope: event.scope,
    outcome: event.outcome,
    payload: event.payload.value,
  });
  return `sha256:${createHash("sha256")
    .update(canonicalAuditJson(candidate), "utf8")
    .digest("hex")}`;
}

export function validateRepositoryLocalProtectedEvent(value: unknown): ProtectedAuditEvent {
  let event: ProtectedAuditEvent;
  try {
    event = validateProtectedAuditEvent(value);
  } catch (error: unknown) {
    if (error instanceof AuditError) return fail();
    throw error;
  }
  const { event_hash: _eventHash, ...integrityWithoutHash } = event.integrity;
  const computed = computeAuditEventHash({ ...event, integrity: integrityWithoutHash });
  if (computed !== event.integrity.event_hash) return fail();
  return event;
}

export function computeRecoveryFactDigest(fact: RecoveryFact): string {
  return domainDigest("yukh-mcp:repository-local:recovery-fact:v1", fact);
}

export function createRepositoryLocalProfileRecord(
  writerRef: string,
  createdAt: string,
): RepositoryLocalProfileRecord {
  if (!isRepositoryLocalReference(writerRef) || !isValidAuditTimestamp(createdAt)) return fail();
  const withoutDigest: Omit<RepositoryLocalProfileRecord, "profile_record_digest"> = {
    profile_record_version: 1 as const,
    profile_id: REPOSITORY_LOCAL_PROFILE_ID,
    canonicalization: REPOSITORY_LOCAL_CANONICALIZATION,
    record_integrity: REPOSITORY_LOCAL_RECORD_INTEGRITY,
    event_chain_algorithm: "sha256_chain_v1" as const,
    checkpoint_algorithm: REPOSITORY_LOCAL_CHECKPOINT_ALGORITHM,
    writer_ref: writerRef,
    limits: REPOSITORY_LOCAL_LIMITS,
    created_at: createdAt,
  };
  return {
    ...withoutDigest,
    profile_record_digest: domainDigest(
      "yukh-mcp:repository-local:profile-record:v1",
      withoutDigest,
    ),
  };
}

export function validateRepositoryLocalProfileRecord(value: unknown): RepositoryLocalProfileRecord {
  const record = requireRecord(value, PROFILE_KEYS);
  if (
    read(record, "profile_record_version") !== 1 ||
    read(record, "profile_id") !== REPOSITORY_LOCAL_PROFILE_ID ||
    read(record, "canonicalization") !== REPOSITORY_LOCAL_CANONICALIZATION ||
    read(record, "record_integrity") !== REPOSITORY_LOCAL_RECORD_INTEGRITY ||
    read(record, "event_chain_algorithm") !== "sha256_chain_v1" ||
    read(record, "checkpoint_algorithm") !== REPOSITORY_LOCAL_CHECKPOINT_ALGORITHM
  ) {
    return fail();
  }
  const parsed: RepositoryLocalProfileRecord = {
    profile_record_version: 1,
    profile_id: REPOSITORY_LOCAL_PROFILE_ID,
    canonicalization: REPOSITORY_LOCAL_CANONICALIZATION,
    record_integrity: REPOSITORY_LOCAL_RECORD_INTEGRITY,
    event_chain_algorithm: "sha256_chain_v1",
    checkpoint_algorithm: REPOSITORY_LOCAL_CHECKPOINT_ALGORITHM,
    writer_ref: reference(read(record, "writer_ref")),
    limits: validateLimits(read(record, "limits")),
    created_at: timestamp(read(record, "created_at")),
    profile_record_digest: digest(read(record, "profile_record_digest")),
  };
  assertSelfDigest(
    "yukh-mcp:repository-local:profile-record:v1",
    parsed as unknown as Record<string, unknown>,
    "profile_record_digest",
  );
  return parsed;
}

export function createRepositoryLocalWriterLockRecord(
  writerRef: string,
  ownerToken: string,
  acquiredAt: string,
): RepositoryLocalWriterLockRecord {
  if (
    !isRepositoryLocalReference(writerRef) ||
    !OWNER_TOKEN_PATTERN.test(ownerToken) ||
    !isValidAuditTimestamp(acquiredAt)
  ) {
    return fail();
  }
  const withoutDigest: Omit<RepositoryLocalWriterLockRecord, "lock_record_digest"> = {
    lock_record_version: 1 as const,
    profile_id: REPOSITORY_LOCAL_PROFILE_ID,
    writer_ref: writerRef,
    owner_token: ownerToken,
    acquired_at: acquiredAt,
  };
  return {
    ...withoutDigest,
    lock_record_digest: domainDigest(
      "yukh-mcp:repository-local:writer-lock-record:v1",
      withoutDigest,
    ),
  };
}

export function validateRepositoryLocalWriterLockRecord(
  value: unknown,
): RepositoryLocalWriterLockRecord {
  const record = requireRecord(value, LOCK_KEYS);
  const ownerToken = read(record, "owner_token");
  if (
    read(record, "lock_record_version") !== 1 ||
    read(record, "profile_id") !== REPOSITORY_LOCAL_PROFILE_ID ||
    typeof ownerToken !== "string" ||
    !OWNER_TOKEN_PATTERN.test(ownerToken)
  ) {
    return fail();
  }
  const parsed: RepositoryLocalWriterLockRecord = {
    lock_record_version: 1,
    profile_id: REPOSITORY_LOCAL_PROFILE_ID,
    writer_ref: reference(read(record, "writer_ref")),
    owner_token: ownerToken,
    acquired_at: timestamp(read(record, "acquired_at")),
    lock_record_digest: digest(read(record, "lock_record_digest")),
  };
  assertSelfDigest(
    "yukh-mcp:repository-local:writer-lock-record:v1",
    parsed as unknown as Record<string, unknown>,
    "lock_record_digest",
  );
  return parsed;
}

export function createRepositoryLocalStreamRecord(
  streamRef: string,
  writerRef: string,
  createdAt: string,
): RepositoryLocalStreamRecord {
  if (
    !isRepositoryLocalReference(streamRef) ||
    !isRepositoryLocalReference(writerRef) ||
    !isValidAuditTimestamp(createdAt)
  ) {
    return fail();
  }
  const withoutDigest: Omit<RepositoryLocalStreamRecord, "stream_record_digest"> = {
    stream_record_version: 1 as const,
    profile_id: REPOSITORY_LOCAL_PROFILE_ID,
    stream_ref: streamRef,
    stream_path_digest: repositoryLocalReferencePathDigest(streamRef),
    writer_ref: writerRef,
    created_at: createdAt,
  };
  return {
    ...withoutDigest,
    stream_record_digest: domainDigest("yukh-mcp:repository-local:stream-record:v1", withoutDigest),
  };
}

export function validateRepositoryLocalStreamRecord(value: unknown): RepositoryLocalStreamRecord {
  const record = requireRecord(value, STREAM_KEYS);
  if (
    read(record, "stream_record_version") !== 1 ||
    read(record, "profile_id") !== REPOSITORY_LOCAL_PROFILE_ID
  ) {
    return fail();
  }
  const parsed: RepositoryLocalStreamRecord = {
    stream_record_version: 1,
    profile_id: REPOSITORY_LOCAL_PROFILE_ID,
    stream_ref: reference(read(record, "stream_ref")),
    stream_path_digest: rawDigest(read(record, "stream_path_digest")),
    writer_ref: reference(read(record, "writer_ref")),
    created_at: timestamp(read(record, "created_at")),
    stream_record_digest: digest(read(record, "stream_record_digest")),
  };
  if (repositoryLocalReferencePathDigest(parsed.stream_ref) !== parsed.stream_path_digest) fail();
  assertSelfDigest(
    "yukh-mcp:repository-local:stream-record:v1",
    parsed as unknown as Record<string, unknown>,
    "stream_record_digest",
  );
  return parsed;
}

export function createRepositoryLocalPrimaryCommitRecord(
  eventValue: unknown,
  candidateDigest: string,
): RepositoryLocalPrimaryCommitRecord {
  const event = validateRepositoryLocalProtectedEvent(eventValue);
  if (!isValidSha256Digest(candidateDigest)) return fail();
  if (computeProtectedEventCandidateDigest(event) !== candidateDigest) return fail();
  const withoutDigest: Omit<RepositoryLocalPrimaryCommitRecord, "primary_commit_record_digest"> = {
    primary_commit_record_version: 1 as const,
    profile_id: REPOSITORY_LOCAL_PROFILE_ID,
    event,
    candidate_digest: candidateDigest,
  };
  return {
    ...withoutDigest,
    primary_commit_record_digest: domainDigest(
      "yukh-mcp:repository-local:primary-commit-record:v1",
      withoutDigest,
    ),
  };
}

export function validateRepositoryLocalPrimaryCommitRecord(
  value: unknown,
): RepositoryLocalPrimaryCommitRecord {
  const record = requireRecord(value, PRIMARY_COMMIT_KEYS);
  if (
    read(record, "primary_commit_record_version") !== 1 ||
    read(record, "profile_id") !== REPOSITORY_LOCAL_PROFILE_ID
  ) {
    return fail();
  }
  const event = validateRepositoryLocalProtectedEvent(read(record, "event"));
  const candidateDigest = digest(read(record, "candidate_digest"));
  if (computeProtectedEventCandidateDigest(event) !== candidateDigest) return fail();
  const parsed: RepositoryLocalPrimaryCommitRecord = {
    primary_commit_record_version: 1,
    profile_id: REPOSITORY_LOCAL_PROFILE_ID,
    event,
    candidate_digest: candidateDigest,
    primary_commit_record_digest: digest(read(record, "primary_commit_record_digest")),
  };
  assertSelfDigest(
    "yukh-mcp:repository-local:primary-commit-record:v1",
    parsed as unknown as Record<string, unknown>,
    "primary_commit_record_digest",
  );
  return parsed;
}

export function createRepositoryLocalPrimaryIdentityRecord(
  commit: RepositoryLocalPrimaryCommitRecord,
): RepositoryLocalPrimaryIdentityRecord {
  const event = commit.event;
  const withoutDigest: Omit<
    RepositoryLocalPrimaryIdentityRecord,
    "primary_identity_record_digest"
  > = {
    primary_identity_record_version: 1 as const,
    identity_version: 0 as const,
    profile_id: REPOSITORY_LOCAL_PROFILE_ID,
    event_id: event.event_id,
    candidate_digest: commit.candidate_digest,
    stream_ref: event.integrity.stream_ref,
    sequence: event.integrity.sequence,
    previous_event_hash: event.integrity.previous_event_hash,
    event_hash: event.integrity.event_hash,
    committed_at: event.committed_at,
    writer_ref: event.integrity.writer_ref,
    durability: "durable" as const,
    commit_record_digest: commit.primary_commit_record_digest,
  };
  return {
    ...withoutDigest,
    primary_identity_record_digest: domainDigest(
      "yukh-mcp:repository-local:primary-identity-record:v0",
      withoutDigest,
    ),
  };
}

export function validateRepositoryLocalPrimaryIdentityRecord(
  value: unknown,
): RepositoryLocalPrimaryIdentityRecord {
  const record = requireRecord(value, PRIMARY_IDENTITY_KEYS);
  if (
    read(record, "primary_identity_record_version") !== 1 ||
    read(record, "identity_version") !== 0 ||
    read(record, "profile_id") !== REPOSITORY_LOCAL_PROFILE_ID ||
    read(record, "durability") !== "durable"
  ) {
    return fail();
  }
  const parsed: RepositoryLocalPrimaryIdentityRecord = {
    primary_identity_record_version: 1,
    identity_version: 0,
    profile_id: REPOSITORY_LOCAL_PROFILE_ID,
    event_id: reference(read(record, "event_id")),
    candidate_digest: digest(read(record, "candidate_digest")),
    stream_ref: reference(read(record, "stream_ref")),
    sequence: nonnegativeInteger(read(record, "sequence")),
    previous_event_hash: digest(read(record, "previous_event_hash")),
    event_hash: digest(read(record, "event_hash")),
    committed_at: timestamp(read(record, "committed_at")),
    writer_ref: reference(read(record, "writer_ref")),
    durability: "durable",
    commit_record_digest: digest(read(record, "commit_record_digest")),
    primary_identity_record_digest: digest(read(record, "primary_identity_record_digest")),
  };
  assertSelfDigest(
    "yukh-mcp:repository-local:primary-identity-record:v0",
    parsed as unknown as Record<string, unknown>,
    "primary_identity_record_digest",
  );
  return parsed;
}

export function primaryIdentityMatchesCommit(
  identity: RepositoryLocalPrimaryIdentityRecord,
  commit: RepositoryLocalPrimaryCommitRecord,
): boolean {
  const event = commit.event;
  return (
    identity.event_id === event.event_id &&
    identity.candidate_digest === commit.candidate_digest &&
    identity.stream_ref === event.integrity.stream_ref &&
    identity.sequence === event.integrity.sequence &&
    identity.previous_event_hash === event.integrity.previous_event_hash &&
    identity.event_hash === event.integrity.event_hash &&
    identity.committed_at === event.committed_at &&
    identity.writer_ref === event.integrity.writer_ref &&
    identity.commit_record_digest === commit.primary_commit_record_digest
  );
}

export function createRepositoryLocalRecoveryPendingRecord(
  factValue: unknown,
  appendedAt: string,
): RepositoryLocalRecoveryPendingRecord {
  let fact: RecoveryFact;
  try {
    fact = validateRecoveryFactShape(factValue);
  } catch (error: unknown) {
    if (error instanceof AuditError) return fail();
    throw error;
  }
  if (!isValidAuditTimestamp(appendedAt)) return fail();
  if (compareAuditTimestamps(appendedAt, fact.original_observed_at) < 0) return fail();
  const withoutDigest: Omit<
    RepositoryLocalRecoveryPendingRecord,
    "recovery_pending_record_digest"
  > = {
    recovery_pending_record_version: 1 as const,
    profile_id: REPOSITORY_LOCAL_PROFILE_ID,
    fact,
    fact_digest: computeRecoveryFactDigest(fact),
    appended_at: appendedAt,
  };
  return {
    ...withoutDigest,
    recovery_pending_record_digest: domainDigest(
      "yukh-mcp:repository-local:recovery-pending-record:v1",
      withoutDigest,
    ),
  };
}

export function validateRepositoryLocalRecoveryPendingRecord(
  value: unknown,
): RepositoryLocalRecoveryPendingRecord {
  const record = requireRecord(value, RECOVERY_PENDING_KEYS);
  if (
    read(record, "recovery_pending_record_version") !== 1 ||
    read(record, "profile_id") !== REPOSITORY_LOCAL_PROFILE_ID
  ) {
    return fail();
  }
  let fact: RecoveryFact;
  try {
    fact = validateRecoveryFactShape(read(record, "fact"));
  } catch (error: unknown) {
    if (error instanceof AuditError) return fail();
    throw error;
  }
  const factDigest = digest(read(record, "fact_digest"));
  if (computeRecoveryFactDigest(fact) !== factDigest) return fail();
  const parsed: RepositoryLocalRecoveryPendingRecord = {
    recovery_pending_record_version: 1,
    profile_id: REPOSITORY_LOCAL_PROFILE_ID,
    fact,
    fact_digest: factDigest,
    appended_at: timestamp(read(record, "appended_at")),
    recovery_pending_record_digest: digest(read(record, "recovery_pending_record_digest")),
  };
  if (compareAuditTimestamps(parsed.appended_at, parsed.fact.original_observed_at) < 0) {
    return fail();
  }
  assertSelfDigest(
    "yukh-mcp:repository-local:recovery-pending-record:v1",
    parsed as unknown as Record<string, unknown>,
    "recovery_pending_record_digest",
  );
  return parsed;
}

export function createRepositoryLocalRecoveryIdentityRecord(
  pending: RepositoryLocalRecoveryPendingRecord,
): RepositoryLocalRecoveryIdentityRecord {
  const withoutDigest: Omit<
    RepositoryLocalRecoveryIdentityRecord,
    "recovery_identity_record_digest"
  > = {
    recovery_identity_record_version: 1 as const,
    identity_version: 0 as const,
    profile_id: REPOSITORY_LOCAL_PROFILE_ID,
    recovery_id: pending.fact.recovery_id,
    fact_digest: pending.fact_digest,
    pending_record_digest: pending.recovery_pending_record_digest,
    appended_at: pending.appended_at,
    durability: "durable" as const,
  };
  return {
    ...withoutDigest,
    recovery_identity_record_digest: domainDigest(
      "yukh-mcp:repository-local:recovery-identity-record:v0",
      withoutDigest,
    ),
  };
}

export function validateRepositoryLocalRecoveryIdentityRecord(
  value: unknown,
): RepositoryLocalRecoveryIdentityRecord {
  const record = requireRecord(value, RECOVERY_IDENTITY_KEYS);
  if (
    read(record, "recovery_identity_record_version") !== 1 ||
    read(record, "identity_version") !== 0 ||
    read(record, "profile_id") !== REPOSITORY_LOCAL_PROFILE_ID ||
    read(record, "durability") !== "durable"
  ) {
    return fail();
  }
  const parsed: RepositoryLocalRecoveryIdentityRecord = {
    recovery_identity_record_version: 1,
    identity_version: 0,
    profile_id: REPOSITORY_LOCAL_PROFILE_ID,
    recovery_id: reference(read(record, "recovery_id")),
    fact_digest: digest(read(record, "fact_digest")),
    pending_record_digest: digest(read(record, "pending_record_digest")),
    appended_at: timestamp(read(record, "appended_at")),
    durability: "durable",
    recovery_identity_record_digest: digest(read(record, "recovery_identity_record_digest")),
  };
  assertSelfDigest(
    "yukh-mcp:repository-local:recovery-identity-record:v0",
    parsed as unknown as Record<string, unknown>,
    "recovery_identity_record_digest",
  );
  return parsed;
}

export function recoveryIdentityMatchesPending(
  identity: RepositoryLocalRecoveryIdentityRecord,
  pending: RepositoryLocalRecoveryPendingRecord,
): boolean {
  return (
    identity.recovery_id === pending.fact.recovery_id &&
    identity.fact_digest === pending.fact_digest &&
    identity.pending_record_digest === pending.recovery_pending_record_digest &&
    identity.appended_at === pending.appended_at
  );
}

function checkpointIdentity(
  input: Readonly<{
    stream_ref: string;
    range_start: number;
    range_end: number;
    terminal_event_hash: string;
    previous_checkpoint_ref: string | null;
  }>,
): string {
  return domainDigest("yukh-mcp:repository-local:checkpoint-identity:v1", input);
}

export function createRepositoryLocalCheckpointRecord(
  input: Readonly<{
    stream_ref: string;
    range_start: number;
    range_end: number;
    terminal_event_hash: string;
    previous_checkpoint_ref: string | null;
    writer_ref: string;
    created_at: string;
  }>,
): RepositoryLocalCheckpointRecord {
  const streamRef = reference(input.stream_ref);
  const rangeStart = nonnegativeInteger(input.range_start);
  const rangeEnd = nonnegativeInteger(input.range_end);
  const terminalEventHash = digest(input.terminal_event_hash);
  const writerRef = reference(input.writer_ref);
  const createdAt = timestamp(input.created_at);
  const previousCheckpointRef =
    input.previous_checkpoint_ref === null ? null : digest(input.previous_checkpoint_ref);
  if (rangeEnd < rangeStart) return fail();
  const identityInput = {
    stream_ref: streamRef,
    range_start: rangeStart,
    range_end: rangeEnd,
    terminal_event_hash: terminalEventHash,
    previous_checkpoint_ref: previousCheckpointRef,
  };
  const withoutDigest: Omit<RepositoryLocalCheckpointRecord, "checkpoint_record_digest"> = {
    checkpoint_record_version: 1 as const,
    profile_id: REPOSITORY_LOCAL_PROFILE_ID,
    checkpoint_id: checkpointIdentity(identityInput),
    previous_checkpoint_ref: previousCheckpointRef,
    stream_ref: streamRef,
    range_start: rangeStart,
    range_end: rangeEnd,
    event_count: rangeEnd - rangeStart + 1,
    terminal_event_hash: terminalEventHash,
    writer_ref: writerRef,
    authority_ref: REPOSITORY_LOCAL_CHECKPOINT_AUTHORITY,
    algorithm: REPOSITORY_LOCAL_CHECKPOINT_ALGORITHM,
    created_at: createdAt,
    limitation: REPOSITORY_LOCAL_CHECKPOINT_LIMITATION,
  };
  return {
    ...withoutDigest,
    checkpoint_record_digest: domainDigest(
      "yukh-mcp:repository-local:checkpoint-record:v1",
      withoutDigest,
    ),
  };
}

export function validateRepositoryLocalCheckpointRecord(
  value: unknown,
): RepositoryLocalCheckpointRecord {
  const record = requireRecord(value, CHECKPOINT_KEYS);
  if (
    read(record, "checkpoint_record_version") !== 1 ||
    read(record, "profile_id") !== REPOSITORY_LOCAL_PROFILE_ID ||
    read(record, "authority_ref") !== REPOSITORY_LOCAL_CHECKPOINT_AUTHORITY ||
    read(record, "algorithm") !== REPOSITORY_LOCAL_CHECKPOINT_ALGORITHM ||
    read(record, "limitation") !== REPOSITORY_LOCAL_CHECKPOINT_LIMITATION
  ) {
    return fail();
  }
  const previous =
    read(record, "previous_checkpoint_ref") === null
      ? null
      : digest(read(record, "previous_checkpoint_ref"));
  const parsed: RepositoryLocalCheckpointRecord = {
    checkpoint_record_version: 1,
    profile_id: REPOSITORY_LOCAL_PROFILE_ID,
    checkpoint_id: digest(read(record, "checkpoint_id")),
    previous_checkpoint_ref: previous,
    stream_ref: reference(read(record, "stream_ref")),
    range_start: nonnegativeInteger(read(record, "range_start")),
    range_end: nonnegativeInteger(read(record, "range_end")),
    event_count: nonnegativeInteger(read(record, "event_count")),
    terminal_event_hash: digest(read(record, "terminal_event_hash")),
    writer_ref: reference(read(record, "writer_ref")),
    authority_ref: REPOSITORY_LOCAL_CHECKPOINT_AUTHORITY,
    algorithm: REPOSITORY_LOCAL_CHECKPOINT_ALGORITHM,
    created_at: timestamp(read(record, "created_at")),
    limitation: REPOSITORY_LOCAL_CHECKPOINT_LIMITATION,
    checkpoint_record_digest: digest(read(record, "checkpoint_record_digest")),
  };
  if (
    parsed.range_end < parsed.range_start ||
    parsed.event_count !== parsed.range_end - parsed.range_start + 1 ||
    parsed.checkpoint_id !==
      checkpointIdentity({
        stream_ref: parsed.stream_ref,
        range_start: parsed.range_start,
        range_end: parsed.range_end,
        terminal_event_hash: parsed.terminal_event_hash,
        previous_checkpoint_ref: parsed.previous_checkpoint_ref,
      })
  ) {
    return fail();
  }
  assertSelfDigest(
    "yukh-mcp:repository-local:checkpoint-record:v1",
    parsed as unknown as Record<string, unknown>,
    "checkpoint_record_digest",
  );
  return parsed;
}

export function repositoryLocalCheckpointFileName(checkpointId: string): string {
  const validated = digest(checkpointId);
  return `${validated.slice("sha256:".length)}.json`;
}

export function repositoryLocalSequenceFileName(sequence: number): string {
  const validated = nonnegativeInteger(sequence);
  if (validated > 99_999_999_999_999_999_999) return fail();
  return `${validated.toString().padStart(20, "0")}.json`;
}

export function repositoryLocalIdentityVersionFileName(version: 0): string {
  if (version !== 0) return fail();
  return "00000000.json";
}

export function receiptFromPrimaryCommit(
  commit: RepositoryLocalPrimaryCommitRecord,
  duplicate: boolean,
): AuditCommitReceipt {
  return {
    event: commit.event,
    durability: "durable",
    duplicate,
  };
}
