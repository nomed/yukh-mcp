import { AuditError, compareAuditTimestamps, type ProtectedAuditEvent } from "./contract.js";
import {
  REPOSITORY_LOCAL_LIMITS,
  primaryIdentityMatchesCommit,
  receiptFromPrimaryCommit,
  recoveryIdentityMatchesPending,
  type RepositoryLocalCheckpointRecord,
  type RepositoryLocalPrimaryCommitRecord,
  type RepositoryLocalPrimaryIdentityRecord,
  type RepositoryLocalRecoveryIdentityRecord,
  type RepositoryLocalRecoveryPendingRecord,
  type RepositoryLocalStreamRecord,
} from "./repository-local-contract.js";

export type RepositoryLocalHealthState = "healthy" | "degraded" | "failed";
export type RepositoryLocalHealthPhase =
  | "checkpoint"
  | "closed"
  | "closing"
  | "pending_read"
  | "pre_effect_check"
  | "primary_append"
  | "ready"
  | "recovery_append"
  | "startup";
export type RepositoryLocalHealthReason =
  | "capacity_degraded"
  | "capacity_exhausted"
  | "checkpoint_invalid"
  | "duplicate_conflict"
  | "filesystem_unsupported"
  | "io_ambiguous"
  | "io_failure"
  | "none"
  | "pending_expired"
  | "pending_read_bound"
  | "state_corrupt"
  | "state_stale"
  | "unsafe_metadata";
export type RepositoryLocalCapacityState = "available" | "degraded" | "exhausted";

export interface RepositoryLocalPrimaryEntry {
  readonly commit: RepositoryLocalPrimaryCommitRecord;
  readonly identity: RepositoryLocalPrimaryIdentityRecord;
  readonly commitBytes: number;
  readonly identityBytes: number;
}

export interface RepositoryLocalRecoveryEntry {
  readonly pending: RepositoryLocalRecoveryPendingRecord;
  readonly identity: RepositoryLocalRecoveryIdentityRecord;
  readonly pendingBytes: number;
  readonly identityBytes: number;
}

export interface RepositoryLocalStreamState {
  readonly metadata: RepositoryLocalStreamRecord;
  readonly metadataBytes: number;
  readonly commits: RepositoryLocalPrimaryEntry[];
  readonly checkpoints: RepositoryLocalCheckpointRecord[];
}

export interface RepositoryLocalCapacityUsage {
  primaryCommittedBytes: number;
  eventIdentityBytes: number;
  recoveryReservedBytes: number;
  checkpointMetadataBytes: number;
  temporaryBytes: number;
  streams: number;
  eventIdentities: number;
  pendingRecoveryFacts: number;
  recoveryIdentities: number;
}

export interface RepositoryLocalHealthDiagnostic {
  readonly profile_version: 1;
  readonly phase: RepositoryLocalHealthPhase;
  readonly state: RepositoryLocalHealthState;
  readonly reason: RepositoryLocalHealthReason;
  readonly counts: Readonly<{
    streams: number;
    event_identities: number;
    pending_recovery_facts: number;
    recovery_identities: number;
  }>;
  readonly capacity: Readonly<{
    primary_committed_bytes: RepositoryLocalCapacityState;
    event_identity_bytes: RepositoryLocalCapacityState;
    recovery_bytes: RepositoryLocalCapacityState;
    checkpoint_metadata_bytes: RepositoryLocalCapacityState;
    temporary_bytes: RepositoryLocalCapacityState;
    stream_count: RepositoryLocalCapacityState;
    event_identity_count: RepositoryLocalCapacityState;
    pending_recovery_count: RepositoryLocalCapacityState;
    recovery_identity_count: RepositoryLocalCapacityState;
  }>;
  readonly checkpoint_authority: "local_unwitnessed_not_complete";
}

export interface RepositoryLocalStateSnapshot {
  readonly streams: ReadonlyMap<string, RepositoryLocalStreamState>;
  readonly primaryByEventId: ReadonlyMap<string, RepositoryLocalPrimaryEntry>;
  readonly recoveriesById: ReadonlyMap<string, RepositoryLocalRecoveryEntry>;
  readonly diagnostic: RepositoryLocalHealthDiagnostic;
}

const NINETY_PERCENT_NUMERATOR = 9;
const NINETY_PERCENT_DENOMINATOR = 10;

export function classifyRepositoryLocalCapacity(
  value: number,
  limit: number,
): RepositoryLocalCapacityState {
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(limit) || value < 0 || limit <= 0) {
    throw new AuditError("audit_integrity_failure");
  }
  if (value >= limit) return "exhausted";
  return value * NINETY_PERCENT_DENOMINATOR >= limit * NINETY_PERCENT_NUMERATOR
    ? "degraded"
    : "available";
}

function safeAdd(current: number, addition: number): number {
  if (
    !Number.isSafeInteger(current) ||
    !Number.isSafeInteger(addition) ||
    current < 0 ||
    addition < 0
  ) {
    throw new AuditError("audit_integrity_failure");
  }
  const result = current + addition;
  if (!Number.isSafeInteger(result) || result < current) {
    throw new AuditError("audit_integrity_failure");
  }
  return result;
}

function boundedCount(value: number, limit: number): number {
  if (!Number.isSafeInteger(value) || value < 0) return limit + 1;
  return Math.min(value, limit + 1);
}

export class RepositoryLocalState {
  readonly streams = new Map<string, RepositoryLocalStreamState>();
  readonly primaryByEventId = new Map<string, RepositoryLocalPrimaryEntry>();
  readonly recoveriesById = new Map<string, RepositoryLocalRecoveryEntry>();
  readonly retainedPrimaryIdentityIds = new Set<string>();
  readonly retainedRecoveryIdentityIds = new Set<string>();
  readonly usage: RepositoryLocalCapacityUsage = {
    primaryCommittedBytes: 0,
    eventIdentityBytes: 0,
    recoveryReservedBytes: 0,
    checkpointMetadataBytes: 0,
    temporaryBytes: 0,
    streams: 0,
    eventIdentities: 0,
    pendingRecoveryFacts: 0,
    recoveryIdentities: 0,
  };

  private phase: RepositoryLocalHealthPhase = "startup";
  private state: RepositoryLocalHealthState = "healthy";
  private reason: RepositoryLocalHealthReason = "none";
  private capacityOnlyFailure = false;

  setPhase(phase: RepositoryLocalHealthPhase): void {
    if (this.phase === "closed") return;
    this.phase = phase;
  }

  fail(reason: Exclude<RepositoryLocalHealthReason, "none" | "capacity_degraded">): void {
    if (this.state !== "failed") {
      this.state = "failed";
      this.reason = reason;
      this.capacityOnlyFailure = reason === "capacity_exhausted";
    } else if (reason !== "capacity_exhausted") {
      this.capacityOnlyFailure = false;
    }
  }

  degrade(): void {
    if (this.state === "healthy") {
      this.state = "degraded";
      this.reason = "capacity_degraded";
    }
  }

  isFailed(): boolean {
    return this.state === "failed";
  }

  allowsCapacityDuplicate(): boolean {
    return this.state === "failed" && this.capacityOnlyFailure;
  }

  assertReadable(): void {
    if (this.state === "failed" && !this.capacityOnlyFailure) {
      throw new AuditError("audit_unavailable");
    }
  }

  assertWritable(): void {
    if (this.state === "failed") throw new AuditError("audit_unavailable");
  }

  registerStream(metadata: RepositoryLocalStreamRecord, metadataBytes: number): void {
    if (this.streams.has(metadata.stream_ref)) throw new AuditError("audit_integrity_failure");
    this.streams.set(metadata.stream_ref, {
      metadata,
      metadataBytes,
      commits: [],
      checkpoints: [],
    });
    this.usage.streams = safeAdd(this.usage.streams, 1);
    this.usage.checkpointMetadataBytes = safeAdd(this.usage.checkpointMetadataBytes, metadataBytes);
  }

  registerPrimary(stream: RepositoryLocalStreamState, entry: RepositoryLocalPrimaryEntry): void {
    if (!primaryIdentityMatchesCommit(entry.identity, entry.commit)) {
      throw new AuditError("audit_integrity_failure");
    }
    const event = entry.commit.event;
    const tail = stream.commits.at(-1)?.commit.event;
    const expectedSequence = tail === undefined ? 0 : tail.integrity.sequence + 1;
    const expectedPrevious = tail?.integrity.event_hash ?? `sha256:${"0".repeat(64)}`;
    if (
      event.integrity.stream_ref !== stream.metadata.stream_ref ||
      event.integrity.sequence !== expectedSequence ||
      event.integrity.previous_event_hash !== expectedPrevious ||
      this.primaryByEventId.has(event.event_id) ||
      this.retainedPrimaryIdentityIds.has(event.event_id)
    ) {
      throw new AuditError("audit_integrity_failure");
    }
    stream.commits.push(entry);
    this.primaryByEventId.set(event.event_id, entry);
    this.retainedPrimaryIdentityIds.add(event.event_id);
    this.usage.primaryCommittedBytes = safeAdd(this.usage.primaryCommittedBytes, entry.commitBytes);
    this.usage.eventIdentityBytes = safeAdd(this.usage.eventIdentityBytes, entry.identityBytes);
    this.usage.eventIdentities = safeAdd(this.usage.eventIdentities, 1);
  }

  registerOrphanPrimaryIdentity(
    identity: RepositoryLocalPrimaryIdentityRecord,
    identityBytes: number,
  ): void {
    if (this.retainedPrimaryIdentityIds.has(identity.event_id)) {
      throw new AuditError("audit_integrity_failure");
    }
    this.retainedPrimaryIdentityIds.add(identity.event_id);
    this.usage.eventIdentityBytes = safeAdd(this.usage.eventIdentityBytes, identityBytes);
    this.usage.eventIdentities = safeAdd(this.usage.eventIdentities, 1);
  }

  registerRecovery(entry: RepositoryLocalRecoveryEntry): void {
    if (!recoveryIdentityMatchesPending(entry.identity, entry.pending)) {
      throw new AuditError("audit_integrity_failure");
    }
    const recoveryId = entry.pending.fact.recovery_id;
    if (this.recoveriesById.has(recoveryId) || this.retainedRecoveryIdentityIds.has(recoveryId)) {
      throw new AuditError("audit_integrity_failure");
    }
    this.recoveriesById.set(recoveryId, entry);
    this.retainedRecoveryIdentityIds.add(recoveryId);
    this.usage.pendingRecoveryFacts = safeAdd(this.usage.pendingRecoveryFacts, 1);
    this.usage.recoveryIdentities = safeAdd(this.usage.recoveryIdentities, 1);
    this.usage.recoveryReservedBytes = safeAdd(
      this.usage.recoveryReservedBytes,
      REPOSITORY_LOCAL_LIMITS.recovery_identity_reservation_bytes,
    );
  }

  registerOrphanRecoveryIdentity(_identity: RepositoryLocalRecoveryIdentityRecord): void {
    if (this.retainedRecoveryIdentityIds.has(_identity.recovery_id)) {
      throw new AuditError("audit_integrity_failure");
    }
    this.retainedRecoveryIdentityIds.add(_identity.recovery_id);
    this.usage.recoveryIdentities = safeAdd(this.usage.recoveryIdentities, 1);
    this.usage.recoveryReservedBytes = safeAdd(
      this.usage.recoveryReservedBytes,
      REPOSITORY_LOCAL_LIMITS.recovery_identity_reservation_bytes,
    );
  }

  registerCheckpoint(
    stream: RepositoryLocalStreamState,
    checkpoint: RepositoryLocalCheckpointRecord,
    checkpointBytes: number,
  ): void {
    const previous = stream.checkpoints.at(-1);
    const expectedStart = previous === undefined ? 0 : previous.range_end + 1;
    const expectedPrevious = previous?.checkpoint_id ?? null;
    const terminal = stream.commits[checkpoint.range_end]?.commit.event;
    if (
      checkpoint.stream_ref !== stream.metadata.stream_ref ||
      checkpoint.writer_ref !== stream.metadata.writer_ref ||
      checkpoint.range_start !== expectedStart ||
      checkpoint.previous_checkpoint_ref !== expectedPrevious ||
      checkpoint.range_end >= stream.commits.length ||
      checkpoint.event_count !== checkpoint.range_end - checkpoint.range_start + 1 ||
      terminal === undefined ||
      terminal.integrity.event_hash !== checkpoint.terminal_event_hash
    ) {
      throw new AuditError("audit_integrity_failure");
    }
    stream.checkpoints.push(checkpoint);
    this.usage.checkpointMetadataBytes = safeAdd(
      this.usage.checkpointMetadataBytes,
      checkpointBytes,
    );
  }

  findPrimary(eventId: string): RepositoryLocalPrimaryEntry | undefined {
    return this.primaryByEventId.get(eventId);
  }

  findRecovery(recoveryId: string): RepositoryLocalRecoveryEntry | undefined {
    return this.recoveriesById.get(recoveryId);
  }

  hasRetainedPrimaryIdentity(eventId: string): boolean {
    return this.retainedPrimaryIdentityIds.has(eventId);
  }

  hasRetainedRecoveryIdentity(recoveryId: string): boolean {
    return this.retainedRecoveryIdentityIds.has(recoveryId);
  }

  tail(streamRef: string): ProtectedAuditEvent | undefined {
    return this.streams.get(streamRef)?.commits.at(-1)?.commit.event;
  }

  receipt(eventId: string, duplicate: boolean) {
    const entry = this.primaryByEventId.get(eventId);
    return entry === undefined ? undefined : receiptFromPrimaryCommit(entry.commit, duplicate);
  }

  assertCanAppendPrimary(
    commitBytes: number,
    identityBytes: number,
    createsStream: boolean,
    streamMetadataBytes: number,
    checkpointBytes: number,
    availableBytes: bigint,
  ): void {
    this.assertWritable();
    const nextPrimary = safeAdd(this.usage.primaryCommittedBytes, commitBytes);
    const nextIdentityBytes = safeAdd(this.usage.eventIdentityBytes, identityBytes);
    const nextIdentities = safeAdd(this.usage.eventIdentities, 1);
    const nextStreams = safeAdd(this.usage.streams, createsStream ? 1 : 0);
    const nextCheckpointMetadata = safeAdd(
      this.usage.checkpointMetadataBytes,
      safeAdd(createsStream ? streamMetadataBytes : 0, checkpointBytes),
    );
    const requiredFree = BigInt(
      2 *
        (REPOSITORY_LOCAL_LIMITS.max_primary_commit_record_bytes +
          REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes +
          (createsStream ? REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes : 0) +
          (checkpointBytes === 0 ? 0 : REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes)),
    );
    if (
      nextPrimary > REPOSITORY_LOCAL_LIMITS.max_primary_committed_bytes ||
      nextIdentityBytes > REPOSITORY_LOCAL_LIMITS.max_event_identity_bytes ||
      nextIdentities > REPOSITORY_LOCAL_LIMITS.max_event_identities ||
      nextStreams > REPOSITORY_LOCAL_LIMITS.max_streams ||
      nextCheckpointMetadata > REPOSITORY_LOCAL_LIMITS.max_checkpoint_deletion_metadata_bytes ||
      availableBytes < requiredFree
    ) {
      this.fail("capacity_exhausted");
      throw new AuditError("audit_unavailable");
    }
  }

  assertCanAppendRecovery(availableBytes: bigint): void {
    this.assertWritable();
    const nextPending = safeAdd(this.usage.pendingRecoveryFacts, 1);
    const nextIdentities = safeAdd(this.usage.recoveryIdentities, 1);
    const nextReserved = safeAdd(
      this.usage.recoveryReservedBytes,
      REPOSITORY_LOCAL_LIMITS.recovery_identity_reservation_bytes,
    );
    const requiredFree = BigInt(
      2 *
        (REPOSITORY_LOCAL_LIMITS.max_recovery_record_bytes +
          REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes),
    );
    if (
      nextPending > REPOSITORY_LOCAL_LIMITS.max_pending_recovery_facts ||
      nextIdentities > REPOSITORY_LOCAL_LIMITS.max_recovery_identities ||
      nextReserved > REPOSITORY_LOCAL_LIMITS.max_recovery_bytes ||
      availableBytes < requiredFree
    ) {
      this.fail("capacity_exhausted");
      throw new AuditError("audit_unavailable");
    }
  }

  assertStartupBounds(): void {
    if (
      this.usage.streams > REPOSITORY_LOCAL_LIMITS.max_streams ||
      this.usage.primaryCommittedBytes > REPOSITORY_LOCAL_LIMITS.max_primary_committed_bytes ||
      this.usage.eventIdentityBytes > REPOSITORY_LOCAL_LIMITS.max_event_identity_bytes ||
      this.usage.eventIdentities > REPOSITORY_LOCAL_LIMITS.max_event_identities ||
      this.usage.pendingRecoveryFacts > REPOSITORY_LOCAL_LIMITS.max_pending_recovery_facts ||
      this.usage.recoveryIdentities > REPOSITORY_LOCAL_LIMITS.max_recovery_identities ||
      this.usage.recoveryReservedBytes > REPOSITORY_LOCAL_LIMITS.max_recovery_bytes ||
      this.usage.checkpointMetadataBytes >
        REPOSITORY_LOCAL_LIMITS.max_checkpoint_deletion_metadata_bytes ||
      this.usage.temporaryBytes > REPOSITORY_LOCAL_LIMITS.max_temporary_bytes
    ) {
      this.fail("capacity_exhausted");
      throw new AuditError("audit_unavailable");
    }
  }

  updateCapacityHealth(): void {
    const capacity = this.capacityDiagnostic();
    const values = Object.values(capacity);
    if (values.includes("exhausted")) {
      this.fail("capacity_exhausted");
    } else if (values.includes("degraded")) {
      this.degrade();
    }
  }

  uncheckpointedCount(stream: RepositoryLocalStreamState): number {
    const lastEnd = stream.checkpoints.at(-1)?.range_end ?? -1;
    return stream.commits.length - (lastEnd + 1);
  }

  requiredFreeBytesForNextWrite(): bigint {
    let primaryBytes = 0;
    const primaryCountAvailable =
      this.usage.primaryCommittedBytes < REPOSITORY_LOCAL_LIMITS.max_primary_committed_bytes &&
      this.usage.eventIdentityBytes < REPOSITORY_LOCAL_LIMITS.max_event_identity_bytes &&
      this.usage.eventIdentities < REPOSITORY_LOCAL_LIMITS.max_event_identities &&
      (this.usage.streams > 0 || this.usage.streams < REPOSITORY_LOCAL_LIMITS.max_streams);
    if (primaryCountAvailable) {
      const needsMetadata =
        this.usage.streams < REPOSITORY_LOCAL_LIMITS.max_streams ||
        [...this.streams.values()].some(
          (stream) =>
            this.uncheckpointedCount(stream) + 1 === REPOSITORY_LOCAL_LIMITS.checkpoint_interval,
        );
      primaryBytes =
        2 *
        (REPOSITORY_LOCAL_LIMITS.max_primary_commit_record_bytes +
          REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes +
          (needsMetadata ? REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes : 0));
    }
    const recoveryAvailable =
      this.usage.pendingRecoveryFacts < REPOSITORY_LOCAL_LIMITS.max_pending_recovery_facts &&
      this.usage.recoveryIdentities < REPOSITORY_LOCAL_LIMITS.max_recovery_identities &&
      this.usage.recoveryReservedBytes < REPOSITORY_LOCAL_LIMITS.max_recovery_bytes;
    const recoveryBytes = recoveryAvailable
      ? 2 *
        (REPOSITORY_LOCAL_LIMITS.max_recovery_record_bytes +
          REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes)
      : 0;
    return BigInt(Math.max(primaryBytes, recoveryBytes));
  }

  pendingSnapshot(): readonly RepositoryLocalRecoveryEntry[] {
    return [...this.recoveriesById.values()].sort((left, right) => {
      const time = compareAuditTimestamps(
        left.pending.fact.original_observed_at,
        right.pending.fact.original_observed_at,
      );
      if (time !== 0) return time;
      const id =
        left.pending.fact.recovery_id < right.pending.fact.recovery_id
          ? -1
          : left.pending.fact.recovery_id > right.pending.fact.recovery_id
            ? 1
            : 0;
      if (id !== 0) return id;
      return left.pending.fact_digest < right.pending.fact_digest
        ? -1
        : left.pending.fact_digest > right.pending.fact_digest
          ? 1
          : 0;
    });
  }

  diagnostic(): RepositoryLocalHealthDiagnostic {
    return {
      profile_version: 1,
      phase: this.phase,
      state: this.state,
      reason: this.reason,
      counts: {
        streams: boundedCount(this.usage.streams, REPOSITORY_LOCAL_LIMITS.max_streams),
        event_identities: boundedCount(
          this.usage.eventIdentities,
          REPOSITORY_LOCAL_LIMITS.max_event_identities,
        ),
        pending_recovery_facts: boundedCount(
          this.usage.pendingRecoveryFacts,
          REPOSITORY_LOCAL_LIMITS.max_pending_recovery_facts,
        ),
        recovery_identities: boundedCount(
          this.usage.recoveryIdentities,
          REPOSITORY_LOCAL_LIMITS.max_recovery_identities,
        ),
      },
      capacity: this.capacityDiagnostic(),
      checkpoint_authority: "local_unwitnessed_not_complete",
    };
  }

  snapshot(): RepositoryLocalStateSnapshot {
    return {
      streams: this.streams,
      primaryByEventId: this.primaryByEventId,
      recoveriesById: this.recoveriesById,
      diagnostic: this.diagnostic(),
    };
  }

  private capacityDiagnostic(): RepositoryLocalHealthDiagnostic["capacity"] {
    return {
      primary_committed_bytes: classifyRepositoryLocalCapacity(
        this.usage.primaryCommittedBytes,
        REPOSITORY_LOCAL_LIMITS.max_primary_committed_bytes,
      ),
      event_identity_bytes: classifyRepositoryLocalCapacity(
        this.usage.eventIdentityBytes,
        REPOSITORY_LOCAL_LIMITS.max_event_identity_bytes,
      ),
      recovery_bytes: classifyRepositoryLocalCapacity(
        this.usage.recoveryReservedBytes,
        REPOSITORY_LOCAL_LIMITS.max_recovery_bytes,
      ),
      checkpoint_metadata_bytes: classifyRepositoryLocalCapacity(
        this.usage.checkpointMetadataBytes,
        REPOSITORY_LOCAL_LIMITS.max_checkpoint_deletion_metadata_bytes,
      ),
      temporary_bytes: classifyRepositoryLocalCapacity(
        this.usage.temporaryBytes,
        REPOSITORY_LOCAL_LIMITS.max_temporary_bytes,
      ),
      stream_count: classifyRepositoryLocalCapacity(
        this.usage.streams,
        REPOSITORY_LOCAL_LIMITS.max_streams,
      ),
      event_identity_count: classifyRepositoryLocalCapacity(
        this.usage.eventIdentities,
        REPOSITORY_LOCAL_LIMITS.max_event_identities,
      ),
      pending_recovery_count: classifyRepositoryLocalCapacity(
        this.usage.pendingRecoveryFacts,
        REPOSITORY_LOCAL_LIMITS.max_pending_recovery_facts,
      ),
      recovery_identity_count: classifyRepositoryLocalCapacity(
        this.usage.recoveryIdentities,
        REPOSITORY_LOCAL_LIMITS.max_recovery_identities,
      ),
    };
  }
}
