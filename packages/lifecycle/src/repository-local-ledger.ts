import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  chmod,
  lstat,
  link,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rmdir,
  statfs,
  unlink,
} from "node:fs/promises";
import { z } from "zod";
import {
  compareAuditTimestamps,
  isValidAuditTimestamp,
  isValidSha256Digest,
} from "../../audit/src/contract.js";
import { canonicalAuditJson } from "../../audit/src/writer.js";
import {
  lifecycleDigest,
  validateExecutionRecord,
  validateVerificationRecord,
  type ExecutionRecordV1,
  type VerificationRecordV1,
} from "./contract.js";
import {
  LifecyclePortError,
  type AttemptReservationBinding,
  type AttemptReservationLedger,
  type AttemptReservationSnapshot,
  type ReservationState,
} from "./ports.js";

export const REPOSITORY_LOCAL_LIFECYCLE_PROFILE_ID = "yukh-mcp/repository-local-lifecycle-v1";
export const REPOSITORY_LOCAL_LIFECYCLE_PATH = ".yukh/runtime/lifecycle-v1";

const DEFAULT_MAX_RESERVATIONS = 1_024;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const MAX_RECORD_BYTES = 128 * 1024;
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const REFERENCE_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const DIRECTORY_PATTERN = /^[0-9a-f]{64}$/;
const TRANSITION_PATTERN = /^[0-9]{8}\.json$/;
const TEMPORARY_PATTERN = /^\.(profile|reservation|[0-9]{8})\.json\.[0-9a-f]{32}\.tmp$/;

const referenceSchema = z.string().min(1).max(128).regex(REFERENCE_PATTERN);
const digestSchema = z.string().refine(isValidSha256Digest);
const timestampSchema = z.string().refine(isValidAuditTimestamp);
const bindingSchema = z
  .object({
    reservation_binding_version: z.literal(1),
    reservation_ref: referenceSchema,
    reservation_digest: digestSchema,
    idempotency_scope_digest: digestSchema,
    plan_id: referenceSchema,
    plan_digest: digestSchema,
    approval_id: referenceSchema.nullable(),
    approval_digest: digestSchema.nullable(),
    approval_nonce_digest: digestSchema.nullable(),
    authorization_request_id: referenceSchema,
    authorization_request_digest: digestSchema,
    authorization_decision_id: referenceSchema,
    authorization_decision_digest: digestSchema,
    subject_ref: referenceSchema,
    capability_definition_digest: digestSchema,
    resource_set_digest: digestSchema,
    environment_ref: referenceSchema,
    operation_set_digest: digestSchema,
    attempt: z.number().int().min(1).max(5),
    reserved_at: timestampSchema,
  })
  .strict();

interface ProfileRecord {
  readonly profile_record_version: 1;
  readonly profile_id: typeof REPOSITORY_LOCAL_LIFECYCLE_PROFILE_ID;
  readonly writer_ref: string;
  readonly max_reservations: number;
  readonly max_bytes: number;
  readonly created_at: string;
  readonly profile_digest: string;
}

interface ReservationRecord {
  readonly reservation_record_version: 1;
  readonly profile_id: typeof REPOSITORY_LOCAL_LIFECYCLE_PROFILE_ID;
  readonly binding: AttemptReservationBinding;
  readonly binding_digest: string;
  readonly reservation_record_digest: string;
}

interface TransitionRecord {
  readonly transition_record_version: 1;
  readonly profile_id: typeof REPOSITORY_LOCAL_LIFECYCLE_PROFILE_ID;
  readonly reservation_ref: string;
  readonly reservation_digest: string;
  readonly state_version: number;
  readonly previous_transition_digest: string | null;
  readonly state: ReservationState;
  readonly recorded_at: string;
  readonly execution: ExecutionRecordV1 | null;
  readonly verification: VerificationRecordV1 | null;
  readonly final_outcome: "succeeded" | "failed" | "partial_effect" | "completion_unknown" | null;
  readonly transition_digest: string;
}

interface LoadedReservation {
  readonly directory: string;
  readonly record: ReservationRecord;
  snapshot: AttemptReservationSnapshot;
  transitionDigest: string;
  recordedAt: string;
  bytes: number;
}

export interface RepositoryLocalLifecycleDiagnostic {
  readonly profile: typeof REPOSITORY_LOCAL_LIFECYCLE_PROFILE_ID;
  readonly state: "healthy" | "failed";
  readonly reason: "ready" | "capacity_exhausted" | "integrity_failure" | "io_failure";
  readonly reservations: number;
  readonly bytes: number;
}

export interface RepositoryLocalLifecycleLedger extends AttemptReservationLedger {
  diagnostic(): RepositoryLocalLifecycleDiagnostic;
}

export interface RepositoryLocalLifecycleLedgerOptions {
  readonly trustedRepositoryRoot: string;
  readonly writerRef: string;
}

export interface RepositoryLocalLifecycleQualificationOptions extends RepositoryLocalLifecycleLedgerOptions {
  readonly now?: () => Date;
  readonly maxReservations?: number;
  readonly maxBytes?: number;
  readonly onFilesystemEvent?: (event: RepositoryLocalLifecycleFilesystemEvent) => void;
}

export type RepositoryLocalLifecycleFilesystemEvent =
  | "record.before_temp_create"
  | "record.after_temp_sync"
  | "record.after_publish"
  | "record.after_directory_sync";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const ordered = [...expected].sort();
  return actual.length === ordered.length && actual.every((key, index) => key === ordered[index]);
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof Reflect.get(error, "code") === "string" &&
    Reflect.get(error, "code") === code
  );
}

function unavailable(
  code: "reservation_unavailable" | "reservation_capacity" = "reservation_unavailable",
) {
  return new LifecyclePortError(code);
}

function conflict(code: "reservation_conflict" | "state_conflict"): never {
  throw new LifecyclePortError(code);
}

function rawSha256(value: string): string {
  return lifecycleDigest(value).slice("sha256:".length);
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalAuditJson(value), "utf8");
}

function nowIso(now: () => Date): string {
  let value: Date;
  let timestamp: string;
  try {
    value = now();
    timestamp = value.toISOString();
  } catch {
    throw unavailable();
  }
  if (!(value instanceof Date) || !isValidAuditTimestamp(timestamp)) throw unavailable();
  return timestamp;
}

function assertBinding(value: unknown): AttemptReservationBinding {
  const parsed = bindingSchema.safeParse(value);
  if (!parsed.success) throw unavailable();
  const binding = parsed.data;
  const { reservation_digest: _reservationDigest, ...digestInput } = binding;
  if (
    lifecycleDigest(digestInput) !== binding.reservation_digest ||
    (binding.approval_id === null) !== (binding.approval_digest === null) ||
    (binding.approval_id === null) !== (binding.approval_nonce_digest === null)
  ) {
    throw unavailable();
  }
  return freezeDeep(binding);
}

function executionMatchesBinding(
  execution: ExecutionRecordV1,
  binding: AttemptReservationBinding,
): boolean {
  return (
    execution.plan_id === binding.plan_id &&
    execution.plan_digest === binding.plan_digest &&
    execution.authorization_request_id === binding.authorization_request_id &&
    execution.authorization_request_digest === binding.authorization_request_digest &&
    execution.authorization_decision_id === binding.authorization_decision_id &&
    execution.authorization_decision_digest === binding.authorization_decision_digest &&
    execution.approval_id === binding.approval_id &&
    execution.approval_digest === binding.approval_digest &&
    execution.reservation_ref === binding.reservation_ref &&
    execution.reservation_digest === binding.reservation_digest &&
    execution.attempt === binding.attempt &&
    compareAuditTimestamps(execution.started_at, binding.reserved_at) >= 0
  );
}

function verificationMatchesBinding(
  verification: VerificationRecordV1,
  execution: ExecutionRecordV1,
  binding: AttemptReservationBinding,
): boolean {
  return (
    verification.plan_id === binding.plan_id &&
    verification.plan_digest === binding.plan_digest &&
    verification.execution_ref === execution.execution_ref &&
    verification.execution_digest === execution.execution_digest
  );
}

function profileRecord(
  writerRef: string,
  maxReservations: number,
  maxBytes: number,
  createdAt: string,
): ProfileRecord {
  const base: Omit<ProfileRecord, "profile_digest"> = {
    profile_record_version: 1,
    profile_id: REPOSITORY_LOCAL_LIFECYCLE_PROFILE_ID,
    writer_ref: writerRef,
    max_reservations: maxReservations,
    max_bytes: maxBytes,
    created_at: createdAt,
  };
  return freezeDeep({ ...base, profile_digest: lifecycleDigest(base) });
}

function reservationRecord(binding: AttemptReservationBinding): ReservationRecord {
  const base: Omit<ReservationRecord, "reservation_record_digest"> = {
    reservation_record_version: 1,
    profile_id: REPOSITORY_LOCAL_LIFECYCLE_PROFILE_ID,
    binding,
    binding_digest: binding.reservation_digest,
  };
  return freezeDeep({ ...base, reservation_record_digest: lifecycleDigest(base) });
}

function sameReservationIntent(
  left: AttemptReservationBinding,
  right: AttemptReservationBinding,
): boolean {
  return (
    left.idempotency_scope_digest === right.idempotency_scope_digest &&
    left.plan_id === right.plan_id &&
    left.plan_digest === right.plan_digest &&
    left.approval_id === right.approval_id &&
    left.approval_digest === right.approval_digest &&
    left.approval_nonce_digest === right.approval_nonce_digest &&
    left.subject_ref === right.subject_ref &&
    left.capability_definition_digest === right.capability_definition_digest &&
    left.resource_set_digest === right.resource_set_digest &&
    left.environment_ref === right.environment_ref &&
    left.operation_set_digest === right.operation_set_digest &&
    left.attempt === right.attempt
  );
}

function transitionRecord(
  snapshot: AttemptReservationSnapshot,
  previousTransitionDigest: string | null,
  recordedAt: string,
): TransitionRecord {
  const base: Omit<TransitionRecord, "transition_digest"> = {
    transition_record_version: 1,
    profile_id: REPOSITORY_LOCAL_LIFECYCLE_PROFILE_ID,
    reservation_ref: snapshot.binding.reservation_ref,
    reservation_digest: snapshot.binding.reservation_digest,
    state_version: snapshot.state_version,
    previous_transition_digest: previousTransitionDigest,
    state: snapshot.state,
    recorded_at: recordedAt,
    execution: snapshot.execution,
    verification: snapshot.verification,
    final_outcome: snapshot.final_outcome,
  };
  return freezeDeep({ ...base, transition_digest: lifecycleDigest(base) });
}

async function assertDirectory(directory: string): Promise<void> {
  const metadata = await lstat(directory);
  const uid = process.geteuid?.();
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (uid !== undefined && metadata.uid !== uid) ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw unavailable();
  }
}

async function assertFile(file: string, maxBytes: number): Promise<void> {
  const metadata = await lstat(file);
  const uid = process.geteuid?.();
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size <= 0 ||
    metadata.size > maxBytes ||
    (uid !== undefined && metadata.uid !== uid) ||
    (metadata.mode & 0o177) !== 0
  ) {
    throw unavailable();
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensureDirectory(directory: string, parent: string): Promise<void> {
  try {
    await mkdir(directory, { mode: DIRECTORY_MODE });
    await chmod(directory, DIRECTORY_MODE);
    await syncDirectory(directory);
    await syncDirectory(parent);
  } catch (error: unknown) {
    if (!isNodeErrorCode(error, "EEXIST")) throw error;
  }
  await assertDirectory(directory);
}

async function ensureSafeParentDirectory(directory: string, parent: string): Promise<void> {
  try {
    await mkdir(directory, { mode: DIRECTORY_MODE });
    await chmod(directory, DIRECTORY_MODE);
    await syncDirectory(directory);
    await syncDirectory(parent);
  } catch (error: unknown) {
    if (!isNodeErrorCode(error, "EEXIST")) throw error;
  }
  const metadata = await lstat(directory);
  const uid = process.geteuid?.();
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (uid !== undefined && metadata.uid !== uid) ||
    (metadata.mode & 0o022) !== 0
  ) {
    throw unavailable();
  }
}

async function readCanonical(file: string, maxBytes: number): Promise<unknown> {
  await assertFile(file, maxBytes);
  const bytes = await readFile(file);
  if (bytes.length === 0 || bytes.length > maxBytes) throw unavailable();
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw unavailable();
  }
  if (!bytes.equals(canonicalBytes(value))) throw unavailable();
  return value;
}

async function publish(
  directory: string,
  fileName: string,
  value: unknown,
  onEvent?: (event: RepositoryLocalLifecycleFilesystemEvent) => void,
): Promise<"published" | "exists"> {
  const bytes = canonicalBytes(value);
  if (bytes.length === 0 || bytes.length > MAX_RECORD_BYTES) throw unavailable();
  const suffix = randomBytes(16).toString("hex");
  const temporary = path.join(directory, `.${fileName}.${suffix}.tmp`);
  const destination = path.join(directory, fileName);
  onEvent?.("record.before_temp_create");
  const handle = await open(temporary, "wx", FILE_MODE);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  onEvent?.("record.after_temp_sync");
  let published = true;
  try {
    await link(temporary, destination);
  } catch (error: unknown) {
    if (!isNodeErrorCode(error, "EEXIST")) throw error;
    published = false;
  }
  if (published) {
    onEvent?.("record.after_publish");
    await syncDirectory(directory);
    onEvent?.("record.after_directory_sync");
  }
  await unlink(temporary);
  await syncDirectory(directory);
  return published ? "published" : "exists";
}

function parseProfile(value: unknown): ProfileRecord {
  if (
    !isPlainRecord(value) ||
    !exactKeys(value, [
      "created_at",
      "max_bytes",
      "max_reservations",
      "profile_digest",
      "profile_id",
      "profile_record_version",
      "writer_ref",
    ])
  ) {
    throw unavailable();
  }
  const {
    profile_record_version: version,
    profile_id: profileId,
    writer_ref: writerRef,
    max_reservations: maxReservations,
    max_bytes: maxBytes,
    created_at: createdAt,
    profile_digest: digest,
  } = value;
  if (
    version !== 1 ||
    profileId !== REPOSITORY_LOCAL_LIFECYCLE_PROFILE_ID ||
    typeof writerRef !== "string" ||
    writerRef.length > 128 ||
    !REFERENCE_PATTERN.test(writerRef) ||
    !Number.isSafeInteger(maxReservations) ||
    (maxReservations as number) < 1 ||
    !Number.isSafeInteger(maxBytes) ||
    (maxBytes as number) < MAX_RECORD_BYTES ||
    !isValidAuditTimestamp(createdAt) ||
    !isValidSha256Digest(digest)
  ) {
    throw unavailable();
  }
  const parsed = profileRecord(writerRef, maxReservations as number, maxBytes as number, createdAt);
  if (parsed.profile_digest !== digest) throw unavailable();
  return parsed;
}

function parseReservation(value: unknown): ReservationRecord {
  if (
    !isPlainRecord(value) ||
    !exactKeys(value, [
      "binding",
      "binding_digest",
      "profile_id",
      "reservation_record_digest",
      "reservation_record_version",
    ])
  ) {
    throw unavailable();
  }
  const binding = assertBinding(value.binding);
  const parsed = reservationRecord(binding);
  if (
    value.reservation_record_version !== 1 ||
    value.profile_id !== REPOSITORY_LOCAL_LIFECYCLE_PROFILE_ID ||
    value.binding_digest !== parsed.binding_digest ||
    value.reservation_record_digest !== parsed.reservation_record_digest
  ) {
    throw unavailable();
  }
  return parsed;
}

function parseTransition(
  value: unknown,
  binding: AttemptReservationBinding,
  expectedVersion: number,
  previous: TransitionRecord | undefined,
): TransitionRecord {
  const previousDigest = previous?.transition_digest ?? null;
  if (
    !isPlainRecord(value) ||
    !exactKeys(value, [
      "execution",
      "final_outcome",
      "previous_transition_digest",
      "profile_id",
      "recorded_at",
      "reservation_digest",
      "reservation_ref",
      "state",
      "state_version",
      "transition_digest",
      "transition_record_version",
      "verification",
    ])
  ) {
    throw unavailable();
  }
  const states: readonly ReservationState[] = [
    "not_started",
    "started",
    "effect_observed",
    "no_effect_proven",
    "partial_effect",
    "completion_unknown",
    "verification_failed",
    "succeeded",
  ];
  const finals = ["succeeded", "failed", "partial_effect", "completion_unknown", null] as const;
  const execution = value.execution === null ? null : validateExecutionRecord(value.execution);
  const verification =
    value.verification === null
      ? null
      : validateVerificationRecord(value.verification, execution ?? undefined);
  if (
    value.transition_record_version !== 1 ||
    value.profile_id !== REPOSITORY_LOCAL_LIFECYCLE_PROFILE_ID ||
    value.reservation_ref !== binding.reservation_ref ||
    value.reservation_digest !== binding.reservation_digest ||
    value.state_version !== expectedVersion ||
    value.previous_transition_digest !== previousDigest ||
    !isReservationState(value.state) ||
    !isFinalOutcome(value.final_outcome) ||
    !isValidAuditTimestamp(value.recorded_at) ||
    !isValidSha256Digest(value.transition_digest)
  ) {
    throw unavailable();
  }
  const snapshot: AttemptReservationSnapshot = {
    binding,
    state: value.state,
    state_version: expectedVersion,
    execution,
    verification,
    final_outcome: value.final_outcome,
  };
  const parsed = transitionRecord(snapshot, previousDigest, value.recorded_at);
  if (parsed.transition_digest !== value.transition_digest) throw unavailable();
  assertTransitionSemantics(parsed, binding);
  if (previous !== undefined) assertTransitionProgress(previous, parsed);
  return parsed;
}

function isReservationState(value: unknown): value is ReservationState {
  return [
    "not_started",
    "started",
    "effect_observed",
    "no_effect_proven",
    "partial_effect",
    "completion_unknown",
    "verification_failed",
    "succeeded",
  ].some((state) => state === value);
}

function isFinalOutcome(
  value: unknown,
): value is "succeeded" | "failed" | "partial_effect" | "completion_unknown" | null {
  return (
    value === "succeeded" ||
    value === "failed" ||
    value === "partial_effect" ||
    value === "completion_unknown" ||
    value === null
  );
}

function assertTransitionSemantics(
  record: TransitionRecord,
  binding: AttemptReservationBinding,
): void {
  const aggregate = record.execution?.aggregate_outcome;
  if (
    (record.state_version === 0 &&
      (record.state !== "not_started" ||
        record.previous_transition_digest !== null ||
        record.execution !== null ||
        record.verification !== null ||
        record.final_outcome !== null)) ||
    (record.state === "started" &&
      (record.execution !== null ||
        record.verification !== null ||
        record.final_outcome !== null)) ||
    (record.state === "effect_observed" && aggregate !== "effect_observed") ||
    (record.state === "no_effect_proven" && aggregate !== "no_effect_proven") ||
    (record.state === "partial_effect" && aggregate !== "partial_effect") ||
    (record.state === "completion_unknown" &&
      record.execution !== null &&
      aggregate !== "completion_unknown" &&
      record.final_outcome !== "completion_unknown") ||
    (record.state === "succeeded" &&
      (aggregate !== "effect_observed" ||
        record.verification?.outcome !== "verified" ||
        (record.final_outcome !== null && record.final_outcome !== "succeeded"))) ||
    (record.state === "verification_failed" &&
      (record.verification === null || record.verification.outcome === "verified")) ||
    (record.verification !== null && record.execution === null) ||
    (record.execution !== null && !executionMatchesBinding(record.execution, binding)) ||
    (record.verification !== null &&
      record.execution !== null &&
      !verificationMatchesBinding(record.verification, record.execution, binding)) ||
    (record.final_outcome === "succeeded" && record.state !== "succeeded") ||
    (record.final_outcome === "failed" &&
      record.state !== "verification_failed" &&
      record.state !== "no_effect_proven") ||
    (record.final_outcome === "partial_effect" && record.state !== "partial_effect") ||
    (record.final_outcome === "completion_unknown" && record.state !== "completion_unknown")
  ) {
    throw unavailable();
  }
}

function assertTransitionProgress(previous: TransitionRecord, current: TransitionRecord): void {
  const executionChanged =
    previous.execution !== null &&
    previous.execution.execution_digest !== current.execution?.execution_digest;
  const verificationChanged =
    previous.verification !== null &&
    previous.verification.verification_digest !== current.verification?.verification_digest;
  const finalChanged =
    previous.final_outcome !== null &&
    previous.final_outcome !== current.final_outcome &&
    current.final_outcome !== "completion_unknown";
  const addedExecution = previous.execution === null && current.execution !== null;
  const addedVerification = previous.verification === null && current.verification !== null;
  const addedFinal = previous.final_outcome === null && current.final_outcome !== null;
  const conservativeUnknown =
    previous.state !== "not_started" &&
    current.state === "completion_unknown" &&
    current.final_outcome === "completion_unknown";
  const allowed =
    conservativeUnknown ||
    (previous.state === "not_started" && current.state === "started") ||
    (previous.state === "started" &&
      ["effect_observed", "no_effect_proven", "partial_effect", "completion_unknown"].includes(
        current.state,
      )) ||
    (previous.state === "effect_observed" &&
      ["succeeded", "verification_failed"].includes(current.state)) ||
    (previous.state === "no_effect_proven" && current.state === "no_effect_proven") ||
    (previous.state === "partial_effect" && current.state === "partial_effect") ||
    (previous.state === "completion_unknown" && current.state === "completion_unknown") ||
    (previous.state === "verification_failed" && current.state === "verification_failed") ||
    (previous.state === "succeeded" && current.state === "succeeded");
  if (
    !allowed ||
    executionChanged ||
    verificationChanged ||
    finalChanged ||
    (previous.execution === null && current.execution !== null && previous.state !== "started") ||
    (previous.verification === null &&
      current.verification !== null &&
      previous.execution === null) ||
    (previous.state === current.state && !addedExecution && !addedVerification && !addedFinal) ||
    compareAuditTimestamps(current.recorded_at, previous.recorded_at) < 0
  ) {
    throw unavailable();
  }
}

function snapshotFrom(record: TransitionRecord, binding: AttemptReservationBinding) {
  return freezeDeep<AttemptReservationSnapshot>({
    binding,
    state: record.state,
    state_version: record.state_version,
    execution: record.execution,
    verification: record.verification,
    final_outcome: record.final_outcome,
  });
}

class RepositoryLocalLifecycleLedgerImpl implements RepositoryLocalLifecycleLedger {
  private readonly reservations = new Map<string, LoadedReservation>();
  private readonly approvalNonces = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private health: RepositoryLocalLifecycleDiagnostic["state"] = "healthy";
  private reason: RepositoryLocalLifecycleDiagnostic["reason"] = "ready";
  private totalBytes = 0;

  constructor(
    private readonly root: string,
    private readonly reservationsRoot: string,
    private readonly lockPath: string,
    private readonly profile: ProfileRecord,
    private readonly now: () => Date,
    private readonly onEvent?: (event: RepositoryLocalLifecycleFilesystemEvent) => void,
  ) {}

  load(entry: LoadedReservation): void {
    const reference = entry.record.binding.reservation_ref;
    if (this.reservations.has(reference)) this.fail("integrity_failure");
    const nonce = entry.record.binding.approval_nonce_digest;
    if (nonce !== null) {
      const existing = this.approvalNonces.get(nonce);
      if (existing !== undefined && existing !== reference) this.fail("integrity_failure");
      this.approvalNonces.set(nonce, reference);
    }
    this.reservations.set(reference, entry);
    this.totalBytes += entry.bytes;
  }

  fail(reason: RepositoryLocalLifecycleDiagnostic["reason"]): never {
    this.health = "failed";
    this.reason = reason;
    throw unavailable(
      reason === "capacity_exhausted" ? "reservation_capacity" : "reservation_unavailable",
    );
  }

  diagnostic(): RepositoryLocalLifecycleDiagnostic {
    return Object.freeze({
      profile: REPOSITORY_LOCAL_LIFECYCLE_PROFILE_ID,
      state: this.health,
      reason: this.reason,
      reservations: this.reservations.size,
      bytes: this.totalBytes,
    });
  }

  async assertReady(): Promise<void> {
    if (this.closed || this.health !== "healthy") throw unavailable();
    if (this.totalBytes + MAX_RECORD_BYTES > this.profile.max_bytes) {
      this.fail("capacity_exhausted");
    }
    let available: bigint;
    try {
      const filesystem = await statfs(this.root, { bigint: true });
      available = filesystem.bavail * filesystem.bsize;
    } catch {
      this.fail("io_failure");
    }
    if (available < BigInt(MAX_RECORD_BYTES * 2)) this.fail("capacity_exhausted");
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      try {
        return await operation();
      } catch (error: unknown) {
        if (error instanceof LifecyclePortError) throw error;
        this.health = "failed";
        this.reason = "io_failure";
        throw unavailable();
      }
    });
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  reserve(
    value: AttemptReservationBinding,
  ): Promise<
    | Readonly<{ status: "reserved"; snapshot: AttemptReservationSnapshot }>
    | Readonly<{ status: "duplicate"; snapshot: AttemptReservationSnapshot }>
  > {
    return this.serialize(async () => {
      await this.assertReady();
      const binding = assertBinding(value);
      const existing = this.reservations.get(binding.reservation_ref);
      if (existing !== undefined) {
        if (!sameReservationIntent(existing.record.binding, binding)) {
          conflict("reservation_conflict");
        }
        return Object.freeze({ status: "duplicate" as const, snapshot: existing.snapshot });
      }
      const nonce = binding.approval_nonce_digest;
      if (nonce !== null && this.approvalNonces.has(nonce)) conflict("reservation_conflict");
      if (this.reservations.size + 1 > this.profile.max_reservations) {
        this.fail("capacity_exhausted");
      }
      const record = reservationRecord(binding);
      const initialSnapshot: AttemptReservationSnapshot = freezeDeep({
        binding,
        state: "not_started",
        state_version: 0,
        execution: null,
        verification: null,
        final_outcome: null,
      });
      const transition = transitionRecord(initialSnapshot, null, binding.reserved_at);
      const bytes = canonicalBytes(record).length + canonicalBytes(transition).length;
      if (this.totalBytes + bytes > this.profile.max_bytes) this.fail("capacity_exhausted");
      const directoryName = rawSha256(binding.reservation_ref);
      const directory = path.join(this.reservationsRoot, directoryName);
      await ensureDirectory(directory, this.reservationsRoot);
      if ((await publish(directory, "reservation.json", record, this.onEvent)) !== "published") {
        conflict("reservation_conflict");
      }
      if ((await publish(directory, "00000000.json", transition, this.onEvent)) !== "published") {
        this.fail("integrity_failure");
      }
      const loaded: LoadedReservation = {
        directory,
        record,
        snapshot: initialSnapshot,
        transitionDigest: transition.transition_digest,
        recordedAt: transition.recorded_at,
        bytes,
      };
      this.load(loaded);
      return Object.freeze({ status: "reserved" as const, snapshot: initialSnapshot });
    });
  }

  markStarted(reservationRef: string, reservationDigest: string, startedAt: string): Promise<void> {
    return this.transition(
      reservationRef,
      reservationDigest,
      (snapshot) => {
        if (snapshot.state === "started") return snapshot;
        if (
          snapshot.state !== "not_started" ||
          !isValidAuditTimestamp(startedAt) ||
          compareAuditTimestamps(startedAt, snapshot.binding.reserved_at) < 0
        ) {
          conflict("state_conflict");
        }
        return {
          ...snapshot,
          state: "started",
          state_version: snapshot.state_version + 1,
        };
      },
      startedAt,
    );
  }

  recordExecution(
    reservationRef: string,
    reservationDigest: string,
    value: ExecutionRecordV1,
  ): Promise<void> {
    return this.transition(
      reservationRef,
      reservationDigest,
      (snapshot) => {
        const execution = validateExecutionRecord(value);
        if (!executionMatchesBinding(execution, snapshot.binding)) {
          conflict("state_conflict");
        }
        if (
          snapshot.execution?.execution_digest === execution.execution_digest &&
          snapshot.state !== "started"
        ) {
          return snapshot;
        }
        if (
          snapshot.state !== "started" ||
          execution.reservation_ref !== snapshot.binding.reservation_ref ||
          execution.reservation_digest !== snapshot.binding.reservation_digest
        ) {
          conflict("state_conflict");
        }
        const state: ReservationState =
          execution.aggregate_outcome === "partial_effect"
            ? "partial_effect"
            : execution.aggregate_outcome;
        return {
          ...snapshot,
          state,
          state_version: snapshot.state_version + 1,
          execution,
        };
      },
      value.completed_at,
    );
  }

  recordVerification(
    reservationRef: string,
    reservationDigest: string,
    value: VerificationRecordV1,
  ): Promise<void> {
    return this.transition(
      reservationRef,
      reservationDigest,
      (snapshot) => {
        const execution = snapshot.execution;
        if (execution === null) conflict("state_conflict");
        const verification = validateVerificationRecord(value, execution);
        if (!verificationMatchesBinding(verification, execution, snapshot.binding)) {
          conflict("state_conflict");
        }
        if (snapshot.verification?.verification_digest === verification.verification_digest) {
          return snapshot;
        }
        if (
          snapshot.verification !== null ||
          !["effect_observed", "partial_effect", "completion_unknown"].includes(snapshot.state)
        ) {
          conflict("state_conflict");
        }
        const state: ReservationState =
          verification.outcome === "verified" && execution.aggregate_outcome === "effect_observed"
            ? "succeeded"
            : execution.aggregate_outcome === "partial_effect"
              ? "partial_effect"
              : execution.aggregate_outcome === "completion_unknown"
                ? "completion_unknown"
                : "verification_failed";
        return {
          ...snapshot,
          state,
          state_version: snapshot.state_version + 1,
          verification,
          final_outcome: snapshot.final_outcome,
        };
      },
      value.completed_at,
    );
  }

  recordFinal(
    reservationRef: string,
    reservationDigest: string,
    outcome: "succeeded" | "failed" | "partial_effect" | "completion_unknown",
  ): Promise<void> {
    return this.transition(
      reservationRef,
      reservationDigest,
      (snapshot) => {
        if (snapshot.final_outcome === outcome) return snapshot;
        if (
          snapshot.final_outcome !== null &&
          !(outcome === "completion_unknown" && snapshot.final_outcome !== "completion_unknown")
        ) {
          conflict("state_conflict");
        }
        if (
          (outcome === "succeeded" && snapshot.state !== "succeeded") ||
          (outcome === "partial_effect" && snapshot.state !== "partial_effect") ||
          (outcome === "completion_unknown" && snapshot.state === "not_started") ||
          (outcome === "failed" &&
            snapshot.state !== "verification_failed" &&
            snapshot.state !== "no_effect_proven")
        ) {
          conflict("state_conflict");
        }
        return {
          ...snapshot,
          state: outcome === "completion_unknown" ? "completion_unknown" : snapshot.state,
          state_version: snapshot.state_version + 1,
          final_outcome: outcome,
        };
      },
      nowIso(this.now),
    );
  }

  private transition(
    reservationRef: string,
    reservationDigest: string,
    update: (snapshot: AttemptReservationSnapshot) => AttemptReservationSnapshot,
    recordedAt: string,
  ): Promise<void> {
    return this.serialize(async () => {
      await this.assertReady();
      const loaded = this.reservations.get(reservationRef);
      if (loaded === undefined || loaded.record.binding_digest !== reservationDigest) {
        conflict("reservation_conflict");
      }
      const updated = freezeDeep(update(loaded.snapshot));
      if (updated === loaded.snapshot || updated.state_version === loaded.snapshot.state_version) {
        return;
      }
      if (
        updated.state_version !== loaded.snapshot.state_version + 1 ||
        !isValidAuditTimestamp(recordedAt) ||
        compareAuditTimestamps(recordedAt, loaded.recordedAt) < 0
      ) {
        conflict("state_conflict");
      }
      const transition = transitionRecord(updated, loaded.transitionDigest, recordedAt);
      assertTransitionSemantics(transition, loaded.record.binding);
      const bytes = canonicalBytes(transition).length;
      if (this.totalBytes + bytes > this.profile.max_bytes) this.fail("capacity_exhausted");
      const fileName = `${updated.state_version.toString().padStart(8, "0")}.json`;
      if ((await publish(loaded.directory, fileName, transition, this.onEvent)) !== "published") {
        this.fail("integrity_failure");
      }
      loaded.snapshot = snapshotFrom(transition, loaded.record.binding);
      loaded.transitionDigest = transition.transition_digest;
      loaded.recordedAt = transition.recorded_at;
      loaded.bytes += bytes;
      this.totalBytes += bytes;
    });
  }

  async read(
    reservationRef: string,
    reservationDigest: string,
  ): Promise<AttemptReservationSnapshot | undefined> {
    if (this.closed || this.health !== "healthy") throw unavailable();
    const loaded = this.reservations.get(reservationRef);
    if (loaded === undefined) return undefined;
    if (loaded.record.binding_digest !== reservationDigest) conflict("reservation_conflict");
    return loaded.snapshot;
  }

  close(): Promise<void> {
    return this.serialize(async () => {
      if (this.closed) return;
      await unlink(this.lockPath);
      await syncDirectory(this.root);
      this.closed = true;
    });
  }
}

async function cleanTemporaries(
  directory: string,
  allowedBase: (base: string) => boolean,
): Promise<void> {
  const entries = await readdir(directory);
  for (const entry of entries) {
    if (!entry.startsWith(".")) continue;
    const match = TEMPORARY_PATTERN.exec(entry);
    if (match === null) throw unavailable();
    const destinationBase = match[1];
    if (destinationBase === undefined || !allowedBase(destinationBase)) throw unavailable();
    const file = path.join(directory, entry);
    const metadata = await lstat(file);
    const uid = process.geteuid?.();
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink < 1 ||
      metadata.nlink > 2 ||
      metadata.size > MAX_RECORD_BYTES ||
      (uid !== undefined && metadata.uid !== uid) ||
      (metadata.mode & 0o177) !== 0
    ) {
      throw unavailable();
    }
    if (metadata.nlink === 2) {
      const destination = path.join(directory, `${destinationBase}.json`);
      const destinationMetadata = await lstat(destination);
      if (
        !destinationMetadata.isFile() ||
        destinationMetadata.isSymbolicLink() ||
        destinationMetadata.dev !== metadata.dev ||
        destinationMetadata.ino !== metadata.ino ||
        destinationMetadata.nlink !== 2 ||
        destinationMetadata.size <= 0 ||
        destinationMetadata.size > MAX_RECORD_BYTES
      ) {
        throw unavailable();
      }
      await syncDirectory(directory);
    }
    await unlink(file);
    await syncDirectory(directory);
  }
}

async function loadReservationDirectory(
  reservationsRoot: string,
  directoryName: string,
): Promise<LoadedReservation | undefined> {
  if (!DIRECTORY_PATTERN.test(directoryName)) throw unavailable();
  const directory = path.join(reservationsRoot, directoryName);
  await assertDirectory(directory);
  await cleanTemporaries(directory, (base) => base === "reservation" || /^[0-9]{8}$/.test(base));
  let entries = (await readdir(directory)).sort();
  if (entries.length === 0) {
    await rmdir(directory);
    await syncDirectory(reservationsRoot);
    return undefined;
  }
  if (!entries.includes("reservation.json")) throw unavailable();
  let transitionFiles = entries.filter((entry) => TRANSITION_PATTERN.test(entry));
  const reservationPath = path.join(directory, "reservation.json");
  const record = parseReservation(await readCanonical(reservationPath, MAX_RECORD_BYTES));
  if (transitionFiles.length === 0 && entries.length === 1) {
    const snapshot: AttemptReservationSnapshot = freezeDeep({
      binding: record.binding,
      state: "not_started",
      state_version: 0,
      execution: null,
      verification: null,
      final_outcome: null,
    });
    const initial = transitionRecord(snapshot, null, record.binding.reserved_at);
    if ((await publish(directory, "00000000.json", initial)) !== "published") {
      throw unavailable();
    }
    entries = (await readdir(directory)).sort();
    transitionFiles = entries.filter((entry) => TRANSITION_PATTERN.test(entry));
  }
  if (
    transitionFiles.length === 0 ||
    entries.length !== transitionFiles.length + 1 ||
    transitionFiles.some((entry, index) => entry !== `${index.toString().padStart(8, "0")}.json`)
  ) {
    throw unavailable();
  }
  if (rawSha256(record.binding.reservation_ref) !== directoryName) throw unavailable();
  let latest: TransitionRecord | undefined;
  let bytes = (await lstat(reservationPath)).size;
  for (const [index, fileName] of transitionFiles.entries()) {
    const file = path.join(directory, fileName);
    const value = await readCanonical(file, MAX_RECORD_BYTES);
    latest = parseTransition(value, record.binding, index, latest);
    bytes += (await lstat(file)).size;
  }
  if (latest === undefined) throw unavailable();
  return {
    directory,
    record,
    snapshot: snapshotFrom(latest, record.binding),
    transitionDigest: latest.transition_digest,
    recordedAt: latest.recorded_at,
    bytes,
  };
}

async function acquireLock(root: string, writerRef: string, now: string): Promise<string> {
  const lockPath = path.join(root, "writer.lock");
  const ownerToken = randomBytes(32).toString("hex");
  const base = {
    lock_record_version: 1,
    profile_id: REPOSITORY_LOCAL_LIFECYCLE_PROFILE_ID,
    writer_ref: writerRef,
    owner_token: ownerToken,
    acquired_at: now,
  };
  const record = { ...base, lock_digest: lifecycleDigest(base) };
  let handle;
  try {
    handle = await open(lockPath, "wx", FILE_MODE);
    await handle.writeFile(canonicalBytes(record));
    await handle.sync();
  } catch (error: unknown) {
    if (handle !== undefined) await handle.close();
    throw unavailable();
  }
  await handle.close();
  await syncDirectory(root);
  return lockPath;
}

async function prepareRoot(repositoryRoot: string): Promise<{
  repositoryRoot: string;
  root: string;
  reservationsRoot: string;
}> {
  const canonicalRepository = await realpath(repositoryRoot);
  const repositoryMetadata = await lstat(canonicalRepository);
  if (!repositoryMetadata.isDirectory() || repositoryMetadata.isSymbolicLink()) throw unavailable();
  let parent = canonicalRepository;
  for (const segment of [".yukh", "runtime"]) {
    const current = path.join(parent, segment);
    await ensureSafeParentDirectory(current, parent);
    parent = current;
  }
  const lifecycleRoot = path.join(parent, "lifecycle-v1");
  await ensureDirectory(lifecycleRoot, parent);
  parent = lifecycleRoot;
  const root = parent;
  if (
    !root.startsWith(`${canonicalRepository}${path.sep}`) ||
    root.includes(`${path.sep}.git${path.sep}`)
  ) {
    throw unavailable();
  }
  const reservationsRoot = path.join(root, "reservations");
  await ensureDirectory(reservationsRoot, root);
  return { repositoryRoot: canonicalRepository, root, reservationsRoot };
}

async function openLedger(
  options: RepositoryLocalLifecycleQualificationOptions,
): Promise<RepositoryLocalLifecycleLedger> {
  if (
    options.writerRef.length > 128 ||
    !REFERENCE_PATTERN.test(options.writerRef) ||
    (options.maxReservations !== undefined &&
      (!Number.isSafeInteger(options.maxReservations) || options.maxReservations < 1)) ||
    (options.maxBytes !== undefined &&
      (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < MAX_RECORD_BYTES))
  ) {
    throw unavailable();
  }
  const now = options.now ?? (() => new Date());
  let prepared: Awaited<ReturnType<typeof prepareRoot>>;
  try {
    prepared = await prepareRoot(options.trustedRepositoryRoot);
  } catch (error: unknown) {
    if (error instanceof LifecyclePortError) throw error;
    throw unavailable();
  }
  const { root, reservationsRoot } = prepared;
  const profilePath = path.join(root, "profile.json");
  try {
    const openedAt = nowIso(now);
    const lockPath = await acquireLock(root, options.writerRef, openedAt);
    await cleanTemporaries(root, (base) => base === "profile");
    const profileExists = await lstat(profilePath).then(
      () => true,
      (error: unknown) => {
        if (isNodeErrorCode(error, "ENOENT")) return false;
        throw error;
      },
    );
    let profile: ProfileRecord;
    if (!profileExists) {
      profile = profileRecord(
        options.writerRef,
        options.maxReservations ?? DEFAULT_MAX_RESERVATIONS,
        options.maxBytes ?? DEFAULT_MAX_BYTES,
        openedAt,
      );
      if (
        (await publish(root, "profile.json", profile, options.onFilesystemEvent)) !== "published"
      ) {
        throw unavailable();
      }
    } else {
      profile = parseProfile(await readCanonical(profilePath, MAX_RECORD_BYTES));
      if (
        profile.writer_ref !== options.writerRef ||
        (options.maxReservations !== undefined &&
          profile.max_reservations !== options.maxReservations) ||
        (options.maxBytes !== undefined && profile.max_bytes !== options.maxBytes)
      ) {
        throw unavailable();
      }
    }
    const allowed = new Set(["profile.json", "reservations", "writer.lock"]);
    const rootEntries = await readdir(root);
    for (const entry of rootEntries) {
      if (!allowed.has(entry)) throw unavailable();
    }
    const ledger = new RepositoryLocalLifecycleLedgerImpl(
      root,
      reservationsRoot,
      lockPath,
      profile,
      now,
      options.onFilesystemEvent,
    );
    const directories = (await readdir(reservationsRoot)).sort();
    if (directories.length > profile.max_reservations) ledger.fail("capacity_exhausted");
    for (const directoryName of directories) {
      const loaded = await loadReservationDirectory(reservationsRoot, directoryName);
      if (loaded !== undefined) ledger.load(loaded);
    }
    if (ledger.diagnostic().bytes > profile.max_bytes) ledger.fail("capacity_exhausted");
    return ledger;
  } catch (error: unknown) {
    if (error instanceof LifecyclePortError) throw error;
    throw unavailable();
  }
}

export function openRepositoryLocalLifecycleLedger(
  options: RepositoryLocalLifecycleLedgerOptions,
): Promise<RepositoryLocalLifecycleLedger> {
  return openLedger(options);
}

export function openRepositoryLocalLifecycleLedgerForQualification(
  options: RepositoryLocalLifecycleQualificationOptions,
): Promise<RepositoryLocalLifecycleLedger> {
  return openLedger(options);
}
