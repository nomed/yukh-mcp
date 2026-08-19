# Contracts and implementations

Use these sources when building or testing an integration. Accepted RFCs define
semantics; reference packages validate records without network or provider
access.

| Contract             | Accepted decision                                                                                                                                                                                                                              | Executable reference                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability v1        | [RFC-0001](https://github.com/nomed/yukh-mcp/blob/main/.context/rfcs/RFC-0001-versioned-capability-contract.md)                                                                                                                                | [Package and API](https://github.com/nomed/yukh-mcp/tree/main/contracts/capability/v1)                                                                                          |
| Authorization v1     | [RFC-0002](https://github.com/nomed/yukh-mcp/blob/main/.context/rfcs/RFC-0002-deny-by-default-authorization.md)                                                                                                                                | [Package and API](https://github.com/nomed/yukh-mcp/tree/main/contracts/authorization/v1)                                                                                       |
| Mutation lifecycle   | [RFC-0003](https://github.com/nomed/yukh-mcp/blob/main/.context/rfcs/RFC-0003-bound-plan-approval-apply-lifecycle.md)                                                                                                                          | [`packages/lifecycle`](https://github.com/nomed/yukh-mcp/tree/main/packages/lifecycle/src): disabled, provider-neutral reference engine and repository-local reservation ledger |
| Mutation qualification fixture | [Issue #94](https://github.com/nomed/yukh-mcp/issues/94), constrained by RFC-0001 through RFC-0004 and RFC-0010 | [Synthetic setting qualification](example-setting-qualification.md): in-memory, network-free, unregistered effect/verifier/restore fixture |
| Sandbox Projects Effect B | [Proposed RFC-0011](https://github.com/nomed/yukh-mcp/blob/main/.context/rfcs/RFC-0011-sandbox-github-projects-capability.md), [issue #96](https://github.com/nomed/yukh-mcp/issues/96), conforming to Accepted [Projects #150](https://github.com/nomed/yukh-projects/issues/150) contracts at `main@521be0d` | Contract review only for `projects.add-dependency.v1` and exactly `add_dependency(201 blocks 202)`; executable bridge/wrapper artifacts remain unpublished; no implementation, registration, credential, network, provider, or gateway path |
| Audit evidence       | [RFC-0004](https://github.com/nomed/yukh-mcp/blob/main/.context/rfcs/RFC-0004-structured-redacted-audit-evidence.md), [RFC-0010](https://github.com/nomed/yukh-mcp/blob/main/.context/rfcs/RFC-0010-repository-local-durable-audit-profile.md) | [Writer and repository-local profile](audit-writer.md)                                                                                                                          |
| Coordination adapter | [RFC-0005](https://github.com/nomed/yukh-mcp/blob/main/.context/rfcs/RFC-0005-stable-coordination-consumer-adapter.md)                                                                                                                         | Synthetic loopback qualification only                                                                                                                                           |
| Runtime worker activity | [Event and subject policy](../architecture/event-subject-policy.md) | [`worker.activity.v1`](https://github.com/nomed/yukh-mcp/tree/main/contracts/runtime/v1): CloudEvents-like runtime activity contract for JetStream subjects; local log files are preview adapters only |

The lifecycle plan, approval, execution, verification, and rollback records are
closed and digest-bound. Apply always obtains and enforces a distinct current
authorization decision. The engine durably reserves an exact attempt before the
effect port, enforces bounded effect and verification deadlines, treats provider
return as an observation rather than success, and releases success only after
exact declared postconditions and terminal audit commit. Rollback is another
complete authorized lifecycle and must match the capability declared by the
original plan.

The repository-local lifecycle ledger is a network-free qualification profile,
not a gateway default or production database. It is single-writer, bounded,
append-only, ignored by git, and separate from audit storage. No implementation
in this reference registers an effect provider, credential, endpoint, or MCP
mutation surface.

The synthetic setting package is a provider fixture only. It qualifies exact
effect, verification, idempotency, recovery, and separately authorized restore
behavior but remains unreachable from gateway discovery or invocation.

RFC-0011 is Proposed and has no implementation authority. It conforms to the
Accepted Projects Effect B and compound-admission specifications at
`nomed/yukh-projects@521be0d0ef1297579e84a6322dea29f80c2549dc`.
Projects has not implemented or published immutable bridge-verifier or
`runMcpEffectBControlledApplyV1` wrapper artifacts. RFC-0011 must pin those
future artifacts and receive acceptance before any separate implementation
gate. The ordinary gateway remains inert.

## Validate the repository

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
```

Unknown versions, fields, bindings, or policy outcomes fail closed. Reference
packages do not authorize a provider, credential, target, or deployment.
