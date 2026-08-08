# Synthetic setting mutation qualification

Issue [#94](https://github.com/nomed/yukh-mcp/issues/94) adds one
network-free, local-only provider fixture for exercising the accepted
provider-neutral mutation lifecycle. The fixture is compiled but is not imported
by the gateway or any runtime entry point.

## Frozen qualification contract

| Binding | Value |
| --- | --- |
| Capability | `example.setting.update@1.0.0` |
| Definition digest | `sha256:d3436429587715737dc9fbae282eeff4d9296600e98f30c735d49c0c4356b0a7` |
| Resource | `example_setting` / `setting-example-01` |
| Environment | `development` |
| Input | `{"name":"display_mode","value":"compact"}` |
| Idempotency | keyed, required, one attempt, retry never |
| Verifier | `setting_value_matches` |
| Rollback mode | `restore` |
| Public fixture ordered operation-set digest | `sha256:dbff0e308503e936c076944c420d89c38c6882d49238583aabbd6929d0f897ad` |

The public operation-set digest is the canonical digest of
`[{"kind":"update","field":"display_mode"}]` from the capability-plan fixture.
The provider-neutral lifecycle independently digests its closed internal step
records; the two digests are intentionally not interchangeable.

## Qualified behavior

Each provider instance owns one in-memory synthetic setting and makes no
filesystem, process, credential, endpoint, or network call. The effect port:

- accepts only the frozen capability, resource, environment, typed input,
  verifier, restore declaration, and keyed idempotency profile;
- binds a key to the exact execution, plan, subject, capability, resource,
  environment, input, and both operation-set digests;
- returns the byte-equivalent stored result for an exact replay without another
  mutation;
- rejects conflicting key reuse and stale state before another effect; and
- exposes bounded health/capacity observations used as lifecycle preconditions.

The verifier independently hashes the current resource, environment, setting
name, value, and monotonic synthetic version. A provider return is not success:
only a current digest matching `setting_value_matches` can release the result.
Wrong versions, state, targets, plans, or executions fail or become
inconclusive.

`restore` is a second synthetic capability input bound to the original
execution, original plan, exact pre-update snapshot, and observed current state.
It receives a new plan, approval fixture, fresh authorization decision,
reservation, effect call, verification, and terminal evidence. It is not an
implicit undo path.

Qualification composes the provider with the accepted repository-local durable
audit writer, recovery journal, repository-local lifecycle ledger, and
provider-neutral engine. Tests cover verification-gated success, policy and
approval denial, expiry, substitution, exact replay, conflict, concurrent
duplicates, post-effect unknown completion and recovery evidence, restart
without retry, verifier mismatch, rollback success/failure/order, and
health/capacity denial with zero effect and external calls.

## Canonical evidence

[`example-setting-qualification-v1.json`](example-setting-qualification-v1.json)
is the canonical future-registration evidence. Its `implementation.source_digest`
is SHA-256 over the exact provider source bytes. Its `evidence_digest` is the
canonical lifecycle SHA-256 digest of the complete evidence object with only the
`evidence_digest` member omitted. Tests reproduce the capability, operation-set,
source, and combined evidence digests.

This evidence qualifies a fixture; it does not register anything. A future
registration gate must independently review and bind the exact evidence digest,
the capability definition, implementation provenance, verifier/target identity,
restore capability, approval-integrity profile, operational audit/storage
profile, and deployment threat model.

## Explicit non-authorizations

This fixture does **not** authorize or implement:

- gateway discovery, provider registration, or an MCP mutation surface;
- approval issuance for RFC-0003 apply-admission Step 9;
- Step 9 execution or any other live provider execution;
- credentials, endpoints, network access, external state, or production state;
- Yukh Projects apply, deployment, or release activation;
- recovery import/acknowledgement or automatic reconciliation; or
- a production-readiness, durability, immutability, or independently witnessed
  evidence claim.
