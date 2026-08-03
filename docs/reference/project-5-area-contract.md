# Project 5 distinct Area contract

This is the accepted Phase A contract governed by
[`yukh-mcp#60`](https://github.com/nomed/yukh-mcp/issues/60). It specifies a
read-only plan. It does not authorize a Project schema mutation.

## Semantic contract

`Area` is an independently governed issue-contract dimension. It is not an
alias for `Component`:

- `Area` describes the kind of work, such as delivery, security, or runtime;
- `Component` identifies the product surface, such as MCP, Projects, or
  Coordination;
- `Status` remains human/Project-owned and is never reconciled from `area`;
- native issue type remains the target for `kind`.

The managed representation is one ProjectV2 single-select field named exactly
`Area`. Its option set is derived, in policy declaration order, from
`.yukh/project.yaml`:

1. Governance
2. Security
3. Architecture
4. Runtime
5. Provider
6. Audit
7. Delivery
8. Documentation
9. Release

The field uses `extension` ownership. Existing matching options are preserved;
missing declared options may be added in a separately authorized convergent
schema operation. Undeclared options, a case-fold-equivalent field name, a
different field type, duplicate options, or an ambiguous observed schema stop
the plan. No rename, deletion, replacement, or inference is permitted.

## Immutable read-only observation

The bounded observation used by Phase A was taken on 2026-08-03 through the
stored OAuth Projects profile. The query selected at most 100 Project fields,
returned 20, requested no items, and included no provider IDs in retained
evidence.

- Project schema `updatedAt`: `2026-08-03T19:04:41Z`
- canonical redacted schema SHA-256:
  `913bdaa510a9da9f90e3f328924f8ed3b8b7d3ba70dcc21529b4b3ce079ad371`
- observed `Area`: absent
- observed `Component`: single-select, preserved unchanged
- observed `Status`: single-select, preserved unchanged

The canonical redacted bytes are retained as
[`project-5-schema-snapshot-v1.json`](project-5-schema-snapshot-v1.json) so the
digest and plan can be independently reproduced without provider identifiers.

Three bounded GraphQL reads were made during review: one failed closed after
the owner was initially typed as an organization, followed by two successful
user-owned Project reads. Each reported query cost 1. The final observed
remaining budget was 4092. No mutation, pagination, retry, polling, sleep, cache
write, conditional request, or provider body was retained.

GitHub Projects v2 field-schema observation is the unavoidable GraphQL surface
for this consumer plan. Issue, pull-request, check-run, and Actions reads remain
REST-first. A future Phase B may use only the producer's reviewed
`createProjectV2Field` path; arbitrary GraphQL documents are forbidden.

## Phase A result

The redacted machine-readable plan is
[`project-5-area-phase-a-plan-v1.json`](project-5-area-phase-a-plan-v1.json).
It proposes one schema operation and is explicitly non-executable.

Before any later mutation, Phase B must obtain a fresh complete schema snapshot
and prove all recorded preconditions. It must declare a GraphQL request ceiling
of three total operations (preflight, at most one create, final verification),
a minimum remaining reserve of 1000, and zero retries. Any ambiguity or partial
result stops without repair.

## Rollback and convergence

Phase A rollback is deletion of no state because Phase A writes nothing. For a
future Phase B, rollback never deletes or renames a Project field or option.
Disable the new apply authorization, retain `Component` and `Status`, preserve
any created `Area` state for review, and restore the immutable consumer workflow
pin if migration cannot converge. A second authorized execution must plan zero
schema operations before consumer apply can be considered.
