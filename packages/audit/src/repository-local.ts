import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  AuditError,
  compareAuditTimestamps,
  isValidAuditTimestamp,
  type ProtectedAuditEvent,
} from "./contract.js";
import {
  validateRecoveryFactShape,
  type RecoveryFact,
  type RecoveryJournal,
  type RequiredAuditReadiness,
} from "./lifecycle.js";
import {
  canonicalRepositoryLocalBytes,
  computeRecoveryFactDigest,
  createRepositoryLocalCheckpointRecord,
  createRepositoryLocalPrimaryCommitRecord,
  createRepositoryLocalPrimaryIdentityRecord,
  createRepositoryLocalProfileRecord,
  createRepositoryLocalRecoveryIdentityRecord,
  createRepositoryLocalRecoveryPendingRecord,
  createRepositoryLocalStreamRecord,
  isRepositoryLocalReference,
  primaryIdentityMatchesCommit,
  REPOSITORY_LOCAL_LIMITS,
  receiptFromPrimaryCommit,
  recoveryIdentityMatchesPending,
  repositoryLocalCheckpointFileName,
  repositoryLocalIdentityVersionFileName,
  repositoryLocalReferencePathDigest,
  repositoryLocalSequenceFileName,
  RepositoryLocalFormatError,
  validateRepositoryLocalCheckpointRecord,
  validateRepositoryLocalPrimaryCommitRecord,
  validateRepositoryLocalPrimaryIdentityRecord,
  validateRepositoryLocalProfileRecord,
  validateRepositoryLocalRecoveryIdentityRecord,
  validateRepositoryLocalRecoveryPendingRecord,
  validateRepositoryLocalStreamRecord,
  type RepositoryLocalCheckpointRecord,
  type RepositoryLocalPrimaryCommitRecord,
  type RepositoryLocalPrimaryIdentityRecord,
  type RepositoryLocalProfileRecord,
  type RepositoryLocalRecoveryIdentityRecord,
  type RepositoryLocalRecoveryPendingRecord,
  type RepositoryLocalStreamRecord,
} from "./repository-local-contract.js";
import {
  acquireRepositoryLocalWriterLock,
  assertEmptyRepositoryLocalDirectory,
  ensureDurableRepositoryLocalDirectory,
  ensureRepositoryLocalRuntimeRoot,
  ensureRepositoryLocalTopology,
  fileExistsWithoutFollowing,
  inspectRepositoryLocalTemporaryBytes,
  listRepositoryLocalDirectory,
  publishRepositoryLocalFile,
  qualifyRepositoryLocalFilesystem,
  readBoundedRepositoryLocalFile,
  releaseRepositoryLocalWriterLock,
  removeRecognizedRepositoryLocalTemporary,
  repositoryLocalAvailableBytes,
  resolveTrustedRepositoryLocalPaths,
  syncRepositoryLocalDirectory,
  verifyRepositoryLocalWriterLock,
  RepositoryLocalFilesystemError,
  type RepositoryLocalFileKind,
  type RepositoryLocalFilesystemHooks,
  type RepositoryLocalOwnedLock,
  type RepositoryLocalPaths,
} from "./repository-local-filesystem.js";
import {
  RepositoryLocalState,
  type RepositoryLocalHealthDiagnostic,
  type RepositoryLocalPrimaryEntry,
  type RepositoryLocalRecoveryEntry,
  type RepositoryLocalStreamState,
} from "./repository-local-state.js";
import { AUDIT_GENESIS_HASH, type AuditCommitReceipt, type AuditStore } from "./writer.js";

export interface RepositoryLocalAuditProfileOptions {
  readonly trustedRepositoryRoot: string;
  readonly writerRef: string;
}

export interface RepositoryLocalAuditProfile {
  readonly store: AuditStore;
  readonly journal: RecoveryJournal;
  readonly readiness: RequiredAuditReadiness;
  pendingFacts(): AsyncIterable<RecoveryFact>;
  diagnostic(): RepositoryLocalHealthDiagnostic;
  close(): Promise<void>;
}

export interface RepositoryLocalQualificationOptions extends RepositoryLocalAuditProfileOptions {
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
  readonly filesystemHooks?: RepositoryLocalFilesystemHooks;
  readonly startupPrimaryScanLimits?: RepositoryLocalStartupScanLimits;
}

export interface RepositoryLocalStartupScanLimits {
  readonly maxRecords: number;
  readonly maxBytes: number;
}

interface RepositoryLocalClock {
  nowIso(): string;
  monotonic(): number;
}

interface LoadedRecord<T> {
  readonly record: T;
  readonly bytes: Buffer;
}

interface LoadedCommit extends LoadedRecord<RepositoryLocalPrimaryCommitRecord> {
  readonly directoryPath: string;
  readonly filePath: string;
}

interface LoadedStream {
  readonly state: RepositoryLocalStreamState;
  readonly commits: readonly LoadedCommit[];
}

interface PrimaryIdentityDirectory {
  readonly directoryPath: string;
  readonly pathDigest: string;
  readonly final?: LoadedRecord<RepositoryLocalPrimaryIdentityRecord>;
  readonly temporaries: readonly string[];
}

interface RecoveryIdentityDirectory {
  readonly directoryPath: string;
  readonly pathDigest: string;
  readonly final?: LoadedRecord<RepositoryLocalRecoveryIdentityRecord>;
  readonly temporaries: readonly string[];
}

interface PreparedCheckpoint {
  readonly record: RepositoryLocalCheckpointRecord;
  readonly bytes: Buffer;
}

interface PendingFactPass {
  readonly facts: readonly RecoveryFact[];
  readonly started: number;
}

const RAW_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const SEQUENCE_FILE_PATTERN = /^[0-9]{20}\.json$/;
const CHECKPOINT_FILE_PATTERN = /^[0-9a-f]{64}\.json$/;
const TEMPORARY_FILE_PATTERN = /^\.(.+\.json)\.([0-9a-f]{64})\.tmp$/;
const STATIC_ROOT_ENTRIES = [
  "exports",
  "primary",
  "profile.json",
  "recovery",
  "tmp",
  "writer.lock",
] as const;
const ROOT_ENTRY_LIMIT = STATIC_ROOT_ENTRIES.length + 1;
const PRIMARY_ENTRY_LIMIT = REPOSITORY_LOCAL_LIMITS.max_event_identities + 1;
const RECOVERY_ENTRY_LIMIT = REPOSITORY_LOCAL_LIMITS.max_recovery_identities + 1;
const STREAM_ENTRY_LIMIT = REPOSITORY_LOCAL_LIMITS.max_streams + 1;
const RECORD_DIRECTORY_ENTRY_LIMIT = 3;
const IDENTITY_DIRECTORY_ENTRY_LIMIT = 2;
const DEFAULT_PRIMARY_STARTUP_SCAN_LIMITS: RepositoryLocalStartupScanLimits = Object.freeze({
  maxRecords: REPOSITORY_LOCAL_LIMITS.max_event_identities,
  maxBytes: REPOSITORY_LOCAL_LIMITS.max_primary_committed_bytes,
});

class PrimaryStartupScanBudget {
  private records = 0;
  private bytes = 0;

  constructor(private readonly limits: RepositoryLocalStartupScanLimits) {
    if (
      !Number.isSafeInteger(limits.maxRecords) ||
      !Number.isSafeInteger(limits.maxBytes) ||
      limits.maxRecords <= 0 ||
      limits.maxBytes <= 0 ||
      limits.maxRecords > REPOSITORY_LOCAL_LIMITS.max_event_identities ||
      limits.maxBytes > REPOSITORY_LOCAL_LIMITS.max_primary_committed_bytes
    ) {
      corruption();
    }
  }

  admitRecord(): void {
    if (this.records >= this.limits.maxRecords) {
      throw new RepositoryLocalFilesystemError("capacity_exhausted");
    }
    this.records += 1;
  }

  admitBytes(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || this.bytes > this.limits.maxBytes - bytes) {
      throw new RepositoryLocalFilesystemError("capacity_exhausted");
    }
    this.bytes += bytes;
  }
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function unavailable(): AuditError {
  return new AuditError("audit_unavailable");
}

function corruption(): never {
  throw new RepositoryLocalFilesystemError("corruption_detected");
}

function createClock(
  options: Readonly<{
    now?: () => Date;
    monotonicNow?: () => number;
  }>,
): RepositoryLocalClock {
  const now = options.now ?? (() => new Date());
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  return {
    nowIso(): string {
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
    },
    monotonic(): number {
      let value: number;
      try {
        value = monotonicNow();
      } catch {
        throw unavailable();
      }
      if (!Number.isFinite(value) || value < 0) throw unavailable();
      return value;
    },
  };
}

function assertExactNames(actual: readonly string[], expected: readonly string[]): void {
  if (
    actual.length !== expected.length ||
    actual.some((name, index) => name !== [...expected].sort()[index])
  ) {
    corruption();
  }
}

function temporaryName(destinationName: string, recordDigest: string): string {
  if (!recordDigest.startsWith("sha256:")) corruption();
  const raw = recordDigest.slice("sha256:".length);
  if (!RAW_DIGEST_PATTERN.test(raw)) corruption();
  return `.${destinationName}.${raw}.tmp`;
}

function parseTemporaryName(
  name: string,
): Readonly<{ destinationName: string; digest: string }> | undefined {
  const match = TEMPORARY_FILE_PATTERN.exec(name);
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined;
  if (match[1].startsWith(".") || match[1].includes(path.sep)) return undefined;
  return { destinationName: match[1], digest: `sha256:${match[2]}` };
}

async function readValidatedRecord<T>(
  filePath: string,
  maximumBytes: number,
  expectedDevice: number,
  hooks: RepositoryLocalFilesystemHooks | undefined,
  validate: (value: unknown) => T,
  expectedLinks: 1 | 2 = 1,
  beforeRead?: (size: number) => void,
): Promise<LoadedRecord<T>> {
  const loaded = await readBoundedRepositoryLocalFile(
    filePath,
    maximumBytes,
    expectedDevice,
    hooks,
    expectedLinks,
    beforeRead,
  );
  let record: T;
  try {
    record = validate(loaded.value);
  } catch {
    corruption();
  }
  return { record: freezeDeep(record), bytes: loaded.bytes };
}

async function cleanupBoundTemporary(
  directoryPath: string,
  temporary: string,
  expectedDestination: string,
  expectedDigest: string | undefined,
  maximumBytes: number,
  expectedDevice: number,
  hooks: RepositoryLocalFilesystemHooks | undefined,
  destinationExists: boolean,
): Promise<void> {
  const binding = parseTemporaryName(temporary);
  if (
    binding === undefined ||
    binding.destinationName !== expectedDestination ||
    (expectedDigest !== undefined && binding.digest !== expectedDigest)
  ) {
    corruption();
  }
  await removeRecognizedRepositoryLocalTemporary(
    path.join(directoryPath, temporary),
    directoryPath,
    maximumBytes,
    expectedDevice,
    hooks,
    destinationExists ? path.join(directoryPath, expectedDestination) : undefined,
  );
}

async function assertClosedStaticTopology(
  paths: RepositoryLocalPaths,
  expectedDevice: number,
  hooks: RepositoryLocalFilesystemHooks | undefined,
): Promise<void> {
  assertExactNames(
    await listRepositoryLocalDirectory(paths.runtimeRoot, expectedDevice, ROOT_ENTRY_LIMIT, hooks),
    STATIC_ROOT_ENTRIES,
  );
  assertExactNames(await listRepositoryLocalDirectory(paths.primary, expectedDevice, 4, hooks), [
    "checkpoints",
    "deletions",
    "identities",
    "streams",
  ]);
  assertExactNames(await listRepositoryLocalDirectory(paths.recovery, expectedDevice, 4, hooks), [
    "acknowledged",
    "identities",
    "pending",
    "quarantine",
  ]);
  await assertEmptyRepositoryLocalDirectory(paths.deletions, expectedDevice, hooks);
  await assertEmptyRepositoryLocalDirectory(paths.acknowledged, expectedDevice, hooks);
  await assertEmptyRepositoryLocalDirectory(paths.quarantine, expectedDevice, hooks);
  await assertEmptyRepositoryLocalDirectory(paths.exports, expectedDevice, hooks);
  await assertEmptyRepositoryLocalDirectory(paths.temporary, expectedDevice, hooks);
}

async function assertBoundedStartupTemporaryState(
  paths: RepositoryLocalPaths,
  expectedDevice: number,
  hooks: RepositoryLocalFilesystemHooks | undefined,
): Promise<void> {
  let count = 0;
  let bytes = 0;
  const inspect = async (
    directoryPath: string,
    maximumBytes: number,
    maximumEntries: number,
  ): Promise<void> => {
    const names = await listRepositoryLocalDirectory(
      directoryPath,
      expectedDevice,
      maximumEntries,
      hooks,
    );
    for (const name of names) {
      if (!name.endsWith(".tmp")) continue;
      if (parseTemporaryName(name) === undefined) corruption();
      count += 1;
      bytes += await inspectRepositoryLocalTemporaryBytes(
        path.join(directoryPath, name),
        maximumBytes,
        expectedDevice,
        hooks,
      );
      if (
        count > 1 ||
        !Number.isSafeInteger(bytes) ||
        bytes > REPOSITORY_LOCAL_LIMITS.max_temporary_bytes
      ) {
        corruption();
      }
    }
  };

  await inspect(
    paths.runtimeRoot,
    REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes,
    ROOT_ENTRY_LIMIT,
  );
  await inspect(
    paths.checkpoints,
    REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes,
    PRIMARY_ENTRY_LIMIT,
  );
  await inspect(
    paths.pending,
    REPOSITORY_LOCAL_LIMITS.max_recovery_record_bytes,
    RECOVERY_ENTRY_LIMIT,
  );
  for (const name of await listRepositoryLocalDirectory(
    paths.streams,
    expectedDevice,
    STREAM_ENTRY_LIMIT,
    hooks,
  )) {
    if (!RAW_DIGEST_PATTERN.test(name)) corruption();
    const streamPath = path.join(paths.streams, name);
    await inspect(
      streamPath,
      REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes,
      RECORD_DIRECTORY_ENTRY_LIMIT,
    );
    if (await fileExistsWithoutFollowing(path.join(streamPath, "commits"))) {
      await inspect(
        path.join(streamPath, "commits"),
        REPOSITORY_LOCAL_LIMITS.max_primary_commit_record_bytes,
        PRIMARY_ENTRY_LIMIT,
      );
    }
  }
  for (const [root, maximumBytes] of [
    [paths.primaryIdentities, REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes],
    [paths.recoveryIdentities, REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes],
  ] as const) {
    const rootLimit = root === paths.primaryIdentities ? PRIMARY_ENTRY_LIMIT : RECOVERY_ENTRY_LIMIT;
    for (const name of await listRepositoryLocalDirectory(root, expectedDevice, rootLimit, hooks)) {
      if (!RAW_DIGEST_PATTERN.test(name)) corruption();
      await inspect(path.join(root, name), maximumBytes, IDENTITY_DIRECTORY_ENTRY_LIMIT);
    }
  }
}

async function assertNoEvidenceForProfileCreation(
  paths: RepositoryLocalPaths,
  expectedDevice: number,
  hooks: RepositoryLocalFilesystemHooks | undefined,
): Promise<void> {
  for (const directoryPath of [
    paths.streams,
    paths.primaryIdentities,
    paths.checkpoints,
    paths.deletions,
    paths.pending,
    paths.acknowledged,
    paths.recoveryIdentities,
    paths.quarantine,
    paths.exports,
    paths.temporary,
  ]) {
    await assertEmptyRepositoryLocalDirectory(directoryPath, expectedDevice, hooks);
  }
}

async function loadOrCreateProfile(
  paths: RepositoryLocalPaths,
  writerRef: string,
  createdAt: string,
  expectedDevice: number,
  hooks: RepositoryLocalFilesystemHooks | undefined,
): Promise<RepositoryLocalProfileRecord> {
  const rootNames = await listRepositoryLocalDirectory(
    paths.runtimeRoot,
    expectedDevice,
    ROOT_ENTRY_LIMIT,
    hooks,
  );
  const profileTemporaries = rootNames.filter((name) => {
    const binding = parseTemporaryName(name);
    return binding?.destinationName === "profile.json";
  });
  const unexpected = rootNames.filter(
    (name) =>
      !STATIC_ROOT_ENTRIES.includes(name as (typeof STATIC_ROOT_ENTRIES)[number]) &&
      !profileTemporaries.includes(name),
  );
  if (unexpected.length !== 0 || profileTemporaries.length > 1) corruption();

  const profileExists = await fileExistsWithoutFollowing(paths.profile);
  if (profileExists) {
    let loaded = await readValidatedRecord(
      paths.profile,
      REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes,
      expectedDevice,
      hooks,
      validateRepositoryLocalProfileRecord,
      profileTemporaries.length === 1 ? 2 : 1,
    );
    if (loaded.record.writer_ref !== writerRef) corruption();
    if (profileTemporaries[0] !== undefined) {
      await cleanupBoundTemporary(
        paths.runtimeRoot,
        profileTemporaries[0],
        "profile.json",
        loaded.record.profile_record_digest,
        REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes,
        expectedDevice,
        hooks,
        true,
      );
    }
    await syncRepositoryLocalDirectory(paths.runtimeRoot, hooks, "profile");
    loaded = await readValidatedRecord(
      paths.profile,
      REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes,
      expectedDevice,
      hooks,
      validateRepositoryLocalProfileRecord,
    );
    if (loaded.record.writer_ref !== writerRef) corruption();
    return loaded.record;
  }

  if (profileTemporaries[0] !== undefined) {
    await cleanupBoundTemporary(
      paths.runtimeRoot,
      profileTemporaries[0],
      "profile.json",
      undefined,
      REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes,
      expectedDevice,
      hooks,
      false,
    );
  }
  await assertNoEvidenceForProfileCreation(paths, expectedDevice, hooks);
  const profile = createRepositoryLocalProfileRecord(writerRef, createdAt);
  const bytes = canonicalRepositoryLocalBytes(profile);
  await publishRepositoryLocalFile(
    paths.runtimeRoot,
    "profile.json",
    temporaryName("profile.json", profile.profile_record_digest),
    bytes,
    REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes,
    expectedDevice,
    "profile",
    hooks,
  );
  await syncRepositoryLocalDirectory(paths.runtimeRoot, hooks, "profile");
  return freezeDeep(profile);
}

async function scanCommitDirectory(
  directoryPath: string,
  expectedDevice: number,
  hooks: RepositoryLocalFilesystemHooks | undefined,
  budget: PrimaryStartupScanBudget,
): Promise<readonly LoadedCommit[]> {
  const names = await listRepositoryLocalDirectory(
    directoryPath,
    expectedDevice,
    PRIMARY_ENTRY_LIMIT,
    hooks,
  );
  const finals = new Map<string, LoadedCommit>();
  const temporaries = names.filter((name) => name.endsWith(".tmp"));
  const temporaryDestinations = new Set<string>();
  for (const temporary of temporaries) {
    const binding = parseTemporaryName(temporary);
    if (
      binding === undefined ||
      !SEQUENCE_FILE_PATTERN.test(binding.destinationName) ||
      temporaryDestinations.has(binding.destinationName)
    ) {
      corruption();
    }
    temporaryDestinations.add(binding.destinationName);
  }
  for (const name of names.filter((entry) => !entry.endsWith(".tmp"))) {
    if (!SEQUENCE_FILE_PATTERN.test(name)) corruption();
    const sequence = Number(name.slice(0, 20));
    if (!Number.isSafeInteger(sequence) || repositoryLocalSequenceFileName(sequence) !== name) {
      corruption();
    }
    budget.admitRecord();
    const filePath = path.join(directoryPath, name);
    const loaded = await readValidatedRecord(
      filePath,
      REPOSITORY_LOCAL_LIMITS.max_primary_commit_record_bytes,
      expectedDevice,
      hooks,
      validateRepositoryLocalPrimaryCommitRecord,
      temporaryDestinations.has(name) ? 2 : 1,
      (size) => budget.admitBytes(size),
    );
    if (loaded.record.event.integrity.sequence !== sequence) corruption();
    finals.set(name, { ...loaded, directoryPath, filePath });
  }
  for (const temporary of temporaries) {
    const binding = parseTemporaryName(temporary);
    if (binding === undefined || !SEQUENCE_FILE_PATTERN.test(binding.destinationName)) {
      corruption();
    }
    const final = finals.get(binding.destinationName);
    await cleanupBoundTemporary(
      directoryPath,
      temporary,
      binding.destinationName,
      final?.record.primary_commit_record_digest,
      REPOSITORY_LOCAL_LIMITS.max_primary_commit_record_bytes,
      expectedDevice,
      hooks,
      final !== undefined,
    );
  }
  return [...finals.values()].sort(
    (left, right) => left.record.event.integrity.sequence - right.record.event.integrity.sequence,
  );
}

async function scanStreams(
  paths: RepositoryLocalPaths,
  expectedDevice: number,
  hooks: RepositoryLocalFilesystemHooks | undefined,
  writerRef: string,
  state: RepositoryLocalState,
  budget: PrimaryStartupScanBudget,
): Promise<readonly LoadedStream[]> {
  const streamDirectoryNames = await listRepositoryLocalDirectory(
    paths.streams,
    expectedDevice,
    STREAM_ENTRY_LIMIT,
    hooks,
  );
  const loadedStreams: LoadedStream[] = [];
  for (const streamDirectoryName of streamDirectoryNames) {
    if (!RAW_DIGEST_PATTERN.test(streamDirectoryName)) corruption();
    const streamDirectoryPath = path.join(paths.streams, streamDirectoryName);
    const entries = await listRepositoryLocalDirectory(
      streamDirectoryPath,
      expectedDevice,
      RECORD_DIRECTORY_ENTRY_LIMIT,
      hooks,
    );
    const temporaries = entries.filter((name) => name.endsWith(".tmp"));
    if (
      temporaries.length > 1 ||
      entries.some(
        (name) => name !== "commits" && name !== "stream.json" && !temporaries.includes(name),
      )
    ) {
      corruption();
    }
    const commitsDirectoryPath = path.join(streamDirectoryPath, "commits");
    const commitsDirectoryExists = entries.includes("commits");
    const streamFileExists = entries.includes("stream.json");
    if (!commitsDirectoryExists) {
      if (streamFileExists || temporaries.length !== 0 || entries.length !== 0) corruption();
      continue;
    }
    const commits = await scanCommitDirectory(commitsDirectoryPath, expectedDevice, hooks, budget);
    let loadedMetadata: LoadedRecord<RepositoryLocalStreamRecord> | undefined;
    if (streamFileExists) {
      loadedMetadata = await readValidatedRecord(
        path.join(streamDirectoryPath, "stream.json"),
        REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes,
        expectedDevice,
        hooks,
        validateRepositoryLocalStreamRecord,
        temporaries.length === 1 ? 2 : 1,
      );
      if (
        loadedMetadata.record.stream_path_digest !== streamDirectoryName ||
        loadedMetadata.record.writer_ref !== writerRef
      ) {
        corruption();
      }
    }
    if (temporaries[0] !== undefined) {
      await cleanupBoundTemporary(
        streamDirectoryPath,
        temporaries[0],
        "stream.json",
        loadedMetadata?.record.stream_record_digest,
        REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes,
        expectedDevice,
        hooks,
        loadedMetadata !== undefined,
      );
    }
    if (loadedMetadata === undefined) {
      if (commits.length !== 0) corruption();
      continue;
    }
    await syncRepositoryLocalDirectory(streamDirectoryPath, hooks, "stream");
    loadedMetadata = await readValidatedRecord(
      path.join(streamDirectoryPath, "stream.json"),
      REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes,
      expectedDevice,
      hooks,
      validateRepositoryLocalStreamRecord,
    );
    if (
      loadedMetadata.record.stream_path_digest !== streamDirectoryName ||
      loadedMetadata.record.writer_ref !== writerRef
    ) {
      corruption();
    }
    state.registerStream(loadedMetadata.record, loadedMetadata.bytes.length);
    const streamState = state.streams.get(loadedMetadata.record.stream_ref);
    if (streamState === undefined) corruption();
    loadedStreams.push({ state: streamState, commits });
  }
  return loadedStreams;
}

async function scanPrimaryIdentityDirectories(
  paths: RepositoryLocalPaths,
  expectedDevice: number,
  hooks: RepositoryLocalFilesystemHooks | undefined,
  writerRef: string,
): Promise<ReadonlyMap<string, PrimaryIdentityDirectory>> {
  const directories = new Map<string, PrimaryIdentityDirectory>();
  const names = await listRepositoryLocalDirectory(
    paths.primaryIdentities,
    expectedDevice,
    PRIMARY_ENTRY_LIMIT,
    hooks,
  );
  for (const name of names) {
    if (!RAW_DIGEST_PATTERN.test(name)) corruption();
    const directoryPath = path.join(paths.primaryIdentities, name);
    const entries = await listRepositoryLocalDirectory(
      directoryPath,
      expectedDevice,
      IDENTITY_DIRECTORY_ENTRY_LIMIT,
      hooks,
    );
    const temporaries = entries.filter((entry) => entry.endsWith(".tmp"));
    const finalName = repositoryLocalIdentityVersionFileName(0);
    if (
      temporaries.length > 1 ||
      entries.some((entry) => entry !== finalName && !temporaries.includes(entry))
    ) {
      corruption();
    }
    let final: LoadedRecord<RepositoryLocalPrimaryIdentityRecord> | undefined;
    if (entries.includes(finalName)) {
      final = await readValidatedRecord(
        path.join(directoryPath, finalName),
        REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes,
        expectedDevice,
        hooks,
        validateRepositoryLocalPrimaryIdentityRecord,
        temporaries.length === 1 ? 2 : 1,
      );
      if (
        repositoryLocalReferencePathDigest(final.record.event_id) !== name ||
        final.record.writer_ref !== writerRef
      ) {
        corruption();
      }
    }
    directories.set(name, {
      directoryPath,
      pathDigest: name,
      ...(final === undefined ? {} : { final }),
      temporaries,
    });
  }
  return directories;
}

async function rereadPrimaryPair(
  commit: LoadedCommit,
  identityPath: string,
  expectedDevice: number,
  hooks: RepositoryLocalFilesystemHooks | undefined,
): Promise<
  Readonly<{
    commit: LoadedRecord<RepositoryLocalPrimaryCommitRecord>;
    identity: LoadedRecord<RepositoryLocalPrimaryIdentityRecord>;
  }>
> {
  const reloadedCommit = await readValidatedRecord(
    commit.filePath,
    REPOSITORY_LOCAL_LIMITS.max_primary_commit_record_bytes,
    expectedDevice,
    hooks,
    validateRepositoryLocalPrimaryCommitRecord,
  );
  const reloadedIdentity = await readValidatedRecord(
    identityPath,
    REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes,
    expectedDevice,
    hooks,
    validateRepositoryLocalPrimaryIdentityRecord,
  );
  if (
    !reloadedCommit.bytes.equals(commit.bytes) ||
    !primaryIdentityMatchesCommit(reloadedIdentity.record, reloadedCommit.record)
  ) {
    corruption();
  }
  return { commit: reloadedCommit, identity: reloadedIdentity };
}

function prevalidatePrimaryState(
  streams: readonly LoadedStream[],
  identityDirectories: ReadonlyMap<string, PrimaryIdentityDirectory>,
  state: RepositoryLocalState,
): void {
  const eventIds = new Set<string>();
  const consumedIdentityDirectories = new Set<string>();
  let committedBytes = 0;
  let identityBytes = 0;
  for (const stream of streams) {
    let expectedSequence = 0;
    let expectedPrevious = AUDIT_GENESIS_HASH;
    for (const loadedCommit of stream.commits) {
      const event = loadedCommit.record.event;
      const genesisHash =
        event.event_type === "audit.stream_opened.v1"
          ? (event.payload.value as Readonly<{ genesis_hash?: unknown }>).genesis_hash
          : undefined;
      if (
        event.integrity.stream_ref !== stream.state.metadata.stream_ref ||
        event.integrity.writer_ref !== stream.state.metadata.writer_ref ||
        event.integrity.sequence !== expectedSequence ||
        event.integrity.previous_event_hash !== expectedPrevious ||
        eventIds.has(event.event_id) ||
        (expectedSequence === 0 &&
          (event.event_type !== "audit.stream_opened.v1" || genesisHash !== AUDIT_GENESIS_HASH)) ||
        (expectedSequence !== 0 && event.event_type === "audit.stream_opened.v1")
      ) {
        corruption();
      }
      eventIds.add(event.event_id);
      committedBytes += loadedCommit.bytes.length;
      expectedSequence += 1;
      expectedPrevious = event.integrity.event_hash;

      const identityDirectoryName = repositoryLocalReferencePathDigest(event.event_id);
      const identityDirectory = identityDirectories.get(identityDirectoryName);
      if (identityDirectory === undefined) corruption();
      consumedIdentityDirectories.add(identityDirectoryName);
      const expectedIdentity = createRepositoryLocalPrimaryIdentityRecord(loadedCommit.record);
      identityBytes +=
        identityDirectory.final?.bytes.length ??
        canonicalRepositoryLocalBytes(expectedIdentity).length;
      if (
        (identityDirectory.final !== undefined &&
          !primaryIdentityMatchesCommit(identityDirectory.final.record, loadedCommit.record)) ||
        (identityDirectory.temporaries[0] !== undefined &&
          identityDirectory.temporaries[0] !==
            temporaryName(
              repositoryLocalIdentityVersionFileName(0),
              expectedIdentity.primary_identity_record_digest,
            ))
      ) {
        corruption();
      }
    }
    if (
      !Number.isSafeInteger(committedBytes) ||
      !Number.isSafeInteger(identityBytes) ||
      streams.length > REPOSITORY_LOCAL_LIMITS.max_streams ||
      eventIds.size > REPOSITORY_LOCAL_LIMITS.max_event_identities ||
      committedBytes > REPOSITORY_LOCAL_LIMITS.max_primary_committed_bytes ||
      identityBytes > REPOSITORY_LOCAL_LIMITS.max_event_identity_bytes
    ) {
      state.fail("capacity_exhausted");
      throw unavailable();
    }
  }
  for (const [directoryName, directory] of identityDirectories) {
    if (
      !consumedIdentityDirectories.has(directoryName) &&
      (directory.final !== undefined || directory.temporaries.length !== 0)
    ) {
      corruption();
    }
  }
}

async function cleanupPrimaryIdentityTemporaries(
  streams: readonly LoadedStream[],
  identityDirectories: ReadonlyMap<string, PrimaryIdentityDirectory>,
  expectedDevice: number,
  hooks: RepositoryLocalFilesystemHooks | undefined,
): Promise<void> {
  for (const stream of streams) {
    const firstCommit = stream.commits[0];
    if (firstCommit !== undefined) {
      await syncRepositoryLocalDirectory(firstCommit.directoryPath, hooks, "primary_record");
    }
    for (const loadedCommit of stream.commits) {
      const identityDirectory = identityDirectories.get(
        repositoryLocalReferencePathDigest(loadedCommit.record.event.event_id),
      );
      if (identityDirectory === undefined) corruption();
      const temporary = identityDirectory.temporaries[0];
      if (temporary === undefined) continue;
      const expectedIdentity = createRepositoryLocalPrimaryIdentityRecord(loadedCommit.record);
      await cleanupBoundTemporary(
        identityDirectory.directoryPath,
        temporary,
        repositoryLocalIdentityVersionFileName(0),
        expectedIdentity.primary_identity_record_digest,
        REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes,
        expectedDevice,
        hooks,
        identityDirectory.final !== undefined,
      );
    }
  }
}

async function resolvePrimaryState(
  streams: readonly LoadedStream[],
  identityDirectories: ReadonlyMap<string, PrimaryIdentityDirectory>,
  expectedDevice: number,
  hooks: RepositoryLocalFilesystemHooks | undefined,
  state: RepositoryLocalState,
): Promise<void> {
  const consumedIdentityDirectories = new Set<string>();
  for (const stream of streams) {
    for (const loadedCommit of stream.commits) {
      const event = loadedCommit.record.event;
      if (
        event.integrity.stream_ref !== stream.state.metadata.stream_ref ||
        event.integrity.writer_ref !== stream.state.metadata.writer_ref
      ) {
        corruption();
      }
      const identityDirectoryName = repositoryLocalReferencePathDigest(event.event_id);
      const identityDirectory = identityDirectories.get(identityDirectoryName);
      if (identityDirectory === undefined) corruption();
      consumedIdentityDirectories.add(identityDirectoryName);
      const expectedIdentity = createRepositoryLocalPrimaryIdentityRecord(loadedCommit.record);
      const finalName = repositoryLocalIdentityVersionFileName(0);
      if (
        identityDirectory.final !== undefined &&
        !primaryIdentityMatchesCommit(identityDirectory.final.record, loadedCommit.record)
      ) {
        corruption();
      }
      if (identityDirectory.final === undefined) {
        const bytes = canonicalRepositoryLocalBytes(expectedIdentity);
        await publishRepositoryLocalFile(
          identityDirectory.directoryPath,
          finalName,
          temporaryName(finalName, expectedIdentity.primary_identity_record_digest),
          bytes,
          REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes,
          expectedDevice,
          "primary_identity",
          hooks,
        );
      }
      await syncRepositoryLocalDirectory(
        identityDirectory.directoryPath,
        hooks,
        "primary_identity",
      );
      const pair = await rereadPrimaryPair(
        loadedCommit,
        path.join(identityDirectory.directoryPath, finalName),
        expectedDevice,
        hooks,
      );
      state.registerPrimary(stream.state, {
        commit: pair.commit.record,
        identity: pair.identity.record,
        commitBytes: pair.commit.bytes.length,
        identityBytes: pair.identity.bytes.length,
      });
    }
  }

  for (const [directoryName, directory] of identityDirectories) {
    if (consumedIdentityDirectories.has(directoryName)) continue;
    if (directory.final !== undefined) {
      state.registerOrphanPrimaryIdentity(directory.final.record, directory.final.bytes.length);
      state.fail("state_stale");
      corruption();
    }
    if (directory.temporaries.length !== 0) {
      state.fail("state_stale");
      corruption();
    }
  }
}

async function scanAndRegisterCheckpoints(
  paths: RepositoryLocalPaths,
  expectedDevice: number,
  hooks: RepositoryLocalFilesystemHooks | undefined,
  state: RepositoryLocalState,
): Promise<void> {
  const names = await listRepositoryLocalDirectory(
    paths.checkpoints,
    expectedDevice,
    PRIMARY_ENTRY_LIMIT,
    hooks,
  );
  const records = new Map<string, LoadedRecord<RepositoryLocalCheckpointRecord>>();
  const temporaries = names.filter((name) => name.endsWith(".tmp"));
  const temporaryDestinations = new Set<string>();
  for (const temporary of temporaries) {
    const binding = parseTemporaryName(temporary);
    if (
      binding === undefined ||
      !CHECKPOINT_FILE_PATTERN.test(binding.destinationName) ||
      temporaryDestinations.has(binding.destinationName)
    ) {
      corruption();
    }
    temporaryDestinations.add(binding.destinationName);
  }
  for (const name of names.filter((entry) => !entry.endsWith(".tmp"))) {
    if (!CHECKPOINT_FILE_PATTERN.test(name)) corruption();
    const loaded = await readValidatedRecord(
      path.join(paths.checkpoints, name),
      REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes,
      expectedDevice,
      hooks,
      validateRepositoryLocalCheckpointRecord,
      temporaryDestinations.has(name) ? 2 : 1,
    );
    if (repositoryLocalCheckpointFileName(loaded.record.checkpoint_id) !== name) corruption();
    records.set(name, loaded);
  }
  for (const temporary of temporaries) {
    const binding = parseTemporaryName(temporary);
    if (binding === undefined || !CHECKPOINT_FILE_PATTERN.test(binding.destinationName)) {
      corruption();
    }
    const final = records.get(binding.destinationName);
    await cleanupBoundTemporary(
      paths.checkpoints,
      temporary,
      binding.destinationName,
      final?.record.checkpoint_record_digest,
      REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes,
      expectedDevice,
      hooks,
      final !== undefined,
    );
  }
  if (records.size !== 0) {
    await syncRepositoryLocalDirectory(paths.checkpoints, hooks, "checkpoint");
  }
  const ordered = [...records.values()].sort((left, right) => {
    if (left.record.stream_ref !== right.record.stream_ref) {
      return left.record.stream_ref < right.record.stream_ref ? -1 : 1;
    }
    return left.record.range_start - right.record.range_start;
  });
  for (const checkpoint of ordered) {
    const stream = state.streams.get(checkpoint.record.stream_ref);
    if (stream === undefined) corruption();
    try {
      state.registerCheckpoint(stream, checkpoint.record, checkpoint.bytes.length);
    } catch {
      corruption();
    }
  }
}

async function scanRecoveryPending(
  paths: RepositoryLocalPaths,
  expectedDevice: number,
  hooks: RepositoryLocalFilesystemHooks | undefined,
): Promise<ReadonlyMap<string, LoadedRecord<RepositoryLocalRecoveryPendingRecord>>> {
  const names = await listRepositoryLocalDirectory(
    paths.pending,
    expectedDevice,
    RECOVERY_ENTRY_LIMIT,
    hooks,
  );
  const records = new Map<string, LoadedRecord<RepositoryLocalRecoveryPendingRecord>>();
  const temporaries = names.filter((name) => name.endsWith(".tmp"));
  const temporaryDestinations = new Set<string>();
  for (const temporary of temporaries) {
    const binding = parseTemporaryName(temporary);
    if (
      binding === undefined ||
      !CHECKPOINT_FILE_PATTERN.test(binding.destinationName) ||
      temporaryDestinations.has(binding.destinationName)
    ) {
      corruption();
    }
    temporaryDestinations.add(binding.destinationName);
  }
  for (const name of names.filter((entry) => !entry.endsWith(".tmp"))) {
    if (!CHECKPOINT_FILE_PATTERN.test(name)) corruption();
    const loaded = await readValidatedRecord(
      path.join(paths.pending, name),
      REPOSITORY_LOCAL_LIMITS.max_recovery_record_bytes,
      expectedDevice,
      hooks,
      validateRepositoryLocalRecoveryPendingRecord,
      temporaryDestinations.has(name) ? 2 : 1,
    );
    if (`${repositoryLocalReferencePathDigest(loaded.record.fact.recovery_id)}.json` !== name) {
      corruption();
    }
    records.set(name, loaded);
  }
  for (const temporary of temporaries) {
    const binding = parseTemporaryName(temporary);
    if (binding === undefined || !CHECKPOINT_FILE_PATTERN.test(binding.destinationName)) {
      corruption();
    }
    const final = records.get(binding.destinationName);
    await cleanupBoundTemporary(
      paths.pending,
      temporary,
      binding.destinationName,
      final?.record.recovery_pending_record_digest,
      REPOSITORY_LOCAL_LIMITS.max_recovery_record_bytes,
      expectedDevice,
      hooks,
      final !== undefined,
    );
  }
  return records;
}

async function scanRecoveryIdentityDirectories(
  paths: RepositoryLocalPaths,
  expectedDevice: number,
  hooks: RepositoryLocalFilesystemHooks | undefined,
): Promise<ReadonlyMap<string, RecoveryIdentityDirectory>> {
  const result = new Map<string, RecoveryIdentityDirectory>();
  const names = await listRepositoryLocalDirectory(
    paths.recoveryIdentities,
    expectedDevice,
    RECOVERY_ENTRY_LIMIT,
    hooks,
  );
  for (const name of names) {
    if (!RAW_DIGEST_PATTERN.test(name)) corruption();
    const directoryPath = path.join(paths.recoveryIdentities, name);
    const entries = await listRepositoryLocalDirectory(
      directoryPath,
      expectedDevice,
      IDENTITY_DIRECTORY_ENTRY_LIMIT,
      hooks,
    );
    const finalName = repositoryLocalIdentityVersionFileName(0);
    const temporaries = entries.filter((entry) => entry.endsWith(".tmp"));
    if (
      temporaries.length > 1 ||
      entries.some((entry) => entry !== finalName && !temporaries.includes(entry))
    ) {
      corruption();
    }
    let final: LoadedRecord<RepositoryLocalRecoveryIdentityRecord> | undefined;
    if (entries.includes(finalName)) {
      final = await readValidatedRecord(
        path.join(directoryPath, finalName),
        REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes,
        expectedDevice,
        hooks,
        validateRepositoryLocalRecoveryIdentityRecord,
        temporaries.length === 1 ? 2 : 1,
      );
      if (repositoryLocalReferencePathDigest(final.record.recovery_id) !== name) corruption();
    }
    result.set(name, {
      directoryPath,
      pathDigest: name,
      ...(final === undefined ? {} : { final }),
      temporaries,
    });
  }
  return result;
}

function prevalidateRecoveryState(
  pending: ReadonlyMap<string, LoadedRecord<RepositoryLocalRecoveryPendingRecord>>,
  identityDirectories: ReadonlyMap<string, RecoveryIdentityDirectory>,
  state: RepositoryLocalState,
): void {
  const recoveryIds = new Set<string>();
  const consumedIdentityDirectories = new Set<string>();
  for (const loadedPending of pending.values()) {
    const recoveryId = loadedPending.record.fact.recovery_id;
    if (recoveryIds.has(recoveryId)) corruption();
    recoveryIds.add(recoveryId);
    const identityDirectoryName = repositoryLocalReferencePathDigest(recoveryId);
    const identityDirectory = identityDirectories.get(identityDirectoryName);
    if (identityDirectory === undefined) corruption();
    consumedIdentityDirectories.add(identityDirectoryName);
    const expectedIdentity = createRepositoryLocalRecoveryIdentityRecord(loadedPending.record);
    if (
      (identityDirectory.final !== undefined &&
        !recoveryIdentityMatchesPending(identityDirectory.final.record, loadedPending.record)) ||
      (identityDirectory.temporaries[0] !== undefined &&
        identityDirectory.temporaries[0] !==
          temporaryName(
            repositoryLocalIdentityVersionFileName(0),
            expectedIdentity.recovery_identity_record_digest,
          ))
    ) {
      corruption();
    }
  }
  for (const [directoryName, directory] of identityDirectories) {
    if (
      !consumedIdentityDirectories.has(directoryName) &&
      (directory.final !== undefined || directory.temporaries.length !== 0)
    ) {
      corruption();
    }
  }
  if (
    recoveryIds.size > REPOSITORY_LOCAL_LIMITS.max_pending_recovery_facts ||
    recoveryIds.size > REPOSITORY_LOCAL_LIMITS.max_recovery_identities ||
    recoveryIds.size * REPOSITORY_LOCAL_LIMITS.recovery_identity_reservation_bytes >
      REPOSITORY_LOCAL_LIMITS.max_recovery_bytes
  ) {
    state.fail("capacity_exhausted");
    throw unavailable();
  }
}

async function cleanupRecoveryIdentityTemporaries(
  paths: RepositoryLocalPaths,
  pending: ReadonlyMap<string, LoadedRecord<RepositoryLocalRecoveryPendingRecord>>,
  identityDirectories: ReadonlyMap<string, RecoveryIdentityDirectory>,
  expectedDevice: number,
  hooks: RepositoryLocalFilesystemHooks | undefined,
): Promise<void> {
  if (pending.size !== 0) {
    await syncRepositoryLocalDirectory(paths.pending, hooks, "recovery_record");
  }
  for (const loadedPending of pending.values()) {
    const identityDirectory = identityDirectories.get(
      repositoryLocalReferencePathDigest(loadedPending.record.fact.recovery_id),
    );
    if (identityDirectory === undefined) corruption();
    const temporary = identityDirectory.temporaries[0];
    if (temporary === undefined) continue;
    const expectedIdentity = createRepositoryLocalRecoveryIdentityRecord(loadedPending.record);
    await cleanupBoundTemporary(
      identityDirectory.directoryPath,
      temporary,
      repositoryLocalIdentityVersionFileName(0),
      expectedIdentity.recovery_identity_record_digest,
      REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes,
      expectedDevice,
      hooks,
      identityDirectory.final !== undefined,
    );
  }
}

async function resolveRecoveryState(
  paths: RepositoryLocalPaths,
  pending: ReadonlyMap<string, LoadedRecord<RepositoryLocalRecoveryPendingRecord>>,
  identityDirectories: ReadonlyMap<string, RecoveryIdentityDirectory>,
  expectedDevice: number,
  hooks: RepositoryLocalFilesystemHooks | undefined,
  state: RepositoryLocalState,
  now: string,
): Promise<void> {
  const consumed = new Set<string>();
  for (const [pendingName, loadedPending] of pending) {
    const recoveryId = loadedPending.record.fact.recovery_id;
    const identityDirectoryName = repositoryLocalReferencePathDigest(recoveryId);
    const identityDirectory = identityDirectories.get(identityDirectoryName);
    if (identityDirectory === undefined) corruption();
    consumed.add(identityDirectoryName);
    const expectedIdentity = createRepositoryLocalRecoveryIdentityRecord(loadedPending.record);
    const finalName = repositoryLocalIdentityVersionFileName(0);
    if (
      identityDirectory.final !== undefined &&
      !recoveryIdentityMatchesPending(identityDirectory.final.record, loadedPending.record)
    ) {
      corruption();
    }
    if (identityDirectory.final === undefined) {
      const bytes = canonicalRepositoryLocalBytes(expectedIdentity);
      await publishRepositoryLocalFile(
        identityDirectory.directoryPath,
        finalName,
        temporaryName(finalName, expectedIdentity.recovery_identity_record_digest),
        bytes,
        REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes,
        expectedDevice,
        "recovery_identity",
        hooks,
      );
    }
    await syncRepositoryLocalDirectory(identityDirectory.directoryPath, hooks, "recovery_identity");
    const reloadedPending = await readValidatedRecord(
      path.join(paths.pending, pendingName),
      REPOSITORY_LOCAL_LIMITS.max_recovery_record_bytes,
      expectedDevice,
      hooks,
      validateRepositoryLocalRecoveryPendingRecord,
    );
    const reloadedIdentity = await readValidatedRecord(
      path.join(identityDirectory.directoryPath, finalName),
      REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes,
      expectedDevice,
      hooks,
      validateRepositoryLocalRecoveryIdentityRecord,
    );
    if (
      !reloadedPending.bytes.equals(loadedPending.bytes) ||
      !recoveryIdentityMatchesPending(reloadedIdentity.record, reloadedPending.record)
    ) {
      corruption();
    }
    state.registerRecovery({
      pending: reloadedPending.record,
      identity: reloadedIdentity.record,
      pendingBytes: reloadedPending.bytes.length,
      identityBytes: reloadedIdentity.bytes.length,
    });
    const observedAt = reloadedPending.record.fact.original_observed_at;
    const age = Date.parse(now) - Date.parse(observedAt);
    if (
      !Number.isFinite(age) ||
      compareAuditTimestamps(now, observedAt) < 0 ||
      age > REPOSITORY_LOCAL_LIMITS.pending_max_age_milliseconds
    ) {
      state.fail(
        age > REPOSITORY_LOCAL_LIMITS.pending_max_age_milliseconds
          ? "pending_expired"
          : "state_stale",
      );
      corruption();
    }
  }
  for (const [directoryName, directory] of identityDirectories) {
    if (consumed.has(directoryName)) continue;
    if (directory.final !== undefined) {
      state.registerOrphanRecoveryIdentity(directory.final.record);
      state.fail("state_stale");
      corruption();
    }
    if (directory.temporaries.length !== 0) {
      state.fail("state_stale");
      corruption();
    }
  }
}

function mapFilesystemReason(
  state: RepositoryLocalState,
  error: RepositoryLocalFilesystemError,
): void {
  if (error.reason === "capacity_exhausted") {
    state.fail("capacity_exhausted");
    return;
  }
  if (error.ambiguous) {
    state.fail("io_ambiguous");
    return;
  }
  switch (error.reason) {
    case "unsupported_filesystem":
      state.fail("filesystem_unsupported");
      return;
    case "unsafe_metadata":
      state.fail("unsafe_metadata");
      return;
    case "corruption_detected":
    case "publication_conflict":
      state.fail("state_corrupt");
      return;
    case "io_failure":
    case "lock_unavailable":
      state.fail("io_failure");
      return;
  }
}

class RepositoryLocalProfileCore {
  readonly store: AuditStore;
  readonly journal: RecoveryJournal;
  readonly readiness: RequiredAuditReadiness;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly paths: RepositoryLocalPaths,
    private readonly expectedDevice: number,
    private readonly profile: RepositoryLocalProfileRecord,
    private readonly lock: RepositoryLocalOwnedLock,
    private readonly state: RepositoryLocalState,
    private readonly clock: RepositoryLocalClock,
    private readonly hooks: RepositoryLocalFilesystemHooks | undefined,
  ) {
    this.store = Object.freeze({
      findById: (eventId: string) => this.findById(eventId),
      tail: (streamRef: string) => this.tail(streamRef),
      append: (event: ProtectedAuditEvent, candidateDigest: string) =>
        this.appendPrimary(event, candidateDigest),
    });
    this.journal = Object.freeze({
      append: (fact: RecoveryFact) => this.appendRecovery(fact),
    });
    this.readiness = Object.freeze({
      assertReadyForProviderStart: () => this.assertReadyForProviderStart(),
    });
  }

  pendingFacts(): AsyncIterable<RecoveryFact> {
    const profile = this;
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<RecoveryFact> {
        const pass = await profile.materializePendingFacts();
        for (const fact of pass.facts) {
          profile.assertPendingPassActive(pass.started);
          yield fact;
          profile.assertPendingPassActive(pass.started);
        }
      },
    };
  }

  diagnostic(): RepositoryLocalHealthDiagnostic {
    try {
      this.assertPendingBacklogFresh();
    } catch (error: unknown) {
      this.translate(error);
    }
    return freezeDeep(structuredClone(this.state.diagnostic()));
  }

  async completeRequiredStartupCheckpoints(): Promise<void> {
    for (const stream of this.state.streams.values()) {
      if (this.state.uncheckpointedCount(stream) === REPOSITORY_LOCAL_LIMITS.checkpoint_interval) {
        await this.publishCheckpoint(stream);
      }
    }
  }

  close(): Promise<void> {
    const operation = this.queue.then(async () => {
      if (this.closed) return;
      this.state.setPhase("closing");
      try {
        await verifyRepositoryLocalWriterLock(this.paths, this.lock, this.hooks);
        try {
          this.assertPendingBacklogFresh();
        } catch (error: unknown) {
          this.translate(error);
        }
        if (!this.state.isFailed()) {
          for (const stream of this.state.streams.values()) {
            try {
              this.assertPendingBacklogFresh();
            } catch (error: unknown) {
              this.translate(error);
              break;
            }
            if (this.state.uncheckpointedCount(stream) > 0) {
              await this.publishCheckpoint(stream);
            }
          }
        }
        await releaseRepositoryLocalWriterLock(this.paths, this.lock, this.hooks);
        this.closed = true;
        this.state.setPhase("closed");
      } catch (error: unknown) {
        throw this.translate(error);
      }
    });
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private run<T>(
    phase: "pending_read" | "pre_effect_check" | "primary_append" | "recovery_append",
    operation: () => Promise<T>,
  ): Promise<T> {
    const result = this.queue.then(async () => {
      if (this.closed) throw unavailable();
      this.state.setPhase(phase);
      try {
        await verifyRepositoryLocalWriterLock(this.paths, this.lock, this.hooks);
        this.assertPendingBacklogFresh();
        return await operation();
      } catch (error: unknown) {
        throw this.translate(error);
      } finally {
        if (!this.closed && !this.state.isFailed()) this.state.setPhase("ready");
      }
    });
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertReadyForProviderStart(): Promise<void> {
    return this.run("pre_effect_check", async () => {
      this.state.assertWritable();
      const availableBytes = await repositoryLocalAvailableBytes(
        this.paths.runtimeRoot,
        this.hooks,
      );
      if (availableBytes < this.state.requiredFreeBytesForNextWrite()) {
        this.state.fail("capacity_exhausted");
        throw unavailable();
      }
      this.state.assertWritable();
    });
  }

  private translate(error: unknown): AuditError {
    if (error instanceof RepositoryLocalFilesystemError) {
      mapFilesystemReason(this.state, error);
      return unavailable();
    }

    if (error instanceof RepositoryLocalFormatError) {
      this.state.fail("state_corrupt");
      return new AuditError("audit_integrity_failure");
    }
    if (error instanceof AuditError) {
      if (error.code === "audit_duplicate_conflict") {
        this.state.fail("duplicate_conflict");
      } else if (error.code === "audit_integrity_failure") {
        this.state.fail("state_corrupt");
      } else if (error.code === "audit_unavailable" && !this.state.isFailed()) {
        this.state.fail("io_failure");
      }
      return error;
    }
    this.state.fail("io_failure");
    return unavailable();
  }

  private assertObservationFresh(observedAt: string, now: string): void {
    const age = Date.parse(now) - Date.parse(observedAt);
    if (!Number.isFinite(age) || compareAuditTimestamps(now, observedAt) < 0) {
      this.state.fail("state_stale");
      throw unavailable();
    }
    if (age > REPOSITORY_LOCAL_LIMITS.pending_max_age_milliseconds) {
      this.state.fail("pending_expired");
      throw unavailable();
    }
  }

  private assertPendingBacklogFresh(): void {
    if (this.state.recoveriesById.size === 0) return;
    const now = this.clock.nowIso();
    for (const entry of this.state.recoveriesById.values()) {
      this.assertObservationFresh(entry.pending.fact.original_observed_at, now);
    }
  }

  private assertPendingPassActive(started: number): void {
    if (this.closed) throw unavailable();
    try {
      this.assertPendingBacklogFresh();
    } catch (error: unknown) {
      throw this.translate(error);
    }
    this.state.assertReadable();
    if (
      this.clock.monotonic() - started >
      REPOSITORY_LOCAL_LIMITS.pending_iterator_max_milliseconds
    ) {
      this.state.setPhase("pending_read");
      this.state.fail("pending_read_bound");
      throw unavailable();
    }
  }

  private findById(eventId: string) {
    return this.run("pending_read", async () => {
      if (!isRepositoryLocalReference(eventId)) {
        throw new AuditError("audit_candidate_invalid");
      }
      this.state.assertReadable();
      const found = this.state.findPrimary(eventId);
      return found === undefined
        ? undefined
        : {
            event: found.commit.event,
            candidate_digest: found.commit.candidate_digest,
            durability: "durable" as const,
          };
    });
  }

  private tail(streamRef: string) {
    return this.run("pending_read", async () => {
      if (!isRepositoryLocalReference(streamRef)) {
        throw new AuditError("audit_candidate_invalid");
      }
      this.state.assertReadable();
      return this.state.tail(streamRef);
    });
  }

  private appendPrimary(
    event: ProtectedAuditEvent,
    candidateDigest: string,
  ): Promise<AuditCommitReceipt> {
    return this.run("primary_append", async () => {
      const commit = freezeDeep(createRepositoryLocalPrimaryCommitRecord(event, candidateDigest));
      const existing = this.state.findPrimary(commit.event.event_id);
      if (existing !== undefined) {
        if (existing.commit.candidate_digest !== commit.candidate_digest) {
          throw new AuditError("audit_duplicate_conflict");
        }
        if (this.state.isFailed() && !this.state.allowsCapacityDuplicate()) {
          throw unavailable();
        }
        return receiptFromPrimaryCommit(existing.commit, true);
      }
      if (this.state.hasRetainedPrimaryIdentity(commit.event.event_id)) {
        throw new AuditError("audit_duplicate_conflict");
      }
      this.state.assertWritable();
      if (commit.event.integrity.writer_ref !== this.profile.writer_ref) {
        throw new AuditError("audit_integrity_failure");
      }
      const streamRef = commit.event.integrity.stream_ref;
      let stream = this.state.streams.get(streamRef);
      const createsStream = stream === undefined;
      const streamRecord =
        stream === undefined
          ? createRepositoryLocalStreamRecord(
              streamRef,
              this.profile.writer_ref,
              commit.event.committed_at,
            )
          : stream.metadata;
      const streamBytes = canonicalRepositoryLocalBytes(streamRecord);
      const commitBytes = canonicalRepositoryLocalBytes(commit);
      const identity = freezeDeep(createRepositoryLocalPrimaryIdentityRecord(commit));
      const identityBytes = canonicalRepositoryLocalBytes(identity);
      const tail = stream?.commits.at(-1)?.commit.event;
      const expectedSequence = tail === undefined ? 0 : tail.integrity.sequence + 1;
      const expectedPrevious = tail?.integrity.event_hash ?? AUDIT_GENESIS_HASH;
      const genesisHash =
        commit.event.event_type === "audit.stream_opened.v1"
          ? (commit.event.payload.value as Readonly<{ genesis_hash?: unknown }>).genesis_hash
          : undefined;
      if (
        commit.event.integrity.sequence !== expectedSequence ||
        commit.event.integrity.previous_event_hash !== expectedPrevious ||
        (expectedSequence === 0 &&
          (commit.event.event_type !== "audit.stream_opened.v1" ||
            genesisHash !== AUDIT_GENESIS_HASH)) ||
        (expectedSequence !== 0 && commit.event.event_type === "audit.stream_opened.v1")
      ) {
        throw new AuditError("audit_integrity_failure");
      }
      const preparedCheckpoint =
        stream !== undefined &&
        this.state.uncheckpointedCount(stream) + 1 === REPOSITORY_LOCAL_LIMITS.checkpoint_interval
          ? this.prepareCheckpoint(stream, commit.event)
          : undefined;
      const availableBytes = await repositoryLocalAvailableBytes(
        this.paths.runtimeRoot,
        this.hooks,
      );
      this.state.assertCanAppendPrimary(
        commitBytes.length,
        identityBytes.length,
        createsStream,
        streamBytes.length,
        preparedCheckpoint?.bytes.length ?? 0,
        availableBytes,
      );

      const streamDirectoryPath = path.join(
        this.paths.streams,
        repositoryLocalReferencePathDigest(streamRef),
      );
      await ensureDurableRepositoryLocalDirectory(
        streamDirectoryPath,
        this.paths.streams,
        this.expectedDevice,
        this.hooks,
      );
      const commitsDirectoryPath = path.join(streamDirectoryPath, "commits");
      await ensureDurableRepositoryLocalDirectory(
        commitsDirectoryPath,
        streamDirectoryPath,
        this.expectedDevice,
        this.hooks,
      );
      const identityDirectoryPath = path.join(
        this.paths.primaryIdentities,
        repositoryLocalReferencePathDigest(commit.event.event_id),
      );
      await ensureDurableRepositoryLocalDirectory(
        identityDirectoryPath,
        this.paths.primaryIdentities,
        this.expectedDevice,
        this.hooks,
      );
      if (createsStream) {
        await publishRepositoryLocalFile(
          streamDirectoryPath,
          "stream.json",
          temporaryName("stream.json", streamRecord.stream_record_digest),
          streamBytes,
          REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes,
          this.expectedDevice,
          "stream",
          this.hooks,
        );
        await syncRepositoryLocalDirectory(streamDirectoryPath, this.hooks, "stream");
        this.state.registerStream(streamRecord, streamBytes.length);
        stream = this.state.streams.get(streamRef);
        if (stream === undefined) corruption();
      }
      if (stream === undefined) corruption();
      const sequenceName = repositoryLocalSequenceFileName(commit.event.integrity.sequence);
      await publishRepositoryLocalFile(
        commitsDirectoryPath,
        sequenceName,
        temporaryName(sequenceName, commit.primary_commit_record_digest),
        commitBytes,
        REPOSITORY_LOCAL_LIMITS.max_primary_commit_record_bytes,
        this.expectedDevice,
        "primary_record",
        this.hooks,
      );
      await syncRepositoryLocalDirectory(commitsDirectoryPath, this.hooks, "primary_record");
      const identityName = repositoryLocalIdentityVersionFileName(0);
      await publishRepositoryLocalFile(
        identityDirectoryPath,
        identityName,
        temporaryName(identityName, identity.primary_identity_record_digest),
        identityBytes,
        REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes,
        this.expectedDevice,
        "primary_identity",
        this.hooks,
      );
      await syncRepositoryLocalDirectory(identityDirectoryPath, this.hooks, "primary_identity");
      const entry: RepositoryLocalPrimaryEntry = {
        commit,
        identity,
        commitBytes: commitBytes.length,
        identityBytes: identityBytes.length,
      };
      this.state.registerPrimary(stream, entry);
      this.state.updateCapacityHealth();
      if (preparedCheckpoint !== undefined) {
        await this.publishCheckpoint(stream, preparedCheckpoint);
      }
      return receiptFromPrimaryCommit(commit, false);
    });
  }

  private appendRecovery(factValue: RecoveryFact): Promise<Readonly<{ durability: "durable" }>> {
    return this.run("recovery_append", async () => {
      const fact = validateRecoveryFactShape(factValue);
      const factDigest = computeRecoveryFactDigest(fact);
      const existing = this.state.findRecovery(fact.recovery_id);
      if (existing !== undefined) {
        if (existing.pending.fact_digest !== factDigest) {
          throw new AuditError("audit_duplicate_conflict");
        }
        if (this.state.isFailed() && !this.state.allowsCapacityDuplicate()) {
          throw unavailable();
        }
        return { durability: "durable" as const };
      }
      if (this.state.hasRetainedRecoveryIdentity(fact.recovery_id)) {
        throw new AuditError("audit_duplicate_conflict");
      }
      this.state.assertWritable();
      const appendedAt = this.clock.nowIso();
      this.assertObservationFresh(fact.original_observed_at, appendedAt);
      const pending = freezeDeep(createRepositoryLocalRecoveryPendingRecord(fact, appendedAt));
      const availableBytes = await repositoryLocalAvailableBytes(
        this.paths.runtimeRoot,
        this.hooks,
      );
      this.state.assertCanAppendRecovery(availableBytes);
      const pendingBytes = canonicalRepositoryLocalBytes(pending);
      const identity = freezeDeep(createRepositoryLocalRecoveryIdentityRecord(pending));
      const identityBytes = canonicalRepositoryLocalBytes(identity);
      const pathDigest = repositoryLocalReferencePathDigest(fact.recovery_id);
      const identityDirectoryPath = path.join(this.paths.recoveryIdentities, pathDigest);
      await ensureDurableRepositoryLocalDirectory(
        identityDirectoryPath,
        this.paths.recoveryIdentities,
        this.expectedDevice,
        this.hooks,
      );
      const pendingName = `${pathDigest}.json`;
      await publishRepositoryLocalFile(
        this.paths.pending,
        pendingName,
        temporaryName(pendingName, pending.recovery_pending_record_digest),
        pendingBytes,
        REPOSITORY_LOCAL_LIMITS.max_recovery_record_bytes,
        this.expectedDevice,
        "recovery_record",
        this.hooks,
      );
      await syncRepositoryLocalDirectory(this.paths.pending, this.hooks, "recovery_record");
      const identityName = repositoryLocalIdentityVersionFileName(0);
      await publishRepositoryLocalFile(
        identityDirectoryPath,
        identityName,
        temporaryName(identityName, identity.recovery_identity_record_digest),
        identityBytes,
        REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes,
        this.expectedDevice,
        "recovery_identity",
        this.hooks,
      );
      await syncRepositoryLocalDirectory(identityDirectoryPath, this.hooks, "recovery_identity");
      const entry: RepositoryLocalRecoveryEntry = {
        pending,
        identity,
        pendingBytes: pendingBytes.length,
        identityBytes: identityBytes.length,
      };
      this.state.registerRecovery(entry);
      this.state.updateCapacityHealth();
      return { durability: "durable" as const };
    });
  }

  private materializePendingFacts(): Promise<PendingFactPass> {
    return this.run("pending_read", async () => {
      this.state.assertReadable();
      const started = this.clock.monotonic();
      let totalBytes = 0;
      const result: RecoveryFact[] = [];
      for (const entry of this.state.pendingSnapshot()) {
        if (
          result.length >= REPOSITORY_LOCAL_LIMITS.max_pending_recovery_facts ||
          this.clock.monotonic() - started >
            REPOSITORY_LOCAL_LIMITS.pending_iterator_max_milliseconds
        ) {
          this.state.fail("pending_read_bound");
          throw unavailable();
        }
        const digest = repositoryLocalReferencePathDigest(entry.pending.fact.recovery_id);
        const loadedPending = await readValidatedRecord(
          path.join(this.paths.pending, `${digest}.json`),
          REPOSITORY_LOCAL_LIMITS.max_recovery_record_bytes,
          this.expectedDevice,
          this.hooks,
          validateRepositoryLocalRecoveryPendingRecord,
        );
        const loadedIdentity = await readValidatedRecord(
          path.join(
            this.paths.recoveryIdentities,
            digest,
            repositoryLocalIdentityVersionFileName(0),
          ),
          REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes,
          this.expectedDevice,
          this.hooks,
          validateRepositoryLocalRecoveryIdentityRecord,
        );
        totalBytes += loadedPending.bytes.length;
        if (
          !Number.isSafeInteger(totalBytes) ||
          totalBytes > REPOSITORY_LOCAL_LIMITS.pending_iterator_max_input_bytes ||
          !recoveryIdentityMatchesPending(loadedIdentity.record, loadedPending.record) ||
          loadedPending.record.fact_digest !== entry.pending.fact_digest ||
          this.clock.monotonic() - started >
            REPOSITORY_LOCAL_LIMITS.pending_iterator_max_milliseconds
        ) {
          this.state.fail("pending_read_bound");
          throw unavailable();
        }
        result.push(freezeDeep(structuredClone(loadedPending.record.fact)));
      }
      return { facts: result, started };
    });
  }

  private prepareCheckpoint(
    stream: RepositoryLocalStreamState,
    terminal: ProtectedAuditEvent,
  ): PreparedCheckpoint {
    const rangeStart = stream.checkpoints.at(-1)?.range_end ?? -1;
    const first = rangeStart + 1;
    if (
      terminal.integrity.stream_ref !== stream.metadata.stream_ref ||
      first > terminal.integrity.sequence
    ) {
      throw new AuditError("audit_integrity_failure");
    }
    const checkpoint = freezeDeep(
      createRepositoryLocalCheckpointRecord({
        stream_ref: stream.metadata.stream_ref,
        range_start: first,
        range_end: terminal.integrity.sequence,
        terminal_event_hash: terminal.integrity.event_hash,
        previous_checkpoint_ref: stream.checkpoints.at(-1)?.checkpoint_id ?? null,
        writer_ref: this.profile.writer_ref,
        created_at: this.clock.nowIso(),
      }),
    );
    return { record: checkpoint, bytes: canonicalRepositoryLocalBytes(checkpoint) };
  }

  private async publishCheckpoint(
    stream: RepositoryLocalStreamState,
    reserved?: PreparedCheckpoint,
  ): Promise<void> {
    const terminal = stream.commits.at(-1)?.commit.event;
    if (terminal === undefined) return;
    const prepared = reserved ?? this.prepareCheckpoint(stream, terminal);
    if (reserved === undefined) {
      if (
        this.state.usage.checkpointMetadataBytes + prepared.bytes.length >
        REPOSITORY_LOCAL_LIMITS.max_checkpoint_deletion_metadata_bytes
      ) {
        this.state.fail("capacity_exhausted");
        throw unavailable();
      }
      const available = await repositoryLocalAvailableBytes(this.paths.runtimeRoot, this.hooks);
      if (available < BigInt(2 * REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes)) {
        this.state.fail("capacity_exhausted");
        throw unavailable();
      }
    }
    const name = repositoryLocalCheckpointFileName(prepared.record.checkpoint_id);
    await publishRepositoryLocalFile(
      this.paths.checkpoints,
      name,
      temporaryName(name, prepared.record.checkpoint_record_digest),
      prepared.bytes,
      REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes,
      this.expectedDevice,
      "checkpoint",
      this.hooks,
    );
    await syncRepositoryLocalDirectory(this.paths.checkpoints, this.hooks, "checkpoint");
    this.state.registerCheckpoint(stream, prepared.record, prepared.bytes.length);
    this.state.updateCapacityHealth();
  }
}

async function openRepositoryLocalAuditProfileInternal(
  options: RepositoryLocalQualificationOptions,
  startupPrimaryScanLimits: RepositoryLocalStartupScanLimits,
): Promise<RepositoryLocalAuditProfile> {
  if (!isRepositoryLocalReference(options.writerRef)) {
    throw new AuditError("audit_candidate_invalid");
  }
  const clock = createClock(options);
  const state = new RepositoryLocalState();
  let paths: RepositoryLocalPaths | undefined;
  let lock: RepositoryLocalOwnedLock | undefined;
  try {
    paths = await resolveTrustedRepositoryLocalPaths(
      options.trustedRepositoryRoot,
      options.filesystemHooks,
    );
    const expectedDevice = await ensureRepositoryLocalRuntimeRoot(paths, options.filesystemHooks);
    const openedAt = clock.nowIso();
    lock = await acquireRepositoryLocalWriterLock(
      paths,
      options.writerRef,
      openedAt,
      expectedDevice,
      options.filesystemHooks,
    );
    await qualifyRepositoryLocalFilesystem(paths, expectedDevice, options.filesystemHooks);
    if (!(await fileExistsWithoutFollowing(paths.profile))) {
      await ensureRepositoryLocalTopology(paths, expectedDevice, options.filesystemHooks);
    }
    await assertBoundedStartupTemporaryState(paths, expectedDevice, options.filesystemHooks);
    const profile = await loadOrCreateProfile(
      paths,
      options.writerRef,
      openedAt,
      expectedDevice,
      options.filesystemHooks,
    );
    await assertClosedStaticTopology(paths, expectedDevice, options.filesystemHooks);
    await verifyRepositoryLocalWriterLock(paths, lock, options.filesystemHooks);

    const streams = await scanStreams(
      paths,
      expectedDevice,
      options.filesystemHooks,
      profile.writer_ref,
      state,
      new PrimaryStartupScanBudget(startupPrimaryScanLimits),
    );
    const primaryIdentityDirectories = await scanPrimaryIdentityDirectories(
      paths,
      expectedDevice,
      options.filesystemHooks,
      profile.writer_ref,
    );
    prevalidatePrimaryState(streams, primaryIdentityDirectories, state);
    await cleanupPrimaryIdentityTemporaries(
      streams,
      primaryIdentityDirectories,
      expectedDevice,
      options.filesystemHooks,
    );
    await resolvePrimaryState(
      streams,
      primaryIdentityDirectories,
      expectedDevice,
      options.filesystemHooks,
      state,
    );
    await scanAndRegisterCheckpoints(paths, expectedDevice, options.filesystemHooks, state);
    for (const stream of state.streams.values()) {
      const uncheckpointed = state.uncheckpointedCount(stream);
      if (uncheckpointed > REPOSITORY_LOCAL_LIMITS.checkpoint_interval) {
        state.fail("checkpoint_invalid");
        corruption();
      }
    }

    const pending = await scanRecoveryPending(paths, expectedDevice, options.filesystemHooks);
    const recoveryIdentityDirectories = await scanRecoveryIdentityDirectories(
      paths,
      expectedDevice,
      options.filesystemHooks,
    );
    prevalidateRecoveryState(pending, recoveryIdentityDirectories, state);
    await cleanupRecoveryIdentityTemporaries(
      paths,
      pending,
      recoveryIdentityDirectories,
      expectedDevice,
      options.filesystemHooks,
    );
    await resolveRecoveryState(
      paths,
      pending,
      recoveryIdentityDirectories,
      expectedDevice,
      options.filesystemHooks,
      state,
      clock.nowIso(),
    );
    state.assertStartupBounds();
    state.updateCapacityHealth();
    const core = new RepositoryLocalProfileCore(
      paths,
      expectedDevice,
      profile,
      lock,
      state,
      clock,
      options.filesystemHooks,
    );
    await core.completeRequiredStartupCheckpoints();
    const availableBytes = await repositoryLocalAvailableBytes(
      paths.runtimeRoot,
      options.filesystemHooks,
    );
    if (availableBytes < state.requiredFreeBytesForNextWrite()) {
      state.fail("capacity_exhausted");
    }
    state.setPhase("ready");
    return Object.freeze({
      store: core.store,
      journal: core.journal,
      readiness: core.readiness,
      pendingFacts: () => core.pendingFacts(),
      diagnostic: () => core.diagnostic(),
      close: () => core.close(),
    });
  } catch (error: unknown) {
    if (lock !== undefined && paths !== undefined && !lock.released) {
      if (error instanceof RepositoryLocalFilesystemError && error.ambiguous) {
        try {
          await lock.handle.close();
        } catch {
          // The persistent lock remains the fail-closed recovery boundary.
        }
      } else {
        try {
          await releaseRepositoryLocalWriterLock(paths, lock, options.filesystemHooks);
        } catch {
          try {
            await lock.handle.close();
          } catch {
            // The persistent lock remains when clean release cannot be proven.
          }
        }
      }
    }
    if (error instanceof RepositoryLocalFilesystemError) {
      mapFilesystemReason(state, error);
    } else if (error instanceof RepositoryLocalFormatError) {
      state.fail("state_corrupt");
    } else if (error instanceof AuditError && error.code === "audit_candidate_invalid") {
      throw error;
    } else if (!state.isFailed()) {
      state.fail("state_corrupt");
    }
    throw unavailable();
  }
}

export function openRepositoryLocalAuditProfile(
  options: RepositoryLocalAuditProfileOptions,
): Promise<RepositoryLocalAuditProfile> {
  return openRepositoryLocalAuditProfileInternal(options, DEFAULT_PRIMARY_STARTUP_SCAN_LIMITS);
}

export function openRepositoryLocalAuditProfileForQualification(
  options: RepositoryLocalQualificationOptions,
): Promise<RepositoryLocalAuditProfile> {
  return openRepositoryLocalAuditProfileInternal(
    options,
    options.startupPrimaryScanLimits ?? DEFAULT_PRIMARY_STARTUP_SCAN_LIMITS,
  );
}
