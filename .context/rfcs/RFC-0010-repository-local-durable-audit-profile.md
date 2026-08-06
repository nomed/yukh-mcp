# RFC-0010 — Repository-local durable audit and recovery profile

- Status: Proposed
- Authors: Copilot
- Created: 2026-08-06
- Governing issue: https://github.com/nomed/yukh-mcp/issues/86
- Depends on: RFC-0003, RFC-0004

Acceptance of this RFC would authorize only a network-free reference
implementation and deterministic qualification behind the existing audit ports.
It would not authorize gateway integration, a provider, credential, endpoint,
live mutation, Project apply, deployment, or a production durability claim.

## Summary

Define `yukh-mcp/repository-local-audit-v1`, the first concrete durability
profile for the RFC-0004 writer and recovery journal. The profile uses a
repository-local, ignored runtime directory and immutable per-sequence commit
records. One process owns one exclusive writer lock. A committed record, rather
than a mutable head or secondary index, is the authority for event bytes,
candidate digest, sequence, previous hash, and event identity.

The profile also defines a separately durable recovery journal, deterministic
restart replay, local checkpoint manifests, bounded retention and export
behavior, and fail-closed health transitions. It remains vendor-neutral at the
`AuditStore` and `RecoveryJournal` ports and introduces no network or provider
operation.

Local checkpoints are produced by the same process and are not independently
witnessed or cryptographically signed. They improve deterministic recovery and
verification but do not make evidence immutable, tamper-proof, complete, or
production-qualified.

## Motivation

PR #85 implemented RFC-0004 candidate validation, causal binding, canonical
hashing, writer and journal ports, retained-range verification, and fail-closed
pre-effect guards. Its only store is deliberately volatile.

RFC-0004 leaves the persistence topology, stream consistency domain, durable
store and journal mechanism, checkpoint authority, retention durations, export
limits, and recovery objectives to a deployment profile. Those choices affect
the trust boundary and cannot be inferred from the storage-neutral port.

The next reviewable layer needs restart and crash evidence without selecting a
database, object store, cloud service, credential, remote checkpoint authority,
or mutation provider.

## Goals

- define one deterministic, network-free implementation of `AuditStore`;
- define one deterministic, network-free implementation of `RecoveryJournal`;
- make exact event resubmission idempotent and conflicting identity reuse fatal;
- survive process restart without a mutable head or trusted secondary index;
- detect and quarantine malformed, torn, reordered, truncated, or substituted
  records before reporting healthy;
- replay bounded recovery facts deterministically without retrying provider work;
- define honest local checkpoint semantics and limitations;
- bound storage, retention work, recovery work, query work, and export output;
- preserve fail-closed pre-effect behavior under every unhealthy state; and
- keep all backend choices behind accepted ports and internal profile factories.

## Non-goals

- multi-process or distributed writers;
- network filesystems, shared volumes, containers, databases, object stores, or
  remote export destinations;
- independent checkpoint witnessing, signatures, MAC keys, KMS, or key custody;
- encryption or confidentiality at rest beyond host filesystem permissions;
- legal-hold, jurisdiction, privacy, or production retention qualification;
- automatic repair, best-effort continuation, or silent deletion;
- a public audit query or export endpoint;
- gateway wiring, provider registration, credentials, live targets, or mutation;
- claims of immutability, tamper-proofing, completeness, high availability,
  disaster recovery, or production readiness.

## Normative profile

The terms MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and
MAY are normative.

### Activation and root

The profile identifier is `yukh-mcp/repository-local-audit-v1`.

The implementation is constructed only through an explicit internal factory.
It is not discoverable from MCP input and has no environment-variable, gateway,
demo, or provider default.

The runtime root is the fixed repository-relative path
`.yukh/runtime/audit-v1`. It is runtime state and MUST be ignored by git. The
factory receives the trusted canonical repository root; repository files,
configuration, issue content, and Project state cannot select or authorize the
profile.

Before reading state, the implementation MUST:

1. resolve every existing path component without following symlinks;
2. require the repository and runtime root to be local filesystem directories;
3. require the runtime root to be owned by the effective user and mode `0700`;
4. create new directories with mode `0700` and files with mode `0600`;
5. reject hard-linked committed or configuration files, non-regular files,
   unsafe ownership or modes, path traversal, unknown top-level entries, and
   case-fold collisions;
6. reject a runtime root inside `.git`; and
7. acquire an exclusive non-blocking profile lock before recovery or writes.

An unavailable lock means `audit_unavailable`. Stale-lock deletion is not
automatic. The first implementation supports one process and one writer only.

### Filesystem topology

The closed topology is:

```text
.yukh/runtime/audit-v1/
  profile.json
  writer.lock
  primary/
    streams/<sha256-stream-ref>/
      stream.json
      commits/<20-digit-sequence>.json
    checkpoints/<checkpoint-id>.json
    deletions/<deletion-id>.json
  recovery/
    pending/<sha256-recovery-id>.json
    acknowledged/<sha256-recovery-id>.json
    quarantine/<sha256-record-id>.json
  exports/
    <export-id>.jsonl
    <export-id>.manifest.json
  tmp/
```

`profile.json` contains only the profile version, canonicalization and integrity
algorithm identifiers, writer reference, capacity limits, and creation time. It
contains no endpoint, credential, personal data, provider identifier, target
identifier, raw source value, or authority assertion.

Stream and recovery directory names are lowercase SHA-256 digests of already
validated opaque references. The corresponding record binds the original
reference. A digest collision or inconsistent binding is an integrity failure.

No mutable event-ID index or stream-head file is authoritative. In-memory
indexes are rebuilt only from validated committed records at startup.

### Primary commit protocol

One `<20-digit-sequence>.json` file is the atomic stream commit unit. It contains
exactly:

- record format version and profile identifier;
- the complete validated `ProtectedAuditEvent`;
- the candidate digest supplied to `AuditStore.append`; and
- the canonical record digest.

For each append, while holding the profile lock, the adapter MUST:

1. validate the protected event and candidate digest again;
2. check the rebuilt global event-ID map;
3. return the original receipt only when event ID and candidate digest match;
4. reject differing reuse as `audit_duplicate_conflict` and mark health failed;
5. derive the expected stream sequence and previous hash from the last contiguous
   committed record;
6. require exact event bytes, sequence, previous hash, stream reference, and
   event hash to match that expected append;
7. write one same-directory temporary file with create-exclusive, no-follow
   semantics and mode `0600`;
8. write all canonical bytes, sync the file, and close it;
9. atomically publish without replacing an existing destination;
10. sync the containing `commits` directory; and
11. only then return a receipt with durability `durable`.

The implementation MUST use an atomic no-replace publication primitive. A
rename operation that can overwrite the destination is insufficient.

The committed sequence file is the transaction. No separately mutable head,
identity row, or receipt is needed for atomicity. A crash before publication
leaves no commit. A crash after publication but before directory sync may leave
a valid record, but no caller received a durable receipt; exact retry discovers
and returns that record idempotently.

Temporary files are never evidence. A hard-link no-replace implementation MAY
leave one profile-owned temporary name linked to an already published
destination if the process crashes between link and unlink. Startup removes
only such well-formed temporary names after validating their type, ownership,
mode, location, link count of exactly two, byte identity with the validated
destination, and destination binding. Every other hard-linked or unknown
temporary entry fails startup.

### Startup recovery and health

Startup occurs before the adapter reports ready:

1. acquire the exclusive lock;
2. validate `profile.json` and the closed topology;
3. enumerate stream directories and commits in bytewise lexical order;
4. validate filenames, bounded file size, canonical bytes, record digest,
   candidate digest, protected event schema, sequence, previous hash, event hash,
   stream binding, and global event-ID uniqueness;
5. rebuild in-memory stream heads and the event-ID map;
6. validate checkpoints and deletion manifests;
7. validate all pending and acknowledged recovery records; and
8. calculate capacity and recovery backlog health.

The following conditions make health `failed` and pre-effect operation
`audit_unavailable`: a gap in a retained undeleted range, non-canonical record,
truncated or oversized file, hash mismatch, chain reset, duplicate conflict,
cross-stream substitution, unknown entry, unsafe filesystem metadata, invalid
checkpoint or deletion manifest, journal conflict, capacity exhaustion, or an
unacknowledged recovery fact beyond its replay objective.

The adapter never repairs, renumbers, overwrites, truncates, or skips a suspect
record. Quarantine is an explicit operator action and does not restore health.
Restoring health requires deterministic verification plus an explicit recovery
decision outside this profile.

### Recovery journal append

A recovery fact is stored separately from primary audit evidence. The pending
record contains exactly the validated `RecoveryFact`, its canonical digest, the
profile identifier, journal append time, and journal record version.

Append uses the same create-exclusive temporary file, file sync, atomic
no-replace publication, and directory sync protocol as a primary commit. A
durable receipt is returned only after the pending directory is synced.

Exact recovery-ID and fact-digest resubmission is idempotent. Reuse with
different content is a journal integrity failure. Recovery facts are never
modified in place and are never treated as committed audit evidence.

### Deterministic replay and acknowledgement

Recovery replay is exposed through a separate internal reader/replayer port; it
does not broaden `RecoveryJournal.append` and is not an MCP or provider surface.

Pending facts are replayed in ascending tuple order:

1. original observation time;
2. recovery ID; and
3. fact digest.

Replay revalidates every fact and supplies it to one injected importer exactly
once per replay pass. RFC-0004 names `audit.gap_declared` but PR #85 does not yet
implement that event schema, and RFC-0004 defines no recovery-import event.
Therefore the first adapter implementation MUST stop at the pending-fact
iterator. Import and acknowledgement are blocked until a separately reviewed
storage-neutral registry extension defines the required closed candidates. A
future importer cannot call a provider, retry an operation, infer success, or
change the recorded `completion_unknown` result.

A pending fact may become acknowledged only after that registry extension is
accepted and an importer returns durable receipts bound to the recovery ID,
source fact digest, original observation time, import time, and declared gap.
The adapter then atomically publishes an immutable acknowledgement record and
syncs its directory. Pending source records remain until retention eligibility;
acknowledgement is not an overwrite or deletion.

Before the registry extension exists, replay is read-only and leaves every fact
pending. Later importer denial, unavailability, invalid receipts, duplicate
conflict, or crash also leaves the fact pending. Replay is idempotent. No
failure causes provider retry. The first implementation bounds one replay pass
to 1,000 facts, 8 MiB of input, and 30 seconds from an injected monotonic clock.

### Local checkpoint authority

The profile creates a checkpoint after at most 1,000 new primary commits and at
clean shutdown. A checkpoint binds:

- profile and checkpoint format versions;
- checkpoint ID and previous checkpoint reference;
- stream reference;
- inclusive retained sequence range and event count;
- terminal event hash;
- writer reference;
- authority reference `repository_local_writer_v1`;
- creation time; and
- canonical checkpoint digest.

Checkpoint publication uses the same sync and no-replace protocol.

The checkpoint authority is the same process and host account as the writer. No
signature, MAC, secret key, remote publication, or independent witness is used.
The algorithm is `sha256_local_checkpoint_v1`. A verifier may use it to detect
inconsistent local state but MUST NOT treat it as an independently trusted
RFC-0004 witness. Tail deletion or full same-account chain replacement can
remain undetected.

Any future signed, MACed, remote, independently witnessed, multi-writer, or
production checkpoint authority requires a superseding accepted profile.

### Capacity and backpressure

The fixed first-profile limits are:

| Resource | Limit |
| --- | ---: |
| one primary commit record | 64 KiB |
| one recovery record | 4 KiB |
| primary committed bytes | 64 MiB |
| recovery pending and acknowledged bytes | 8 MiB |
| checkpoint and deletion metadata | 4 MiB |
| completed export artifacts | 32 MiB |
| temporary bytes | 16 MiB |
| streams | 64 |
| pending recovery facts | 1,000 |

Limits include filesystem record bytes, not only payload bytes. At 90% of any
byte or count limit health becomes `degraded` and new export work is denied. At
the limit, or when free space cannot cover the maximum next record plus its
temporary copy, health becomes `failed`; pre-effect commits deny before provider
start. Existing evidence is never deleted automatically to admit a write.

### Retention and deletion

This reference profile registers:

| Class | Minimum | Maximum |
| --- | ---: | ---: |
| protected event body | 24 hours | 30 days |
| acknowledged recovery source | 24 hours after acknowledgement | 30 days |
| local checkpoint or deletion manifest | 30 days | 90 days |
| export artifact | 1 hour | 24 hours |

Pending recovery facts are not retention-eligible. If they exceed 30 days, the
profile fails health rather than deleting evidence.

Retention is an explicit, locally invoked maintenance operation. There is no
timer or startup deletion. It may remove only a contiguous stream prefix whose
maximum retention has elapsed, whose terminal hash is covered by a valid local
checkpoint, and whose deletion manifest has first been durably published.

The manifest records the exact range, class, deletion time, fixed authority
reference, method, event count, terminal hash, checkpoint reference, and reason
`expired_by_policy`. It contains no event body. After deletion, verification and
export report that range as `expired_by_policy`, never `missing`.

The local operator and writer are the same host authority; this profile does not
qualify legal holds or separation of duties. Any hold request denies retention
because no accepted hold-authority profile exists.

### Bounded export

No export is available to MCP clients, the gateway, providers, or ambient
filesystem readers through this profile.

The internal exporter requires an injected explicit authorization result
independent of capability execution. Missing, malformed, denied, or
non-explicit authorization denies before reading records. The profile does not
define an identity provider and therefore qualifies export only with synthetic
authorization fixtures.

One export is limited to one stream, one contiguous declared range, 10,000
records, 16 MiB of source bytes, 16 MiB of output, and 30 seconds from an
injected monotonic clock. Projection is deterministic and closed. The exporter
writes and syncs a temporary artifact, publishes it without replacement, then
writes, syncs, and publishes the manifest without replacement before syncing
the export directory. The manifest is the commit point: an artifact without its
valid manifest is incomplete and unavailable. Any failure removes only
validated profile-owned incomplete files and exposes no partial trusted export.

The manifest contains the RFC-0004 bounded fields, included hashes and local
checkpoints, declared retention gaps, output digest, projection version, and the
explicit limitation `local_unwitnessed_not_complete`. Export never includes
raw-store records, candidate digests, writer filesystem metadata, source paths,
credentials, resolver data, or forbidden content.

### Diagnostics

Public errors use only existing closed audit outcome codes. Internal health
output is a closed record containing profile version, phase, health state,
bounded counts, capacity buckets, and sanitized reason code.

Diagnostics MUST NOT contain repository paths, stream or event references,
candidate or event bytes, recovery facts, checkpoint contents, exporter
contents, raw exceptions, filesystem metadata, or operating-system error text.

## Trust boundaries and threat analysis

The new boundaries are trusted process to local filesystem, writer lock to
single-process ownership, immutable commit publication, startup recovery,
recovery replayer to importer, local checkpoint authority, retention
maintenance, and synthetic exporter authorization.

Primary threats are symlink or hard-link substitution, unsafe ownership,
concurrent writers, torn or reordered writes, stale or forged identity indexes,
event-ID conflict, chain truncation, recovery fact loss or replay confusion,
checkpoint overclaim, disk exhaustion, retention erasing evidence, unauthorized
export, and forbidden content in diagnostics.

Controls are a closed canonical root, safe metadata checks, exclusive ownership,
immutable per-sequence commit units, sync-before-receipt publication, complete
startup reconstruction, global identity conflict checks, bounded journal replay,
same-process checkpoint labels, explicit manifest-before-delete retention,
synthetic-only export qualification, and fail-closed health.

Residual risk includes host or effective-user compromise, filesystem or kernel
failure that violates sync guarantees, same-authority deletion or replacement,
unwitnessed tail truncation, repository deletion, backup omission, clock error,
denial through lock or capacity exhaustion, and lack of confidentiality at rest.
These risks are not accepted for production mutation.

## Compatibility

The primary adapter implements the accepted `AuditStore` contract. The journal
implements the accepted `RecoveryJournal.append` contract. Replay, retention,
checkpoint, health, and export operations are separate internal ports so the
accepted write contracts do not acquire backend-specific fields.

Canonical RFC-0004 event bytes, hashes, candidates, and recovery facts do not
change. Recovery import and acknowledgement remain blocked pending a separately
reviewed storage-neutral event-registry extension for gap declaration and
recovery import. This profile does not authorize those schema additions.

No ordinary gateway, demo, provider, MCP discovery, configuration, or network
behavior changes.

## Validation and acceptance evidence

Implementation must include deterministic tests for:

- fresh commit, exact duplicate, conflicting duplicate, and concurrent calls;
- restart reconstruction and byte-for-byte receipt stability;
- crash before write, during write, after file sync, after publication, and
  before/after directory sync using fault injection;
- torn, oversized, non-canonical, reordered, missing, truncated, substituted,
  hard-linked, symlinked, wrong-owner, wrong-mode, and unknown records;
- two process instances contending for the lock with the loser failing closed;
- zero provider-start callback calls for every unhealthy or non-durable
  pre-effect path;
- journal append durability, exact replay order, replay restart, pending-fact
  preservation, duplicate conflict, blocked acknowledgement, and no retry;
- local checkpoint fixed vectors, invalid checkpoint, tail truncation limits,
  and explicit absence of independent-witness claims;
- capacity thresholds, free-space failure, bounded replay, and backpressure;
- retention eligibility, noncontiguous deletion denial, manifest-before-delete,
  pending-fact preservation, and `expired_by_policy` reporting;
- denied export, source/output/time bounds, deterministic manifest and output,
  crash cleanup, and no partial artifact;
- no forbidden content or raw filesystem error in records or diagnostics; and
- existing full repository validation.

Crash qualification MUST use child processes and actual restart, not only
in-memory mocks. Filesystem fault injection supplements but does not replace
restart tests.

## Rollout and rollback

1. Accept this RFC and its threat-model delta.
2. Open a separate implementation issue.
3. Implement internal ports and the repository-local adapters without gateway or
   provider imports.
4. Qualify deterministic restart, crash, replay, retention, and export behavior.
5. Keep the profile disabled and unreachable from ordinary runtime entry points.
6. Review implementation evidence in a focused PR.

Rollback removes the disabled implementation and its test fixtures. Runtime
evidence directories are never deleted automatically by source rollback.

Any gateway integration, provider mutation, external checkpoint authority,
credential, endpoint, multi-process writer, remote store, or production use
requires a separate accepted profile and threat review.

## Alternatives

### Mutable append log plus head and event-ID index

Rejected because a local filesystem cannot atomically update the log, head, and
index as one transaction. Immutable sequence records make one directory entry
the commit unit and rebuild derivative state after restart.

### SQLite

Deferred. SQLite could provide a strong local transaction boundary, but choosing
it now would add a backend dependency and database-specific operational surface.
The accepted ports permit a later profile without changing audit semantics.

### Raw JSON Lines append

Rejected because a crash may leave a torn final line and exact durable receipt,
identity conflict, and no-replace publication semantics become ambiguous.

### Treat local checkpoints as trusted witnesses

Rejected because the writer and checkpoint authority share one process, account,
host, and filesystem. The profile labels the limitation rather than overstating
integrity.

### Automatically delete oldest evidence under pressure

Rejected because capacity pressure must not silently erase evidence to allow a
provider operation. The adapter fails closed and requires explicit retention.

### Implement before accepting a profile

Rejected because RFC-0004 explicitly leaves durability, checkpoint authority,
retention, export, and recovery choices to a deployment profile and requires
owner acceptance before implementation.

## Open questions

The owner must decide during review:

1. whether hard-link-based no-replace publication is sufficiently portable for
   the supported local filesystems or the implementation must expose a narrower
   qualified-filesystem list;
2. whether the fixed capacity and retention limits are appropriate for the
   reference profile; and
3. what separately governed storage-neutral event schemas should represent
   recovery import and the required declared gap.
