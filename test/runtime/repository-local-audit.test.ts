import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { AuditError, compareAuditTimestamps } from "../../packages/audit/src/contract.js";
import {
  canonicalRepositoryLocalBytes,
  createRepositoryLocalCheckpointRecord,
  parseCanonicalRepositoryLocalBytes,
  REPOSITORY_LOCAL_CHECKPOINT_LIMITATION,
  REPOSITORY_LOCAL_LIMITS,
  repositoryLocalReferencePathDigest,
  validateRepositoryLocalCheckpointRecord,
  validateRepositoryLocalProfileRecord,
} from "../../packages/audit/src/repository-local-contract.js";
import {
  openRepositoryLocalAuditProfileForQualification,
  type RepositoryLocalAuditProfile,
} from "../../packages/audit/src/repository-local.js";
import type {
  RepositoryLocalFilesystemEvent,
  RepositoryLocalFilesystemHooks,
} from "../../packages/audit/src/repository-local-filesystem.js";
import {
  listRepositoryLocalDirectory,
  RepositoryLocalFilesystemError,
} from "../../packages/audit/src/repository-local-filesystem.js";
import { canonicalAuditJson } from "../../packages/audit/src/writer.js";
import {
  D1,
  FIXED_LATER,
  FIXED_NOW,
  STREAM_REF,
  WRITER_REF,
  candidateDigest,
  protectedGenesisEvent,
  protectedRequestEvent,
  recoveryFact,
} from "./repository-local-test-fixtures.js";

const RUNTIME_PARTS = [".yukh", "runtime", "audit-v1"] as const;

async function repositoryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  await chmod(root, 0o700);
  return realpath(root);
}

function runtime(root: string, ...parts: string[]): string {
  return path.join(root, ...RUNTIME_PARTS, ...parts);
}

function profileOptions(
  root: string,
  overrides: Readonly<{
    now?: () => Date;
    monotonicNow?: () => number;
    hooks?: RepositoryLocalFilesystemHooks;
    startupPrimaryScanLimits?: Readonly<{ maxRecords: number; maxBytes: number }>;
  }> = {},
) {
  return {
    trustedRepositoryRoot: root,
    writerRef: WRITER_REF,
    now: overrides.now ?? (() => new Date(FIXED_NOW)),
    ...(overrides.monotonicNow === undefined ? {} : { monotonicNow: overrides.monotonicNow }),
    ...(overrides.startupPrimaryScanLimits === undefined
      ? {}
      : { startupPrimaryScanLimits: overrides.startupPrimaryScanLimits }),
    filesystemHooks: {
      filesystemKindOverride: "ext" as const,
      ...overrides.hooks,
    },
  };
}

async function openProfile(
  root: string,
  overrides: Parameters<typeof profileOptions>[1] = {},
): Promise<RepositoryLocalAuditProfile> {
  return openRepositoryLocalAuditProfileForQualification(profileOptions(root, overrides));
}

async function expectUnavailable(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof AuditError && error.code === "audit_unavailable",
  );
}

async function initialize(root: string): Promise<void> {
  const profile = await openProfile(root);
  await profile.close();
}

async function appendPrimaryChain(
  profile: RepositoryLocalAuditProfile,
): Promise<
  readonly [ReturnType<typeof protectedGenesisEvent>, ReturnType<typeof protectedRequestEvent>]
> {
  const genesis = protectedGenesisEvent();
  await profile.store.append(genesis, candidateDigest(genesis));
  const request = protectedRequestEvent(genesis);
  await profile.store.append(request, candidateDigest(request));
  return [genesis, request];
}

function streamDirectory(root: string): string {
  return runtime(root, "primary", "streams", repositoryLocalReferencePathDigest(STREAM_REF));
}

function commitPath(root: string, sequence: number): string {
  return path.join(
    streamDirectory(root),
    "commits",
    `${sequence.toString().padStart(20, "0")}.json`,
  );
}

function primaryIdentityPath(root: string, eventId: string): string {
  return runtime(
    root,
    "primary",
    "identities",
    repositoryLocalReferencePathDigest(eventId),
    "00000000.json",
  );
}

test("primary store is durable, concurrent-idempotent, and conflict-fatal", async () => {
  const root = await repositoryRoot("repository-local-primary-");
  try {
    const profile = await openProfile(root);
    const event = protectedGenesisEvent();
    const [first, second] = await Promise.all([
      profile.store.append(event, candidateDigest(event)),
      profile.store.append(event, candidateDigest(event)),
    ]);
    assert.deepEqual([first.duplicate, second.duplicate].sort(), [false, true]);
    assert.equal(first.durability, "durable");
    assert.equal(second.durability, "durable");
    assert.equal(canonicalAuditJson(first.event), canonicalAuditJson(second.event));
    await profile.close();

    const reopened = await openProfile(root, {
      now: () => new Date(FIXED_LATER),
    });
    const found = await reopened.store.findById(event.event_id);
    assert.deepEqual(found, {
      event,
      candidate_digest: candidateDigest(event),
      durability: "durable",
    });
    assert.equal((await reopened.store.append(event, candidateDigest(event))).duplicate, true);

    const conflict = protectedGenesisEvent({
      subjectRef: "service.conflicting-audit",
    });
    await assert.rejects(
      reopened.store.append(conflict, candidateDigest(conflict)),
      (error: unknown) => error instanceof AuditError && error.code === "audit_duplicate_conflict",
    );
    assert.deepEqual(reopened.diagnostic(), {
      ...reopened.diagnostic(),
      phase: "primary_append",
      state: "failed",
      reason: "duplicate_conflict",
    });
    await expectUnavailable(reopened.store.append(event, candidateDigest(event)));
    assert.equal(JSON.stringify(reopened.diagnostic()).includes(root), false);
    await reopened.close();

    const verified = await openProfile(root, {
      now: () => new Date(FIXED_LATER),
    });
    assert.deepEqual((await verified.store.findById(event.event_id))?.event, event);
    await verified.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recovery journal preserves exact facts and replays deterministic read-only order", async () => {
  const root = await repositoryRoot("repository-local-recovery-");
  try {
    const profile = await openProfile(root);
    const facts = [
      recoveryFact(3, { observedAt: "2026-08-07T11:03:00.000Z" }),
      recoveryFact(1, { observedAt: "2026-08-07T11:01:00.000Z" }),
      recoveryFact(2, { observedAt: "2026-08-07T11:02:00.000Z" }),
    ];
    for (const fact of facts) {
      assert.deepEqual(await profile.journal.append(fact), {
        durability: "durable",
      });
    }
    assert.deepEqual(await profile.journal.append(facts[0]!), {
      durability: "durable",
    });
    const firstPass = [];
    for await (const fact of profile.pendingFacts()) {
      assert(Object.isFrozen(fact));
      firstPass.push(fact);
    }
    assert.deepEqual(
      firstPass.map((fact) => fact.recovery_id),
      [facts[1]!.recovery_id, facts[2]!.recovery_id, facts[0]!.recovery_id],
    );
    const secondPass = [];
    for await (const fact of profile.pendingFacts()) secondPass.push(fact);
    assert.deepEqual(secondPass, firstPass);

    const conflict = recoveryFact(3, { eventId: "event.conflicting-recovery" });
    await assert.rejects(
      profile.journal.append(conflict),
      (error: unknown) => error instanceof AuditError && error.code === "audit_duplicate_conflict",
    );
    assert.equal(profile.diagnostic().state, "failed");
    await expectUnavailable(profile.journal.append(facts[0]!));
    await profile.close();

    const reopened = await openProfile(root, {
      now: () => new Date(FIXED_LATER),
    });
    const afterRestart = [];
    for await (const fact of reopened.pendingFacts()) afterRestart.push(fact);
    assert.deepEqual(afterRestart, firstPass);
    assert.deepEqual(await readdir(runtime(root, "recovery", "acknowledged")), []);
    await reopened.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("overdue recovery facts fail a live profile before any further durable effect", async () => {
  const liveRoot = await repositoryRoot("repository-local-live-overdue-");
  const staleAppendRoot = await repositoryRoot("repository-local-stale-append-");
  let now = FIXED_NOW;
  try {
    const live = await openProfile(liveRoot, {
      now: () => new Date(now),
    });
    const recorded = protectedGenesisEvent();
    await live.store.append(recorded, candidateDigest(recorded));
    const fact = recoveryFact();
    await live.journal.append(fact);
    now = "2026-09-07T12:00:01.000Z";
    assert.equal(live.diagnostic().reason, "pending_expired");
    const event = protectedGenesisEvent({
      eventId: "event.overdue-denied",
      streamRef: "stream.overdue-denied",
    });
    await expectUnavailable(live.store.append(event, candidateDigest(event)));
    await expectUnavailable(live.journal.append(fact));
    assert.equal(live.diagnostic().reason, "pending_expired");
    await live.close();
    assert.deepEqual(await readdir(runtime(liveRoot, "primary", "checkpoints")), []);

    const staleAppend = await openProfile(staleAppendRoot, {
      now: () => new Date("2026-09-07T12:00:01.000Z"),
    });
    await expectUnavailable(staleAppend.journal.append(recoveryFact()));
    assert.equal(staleAppend.diagnostic().reason, "pending_expired");
    assert.deepEqual(await readdir(runtime(staleAppendRoot, "recovery", "pending")), []);
    await staleAppend.close();
  } finally {
    await rm(liveRoot, { recursive: true, force: true });
    await rm(staleAppendRoot, { recursive: true, force: true });
  }
});

test("closed records and local checkpoint claims are canonical and fixed", () => {
  const checkpoint = createRepositoryLocalCheckpointRecord({
    stream_ref: STREAM_REF,
    range_start: 0,
    range_end: 9,
    terminal_event_hash: D1,
    previous_checkpoint_ref: null,
    writer_ref: WRITER_REF,
    created_at: FIXED_NOW,
  });
  assert.equal(checkpoint.event_count, 10);
  assert.equal(checkpoint.limitation, REPOSITORY_LOCAL_CHECKPOINT_LIMITATION);
  assert.equal(checkpoint.authority_ref, "repository_local_writer_v1");
  assert.equal(checkpoint.algorithm, "sha256_local_checkpoint_v1");
  assert.equal(
    checkpoint.checkpoint_id,
    "sha256:241c45517b6633182ef2015ef96ffa5bf54018ca32c466c5be3cbf671a7c79df",
  );
  assert.deepEqual(
    validateRepositoryLocalCheckpointRecord(
      parseCanonicalRepositoryLocalBytes(canonicalRepositoryLocalBytes(checkpoint)),
    ),
    checkpoint,
  );
  assert.throws(() =>
    parseCanonicalRepositoryLocalBytes(Buffer.from(`${JSON.stringify(checkpoint)}\n`, "utf8")),
  );
  assert.throws(() => validateRepositoryLocalCheckpointRecord({ ...checkpoint, unknown: true }));
  assert.equal(REPOSITORY_LOCAL_LIMITS.recovery_identity_reservation_bytes, 16 * 1024);
  assert.equal(REPOSITORY_LOCAL_LIMITS.max_event_identities, 8_192);
  assert.equal(REPOSITORY_LOCAL_LIMITS.max_primary_committed_bytes, 64 * 1024 * 1024);
  assert.equal(
    REPOSITORY_LOCAL_LIMITS.max_recovery_identities *
      REPOSITORY_LOCAL_LIMITS.recovery_identity_reservation_bytes,
    REPOSITORY_LOCAL_LIMITS.max_recovery_bytes,
  );
  assert.equal(compareAuditTimestamps("2026-08-07T12:00:00Z", "2026-08-07T12:00:00.1Z"), -1);
  assert.equal(
    compareAuditTimestamps("2026-08-07T12:00:00.100000000Z", "2026-08-07T12:00:00.1Z"),
    0,
  );
});

test("clean shutdown publishes one honest checkpoint per changed stream", async () => {
  const root = await repositoryRoot("repository-local-checkpoints-");
  try {
    const profile = await openProfile(root);
    const first = protectedGenesisEvent();
    const second = protectedGenesisEvent({
      eventId: "event.repository-local-second-stream",
      streamRef: "stream.repository-local-second",
    });
    await profile.store.append(first, candidateDigest(first));
    await profile.store.append(second, candidateDigest(second));
    await profile.close();

    const files = await readdir(runtime(root, "primary", "checkpoints"));
    assert.equal(files.length, 2);
    for (const file of files) {
      const parsed = validateRepositoryLocalCheckpointRecord(
        parseCanonicalRepositoryLocalBytes(
          await readFile(runtime(root, "primary", "checkpoints", file)),
        ),
      );
      assert.equal(parsed.range_start, 0);
      assert.equal(parsed.range_end, 0);
      assert.equal(parsed.event_count, 1);
      assert.equal(parsed.limitation, "local_unwitnessed_not_complete");
    }
    const reopened = await openProfile(root, {
      now: () => new Date(FIXED_LATER),
    });
    assert.equal(reopened.diagnostic().state, "healthy");
    await reopened.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup commit budgets are global across stream directories", async () => {
  const root = await repositoryRoot("repository-local-global-scan-budget-");
  try {
    const profile = await openProfile(root);
    const first = protectedGenesisEvent();
    const second = protectedGenesisEvent({
      eventId: "event.repository-local-scan-budget-second",
      streamRef: "stream.repository-local-scan-budget-second",
    });
    await profile.store.append(first, candidateDigest(first));
    await profile.store.append(second, candidateDigest(second));
    await profile.close();

    const firstPath = commitPath(root, 0);
    const secondPath = runtime(
      root,
      "primary",
      "streams",
      repositoryLocalReferencePathDigest(second.integrity.stream_ref),
      "commits",
      "00000000000000000000.json",
    );
    const sizes = [(await lstat(firstPath)).size, (await lstat(secondPath)).size];
    const singleDirectoryByteAllowance = Math.max(...sizes);
    assert(sizes.every((size) => size <= singleDirectoryByteAllowance));
    assert(sizes.reduce((total, size) => total + size, 0) > singleDirectoryByteAllowance);

    await expectUnavailable(
      openProfile(root, {
        startupPrimaryScanLimits: {
          maxRecords: 1,
          maxBytes: REPOSITORY_LOCAL_LIMITS.max_primary_committed_bytes,
        },
      }),
    );
    await expectUnavailable(
      openProfile(root, {
        startupPrimaryScanLimits: {
          maxRecords: REPOSITORY_LOCAL_LIMITS.max_event_identities,
          maxBytes: singleDirectoryByteAllowance,
        },
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the per-stream checkpoint interval commits at exactly 1,000 records", async () => {
  const root = await repositoryRoot("repository-local-checkpoint-interval-");
  try {
    const options = profileOptions(root);
    const mutableHooks = options.filesystemHooks as {
      filesystemKindOverride: "ext";
      availableBytesOverride?: bigint;
    };
    const profile = await openRepositoryLocalAuditProfileForQualification(options);
    let previous = protectedGenesisEvent();
    await profile.store.append(previous, candidateDigest(previous));
    for (
      let sequence = 1;
      sequence < REPOSITORY_LOCAL_LIMITS.checkpoint_interval - 1;
      sequence += 1
    ) {
      previous = protectedRequestEvent(previous, sequence);
      await profile.store.append(previous, candidateDigest(previous));
    }
    assert.deepEqual(await readdir(runtime(root, "primary", "checkpoints")), []);
    const thresholdEvent = protectedRequestEvent(
      previous,
      REPOSITORY_LOCAL_LIMITS.checkpoint_interval - 1,
    );
    mutableHooks.availableBytesOverride = 0n;
    await expectUnavailable(profile.store.append(thresholdEvent, candidateDigest(thresholdEvent)));
    await assert.rejects(lstat(commitPath(root, REPOSITORY_LOCAL_LIMITS.checkpoint_interval - 1)), {
      code: "ENOENT",
    });
    assert.deepEqual(await readdir(runtime(root, "primary", "checkpoints")), []);
    await profile.close();

    const resumed = await openProfile(root, {
      now: () => new Date(FIXED_LATER),
    });
    await resumed.store.append(thresholdEvent, candidateDigest(thresholdEvent));
    const files = await readdir(runtime(root, "primary", "checkpoints"));
    assert.equal(files.length, 1);
    const checkpoint = validateRepositoryLocalCheckpointRecord(
      parseCanonicalRepositoryLocalBytes(
        await readFile(runtime(root, "primary", "checkpoints", files[0]!)),
      ),
    );
    assert.equal(checkpoint.range_start, 0);
    assert.equal(checkpoint.range_end, 999);
    assert.equal(checkpoint.event_count, 1_000);
    await resumed.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publication is atomic no-replace and never overwrites a destination", async () => {
  const root = await repositoryRoot("repository-local-no-replace-");
  let injectConflict = false;
  try {
    const profile = await openProfile(root, {
      hooks: {
        onEvent: async (event) => {
          if (injectConflict && event === "primary_record.before_temp_create") {
            injectConflict = false;
            await writeFile(commitPath(root, 0), "sentinel", {
              mode: 0o600,
              flag: "wx",
            });
          }
        },
      },
    });
    injectConflict = true;
    const event = protectedGenesisEvent();
    await expectUnavailable(profile.store.append(event, candidateDigest(event)));
    assert.equal(await readFile(commitPath(root, 0), "utf8"), "sentinel");
    assert.equal(profile.diagnostic().state, "failed");
    await profile.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persistent lock, paths, links, ownership, modes, and filesystem support fail closed", async (t) => {
  await t.test("stale lock is retained and never auto-stolen", async () => {
    const root = await repositoryRoot("repository-local-stale-lock-");
    try {
      await initialize(root);
      const lockPath = runtime(root, "writer.lock");
      await writeFile(lockPath, "stale-lock", { mode: 0o600, flag: "wx" });
      await expectUnavailable(openProfile(root));
      assert.equal(await readFile(lockPath, "utf8"), "stale-lock");
      await unlink(lockPath);
      const recovered = await openProfile(root);
      await recovered.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("non-canonical and traversal roots are rejected", async () => {
    const root = await repositoryRoot("repository-local-path-");
    try {
      const nonCanonical = `${root}${path.sep}..${path.sep}${path.basename(root)}`;
      await expectUnavailable(openProfile(nonCanonical));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("repository roots inside .git are rejected", async () => {
    const outer = await repositoryRoot("repository-local-git-root-");
    try {
      const gitRoot = path.join(outer, ".git");
      await mkdir(gitRoot, { mode: 0o700 });
      await expectUnavailable(openProfile(gitRoot));
    } finally {
      await rm(outer, { recursive: true, force: true });
    }
  });

  await t.test("symlink roots and runtime components are rejected", async () => {
    const root = await repositoryRoot("repository-local-symlink-");
    const alias = `${root}-alias`;
    const target = `${root}-runtime-target`;
    try {
      await symlink(root, alias);
      await expectUnavailable(openProfile(alias));
      await mkdir(path.join(root, ".yukh"), { mode: 0o700 });
      await mkdir(target, { mode: 0o700 });
      await symlink(target, path.join(root, ".yukh", "runtime"));
      await expectUnavailable(openProfile(root));
    } finally {
      await rm(alias, { force: true });
      await rm(target, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("unsafe directory and file modes are rejected", async () => {
    const root = await repositoryRoot("repository-local-modes-");
    try {
      await initialize(root);
      await chmod(runtime(root), 0o755);
      await expectUnavailable(openProfile(root));
      await chmod(runtime(root), 0o700);
      const profile = await openProfile(root);
      const event = protectedGenesisEvent();
      await profile.store.append(event, candidateDigest(event));
      await profile.close();
      await chmod(commitPath(root, 0), 0o644);
      await expectUnavailable(openProfile(root));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("hard-linked committed files are rejected", async () => {
    const root = await repositoryRoot("repository-local-hardlink-");
    const hardLink = `${root}-profile-link`;
    try {
      await initialize(root);
      await link(runtime(root, "profile.json"), hardLink);
      await expectUnavailable(openProfile(root));
      assert.equal((await lstat(hardLink)).nlink, 2);
    } finally {
      await rm(hardLink, { force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("simulated wrong ownership is rejected", async () => {
    const root = await repositoryRoot("repository-local-owner-");
    try {
      await expectUnavailable(
        openProfile(root, {
          hooks: {
            metadataOverride: (_label, metadata) => ({
              ...metadata,
              owner: metadata.owner + 1,
            }),
          },
        }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("APFS fails closed for direct and inherited ACL state", async () => {
    const cleanRoot = await repositoryRoot("repository-local-apfs-clean-");
    try {
      await expectUnavailable(
        openProfile(cleanRoot, {
          hooks: { filesystemKindOverride: "apfs" },
        }),
      );
    } finally {
      await rm(cleanRoot, { recursive: true, force: true });
    }
    if (process.platform !== "darwin") return;

    for (const kind of ["direct", "inherited"] as const) {
      const root = await repositoryRoot(`repository-local-apfs-acl-${kind}-`);
      try {
        if (kind === "direct") {
          await initialize(root);
          const target = runtime(root);
          const added = spawnSync(
            "/bin/chmod",
            ["+a", "everyone allow write,delete_child,file_inherit,directory_inherit", target],
            { encoding: "utf8" },
          );
          assert.equal(added.error, undefined);
          assert.equal(added.status, 0, added.stderr);
          assert.equal(added.stdout, "");
          const listed = spawnSync("/bin/ls", ["-lde", target], { encoding: "utf8" });
          assert.equal(listed.error, undefined);
          assert.equal(listed.status, 0, listed.stderr);
          assert.equal(listed.stderr, "");
          assert.match(listed.stdout, /everyone allow .*delete_child/);
        } else {
          const added = spawnSync(
            "/bin/chmod",
            ["+a", "everyone allow write,delete_child,file_inherit,directory_inherit", root],
            { encoding: "utf8" },
          );
          assert.equal(added.error, undefined);
          assert.equal(added.status, 0, added.stderr);
          assert.equal(added.stdout, "");
        }

        await expectUnavailable(
          openProfile(root, {
            hooks: { filesystemKindOverride: "apfs" },
          }),
        );
        if (kind === "inherited") {
          const listed = spawnSync("/bin/ls", ["-lde", runtime(root)], { encoding: "utf8" });
          assert.equal(listed.error, undefined);
          assert.equal(listed.status, 0, listed.stderr);
          assert.equal(listed.stderr, "");
          assert.match(listed.stdout, /everyone inherited allow .*delete_child/);
        }
      } finally {
        const cleared = spawnSync("/bin/chmod", ["-RN", root], { encoding: "utf8" });
        assert.equal(cleared.error, undefined);
        assert.equal(cleared.status, 0, cleared.stderr);
        assert.equal(cleared.stdout, "");
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  await t.test("unsupported filesystems are rejected before readiness", async () => {
    const root = await repositoryRoot("repository-local-unsupported-fs-");
    try {
      await expectUnavailable(
        openProfile(root, {
          hooks: { filesystemKindOverride: "unsupported" },
        }),
      );
      const qualified = await openProfile(root);
      await qualified.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("directory enumeration aborts at its caller bound", async () => {
    const root = await repositoryRoot("repository-local-directory-bound-");
    try {
      await writeFile(path.join(root, "first"), "x", { mode: 0o600 });
      await writeFile(path.join(root, "second"), "x", { mode: 0o600 });
      await assert.rejects(
        listRepositoryLocalDirectory(root, (await lstat(root)).dev, 1),
        (error: unknown) =>
          error instanceof RepositoryLocalFilesystemError && error.reason === "corruption_detected",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("corruption, gaps, substitution, stale facts, and unknown state fail without repair", async (t) => {
  await t.test("non-canonical profile bytes", async () => {
    const root = await repositoryRoot("repository-local-noncanonical-");
    try {
      await initialize(root);
      const profilePath = runtime(root, "profile.json");
      const parsed = validateRepositoryLocalProfileRecord(
        parseCanonicalRepositoryLocalBytes(await readFile(profilePath)),
      );
      await writeFile(profilePath, JSON.stringify(parsed, null, 2), { mode: 0o600 });
      await expectUnavailable(openProfile(root));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("truncated and oversized commits", async () => {
    for (const kind of ["truncated", "oversized"] as const) {
      const root = await repositoryRoot(`repository-local-${kind}-`);
      try {
        const profile = await openProfile(root);
        const event = protectedGenesisEvent();
        await profile.store.append(event, candidateDigest(event));
        await profile.close();
        const file = commitPath(root, 0);
        const original = await readFile(file);
        await writeFile(
          file,
          kind === "truncated"
            ? original.subarray(0, Math.floor(original.length / 2))
            : Buffer.alloc(REPOSITORY_LOCAL_LIMITS.max_primary_commit_record_bytes + 1, 0x61),
          { mode: 0o600 },
        );
        await expectUnavailable(openProfile(root));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  await t.test("identity completion requires a validated final record", async () => {
    for (const kind of ["primary", "recovery"] as const) {
      const root = await repositoryRoot(`repository-local-validated-${kind}-`);
      let failAt: RepositoryLocalFilesystemEvent | undefined;
      try {
        const profile = await openProfile(root, {
          hooks: {
            onEvent: (event) => {
              if (event === failAt) {
                throw Object.assign(new Error("simulated ambiguous publication"), {
                  code: "EIO",
                });
              }
            },
          },
        });
        if (kind === "primary") {
          const event = protectedGenesisEvent();
          failAt = "primary_record.before_directory_sync";
          await expectUnavailable(profile.store.append(event, candidateDigest(event)));
          await profile.close();
          await writeFile(commitPath(root, 0), "not-canonical", { mode: 0o600 });
          const identity = primaryIdentityPath(root, event.event_id);
          await expectUnavailable(openProfile(root));
          await assert.rejects(lstat(identity), { code: "ENOENT" });
        } else {
          const fact = recoveryFact();
          failAt = "recovery_record.before_directory_sync";
          await expectUnavailable(profile.journal.append(fact));
          await profile.close();
          const digest = repositoryLocalReferencePathDigest(fact.recovery_id);
          const pendingPath = runtime(root, "recovery", "pending", `${digest}.json`);
          const identity = runtime(root, "recovery", "identities", digest, "00000000.json");
          await writeFile(pendingPath, "not-canonical", { mode: 0o600 });
          await expectUnavailable(openProfile(root));
          await assert.rejects(lstat(identity), { code: "ENOENT" });
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  await t.test("all identity temporaries validate before any identity completion", async () => {
    for (const kind of ["primary", "recovery"] as const) {
      const root = await repositoryRoot(`repository-local-global-temp-${kind}-`);
      const externalLink = `${root}-identity-link`;
      try {
        const profile = await openProfile(root);
        let missingIdentity: string;
        let laterIdentity: string;
        let recordDigest: string;
        if (kind === "primary") {
          const [first, second] = await appendPrimaryChain(profile);
          await profile.close();
          missingIdentity = primaryIdentityPath(root, first.event_id);
          laterIdentity = primaryIdentityPath(root, second.event_id);
          const parsed = JSON.parse(await readFile(laterIdentity, "utf8")) as Readonly<{
            primary_identity_record_digest: string;
          }>;
          recordDigest = parsed.primary_identity_record_digest;
        } else {
          const first = recoveryFact(0);
          const second = recoveryFact(1);
          await profile.journal.append(first);
          await profile.journal.append(second);
          await profile.close();
          missingIdentity = runtime(
            root,
            "recovery",
            "identities",
            repositoryLocalReferencePathDigest(first.recovery_id),
            "00000000.json",
          );
          laterIdentity = runtime(
            root,
            "recovery",
            "identities",
            repositoryLocalReferencePathDigest(second.recovery_id),
            "00000000.json",
          );
          const parsed = JSON.parse(await readFile(laterIdentity, "utf8")) as Readonly<{
            recovery_identity_record_digest: string;
          }>;
          recordDigest = parsed.recovery_identity_record_digest;
        }
        await unlink(missingIdentity);
        await link(laterIdentity, externalLink);
        const temporary = path.join(
          path.dirname(laterIdentity),
          `.00000000.json.${recordDigest.slice("sha256:".length)}.tmp`,
        );
        await writeFile(temporary, "x", { mode: 0o600, flag: "wx" });
        await expectUnavailable(openProfile(root));
        await assert.rejects(lstat(missingIdentity), { code: "ENOENT" });
      } finally {
        await rm(externalLink, { force: true });
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  await t.test("missing and reordered sequence records", async () => {
    for (const kind of ["missing", "reordered"] as const) {
      const root = await repositoryRoot(`repository-local-${kind}-sequence-`);
      try {
        const profile = await openProfile(root);
        const [, request] = await appendPrimaryChain(profile);
        await profile.close();
        if (kind === "missing") {
          await unlink(commitPath(root, 0));
          await unlink(primaryIdentityPath(root, request.event_id));
        } else {
          await rename(commitPath(root, 1), commitPath(root, 2));
        }
        await expectUnavailable(openProfile(root));
        if (kind === "missing") {
          await assert.rejects(lstat(primaryIdentityPath(root, request.event_id)), {
            code: "ENOENT",
          });
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  await t.test("symlink substitution is rejected without following", async () => {
    const root = await repositoryRoot("repository-local-record-symlink-");
    const target = `${root}-commit-copy`;
    try {
      const profile = await openProfile(root);
      const event = protectedGenesisEvent();
      await profile.store.append(event, candidateDigest(event));
      await profile.close();
      const file = commitPath(root, 0);
      await copyFile(file, target);
      await unlink(file);
      await symlink(target, file);
      await expectUnavailable(openProfile(root));
    } finally {
      await rm(target, { force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("mismatched identity and orphan identity are retained", async () => {
    for (const kind of ["mismatch", "orphan"] as const) {
      const root = await repositoryRoot(`repository-local-identity-${kind}-`);
      try {
        const profile = await openProfile(root);
        const event = protectedGenesisEvent();
        await profile.store.append(event, candidateDigest(event));
        await profile.close();
        const identityPath = primaryIdentityPath(root, event.event_id);
        if (kind === "mismatch") {
          const identity = JSON.parse(await readFile(identityPath, "utf8")) as Record<
            string,
            unknown
          >;
          identity.candidate_digest = `sha256:${"9".repeat(64)}`;
          await writeFile(identityPath, canonicalAuditJson(identity), { mode: 0o600 });
        } else {
          await unlink(commitPath(root, 0));
        }
        await expectUnavailable(openProfile(root));
        assert.equal((await lstat(identityPath)).isFile(), true);
        await expectUnavailable(openProfile(root));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  await t.test("invalid checkpoint and stale pending fact", async () => {
    const checkpointRoot = await repositoryRoot("repository-local-bad-checkpoint-");
    const staleRoot = await repositoryRoot("repository-local-stale-fact-");
    try {
      const profile = await openProfile(checkpointRoot);
      const event = protectedGenesisEvent();
      await profile.store.append(event, candidateDigest(event));
      await profile.close();
      const checkpointName = (await readdir(runtime(checkpointRoot, "primary", "checkpoints")))[0]!;
      const checkpointPath = runtime(checkpointRoot, "primary", "checkpoints", checkpointName);
      const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8")) as Record<
        string,
        unknown
      >;
      checkpoint.limitation = "independently_witnessed";
      await writeFile(checkpointPath, canonicalAuditJson(checkpoint), { mode: 0o600 });
      await expectUnavailable(openProfile(checkpointRoot));

      const stale = await openProfile(staleRoot);
      await stale.journal.append(recoveryFact());
      await stale.close();
      await expectUnavailable(
        openProfile(staleRoot, {
          now: () => new Date("2026-09-07T12:00:01.000Z"),
        }),
      );
    } finally {
      await rm(checkpointRoot, { recursive: true, force: true });
      await rm(staleRoot, { recursive: true, force: true });
    }
  });

  await t.test("unknown topology entries", async () => {
    const root = await repositoryRoot("repository-local-unknown-");
    try {
      await initialize(root);
      await writeFile(runtime(root, "unknown.json"), "{}", { mode: 0o600 });
      await expectUnavailable(openProfile(root));
      assert.equal(await readFile(runtime(root, "unknown.json"), "utf8"), "{}");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("missing closed-topology directories are not recreated", async () => {
    const root = await repositoryRoot("repository-local-missing-topology-");
    try {
      await initialize(root);
      const missing = runtime(root, "recovery", "quarantine");
      await rm(missing, { recursive: true });
      await expectUnavailable(openProfile(root));
      await assert.rejects(lstat(missing), { code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("multiple impossible transaction temporaries are retained", async () => {
    const root = await repositoryRoot("repository-local-multiple-temporaries-");
    try {
      await initialize(root);
      const directory = runtime(root, "primary", "checkpoints");
      const names = ["a", "b"].map((value) => `.${value.repeat(64)}.json.${value.repeat(64)}.tmp`);
      for (const name of names) {
        await writeFile(path.join(directory, name), "x", {
          mode: 0o600,
          flag: "wx",
        });
      }
      await expectUnavailable(openProfile(root));
      assert.deepEqual((await readdir(directory)).sort(), names);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("simulated I/O, disk-full, and free-space failures are closed and restart-safe", async (t) => {
  await t.test("disk-full during a temporary write preserves no commit", async () => {
    const root = await repositoryRoot("repository-local-enospc-");
    let failure: RepositoryLocalFilesystemEvent | undefined;
    try {
      const profile = await openProfile(root, {
        hooks: {
          onEvent: (event) => {
            if (event === failure) {
              throw Object.assign(new Error("sensitive disk error"), {
                code: "ENOSPC",
              });
            }
          },
        },
      });
      failure = "primary_record.during_temp_write";
      const event = protectedGenesisEvent();
      await expectUnavailable(profile.store.append(event, candidateDigest(event)));
      assert.equal(profile.diagnostic().state, "failed");
      assert.equal(profile.diagnostic().reason, "capacity_exhausted");
      assert.equal(JSON.stringify(profile.diagnostic()).includes("sensitive disk error"), false);
      await profile.close();

      const restarted = await openProfile(root, {
        now: () => new Date(FIXED_LATER),
      });
      assert.equal(await restarted.store.findById(event.event_id), undefined);
      await restarted.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("ambiguous I/O after publication completes only on restart", async () => {
    const root = await repositoryRoot("repository-local-eio-");
    let failure: RepositoryLocalFilesystemEvent | undefined;
    try {
      const profile = await openProfile(root, {
        hooks: {
          onEvent: (event) => {
            if (event === failure) {
              throw Object.assign(new Error("sensitive io error"), { code: "EIO" });
            }
          },
        },
      });
      failure = "primary_record.before_directory_sync";
      const event = protectedGenesisEvent();
      await expectUnavailable(profile.store.append(event, candidateDigest(event)));
      assert.equal(profile.diagnostic().reason, "io_ambiguous");
      await profile.close();

      const restarted = await openProfile(root, {
        now: () => new Date(FIXED_LATER),
      });
      assert.deepEqual((await restarted.store.findById(event.event_id))?.event, event);
      assert.equal((await restarted.store.append(event, candidateDigest(event))).duplicate, true);
      await restarted.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("insufficient free space denies before record creation", async () => {
    const root = await repositoryRoot("repository-local-free-space-");
    try {
      const profile = await openProfile(root, {
        hooks: {
          availableBytesOverride: BigInt(
            2 *
              (REPOSITORY_LOCAL_LIMITS.max_primary_commit_record_bytes +
                REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes),
          ),
        },
      });
      assert.equal(profile.diagnostic().state, "failed");
      assert.equal(profile.diagnostic().reason, "capacity_exhausted");
      const event = protectedGenesisEvent();
      await expectUnavailable(profile.store.append(event, candidateDigest(event)));
      assert.equal(profile.diagnostic().reason, "capacity_exhausted");
      assert.deepEqual(
        await readdir(path.join(streamDirectory(root), "commits")).catch(() => []),
        [],
      );
      await profile.close();

      const healthy = await openProfile(root);
      await healthy.store.append(event, candidateDigest(event));
      await healthy.close();
      const constrained = await openProfile(root, {
        hooks: {
          availableBytesOverride: BigInt(
            2 *
              (REPOSITORY_LOCAL_LIMITS.max_primary_commit_record_bytes +
                REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes),
          ),
        },
      });
      assert.equal(constrained.diagnostic().state, "failed");
      assert.deepEqual((await constrained.store.findById(event.event_id))?.event, event);
      assert.equal((await constrained.store.append(event, candidateDigest(event))).duplicate, true);
      const next = protectedRequestEvent(event);
      await expectUnavailable(constrained.store.append(next, candidateDigest(next)));
      await constrained.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("recovery disk-full preserves no pending fact", async () => {
    const root = await repositoryRoot("repository-local-recovery-enospc-");
    let failure: RepositoryLocalFilesystemEvent | undefined;
    try {
      const profile = await openProfile(root, {
        hooks: {
          onEvent: (event) => {
            if (event === failure) {
              throw Object.assign(new Error("sensitive recovery disk error"), {
                code: "ENOSPC",
              });
            }
          },
        },
      });
      failure = "recovery_record.during_temp_write";
      const fact = recoveryFact();
      await expectUnavailable(profile.journal.append(fact));
      assert.equal(profile.diagnostic().state, "failed");
      assert.equal(profile.diagnostic().reason, "capacity_exhausted");
      assert.equal(
        JSON.stringify(profile.diagnostic()).includes("sensitive recovery disk error"),
        false,
      );
      await profile.close();

      const restarted = await openProfile(root, {
        now: () => new Date(FIXED_LATER),
      });
      const pending = [];
      for await (const recovered of restarted.pendingFacts()) pending.push(recovered);
      assert.deepEqual(pending, []);
      await restarted.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("ambiguous recovery I/O completes only on restart", async () => {
    const root = await repositoryRoot("repository-local-recovery-eio-");
    let failure: RepositoryLocalFilesystemEvent | undefined;
    try {
      const profile = await openProfile(root, {
        hooks: {
          onEvent: (event) => {
            if (event === failure) {
              throw Object.assign(new Error("sensitive recovery io error"), {
                code: "EIO",
              });
            }
          },
        },
      });
      failure = "recovery_record.before_directory_sync";
      const fact = recoveryFact();
      await expectUnavailable(profile.journal.append(fact));
      assert.equal(profile.diagnostic().reason, "io_ambiguous");
      await profile.close();

      const restarted = await openProfile(root, {
        now: () => new Date(FIXED_LATER),
      });
      const pending = [];
      for await (const recovered of restarted.pendingFacts()) pending.push(recovered);
      assert.deepEqual(pending, [fact]);
      assert.deepEqual(await restarted.journal.append(fact), {
        durability: "durable",
      });
      await restarted.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test("insufficient free space denies recovery before record creation", async () => {
    const root = await repositoryRoot("repository-local-recovery-free-space-");
    try {
      const recoveryRequiredFree =
        2 *
        (REPOSITORY_LOCAL_LIMITS.max_recovery_record_bytes +
          REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes);
      const startupRequiredFree =
        2 *
        (REPOSITORY_LOCAL_LIMITS.max_primary_commit_record_bytes +
          REPOSITORY_LOCAL_LIMITS.max_identity_record_bytes +
          REPOSITORY_LOCAL_LIMITS.max_checkpoint_record_bytes);
      const options = profileOptions(root, {
        hooks: {
          availableBytesOverride: BigInt(startupRequiredFree),
        },
      });
      const profile = await openRepositoryLocalAuditProfileForQualification(options);
      assert.equal(profile.diagnostic().state, "healthy");
      options.filesystemHooks.availableBytesOverride = BigInt(recoveryRequiredFree - 1);
      const fact = recoveryFact();
      await expectUnavailable(profile.journal.append(fact));
      assert.equal(profile.diagnostic().state, "failed");
      assert.equal(profile.diagnostic().reason, "capacity_exhausted");
      assert.deepEqual(await readdir(runtime(root, "recovery", "pending")), []);
      await profile.close();

      const restarted = await openProfile(root);
      await restarted.journal.append(fact);
      await restarted.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("511/512/513 recovery capacity uses the full 16 KiB lifetime reservation", async () => {
  const root = await repositoryRoot("repository-local-capacity-");
  try {
    const profile = await openProfile(root);
    for (let index = 0; index < 511; index += 1) {
      await profile.journal.append(recoveryFact(index));
    }
    assert.equal(profile.diagnostic().counts.recovery_identities, 511);
    assert.equal(profile.diagnostic().state, "degraded");
    assert.equal(profile.diagnostic().capacity.recovery_bytes, "degraded");
    await profile.readiness.assertReadyForProviderStart();

    const boundary = recoveryFact(511);
    assert.deepEqual(await profile.journal.append(boundary), {
      durability: "durable",
    });
    assert.equal(profile.diagnostic().counts.recovery_identities, 512);
    assert.equal(profile.diagnostic().state, "failed");
    assert.equal(profile.diagnostic().reason, "capacity_exhausted");
    assert.equal(profile.diagnostic().capacity.recovery_bytes, "exhausted");
    await expectUnavailable(profile.readiness.assertReadyForProviderStart());
    assert.deepEqual(await profile.journal.append(boundary), {
      durability: "durable",
    });
    await expectUnavailable(profile.journal.append(recoveryFact(512)));

    let replayCount = 0;
    for await (const _fact of profile.pendingFacts()) replayCount += 1;
    assert.equal(replayCount, 512);
    await profile.close();

    const restarted = await openProfile(root, {
      now: () => new Date(FIXED_LATER),
    });
    assert.equal(restarted.diagnostic().state, "failed");
    assert.equal(restarted.diagnostic().reason, "capacity_exhausted");
    await expectUnavailable(restarted.readiness.assertReadyForProviderStart());
    assert.deepEqual(await restarted.journal.append(boundary), {
      durability: "durable",
    });
    await expectUnavailable(restarted.journal.append(recoveryFact(512)));
    await restarted.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pending iterator enforces its injected 30-second bound without acknowledgement", async () => {
  const root = await repositoryRoot("repository-local-iterator-bound-");
  let monotonic = 0;
  try {
    const profile = await openProfile(root, {
      monotonicNow: () => monotonic,
    });
    const fact = recoveryFact();
    await profile.journal.append(fact);
    const iterator = profile.pendingFacts()[Symbol.asyncIterator]();
    assert.deepEqual(await iterator.next(), { done: false, value: fact });
    monotonic = 30_001;
    await assert.rejects(
      iterator.next(),
      (error: unknown) => error instanceof AuditError && error.code === "audit_unavailable",
    );
    assert.equal(profile.diagnostic().reason, "pending_read_bound");
    await expectUnavailable(profile.journal.append(fact));
    assert.deepEqual(await readdir(runtime(root, "recovery", "acknowledged")), []);
    await profile.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adapter has no network/provider surface and performs zero network calls", async () => {
  const root = await repositoryRoot("repository-local-network-free-");
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("network must remain unreachable");
  }) as typeof fetch;
  try {
    const profile = await openProfile(root, {
      hooks: { availableBytesOverride: 0n },
    });
    const event = protectedGenesisEvent();
    await expectUnavailable(profile.store.append(event, candidateDigest(event)));
    await profile.close();
    assert.equal(fetchCalls, 0);

    const source = await readFile(
      path.join(process.cwd(), "packages", "audit", "src", "repository-local.ts"),
      "utf8",
    );
    assert.equal(/from ["']node:(?:http|https|net|tls|dns)["']|fetch\s*\(/.test(source), false);
    assert.equal(source.includes("provider"), false);
    assert.equal("acknowledge" in profile, false);
    assert.equal("retain" in profile, false);
    assert.equal("export" in profile, false);
    assert.equal(createHash("sha256").update(source).digest("hex").length, 64);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test("repository-local runtime state is ignored without hiding tracked project config", async () => {
  const ignore = await readFile(path.join(process.cwd(), ".gitignore"), "utf8");
  assert.match(ignore, /^\.yukh\/runtime\/$/m);
  assert.equal(ignore.includes(".yukh/\n"), false);
});
