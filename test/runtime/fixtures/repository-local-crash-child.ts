import { AuditError } from "../../../packages/audit/src/contract.js";
import { openRepositoryLocalAuditProfileForQualification } from "../../../packages/audit/src/repository-local.js";
import {
  FIXED_NOW,
  WRITER_REF,
  candidateDigest,
  protectedGenesisEvent,
  recoveryFact,
} from "../repository-local-test-fixtures.js";
import { writeCrashProtocolEvent } from "./crash-protocol.js";

const [, , mode, repositoryRoot, crashEvent, crashOccurrenceValue] = process.argv;
if (
  repositoryRoot === undefined ||
  (mode !== "primary" && mode !== "recovery" && mode !== "expect-lock")
) {
  process.exit(64);
}

if (mode === "expect-lock") {
  try {
    const profile = await openRepositoryLocalAuditProfileForQualification({
      trustedRepositoryRoot: repositoryRoot,
      writerRef: WRITER_REF,
      now: () => new Date(FIXED_NOW),
      filesystemHooks: { filesystemKindOverride: "ext" },
    });
    await profile.close();
    process.exit(65);
  } catch (error: unknown) {
    process.exit(error instanceof AuditError && error.code === "audit_unavailable" ? 0 : 66);
  }
}

if (crashEvent === undefined) process.exit(67);
const crashOccurrence = crashOccurrenceValue === undefined ? 1 : Number(crashOccurrenceValue);
if (!Number.isSafeInteger(crashOccurrence) || crashOccurrence < 1) process.exit(69);
let armed = false;
let occurrence = 0;
const profile = await openRepositoryLocalAuditProfileForQualification({
  trustedRepositoryRoot: repositoryRoot,
  writerRef: WRITER_REF,
  now: () => new Date(FIXED_NOW),
  filesystemHooks: {
    filesystemKindOverride: "ext",
    onEvent: (event) => {
      if (armed && event === crashEvent) {
        occurrence += 1;
        if (occurrence === crashOccurrence) {
          writeCrashProtocolEvent({
            phase: "crash",
            fixture: "repository-local",
            boundary: event,
            occurrence,
          });
          process.exit(86);
        }
      }
    },
  },
});
armed = true;
writeCrashProtocolEvent({ phase: "ready", fixture: "repository-local", mode });

if (mode === "primary") {
  const event = protectedGenesisEvent();
  await profile.store.append(event, candidateDigest(event));
} else {
  await profile.journal.append(recoveryFact());
}
await profile.close();
process.exit(68);
