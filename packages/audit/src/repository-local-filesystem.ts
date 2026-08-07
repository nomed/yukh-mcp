import { randomBytes } from "node:crypto";
import {
  constants,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  statfs,
  unlink,
  link,
  type FileHandle,
} from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import {
  canonicalRepositoryLocalBytes,
  createRepositoryLocalWriterLockRecord,
  parseCanonicalRepositoryLocalBytes,
  REPOSITORY_LOCAL_RUNTIME_PATH,
  validateRepositoryLocalWriterLockRecord,
  type RepositoryLocalWriterLockRecord,
} from "./repository-local-contract.js";

export type RepositoryLocalFailureReason =
  | "capacity_exhausted"
  | "corruption_detected"
  | "io_failure"
  | "lock_unavailable"
  | "publication_conflict"
  | "unsafe_metadata"
  | "unsupported_filesystem";

export class RepositoryLocalFilesystemError extends Error {
  constructor(
    readonly reason: RepositoryLocalFailureReason,
    readonly ambiguous: boolean = false,
  ) {
    super("repository_local_filesystem_failure");
    this.name = "RepositoryLocalFilesystemError";
  }
}

export type RepositoryLocalFileKind =
  | "checkpoint"
  | "primary_identity"
  | "primary_record"
  | "profile"
  | "qualification"
  | "recovery_identity"
  | "recovery_record"
  | "stream";

export type RepositoryLocalFilesystemEvent =
  | "directory.after_create"
  | "directory.after_self_sync"
  | "directory.after_parent_sync"
  | "lock.after_file_sync"
  | "lock.after_directory_sync"
  | `${RepositoryLocalFileKind}.before_temp_create`
  | `${RepositoryLocalFileKind}.during_temp_write`
  | `${RepositoryLocalFileKind}.after_temp_sync`
  | `${RepositoryLocalFileKind}.after_link`
  | `${RepositoryLocalFileKind}.after_publish`
  | `${RepositoryLocalFileKind}.before_directory_sync`
  | `${RepositoryLocalFileKind}.after_directory_sync`;

export interface RepositoryLocalMetadataSnapshot {
  readonly device: number;
  readonly inode: number;
  readonly mode: number;
  readonly links: number;
  readonly owner: number;
  readonly size: number;
  readonly kind: "directory" | "file" | "other";
}

export interface RepositoryLocalFilesystemHooks {
  readonly onEvent?: (event: RepositoryLocalFilesystemEvent) => void | Promise<void>;
  readonly filesystemKindOverride?: "apfs" | "ext" | "unsupported";
  readonly availableBytesOverride?: bigint;
  readonly writeChunkLimit?: (kind: RepositoryLocalFileKind, remainingBytes: number) => number;
  readonly metadataOverride?: (
    label: "directory" | "file" | "repository",
    metadata: RepositoryLocalMetadataSnapshot,
  ) => RepositoryLocalMetadataSnapshot;
}

export interface RepositoryLocalPaths {
  readonly repositoryRoot: string;
  readonly runtimeRoot: string;
  readonly profile: string;
  readonly lock: string;
  readonly primary: string;
  readonly streams: string;
  readonly primaryIdentities: string;
  readonly checkpoints: string;
  readonly deletions: string;
  readonly recovery: string;
  readonly pending: string;
  readonly acknowledged: string;
  readonly recoveryIdentities: string;
  readonly quarantine: string;
  readonly exports: string;
  readonly temporary: string;
}

export interface RepositoryLocalOwnedLock {
  readonly handle: FileHandle;
  readonly record: RepositoryLocalWriterLockRecord;
  readonly bytes: Buffer;
  readonly device: number;
  readonly inode: number;
  released: boolean;
}

export interface RepositoryLocalReadResult {
  readonly value: unknown;
  readonly bytes: Buffer;
  readonly metadata: RepositoryLocalMetadataSnapshot;
}

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const APFS_DARWIN_TYPE = 26;
const EXT_LINUX_TYPE = 0xef53;
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const O_DIRECTORY = constants.O_DIRECTORY ?? 0;
const CREATE_EXCLUSIVE_FLAGS = constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | O_NOFOLLOW;
const READ_NOFOLLOW_FLAGS = constants.O_RDONLY | O_NOFOLLOW;
const DIRECTORY_FLAGS = constants.O_RDONLY | O_NOFOLLOW | O_DIRECTORY;

function fail(reason: RepositoryLocalFailureReason, ambiguous = false): never {
  throw new RepositoryLocalFilesystemError(reason, ambiguous);
}

function nodeErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

function mapFilesystemError(error: unknown, ambiguous = false): never {
  if (error instanceof RepositoryLocalFilesystemError) throw error;
  const code = nodeErrorCode(error);
  if (code === "ENOSPC" || code === "EDQUOT" || code === "EFBIG") {
    return fail("capacity_exhausted", ambiguous);
  }
  if (
    code === "ELOOP" ||
    code === "ENOTDIR" ||
    code === "EPERM" ||
    code === "EACCES" ||
    code === "EMLINK" ||
    code === "EXDEV"
  ) {
    return fail("unsafe_metadata", ambiguous);
  }
  return fail("io_failure", ambiguous);
}

async function emit(
  hooks: RepositoryLocalFilesystemHooks | undefined,
  event: RepositoryLocalFilesystemEvent,
): Promise<void> {
  if (hooks?.onEvent === undefined) return;
  try {
    await hooks.onEvent(event);
  } catch (error: unknown) {
    mapFilesystemError(
      error,
      event.endsWith("after_link") ||
        event.endsWith("after_publish") ||
        event.endsWith("before_directory_sync") ||
        event.endsWith("after_directory_sync"),
    );
  }
}

function effectiveUserId(): number {
  if (typeof process.geteuid !== "function") return fail("unsupported_filesystem");
  return process.geteuid();
}

function metadataFromStats(stats: Stats): RepositoryLocalMetadataSnapshot {
  return {
    device: stats.dev,
    inode: stats.ino,
    mode: stats.mode & 0o777,
    links: stats.nlink,
    owner: stats.uid,
    size: stats.size,
    kind: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
  };
}

function metadata(
  stats: Stats,
  label: "directory" | "file" | "repository",
  hooks: RepositoryLocalFilesystemHooks | undefined,
): RepositoryLocalMetadataSnapshot {
  const actual = metadataFromStats(stats);
  return hooks?.metadataOverride?.(label, actual) ?? actual;
}

function assertRepositoryMetadata(
  stats: Stats,
  hooks: RepositoryLocalFilesystemHooks | undefined,
): RepositoryLocalMetadataSnapshot {
  const snapshot = metadata(stats, "repository", hooks);
  if (
    snapshot.kind !== "directory" ||
    snapshot.owner !== effectiveUserId() ||
    snapshot.links < 1 ||
    (snapshot.mode & 0o022) !== 0
  ) {
    return fail("unsafe_metadata");
  }
  return snapshot;
}

export function assertRepositoryLocalDirectoryMetadata(
  stats: Stats,
  hooks?: RepositoryLocalFilesystemHooks,
): RepositoryLocalMetadataSnapshot {
  const snapshot = metadata(stats, "directory", hooks);
  if (
    snapshot.kind !== "directory" ||
    snapshot.owner !== effectiveUserId() ||
    snapshot.mode !== DIRECTORY_MODE ||
    snapshot.links < 1
  ) {
    return fail("unsafe_metadata");
  }
  return snapshot;
}

export function assertRepositoryLocalFileMetadata(
  stats: Stats,
  expectedDevice: number,
  expectedLinks: 1 | 2,
  maximumBytes: number,
  hooks?: RepositoryLocalFilesystemHooks,
): RepositoryLocalMetadataSnapshot {
  const snapshot = metadata(stats, "file", hooks);
  if (
    snapshot.kind !== "file" ||
    snapshot.owner !== effectiveUserId() ||
    snapshot.mode !== FILE_MODE ||
    snapshot.links !== expectedLinks ||
    snapshot.device !== expectedDevice ||
    snapshot.size < 0 ||
    snapshot.size > maximumBytes
  ) {
    return fail("unsafe_metadata");
  }
  return snapshot;
}

async function safeLstat(filePath: string): Promise<Stats> {
  try {
    return await lstat(filePath);
  } catch (error: unknown) {
    mapFilesystemError(error);
  }
}

async function lstatIfPresent(filePath: string): Promise<Stats | undefined> {
  try {
    return await lstat(filePath);
  } catch (error: unknown) {
    if (nodeErrorCode(error) === "ENOENT") return undefined;
    mapFilesystemError(error);
  }
}

async function validateExistingPathComponents(absolutePath: string): Promise<void> {
  const parsed = path.parse(absolutePath);
  const relative = absolutePath.slice(parsed.root.length);
  const components = relative.split(path.sep).filter((component) => component.length > 0);
  let current = parsed.root;
  for (const component of components) {
    current = path.join(current, component);
    const stats = await safeLstat(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) return fail("unsafe_metadata");
  }
}

export async function resolveTrustedRepositoryLocalPaths(
  trustedRepositoryRoot: string,
  hooks?: RepositoryLocalFilesystemHooks,
): Promise<RepositoryLocalPaths> {
  if (
    O_NOFOLLOW === 0 ||
    O_DIRECTORY === 0 ||
    !path.isAbsolute(trustedRepositoryRoot) ||
    path.normalize(trustedRepositoryRoot) !== trustedRepositoryRoot ||
    trustedRepositoryRoot === path.parse(trustedRepositoryRoot).root ||
    trustedRepositoryRoot
      .split(path.sep)
      .some((component) => component.toLocaleLowerCase("en-US") === ".git")
  ) {
    return fail("unsafe_metadata");
  }
  await validateExistingPathComponents(trustedRepositoryRoot);
  let canonical: string;
  try {
    canonical = await realpath(trustedRepositoryRoot);
  } catch (error: unknown) {
    mapFilesystemError(error);
  }
  if (canonical !== trustedRepositoryRoot) return fail("unsafe_metadata");
  const repositoryMetadata = assertRepositoryMetadata(
    await safeLstat(trustedRepositoryRoot),
    hooks,
  );
  const runtimeRoot = path.join(trustedRepositoryRoot, ...REPOSITORY_LOCAL_RUNTIME_PATH.split("/"));
  const gitRoot = path.join(trustedRepositoryRoot, ".git");
  if (runtimeRoot === gitRoot || runtimeRoot.startsWith(`${gitRoot}${path.sep}`)) {
    return fail("unsafe_metadata");
  }
  const primary = path.join(runtimeRoot, "primary");
  const recovery = path.join(runtimeRoot, "recovery");
  const paths: RepositoryLocalPaths = {
    repositoryRoot: trustedRepositoryRoot,
    runtimeRoot,
    profile: path.join(runtimeRoot, "profile.json"),
    lock: path.join(runtimeRoot, "writer.lock"),
    primary,
    streams: path.join(primary, "streams"),
    primaryIdentities: path.join(primary, "identities"),
    checkpoints: path.join(primary, "checkpoints"),
    deletions: path.join(primary, "deletions"),
    recovery,
    pending: path.join(recovery, "pending"),
    acknowledged: path.join(recovery, "acknowledged"),
    recoveryIdentities: path.join(recovery, "identities"),
    quarantine: path.join(recovery, "quarantine"),
    exports: path.join(runtimeRoot, "exports"),
    temporary: path.join(runtimeRoot, "tmp"),
  };
  Object.defineProperty(paths, "__repositoryDevice", {
    value: repositoryMetadata.device,
    enumerable: false,
  });
  return paths;
}

async function syncDirectoryHandle(
  directoryPath: string,
  hooks: RepositoryLocalFilesystemHooks | undefined,
  trustedRepositoryRoot = false,
): Promise<void> {
  let handle: FileHandle;
  try {
    handle = await open(directoryPath, DIRECTORY_FLAGS);
  } catch (error: unknown) {
    mapFilesystemError(error);
  }
  try {
    const stats = await handle.stat();
    if (trustedRepositoryRoot) {
      assertRepositoryMetadata(stats, hooks);
    } else {
      assertRepositoryLocalDirectoryMetadata(stats, hooks);
    }
    await handle.sync();
  } catch (error: unknown) {
    try {
      await handle.close();
    } catch (closeError: unknown) {
      mapFilesystemError(closeError, true);
    }
    mapFilesystemError(error, true);
  }
  try {
    await handle.close();
  } catch (error: unknown) {
    mapFilesystemError(error, true);
  }
}

export async function syncRepositoryLocalDirectory(
  directoryPath: string,
  hooks?: RepositoryLocalFilesystemHooks,
  kind?: RepositoryLocalFileKind,
): Promise<void> {
  if (kind !== undefined) await emit(hooks, `${kind}.before_directory_sync`);
  await syncDirectoryHandle(directoryPath, hooks);
  if (kind !== undefined) await emit(hooks, `${kind}.after_directory_sync`);
}

export async function ensureDurableRepositoryLocalDirectory(
  directoryPath: string,
  parentPath: string,
  expectedDevice: number,
  hooks?: RepositoryLocalFilesystemHooks,
  parentMayUseRepositoryMode = false,
  existingMayUseRepositoryMode = false,
): Promise<Readonly<{ created: boolean; metadata: RepositoryLocalMetadataSnapshot }>> {
  const existing = await lstatIfPresent(directoryPath);
  if (existing !== undefined) {
    const existingMetadata = existingMayUseRepositoryMode
      ? assertRepositoryMetadata(existing, hooks)
      : assertRepositoryLocalDirectoryMetadata(existing, hooks);
    if (existingMetadata.device !== expectedDevice) return fail("unsafe_metadata");
    await syncDirectoryHandle(directoryPath, hooks, existingMayUseRepositoryMode);
    await emit(hooks, "directory.after_self_sync");
    await syncDirectoryHandle(parentPath, hooks, parentMayUseRepositoryMode);
    await emit(hooks, "directory.after_parent_sync");
    return { created: false, metadata: existingMetadata };
  }
  try {
    await mkdir(directoryPath, { mode: DIRECTORY_MODE });
  } catch (error: unknown) {
    if (nodeErrorCode(error) === "EEXIST") return fail("unsafe_metadata");
    mapFilesystemError(error);
  }
  await emit(hooks, "directory.after_create");
  const createdMetadata = assertRepositoryLocalDirectoryMetadata(
    await safeLstat(directoryPath),
    hooks,
  );
  if (createdMetadata.device !== expectedDevice) return fail("unsafe_metadata");
  await syncDirectoryHandle(directoryPath, hooks);
  await emit(hooks, "directory.after_self_sync");
  await syncDirectoryHandle(parentPath, hooks, parentMayUseRepositoryMode);
  await emit(hooks, "directory.after_parent_sync");
  return { created: true, metadata: createdMetadata };
}

export async function ensureRepositoryLocalRuntimeRoot(
  paths: RepositoryLocalPaths,
  hooks?: RepositoryLocalFilesystemHooks,
): Promise<number> {
  const repositoryMetadata = assertRepositoryMetadata(await safeLstat(paths.repositoryRoot), hooks);
  const yukhRoot = path.join(paths.repositoryRoot, ".yukh");
  const runtimeParent = path.join(yukhRoot, "runtime");
  await ensureDurableRepositoryLocalDirectory(
    yukhRoot,
    paths.repositoryRoot,
    repositoryMetadata.device,
    hooks,
    true,
    true,
  );
  await ensureDurableRepositoryLocalDirectory(
    runtimeParent,
    yukhRoot,
    repositoryMetadata.device,
    hooks,
    true,
  );
  const root = await ensureDurableRepositoryLocalDirectory(
    paths.runtimeRoot,
    runtimeParent,
    repositoryMetadata.device,
    hooks,
  );
  return root.metadata.device;
}

export async function ensureRepositoryLocalTopology(
  paths: RepositoryLocalPaths,
  expectedDevice: number,
  hooks?: RepositoryLocalFilesystemHooks,
): Promise<void> {
  for (const [directoryPath, parentPath] of [
    [paths.primary, paths.runtimeRoot],
    [paths.streams, paths.primary],
    [paths.primaryIdentities, paths.primary],
    [paths.checkpoints, paths.primary],
    [paths.deletions, paths.primary],
    [paths.recovery, paths.runtimeRoot],
    [paths.pending, paths.recovery],
    [paths.acknowledged, paths.recovery],
    [paths.recoveryIdentities, paths.recovery],
    [paths.quarantine, paths.recovery],
    [paths.exports, paths.runtimeRoot],
    [paths.temporary, paths.runtimeRoot],
  ] as const) {
    await ensureDurableRepositoryLocalDirectory(directoryPath, parentPath, expectedDevice, hooks);
  }
}

async function writeAll(
  handle: FileHandle,
  bytes: Buffer,
  kind: RepositoryLocalFileKind,
  hooks: RepositoryLocalFilesystemHooks | undefined,
  baseOffset = 0,
  emitDuringWrite = true,
): Promise<void> {
  let offset = 0;
  let emittedDuringWrite = false;
  while (offset < bytes.length) {
    const remaining = bytes.length - offset;
    const requested = hooks?.writeChunkLimit?.(kind, remaining) ?? remaining;
    if (!Number.isSafeInteger(requested) || requested <= 0 || requested > remaining) {
      return fail("io_failure", true);
    }
    let written: number;
    try {
      ({ bytesWritten: written } = await handle.write(
        bytes,
        offset,
        requested,
        baseOffset + offset,
      ));
    } catch (error: unknown) {
      mapFilesystemError(error, true);
    }
    if (written <= 0 || written > requested) return fail("io_failure", true);
    offset += written;
    if (emitDuringWrite && !emittedDuringWrite && bytes.length > 1 && offset < bytes.length) {
      emittedDuringWrite = true;
      await emit(hooks, `${kind}.during_temp_write`);
    }
  }
}

async function writeExclusiveTemporary(
  temporaryPath: string,
  bytes: Buffer,
  maximumBytes: number,
  expectedDevice: number,
  kind: RepositoryLocalFileKind,
  hooks: RepositoryLocalFilesystemHooks | undefined,
): Promise<void> {
  if (bytes.length <= 0 || bytes.length > maximumBytes) return fail("capacity_exhausted");
  await emit(hooks, `${kind}.before_temp_create`);
  let handle: FileHandle;
  try {
    handle = await open(temporaryPath, CREATE_EXCLUSIVE_FLAGS, FILE_MODE);
  } catch (error: unknown) {
    if (nodeErrorCode(error) === "EEXIST") return fail("publication_conflict");
    mapFilesystemError(error);
  }
  let closed = false;
  try {
    if (bytes.length > 1 && hooks?.onEvent !== undefined) {
      const firstLength = Math.max(1, Math.floor(bytes.length / 2));
      let firstWritten: number;
      ({ bytesWritten: firstWritten } = await handle.write(bytes, 0, firstLength, 0));
      if (firstWritten <= 0 || firstWritten > firstLength) return fail("io_failure", true);
      await emit(hooks, `${kind}.during_temp_write`);
      if (firstWritten < bytes.length) {
        const remaining = bytes.subarray(firstWritten);
        await writeAll(handle, remaining, kind, hooks, firstWritten, false);
      }
    } else {
      await writeAll(handle, bytes, kind, hooks);
    }
    await handle.sync();
    await emit(hooks, `${kind}.after_temp_sync`);
    const fileMetadata = assertRepositoryLocalFileMetadata(
      await handle.stat(),
      expectedDevice,
      1,
      maximumBytes,
      hooks,
    );
    if (fileMetadata.size !== bytes.length) return fail("io_failure", true);
    await handle.close();
    closed = true;
  } catch (error: unknown) {
    if (!closed) {
      try {
        await handle.close();
      } catch (closeError: unknown) {
        mapFilesystemError(closeError, true);
      }
    }
    mapFilesystemError(error, true);
  }
  const closedMetadata = assertRepositoryLocalFileMetadata(
    await safeLstat(temporaryPath),
    expectedDevice,
    1,
    maximumBytes,
    hooks,
  );
  if (closedMetadata.size !== bytes.length) return fail("io_failure", true);
}

export async function publishRepositoryLocalFile(
  directoryPath: string,
  destinationName: string,
  temporaryName: string,
  bytes: Buffer,
  maximumBytes: number,
  expectedDevice: number,
  kind: RepositoryLocalFileKind,
  hooks?: RepositoryLocalFilesystemHooks,
): Promise<void> {
  if (
    destinationName.includes(path.sep) ||
    temporaryName.includes(path.sep) ||
    destinationName.length === 0 ||
    temporaryName.length === 0 ||
    destinationName === "." ||
    destinationName === ".." ||
    temporaryName === "." ||
    temporaryName === ".." ||
    destinationName.includes("\0") ||
    temporaryName.includes("\0") ||
    destinationName === temporaryName
  ) {
    return fail("unsafe_metadata");
  }
  const destinationPath = path.join(directoryPath, destinationName);
  const temporaryPath = path.join(directoryPath, temporaryName);
  await writeExclusiveTemporary(temporaryPath, bytes, maximumBytes, expectedDevice, kind, hooks);
  try {
    await link(temporaryPath, destinationPath);
  } catch (error: unknown) {
    if (nodeErrorCode(error) === "EEXIST") return fail("publication_conflict");
    mapFilesystemError(error, true);
  }
  const temporaryMetadata = assertRepositoryLocalFileMetadata(
    await safeLstat(temporaryPath),
    expectedDevice,
    2,
    maximumBytes,
    hooks,
  );
  const destinationMetadata = assertRepositoryLocalFileMetadata(
    await safeLstat(destinationPath),
    expectedDevice,
    2,
    maximumBytes,
    hooks,
  );
  if (
    temporaryMetadata.inode !== destinationMetadata.inode ||
    temporaryMetadata.size !== bytes.length ||
    destinationMetadata.size !== bytes.length
  ) {
    return fail("unsafe_metadata", true);
  }
  await emit(hooks, `${kind}.after_link`);
  try {
    await unlink(temporaryPath);
  } catch (error: unknown) {
    mapFilesystemError(error, true);
  }
  const publishedMetadata = assertRepositoryLocalFileMetadata(
    await safeLstat(destinationPath),
    expectedDevice,
    1,
    maximumBytes,
    hooks,
  );
  if (publishedMetadata.size !== bytes.length) return fail("io_failure", true);
  await emit(hooks, `${kind}.after_publish`);
}

export async function removeRecognizedRepositoryLocalTemporary(
  temporaryPath: string,
  containingDirectory: string,
  maximumBytes: number,
  expectedDevice: number,
  hooks?: RepositoryLocalFilesystemHooks,
  publishedDestinationPath?: string,
): Promise<void> {
  const temporaryStats = await safeLstat(temporaryPath);
  if (publishedDestinationPath === undefined) {
    assertRepositoryLocalFileMetadata(temporaryStats, expectedDevice, 1, maximumBytes, hooks);
  } else {
    const destinationStats = await safeLstat(publishedDestinationPath);
    const temporaryMetadata = assertRepositoryLocalFileMetadata(
      temporaryStats,
      expectedDevice,
      2,
      maximumBytes,
      hooks,
    );
    const destinationMetadata = assertRepositoryLocalFileMetadata(
      destinationStats,
      expectedDevice,
      2,
      maximumBytes,
      hooks,
    );
    if (
      temporaryMetadata.inode !== destinationMetadata.inode ||
      temporaryMetadata.size !== destinationMetadata.size
    ) {
      return fail("unsafe_metadata");
    }
  }
  try {
    await unlink(temporaryPath);
  } catch (error: unknown) {
    mapFilesystemError(error, true);
  }
  await syncDirectoryHandle(containingDirectory, hooks);
}

export async function inspectRepositoryLocalTemporaryBytes(
  temporaryPath: string,
  maximumBytes: number,
  expectedDevice: number,
  hooks?: RepositoryLocalFilesystemHooks,
): Promise<number> {
  const stats = await safeLstat(temporaryPath);
  const links = stats.nlink === 1 ? 1 : stats.nlink === 2 ? 2 : undefined;
  if (links === undefined) return fail("unsafe_metadata");
  return assertRepositoryLocalFileMetadata(stats, expectedDevice, links, maximumBytes, hooks).size;
}

export async function readBoundedRepositoryLocalFile(
  filePath: string,
  maximumBytes: number,
  expectedDevice: number,
  hooks?: RepositoryLocalFilesystemHooks,
  expectedLinks: 1 | 2 = 1,
): Promise<RepositoryLocalReadResult> {
  let handle: FileHandle;
  try {
    handle = await open(filePath, READ_NOFOLLOW_FLAGS);
  } catch (error: unknown) {
    mapFilesystemError(error);
  }
  let before: RepositoryLocalMetadataSnapshot;
  let bytes: Buffer;
  try {
    before = assertRepositoryLocalFileMetadata(
      await handle.stat(),
      expectedDevice,
      expectedLinks,
      maximumBytes,
      hooks,
    );
    if (before.size <= 0) return fail("corruption_detected");
    bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead <= 0) return fail("corruption_detected");
      offset += result.bytesRead;
    }
    const after = assertRepositoryLocalFileMetadata(
      await handle.stat(),
      expectedDevice,
      expectedLinks,
      maximumBytes,
      hooks,
    );
    if (
      after.inode !== before.inode ||
      after.size !== before.size ||
      after.device !== before.device
    ) {
      return fail("unsafe_metadata");
    }
    await handle.close();
  } catch (error: unknown) {
    try {
      await handle.close();
    } catch (closeError: unknown) {
      mapFilesystemError(closeError, true);
    }
    mapFilesystemError(error);
  }
  let value: unknown;
  try {
    value = parseCanonicalRepositoryLocalBytes(bytes);
  } catch (error: unknown) {
    if (error instanceof RepositoryLocalFilesystemError) throw error;
    return fail("corruption_detected");
  }
  return { value, bytes, metadata: before };
}

export async function listRepositoryLocalDirectory(
  directoryPath: string,
  expectedDevice: number,
  maximumEntries: number,
  hooks?: RepositoryLocalFilesystemHooks,
): Promise<readonly string[]> {
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 0) {
    return fail("corruption_detected");
  }
  const directoryMetadata = assertRepositoryLocalDirectoryMetadata(
    await safeLstat(directoryPath),
    hooks,
  );
  if (directoryMetadata.device !== expectedDevice) return fail("unsafe_metadata");
  let directory: Awaited<ReturnType<typeof opendir>>;
  try {
    directory = await opendir(directoryPath);
  } catch (error: unknown) {
    mapFilesystemError(error);
  }
  const names: string[] = [];
  let closed = false;
  try {
    for (;;) {
      const entry = await directory.read();
      if (entry === null) break;
      names.push(entry.name);
      if (names.length > maximumEntries) return fail("corruption_detected");
    }
    await directory.close();
    closed = true;
  } catch (error: unknown) {
    if (!closed) {
      try {
        await directory.close();
      } catch (closeError: unknown) {
        mapFilesystemError(closeError);
      }
    }
    mapFilesystemError(error);
  }
  names.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const caseFolded = new Set<string>();
  for (const name of names) {
    if (
      name.length === 0 ||
      name === "." ||
      name === ".." ||
      name.includes("/") ||
      name.includes("\0")
    ) {
      return fail("unsafe_metadata");
    }
    const folded = name.toLocaleLowerCase("en-US");
    if (caseFolded.has(folded)) return fail("unsafe_metadata");
    caseFolded.add(folded);
  }
  return names;
}

export async function assertEmptyRepositoryLocalDirectory(
  directoryPath: string,
  expectedDevice: number,
  hooks?: RepositoryLocalFilesystemHooks,
): Promise<void> {
  if ((await listRepositoryLocalDirectory(directoryPath, expectedDevice, 0, hooks)).length !== 0) {
    return fail("corruption_detected");
  }
}

export async function qualifyRepositoryLocalFilesystem(
  paths: RepositoryLocalPaths,
  expectedDevice: number,
  hooks?: RepositoryLocalFilesystemHooks,
): Promise<void> {
  let filesystemKind: "apfs" | "ext" | "unsupported";
  if (hooks?.filesystemKindOverride !== undefined) {
    filesystemKind = hooks.filesystemKindOverride;
  } else {
    let information: Awaited<ReturnType<typeof statfs>>;
    try {
      information = await statfs(paths.runtimeRoot);
    } catch (error: unknown) {
      mapFilesystemError(error);
    }
    filesystemKind =
      process.platform === "darwin" && information.type === APFS_DARWIN_TYPE
        ? "apfs"
        : process.platform === "linux" && information.type === EXT_LINUX_TYPE
          ? "ext"
          : "unsupported";
  }
  if (filesystemKind === "unsupported") return fail("unsupported_filesystem");

  const sourceName = ".qualification.source.tmp";
  const destinationName = ".qualification.destination.tmp";
  const sourcePath = path.join(paths.runtimeRoot, sourceName);
  const destinationPath = path.join(paths.runtimeRoot, destinationName);
  if (
    (await lstatIfPresent(sourcePath)) !== undefined ||
    (await lstatIfPresent(destinationPath)) !== undefined
  ) {
    return fail("unsafe_metadata");
  }
  const bytes = Buffer.from("repository-local-filesystem-qualification-v1", "utf8");
  await writeExclusiveTemporary(
    sourcePath,
    bytes,
    bytes.length,
    expectedDevice,
    "qualification",
    hooks,
  );
  try {
    await link(sourcePath, destinationPath);
  } catch (error: unknown) {
    mapFilesystemError(error, true);
  }
  try {
    await link(sourcePath, destinationPath);
    return fail("unsupported_filesystem", true);
  } catch (error: unknown) {
    if (nodeErrorCode(error) !== "EEXIST") mapFilesystemError(error, true);
  }
  const sourceMetadata = assertRepositoryLocalFileMetadata(
    await safeLstat(sourcePath),
    expectedDevice,
    2,
    bytes.length,
    hooks,
  );
  const destinationMetadata = assertRepositoryLocalFileMetadata(
    await safeLstat(destinationPath),
    expectedDevice,
    2,
    bytes.length,
    hooks,
  );
  if (sourceMetadata.inode !== destinationMetadata.inode) {
    return fail("unsupported_filesystem", true);
  }
  try {
    await unlink(destinationPath);
    await unlink(sourcePath);
  } catch (error: unknown) {
    mapFilesystemError(error, true);
  }
  await syncDirectoryHandle(paths.runtimeRoot, hooks);
}

export async function repositoryLocalAvailableBytes(
  runtimeRoot: string,
  hooks?: RepositoryLocalFilesystemHooks,
): Promise<bigint> {
  if (hooks?.availableBytesOverride !== undefined) return hooks.availableBytesOverride;
  let information: Awaited<ReturnType<typeof statfs>>;
  try {
    information = await statfs(runtimeRoot, { bigint: true });
  } catch (error: unknown) {
    mapFilesystemError(error);
  }
  const available = information.bavail * information.bsize;
  if (available < 0n) return fail("io_failure");
  return available;
}

export async function acquireRepositoryLocalWriterLock(
  paths: RepositoryLocalPaths,
  writerRef: string,
  acquiredAt: string,
  expectedDevice: number,
  hooks?: RepositoryLocalFilesystemHooks,
): Promise<RepositoryLocalOwnedLock> {
  const record = createRepositoryLocalWriterLockRecord(
    writerRef,
    randomBytes(32).toString("hex"),
    acquiredAt,
  );
  const bytes = canonicalRepositoryLocalBytes(record);
  let handle: FileHandle;
  try {
    handle = await open(paths.lock, CREATE_EXCLUSIVE_FLAGS, FILE_MODE);
  } catch (error: unknown) {
    if (nodeErrorCode(error) === "EEXIST") return fail("lock_unavailable");
    mapFilesystemError(error);
  }
  try {
    await writeAll(handle, bytes, "profile", hooks);
    await handle.sync();
    await emit(hooks, "lock.after_file_sync");
    const fileMetadata = assertRepositoryLocalFileMetadata(
      await handle.stat(),
      expectedDevice,
      1,
      bytes.length,
      hooks,
    );
    if (fileMetadata.size !== bytes.length) return fail("io_failure", true);
    await syncDirectoryHandle(paths.runtimeRoot, hooks);
    await emit(hooks, "lock.after_directory_sync");
    return {
      handle,
      record,
      bytes,
      device: fileMetadata.device,
      inode: fileMetadata.inode,
      released: false,
    };
  } catch (error: unknown) {
    try {
      await handle.close();
    } catch (closeError: unknown) {
      mapFilesystemError(closeError, true);
    }
    mapFilesystemError(error, true);
  }
}

export async function verifyRepositoryLocalWriterLock(
  paths: RepositoryLocalPaths,
  lockOwner: RepositoryLocalOwnedLock,
  hooks?: RepositoryLocalFilesystemHooks,
): Promise<void> {
  if (lockOwner.released) return fail("lock_unavailable");
  let descriptorMetadata: RepositoryLocalMetadataSnapshot;
  try {
    descriptorMetadata = assertRepositoryLocalFileMetadata(
      await lockOwner.handle.stat(),
      lockOwner.device,
      1,
      lockOwner.bytes.length,
      hooks,
    );
  } catch (error: unknown) {
    mapFilesystemError(error);
  }
  const pathMetadata = assertRepositoryLocalFileMetadata(
    await safeLstat(paths.lock),
    lockOwner.device,
    1,
    lockOwner.bytes.length,
    hooks,
  );
  if (
    descriptorMetadata.inode !== lockOwner.inode ||
    pathMetadata.inode !== lockOwner.inode ||
    descriptorMetadata.size !== lockOwner.bytes.length ||
    pathMetadata.size !== lockOwner.bytes.length
  ) {
    return fail("unsafe_metadata");
  }
  const bytes = Buffer.allocUnsafe(lockOwner.bytes.length);
  let offset = 0;
  try {
    while (offset < bytes.length) {
      const result = await lockOwner.handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead <= 0) return fail("corruption_detected");
      offset += result.bytesRead;
    }
  } catch (error: unknown) {
    mapFilesystemError(error);
  }
  if (!bytes.equals(lockOwner.bytes)) return fail("unsafe_metadata");
  let parsed: RepositoryLocalWriterLockRecord;
  try {
    parsed = validateRepositoryLocalWriterLockRecord(parseCanonicalRepositoryLocalBytes(bytes));
  } catch {
    return fail("unsafe_metadata");
  }
  if (
    parsed.owner_token !== lockOwner.record.owner_token ||
    parsed.lock_record_digest !== lockOwner.record.lock_record_digest
  ) {
    return fail("unsafe_metadata");
  }
}

export async function releaseRepositoryLocalWriterLock(
  paths: RepositoryLocalPaths,
  lockOwner: RepositoryLocalOwnedLock,
  hooks?: RepositoryLocalFilesystemHooks,
): Promise<void> {
  if (lockOwner.released) return;
  await verifyRepositoryLocalWriterLock(paths, lockOwner, hooks);
  try {
    await unlink(paths.lock);
    await lockOwner.handle.close();
    lockOwner.released = true;
    await syncDirectoryHandle(paths.runtimeRoot, hooks);
  } catch (error: unknown) {
    mapFilesystemError(error, true);
  }
}

export async function fileExistsWithoutFollowing(filePath: string): Promise<boolean> {
  return (await lstatIfPresent(filePath)) !== undefined;
}
