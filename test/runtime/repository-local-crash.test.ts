import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, realpath, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AuditError } from "../../packages/audit/src/contract.js";
import { openRepositoryLocalAuditProfileForQualification } from "../../packages/audit/src/repository-local.js";
import type { RepositoryLocalFilesystemEvent } from "../../packages/audit/src/repository-local-filesystem.js";
import {
  FIXED_LATER,
  FIXED_NOW,
  WRITER_REF,
  candidateDigest,
  protectedGenesisEvent,
  recoveryFact,
} from "./repository-local-test-fixtures.js";

const childPath = fileURLToPath(
  new URL("./fixtures/repository-local-crash-child.ts", import.meta.url),
);
const lockRelativePath = path.join(".yukh", "runtime", "audit-v1", "writer.lock");
const PRIMARY_BOUNDARIES = [
  "primary_record.before_temp_create",
  "primary_record.during_temp_write",
  "primary_record.after_temp_sync",
  "primary_record.after_link",
  "primary_record.after_publish",
  "primary_record.before_directory_sync",
  "primary_record.after_directory_sync",
  "primary_identity.during_temp_write",
  "primary_identity.after_link",
  "primary_identity.after_publish",
  "primary_identity.before_directory_sync",
  "primary_identity.after_directory_sync",
] as const;
const RECOVERY_BOUNDARIES = [
  "recovery_record.before_temp_create",
  "recovery_record.during_temp_write",
  "recovery_record.after_temp_sync",
  "recovery_record.after_link",
  "recovery_record.after_publish",
  "recovery_record.before_directory_sync",
  "recovery_record.after_directory_sync",
  "recovery_identity.during_temp_write",
  "recovery_identity.after_link",
  "recovery_identity.after_publish",
  "recovery_identity.before_directory_sync",
  "recovery_identity.after_directory_sync",
] as const;
const DIRECTORY_BOUNDARIES = [
  "directory.after_create",
  "directory.after_self_sync",
  "directory.after_parent_sync",
] as const;
const PRIMARY_DIRECTORY_NAMES = ["stream", "commits", "identity"] as const;

async function repositoryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  await chmod(root, 0o700);
  return realpath(root);
}

function options(root: string, later = false) {
  return {
    trustedRepositoryRoot: root,
    writerRef: WRITER_REF,
    now: () => new Date(later ? FIXED_LATER : FIXED_NOW),
    filesystemHooks: { filesystemKindOverride: "ext" as const },
  };
}

async function initialize(root: string): Promise<void> {
  const profile = await openRepositoryLocalAuditProfileForQualification(options(root));
  await profile.close();
}

function crashChild(
  mode: "primary" | "recovery",
  root: string,
  boundary: string,
  occurrence = 1,
): void {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", childPath, mode, root, boundary, occurrence.toString()],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      timeout: 30_000,
    },
  );
  assert.equal(
    result.status,
    86,
    `child did not crash at ${boundary}: stdout=${result.stdout} stderr=${result.stderr}`,
  );
  assert.equal(result.signal, null);
}

async function assertPersistentLockThenRemove(root: string): Promise<void> {
  await assert.rejects(
    openRepositoryLocalAuditProfileForQualification(options(root, true)),
    (error: unknown) => error instanceof AuditError && error.code === "audit_unavailable",
  );
  await unlink(path.join(root, lockRelativePath));
}

test("real child-process primary crashes converge at every RFC append boundary", async (t) => {
  for (const boundary of PRIMARY_BOUNDARIES) {
    await t.test(boundary, async () => {
      const root = await repositoryRoot("repository-local-primary-crash-");
      try {
        await initialize(root);
        crashChild("primary", root, boundary);
        await assertPersistentLockThenRemove(root);

        const profile = await openRepositoryLocalAuditProfileForQualification(options(root, true));
        const event = protectedGenesisEvent();
        const committedBeforeCrash =
          boundary !== "primary_record.before_temp_create" &&
          boundary !== "primary_record.during_temp_write" &&
          boundary !== "primary_record.after_temp_sync";
        assert.equal(
          (await profile.store.findById(event.event_id)) !== undefined,
          committedBeforeCrash,
        );
        const receipt = await profile.store.append(event, candidateDigest(event));
        assert.equal(receipt.duplicate, committedBeforeCrash);
        assert.deepEqual(receipt.event, event);
        await profile.close();

        const repeated = await openRepositoryLocalAuditProfileForQualification(options(root, true));
        assert.deepEqual((await repeated.store.findById(event.event_id))?.event, event);
        assert.equal((await repeated.store.append(event, candidateDigest(event))).duplicate, true);
        await repeated.close();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("real child-process recovery crashes converge at every RFC append boundary", async (t) => {
  for (const boundary of RECOVERY_BOUNDARIES) {
    await t.test(boundary, async () => {
      const root = await repositoryRoot("repository-local-recovery-crash-");
      try {
        await initialize(root);
        crashChild("recovery", root, boundary);
        await assertPersistentLockThenRemove(root);

        const profile = await openRepositoryLocalAuditProfileForQualification(options(root, true));
        const committedBeforeCrash =
          boundary !== "recovery_record.before_temp_create" &&
          boundary !== "recovery_record.during_temp_write" &&
          boundary !== "recovery_record.after_temp_sync";
        const before: string[] = [];
        for await (const fact of profile.pendingFacts()) before.push(fact.recovery_id);
        assert.deepEqual(before, committedBeforeCrash ? [recoveryFact().recovery_id] : []);
        assert.deepEqual(await profile.journal.append(recoveryFact()), {
          durability: "durable",
        });
        const after: string[] = [];
        for await (const fact of profile.pendingFacts()) after.push(fact.recovery_id);
        assert.deepEqual(after, [recoveryFact().recovery_id]);
        await profile.close();

        const repeated = await openRepositoryLocalAuditProfileForQualification(options(root, true));
        await assert.rejects(
          repeated.journal.append(
            recoveryFact(0, {
              recoveryId: recoveryFact().recovery_id,
              eventId: "event.recovery-conflict-after-restart",
            }),
          ),
          (error: unknown) =>
            error instanceof AuditError && error.code === "audit_duplicate_conflict",
        );
        assert.equal(repeated.diagnostic().state, "failed");
        await repeated.close();

        const replay = await openRepositoryLocalAuditProfileForQualification(options(root, true));
        const replayed: string[] = [];
        for await (const fact of replay.pendingFacts()) {
          replayed.push(fact.recovery_id);
        }
        assert.deepEqual(replayed, [recoveryFact().recovery_id]);
        await replay.close();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("real child crashes prove every new primary directory link is durable first", async (t) => {
  for (const boundary of DIRECTORY_BOUNDARIES) {
    for (const [index, directoryName] of PRIMARY_DIRECTORY_NAMES.entries()) {
      await t.test(`${directoryName}:${boundary}`, async () => {
        const root = await repositoryRoot("repository-local-primary-directory-crash-");
        try {
          await initialize(root);
          crashChild("primary", root, boundary, index + 1);
          await assertPersistentLockThenRemove(root);
          const profile = await openRepositoryLocalAuditProfileForQualification(
            options(root, true),
          );
          const event = protectedGenesisEvent();
          assert.equal(await profile.store.findById(event.event_id), undefined);
          assert.equal(
            (await profile.store.append(event, candidateDigest(event))).duplicate,
            false,
          );
          await profile.close();
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }
});

test("real child crashes prove the recovery identity directory is durable first", async (t) => {
  for (const boundary of DIRECTORY_BOUNDARIES) {
    await t.test(boundary, async () => {
      const root = await repositoryRoot("repository-local-recovery-directory-crash-");
      try {
        await initialize(root);
        crashChild("recovery", root, boundary);
        await assertPersistentLockThenRemove(root);
        const profile = await openRepositoryLocalAuditProfileForQualification(options(root, true));
        const pending: string[] = [];
        for await (const fact of profile.pendingFacts()) pending.push(fact.recovery_id);
        assert.deepEqual(pending, []);
        assert.deepEqual(await profile.journal.append(recoveryFact()), {
          durability: "durable",
        });
        await profile.close();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("record publication and directory sync precede all identity writes", async () => {
  const root = await repositoryRoot("repository-local-ordering-");
  try {
    const events: RepositoryLocalFilesystemEvent[] = [];
    const profile = await openRepositoryLocalAuditProfileForQualification({
      ...options(root),
      filesystemHooks: {
        filesystemKindOverride: "ext",
        onEvent: (event) => {
          events.push(event);
        },
      },
    });

    events.length = 0;
    const event = protectedGenesisEvent();
    await profile.store.append(event, candidateDigest(event));
    const recordWrite = events.indexOf("primary_record.before_temp_create");
    const recordPublish = events.indexOf("primary_record.after_publish");
    const recordSync = events.indexOf("primary_record.after_directory_sync");
    const identityWrite = events.indexOf("primary_identity.before_temp_create");
    assert(recordWrite >= 0);
    assert(recordPublish > recordWrite);
    assert(recordSync > recordPublish);
    assert(identityWrite > recordSync);
    assert(events.slice(0, recordWrite).lastIndexOf("directory.after_parent_sync") >= 0);

    events.length = 0;
    await profile.journal.append(recoveryFact());
    const pendingWrite = events.indexOf("recovery_record.before_temp_create");
    const pendingPublish = events.indexOf("recovery_record.after_publish");
    const pendingSync = events.indexOf("recovery_record.after_directory_sync");
    const recoveryIdentityWrite = events.indexOf("recovery_identity.before_temp_create");
    assert(pendingWrite >= 0);
    assert(pendingPublish > pendingWrite);
    assert(pendingSync > pendingPublish);
    assert(recoveryIdentityWrite > pendingSync);
    assert(events.slice(0, pendingWrite).lastIndexOf("directory.after_parent_sync") >= 0);
    await profile.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a second real process cannot acquire the live create-exclusive lock", async () => {
  const root = await repositoryRoot("repository-local-lock-contention-");
  try {
    const profile = await openRepositoryLocalAuditProfileForQualification(options(root));
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", childPath, "expect-lock", root],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: process.env,
        timeout: 30_000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    await profile.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
