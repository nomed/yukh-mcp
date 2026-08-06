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
Recovery import, acknowledgement, retention, and export remain blocked by the
separately accepted storage-neutral extensions identified below.

## Summary

Define `yukh-mcp/repository-local-audit-v1`, the first concrete durability
profile for the RFC-0004 writer and recovery journal. The profile uses a
repository-local, ignored runtime directory and immutable per-sequence commit
records. One process owns one exclusive writer lock. A retained commit and its
bounded durable identity record, or the identity record alone after authorized
body expiry, are the authority for candidate digest and event identity. A
retained commit remains the authority for its event bytes and chain position.

The profile also defines a separately durable recovery journal, deterministic
restart replay, local checkpoint manifests, bounded retention and export
requirements, and fail-closed health transitions. Retention and export
requirements are prospective and do not authorize those implementations. The
profile remains vendor-neutral at the `AuditStore` and `RecoveryJournal` ports
and introduces no network or provider operation.

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
- preserve event and recovery identities for the fixed profile lifetime without
  letting retention, restart, or pressure recycle them;
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
    identities/<sha256-event-id>/<8-digit-version>.json
    checkpoints/<checkpoint-id>.json
    deletions/<deletion-id>.intent.json
    deletions/<deletion-id>.outcome.json
  recovery/
    pending/<sha256-recovery-id>.json
    acknowledged/<sha256-recovery-id>.json
    identities/<sha256-recovery-id>/<8-digit-version>.json
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

No mutable event-ID index or stream-head file is authoritative. Identity
versions are immutable monotonic extensions: every version repeats all earlier
fields exactly and may add only fields registered for its lifecycle transition.
Before retention, in-memory indexes are rebuilt from validated committed
records and cross-checked against identity version zero. After retention, the
validated version chain preserves uniqueness and conflict detection for expired
bodies.

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
10. publish without replacement immutable identity version zero containing
    exactly the event ID, candidate digest, stream reference, sequence, previous
    hash, event hash, commit time, writer reference, durability `durable`,
    commit-record digest, and identity-record digest;
11. sync the `commits` and `identities` directories; and
12. only then return a receipt with durability `durable`.

The implementation MUST use an atomic no-replace publication primitive. A
rename operation that can overwrite the destination is insufficient.

The committed sequence file is the event transaction; identity version zero is a
derived immutable guard that becomes independently necessary only after
retention. A crash before commit publication leaves no commit. A crash after
commit publication but before identity publication or directory sync may leave
a valid event for which no caller received a durable receipt. Startup derives
and publishes the missing identity record only after validating the complete
commit, then exact retry returns the event idempotently. Identity version zero
without its referenced valid commit is an integrity failure unless a later
validated permanent version binds the deletion manifest digest and
`expired_by_policy` state. Expiry of the separate manifest does not erase that
binding.

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
5. validate or deterministically complete primary identity records and rebuild
   in-memory stream heads plus the never-reusable event-ID map;
6. validate checkpoints, deletion manifests, and expired-body identity bindings;
7. validate and resolve every recovery acknowledgement transaction according to
   the deterministic state table below, then validate all remaining pending,
   acknowledged, quarantine, and recovery identity records; and
8. calculate capacity, identity tombstone, and recovery backlog health.

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
no-replace publication, and directory sync protocol as a primary commit. Before
returning, it also publishes an immutable recovery identity record containing
exactly the recovery ID, fact digest, pending-record digest, append time,
durability `durable`, and identity-record digest. A durable receipt is returned
only after the pending and identity directories are synced.

Exact recovery-ID and fact-digest resubmission is idempotent. Reuse with
different content is a journal integrity failure. Recovery identity records are
never retention-eligible. Recovery facts are never modified in place and are
never treated as committed audit evidence.

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
One acknowledgement binds at most four import receipts; an empty, oversized,
duplicate, or inconsistently bound receipt set denies acknowledgement and
leaves the fact pending.

Acknowledgement is one ordered, recoverable transaction. Its acknowledgement
record contains the recovery ID, fact and pending-record digests, original
observation and import times, the ordered import-receipt tuples, their set
digest, transaction ID, previous recovery-identity digest, and record digest.
Each receipt tuple contains its receipt digest, event ID, event reference,
candidate digest, and declared-gap binding. The next immutable recovery identity
version repeats every earlier identity field and adds state
`acknowledgement_prepared`, the transaction ID, acknowledgement-record digest,
the same receipt set digest and tuples, and every field needed to reproduce the
acknowledgement record byte-for-byte. This permanent extension is the
profile-lifetime conflict-protection tombstone; it is never retention-eligible.
The transaction ID is the domain-separated canonical digest of the recovery ID,
fact digest, pending-record digest, previous identity digest, and ordered receipt
tuples. Neither record may refer to a mutable filename or temporary file.

While holding the profile lock, acknowledgement MUST use this exact order:

1. revalidate the pending record, complete identity chain, importer receipts,
   bounds, capacity reservation, and absence of either transaction destination;
2. construct the canonical acknowledgement record and next identity extension
   in memory and cross-check their transaction, record, receipt, and previous
   identity digests;
3. create both same-directory temporary files exclusively, write their complete
   canonical bytes, sync each file, and close each file;
4. publish the identity extension without replacement;
5. sync the recovery ID's `identities` directory;
6. publish the acknowledgement record without replacement;
7. sync the `acknowledged` directory; and
8. only then expose state `acknowledged` or return acknowledgement success.

Step 7 is the single logical acknowledgement commit point. It is intentionally
after the identity-directory sync: no live process may expose an acknowledged
state unless the permanent identity conflict protection and complete receipt
binding are already durable. Publication alone, a synced temporary file, or an
identity with `acknowledgement_prepared` is not acknowledgement. The pending
source remains until separately authorized retention; acknowledgement is not an
overwrite or deletion.

Before readiness, startup resolves every possible crash state as follows:

| Durable/visible state after restart                                                                                             | Required deterministic action                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| neither final record nor recognized transaction temporary exists                                                                | remain pending without filesystem change                                                                                                                                        |
| neither final record exists and one or both recognized temporary files exist                                                    | after validating ownership, names, bounds, and transaction binding, unlink them, sync each containing directory, and remain pending                                             |
| valid identity extension exists, acknowledgement record absent                                                                  | sync the identity directory, reproduce the acknowledgement bytes from the extension, publish without replacement, sync `acknowledged`, then commit                              |
| valid identity extension and matching acknowledgement record exist, but either publication may have preceded its directory sync | sync the identity directory first, then `acknowledged`; validate both again, then commit                                                                                        |
| both records validate after both directory syncs                                                                                | expose exactly one acknowledged transaction idempotently                                                                                                                        |
| acknowledgement record exists without its exact valid identity extension                                                        | atomically move it without replacement to its transaction-derived quarantine name, sync both directories, keep the fact pending, and fail health                                |
| either final record is malformed, conflicting, non-monotonic, or disagrees on any binding                                       | quarantine every safely attributable conflicting final record without replacement, preserve the pending source and prior identities, sync affected directories, and fail health |

The first two rows cover crashes before identity publication, including during
temporary writes and after either temporary-file sync. The third row covers a
crash after identity publication or its directory sync but before
acknowledgement publication. The fourth covers a crash after acknowledgement
publication but before its directory sync. The fifth covers a crash after the
commit point. If a published identity entry is absent after restart, it was not
durable and the transaction follows the rollback row; if present, startup first
makes its directory entry durable and follows completion. A quarantine move
preserves the exact bounded bytes, uses a deterministic transaction-derived
name, and is never repair or acknowledgement. Failure to complete and sync the
quarantine move leaves the source inaccessible, fails startup, and exposes no
acknowledged state. Temporary files are never used as authority.

Before the registry extension exists, replay is read-only and leaves every fact
pending. Later importer denial, unavailability, invalid receipts, or duplicate
conflict also leaves the fact pending. A crash is resolved only by the table
above and never causes importer or provider retry. Replay and transaction
completion are idempotent. The first implementation bounds one replay pass to
580 facts, 8 MiB of input, and 30 seconds from an injected monotonic clock.

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
| one primary or recovery identity record | 2 KiB |
| primary committed bytes | 64 MiB |
| recovery pending, acknowledged, and identity bytes | 8 MiB |
| event identity records | 16 MiB |
| checkpoint and deletion metadata | 4 MiB |
| completed export artifacts | 32 MiB |
| temporary bytes | 16 MiB |
| streams | 64 |
| pending recovery facts | 580 |
| total recovery identities in all lifecycle states | 580 |
| total event identities in all lifecycle states | 8,192 |

Limits include filesystem record bytes, not only payload bytes. Primary append
admission accounts for its maximum identity version-zero bytes. Recovery append
admission accounts for the pending record and reserves space under the same
8 MiB cap for the maximum acknowledgement and every later identity version
needed to acknowledge and compact that recovery ID. Acknowledgement cannot
consume that reservation. Retention admission likewise reserves all identity
versions, manifests, and terminal-control evidence before recording `admitted`.
The 580-recovery-identity ceiling is derived conservatively from the 8 MiB cap:
for every identity it reserves one 4 KiB pending record, one 4 KiB
acknowledgement record, and three 2 KiB identity versions for append,
acknowledgement, and compaction (14 KiB total).
At 90% of any byte or count limit health becomes `degraded` and new export work
is denied. At the limit, or when free space cannot cover the maximum next record
plus its temporary copy, health becomes `failed`; pre-effect commits and new
recovery identities deny. Exact duplicate lookup remains available. Existing
evidence is never deleted automatically to admit a write.

Identity capacity is not reclaimed. The explicit lifetime of an identity is the
lifetime of this profile root: from `profile.json` creation until the complete
root is retired under a separately accepted migration or destruction profile.
Restart, upgrade, repository movement, body expiry, and capacity pressure do not
end that lifetime. Version 1 defines no identity eviction, rollover, reset, or
reuse. Reaching a byte or identity limit therefore fails closed and requires an
accepted successor profile.

### Retention and deletion

This reference profile registers:

| Class | Minimum | Maximum |
| --- | ---: | ---: |
| protected event body | 24 hours | 30 days |
| acknowledged recovery fact and acknowledgement record | 24 hours after acknowledgement | 30 days |
| primary and recovery identity tombstone | profile lifetime | profile lifetime |
| local checkpoint or deletion manifest | 30 days | 90 days |
| export artifact | 1 hour | 24 hours |

Pending recovery facts are not retention-eligible. If a pending fact exceeds 30
days, or an acknowledged fact or acknowledgement reaches 30 days without a
completed authorized compaction, the profile fails health rather than deleting,
overwriting, or silently extending evidence.

Retention is an explicit, locally invoked maintenance operation. There is no
timer or startup deletion. Every invocation requires a fresh injected explicit
authorization decision, independent from capability execution, bound to the
exact profile, action, classes, stream/range or recovery IDs, body digests,
identity digests, policy reference, expiry, and deletion plan digest. Missing,
malformed, stale, denied, or non-explicit authorization denies before deletion.
One invocation covers either one contiguous prefix of one stream or one exact
recovery-ID set, never both, and is limited to 1,000 filesystem records, 16 MiB
of source bytes, 4 MiB of generated identity/control metadata, and 30 seconds
from an injected monotonic clock. Crossing any bound before the first unlink is
`denied`; crossing one afterward is `failed` and `retention_incomplete`.

Before any deletion, the writer MUST durably commit registered control evidence
for the attempt, authorization allow or deny decision, enforcement, hold
decision, exact deletion-plan digest, and pre-action result `admitted` or
`denied`. A denied attempt MUST durably record terminal outcome `denied` before
returning. An allowed no-op MUST durably record terminal outcome `no_action`.
Admission MUST reserve capacity for the terminal record. After physical work it
MUST record exactly one terminal outcome: `applied` only after all directory
syncs, otherwise `failed` with a bounded phase code. Every terminal record binds
the pre-action evidence, plan, intent and outcome manifest digests, and exact
counts. Audit unavailability denies before deletion; failure after deletion
begins fails health and requires explicit reconciliation.

PR #85 does not implement retention-control event schemas, and the accepted
`AuditStore.findById` result cannot represent an expired identity without the
complete protected event needed for its original receipt. Therefore the first
adapter implementation MUST NOT delete primary or recovery bodies. Retention is
blocked until separately reviewed storage-neutral event-registry and store-port
extensions define the control evidence, expired identity state, and closed
retry result without making an expired ID reusable.

No hold request, absence of a hold record, or local operator assertion proves
that deletion is unheld. Retention also requires a fresh explicit `not_held`
decision from a separately accepted hold authority bound to the same scope and
plan; `held`, missing, stale, unavailable, or unknown denies. No such authority
is selected here, so only synthetic hold fixtures may be used in qualification.

After those extensions are accepted, retention may remove a primary body only
from a contiguous stream prefix whose maximum retention has elapsed, whose
terminal hash is covered by a valid local checkpoint, whose immutable identity
record is durable, and whose deletion manifest and pre-action control evidence
have first been durably committed. The exact transaction order is:

1. durably commit attempt, authorization, hold, enforcement, and `admitted`
   control evidence and reserve terminal capacity;
2. publish and sync an immutable intent manifest;
3. append and sync a permanent identity version for every affected identity,
   repeating its event ID/candidate digest or recovery ID/fact digest and binding
   the intent digest with state `deletion_admitted`;
4. revalidate authorization time, `not_held`, exact files, identity versions,
   checkpoint, and intent immediately before the first unlink;
5. unlink only the declared files and sync every affected directory;
6. publish and sync an immutable outcome manifest with result `applied`;
7. append and sync identity versions binding the intent and outcome digests,
   deletion time, method, reason, applicable stream range/terminal hash/
   checkpoint digest, terminal control event ID and candidate digest, and state
   `expired_by_policy`; and
8. durably commit the terminal `applied` control event.

The intent records exact event range or recovery IDs, class, authorization,
hold, and pre-action evidence references, method, record count, identity-set
digest, terminal hash and checkpoint where applicable, and reason
`expired_by_policy`. The outcome binds the intent, exact removed record set,
directory-sync completion, and result. Neither contains an event or recovery
body.

An acknowledged recovery fact and acknowledgement record are deleted together
only after both reach maximum retention and their recovery identity versions
bind the source digest, acknowledgement digest, and every import receipt digest
and event reference. Pending facts and identity records are never eligible.

A crash or error after step 1 but before step 8 is `retention_incomplete`, fails
health, and requires explicit reconciliation; no startup or retry silently
resumes deletion. Verification and export deny the affected range until all
intent, identity, outcome, and terminal-control bindings validate. After a
detailed intent, outcome manifest, checkpoint, or terminal-control body reaches
its own retention maximum, the permanent identity versions retain the closed
completion fields and digests needed to continue reporting
`expired_by_policy`; they do not claim more checkpoint authority than the
original local anchor. Exact or conflicting reuse always consults the
profile-lifetime identity chain and can never create a new record.

The local operator and writer are the same host authority; this profile does not
qualify legal holds or separation of duties. Because no hold authority is
accepted, an actual hold result is unknown and all non-synthetic retention
denies.

### Bounded export

No export is available to MCP clients, the gateway, providers, or ambient
filesystem readers through this profile.

RFC-0004 requires every export attempt, including a denial or failure, to be
audited through a control stream. Its current registry supplies only
`audit.export_created`; that success event cannot represent an attempted export,
an allow or deny authorization decision, enforcement, or a terminal denied or
failed outcome. Therefore this RFC does not authorize an exporter
implementation, including an internal exporter exercised only with synthetic
authorization fixtures.

Exporter implementation remains blocked until a separately reviewed and
accepted storage-neutral RFC-0004 registry extension defines closed, versioned
export-control candidates for:

1. `audit.export_attempted` before authorization or source-record access;
2. `audit.export_authorization_recorded` with explicit `allow` or `deny`;
3. `audit.export_enforcement_recorded` with `admitted` or `denied`; and
4. `audit.export_outcome_recorded` with exactly one terminal outcome from
   `created`, `denied`, `failed`, or `no_action`.

The extension MUST define producer allowlists, schemas, classifications,
correlation and causation rules, projection and retention policy, reason and
phase-code registries, and durable preconditions. Every candidate MUST bind the
export ID, requester reference, profile and projection versions, exact query and
range digest, authorization decision reference and digest where applicable,
and its causal predecessor. The terminal candidate MUST additionally bind the
attempt, authorization and enforcement evidence, manifest and output digests
when created, bounded counts, and a sanitized terminal phase. For outcome
`created`, it MUST causally bind the existing `audit.export_created` event;
other outcomes MUST NOT emit that event. It MUST support durable evidence for
denied authorization and pre-manifest failure without inventing an artifact.
Unknown or unavailable control evidence fails closed.

After that extension is accepted, any future exporter requires an injected
explicit authorization result independent of capability execution. It MUST
durably commit attempt evidence before authorization, durable allow-or-deny and
enforcement evidence before source-record access, reserve capacity for a
terminal event, and durably commit exactly one terminal outcome before return.
Missing, malformed, stale, denied, non-explicit, or unauditable authorization
denies without reading source records, but still requires durable denial
evidence. Audit unavailability means no export attempt may proceed or return an
authorization result without a durable terminal outcome.

One export is limited to one stream, one contiguous declared range, 10,000
records, 16 MiB of source bytes, 16 MiB of output, and 30 seconds from an
injected monotonic clock. Projection is deterministic and closed. The exporter
writes and syncs a temporary artifact, publishes it without replacement, then
writes, syncs, and publishes the manifest without replacement before syncing
the export directory. The manifest is the commit point: an artifact without its
valid manifest is incomplete and unavailable. Any failure removes only
validated profile-owned incomplete files and exposes no partial trusted export.
These are prospective requirements for the separately reviewed implementation,
not authorization supplied by acceptance of this RFC.

The manifest contains the RFC-0004 bounded fields, included hashes and local
checkpoints, validated completed-retention ranges, output digest, projection
version, and the explicit limitation `local_unwitnessed_not_complete`.
`retention_incomplete` denies export of the affected range. Export never
includes raw-store records, identity records, candidate or fact digests, writer
filesystem metadata, source paths, credentials, resolver data, or forbidden
content.

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
maintenance, and the blocked export-control boundary.

Primary threats are symlink or hard-link substitution, unsafe ownership,
concurrent writers, torn or reordered writes, stale or forged identity indexes,
event- or recovery-ID reuse after retention, chain truncation, recovery fact
loss or replay confusion, unbounded acknowledgements, checkpoint overclaim,
disk exhaustion, unauthorized or partially audited retention erasing evidence,
unauthorized export, and forbidden content in diagnostics.

Controls are a closed canonical root, safe metadata checks, exclusive ownership,
immutable per-sequence commit units, sync-before-receipt publication, complete
startup reconstruction, global identity conflict checks, bounded journal replay,
same-process checkpoint labels, permanent bounded identity tombstones, separately
authorized and durably audited manifest-before-delete retention, no exporter
before a storage-neutral durable control-event extension, and fail-closed
health.

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
recovery import. Retention remains blocked pending storage-neutral control-event
and expired-identity store-port extensions. Export remains blocked pending the
export attempt, authorization, enforcement, and terminal-outcome registry
extension specified above. This profile does not authorize those contract
additions or an exporter.

No ordinary gateway, demo, provider, MCP discovery, configuration, or network
behavior changes.

## Validation and acceptance evidence

Implementation must include deterministic tests for:

- fresh commit, exact duplicate, conflicting duplicate, and concurrent calls;
- restart reconstruction, identity completion after injected crash, and
  byte-for-byte receipt stability;
- crash before write, during write, after file sync, after publication, and
  before/after directory sync using fault injection;
- torn, oversized, non-canonical, reordered, missing, truncated, substituted,
  hard-linked, symlinked, wrong-owner, wrong-mode, and unknown records;
- two process instances contending for the lock with the loser failing closed;
- zero provider-start callback calls for every unhealthy or non-durable
  pre-effect path;
- journal append durability, exact replay order, replay restart, pending-fact
  preservation, recovery identity conflict, blocked acknowledgement, and no
  retry; acknowledgement receipt cardinality, duplicate, digest, reference, and
  source-binding bounds; byte-exact acknowledgement/identity cross-binding,
  identity-directory sync before acknowledgement publication, acknowledgement
  commit only after its directory sync, and every crash-table row with
  deterministic rollback, completion, quarantine, failed health, idempotent
  restart, and no acknowledged visibility before durable identity protection;
- local checkpoint fixed vectors, invalid checkpoint, tail truncation limits,
  and explicit absence of independent-witness claims;
- capacity thresholds, free-space failure, bounded replay, and backpressure;
- retention denial without explicit bound authorization, durable denial
  evidence, durable allow/deny/admitted/no-action/applied/failed semantics,
  audit-capacity and missing/stale/held/unknown hold denial, authorization expiry
  and hold insertion immediately before unlink, blocked retention before
  contract extensions, range/record/source/generated-byte/time and
  noncontiguous deletion denial, intent-before-identity-before-delete ordering,
  every crash point through terminal outcome,
  `retention_incomplete` health/export behavior, event-ID and recovery-ID
  conflict detection after restart and body expiry, bounded acknowledgement
  expiry under the shared 8 MiB cap, pending-fact preservation, and
  `expired_by_policy` only after complete terminal bindings;
- exact duplicate and conflicting event/recovery reuse before expiry, after
  expiry, and after restart; tampered, colliding, missing, reordered, or
  non-monotonic identity versions; byte/count exhaustion; and proof no identity
  is recycled to regain capacity;
- absence and unreachability of an exporter before the registry extension, zero
  source reads when required control evidence is unavailable, and governance
  fixtures proving the proposed extension can represent durable attempted,
  allow/deny, enforcement, and every terminal outcome; after separate acceptance,
  denied export, durable evidence ordering, terminal-capacity reservation,
  source/output/time bounds, deterministic manifest and output, every crash
  boundary, cleanup, and no partial artifact;
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
4. Qualify deterministic restart, crash, and replay behavior; keep retention
   and export blocked until their storage-neutral contract extensions are
   separately accepted.
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

### Delete identity or acknowledgement metadata with expired bodies

Rejected because restart would forget prior event or recovery identities, permit
conflicting reuse, and sever journal/import receipt bindings. Version 1 keeps
bounded identity records for its explicit profile lifetime and fails closed at
the cap.

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
   recovery import and the required declared gap; and
4. whether a separate RFC should adopt the proposed export-control event set
   without changing RFC-0004's existing `audit.export_created` compatibility.
