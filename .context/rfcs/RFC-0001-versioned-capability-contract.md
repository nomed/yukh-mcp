# RFC-0001 — Versioned capability contract

- Status: Draft
- Authors: Codex
- Created: 2026-08-03
- Governing issue: https://github.com/nomed/yukh-mcp/issues/5

## Summary

Define the vendor-neutral contract by which Yukh MCP registers, discovers,
authorizes, plans, invokes, verifies, and reports bounded capabilities.

A capability is a static server-registered operation. A client selects its
identity and version and supplies schema-valid data; it cannot select an
executable, interpreter, provider method, credential, or unrestricted command.
The contract describes scope, risk, mutation behavior, time and resource bounds,
idempotency, retry safety, verification, rollback, and structured results.

This RFC defines the contract. It does not select an MCP transport binding,
policy engine, provider SDK, persistence layer, or operational capability.

## Motivation

An MCP interface can be syntactically typed while still delegating excessive
authority through a field such as `command`, `script`, or arbitrary `argv`.
Yukh MCP instead needs a contract that makes the authority and expected effects
of an operation reviewable before a provider receives a request.

The gateway must also distinguish failures that callers may safely correct or
retry from ambiguous provider outcomes that require verification or operator
review. Those semantics cannot be left to provider-specific prose.

## Normative language

The terms MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY
are normative. Contract validation is server-side and deterministic. Failure to
validate, resolve, authorize, plan, or verify fails closed.

## Goals

- identify capabilities with a stable name and exact semantic version;
- validate typed inputs and structured outputs deterministically;
- bind every request to a canonical resource and environment;
- declare risk, effects, mutation, approval, and destructive behavior;
- define timeout, concurrency, idempotency, and retry semantics;
- make verification and rollback behavior explicit;
- return stable, sanitized errors and evidence references;
- support read-only and mutating capabilities without exposing provider
  credentials or mechanics;
- define compatibility rules for clients, gateways, and providers.

## Non-goals

- define unrestricted shell, script, SQL, GraphQL, HTTP, or provider-native API
  execution as public capabilities;
- define authentication, authorization policy language, or approval transport;
- standardize provider-internal implementation or credential storage;
- define the complete plan lifecycle governed by #4;
- define the complete audit envelope governed by #9;
- guarantee rollback for operations whose domain cannot support it;
- select JSON Schema tooling or the official MCP SDK implementation.

## Detailed design

## Contract model

The public contract consists of four distinct records:

1. `CapabilityDefinition`: immutable definition registered by the server.
2. `CapabilityRequest`: one invocation request from an authenticated client.
3. `CapabilityPlan`: immutable, expiring proposed effects derived server-side.
4. `CapabilityResult`: structured outcome and verification summary.

Definitions are public API. Requests, plans, and results are runtime records.
Provider configuration and credentials are not part of any public record.

All records use UTF-8 JSON-compatible data. Timestamps use RFC 3339 UTC with
fractional seconds permitted. Digests use an algorithm-prefixed lowercase value,
for example `sha256:<lowercase-hex>`. Identifiers are opaque strings with a
record-specific prefix and MUST NOT encode secrets or personal data.

## Capability definition

The normative logical shape is:

```yaml
contract_version: 1
capability:
  id: node.inspect
  version: 1.0.0
  summary: Inspect bounded metadata for one configured node
  stability: experimental
resource:
  kinds: [node]
  cardinality: one
environment:
  required: true
operation:
  model: typed
  class: read
  effects: [observe]
input:
  schema: {}
output:
  schema: {}
risk:
  level: low
  data_classes: [operational_metadata]
mutation:
  mode: none
  destructive: false
approval:
  mode: never
execution:
  timeout_ms: 5000
  max_attempts: 1
  concurrency: per_resource
idempotency:
  classification: naturally_idempotent
  key: forbidden
retry:
  policy: safe_before_start_only
verification:
  mode: required
  postconditions: [resource_identity_matches, output_schema_valid]
rollback:
  mode: not_applicable
errors:
  taxonomy_version: 1
```

### Identity and version

`contract_version` MUST equal a gateway-supported positive integer.

`capability.id` MUST match:

```text
^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$
```

The identifier names domain intent, not execution machinery. Identifiers whose
public meaning is unrestricted execution, including generic shell, script,
interpreter, arbitrary request, or command proxy behavior, MUST be rejected at
registration even if they match the syntax.

`capability.version` MUST be a complete SemVer version without a range or
wildcard. Clients request one exact version or use a separately defined server
negotiation operation; providers never choose a different version silently.

`capability.summary` is bounded public text and has no authority semantics.
`stability` is one of `experimental`, `preview`, `stable`, or `deprecated`.
Stability is not a security level.

### Typed-operation invariant

`operation.model` MUST be `typed`. No other public execution model exists in
contract version 1.

The provider implementation is selected only by the server-side registry for
the exact capability identity and version. Public input schemas MUST NOT contain
a field whose semantics select or supply:

- an executable, interpreter, script, command line, raw argument vector, query
  language program, arbitrary network request, or provider method;
- a credential, private key, bearer token, session secret, or credential
  locator;
- an unbounded resource locator that bypasses the declared resource scope;
- an extension that changes operation class, effects, risk, approval,
  verification, or rollback behavior.

Strings remain valid domain data when their interpretation is bounded by the
capability definition. Schema validation alone cannot prove semantic safety, so
registration additionally requires provider conformance and human design
review. A provider that interprets ordinary data as unrestricted executable
input violates the contract.

`operation.class` is one of `read`, `mutate`, or `mixed`. `mixed` is permitted
only when one request deterministically selects a definition-declared path and
the plan exposes the selected effects before apply.

`operation.effects` is a non-empty set selected from a versioned gateway
registry. Contract version 1 defines `observe`, `create`, `update`, `delete`,
`execute_bounded`, and `emit`. `execute_bounded` means a fixed provider operation
with typed data; it never means arbitrary command execution.

### Schemas

`input.schema` and `output.schema` MUST be embedded JSON Schema 2020-12 objects
from the Yukh-supported profile. The initial profile:

- requires a root object and `additionalProperties: false` at every object
  boundary unless an extension namespace is explicitly declared;
- requires finite limits for strings, arrays, object properties, numeric ranges,
  and nesting depth;
- forbids remote references, dynamic references, executable formats, custom
  validation code, and unknown schema vocabularies;
- allows only local `$defs` references with bounded, acyclic resolution;
- distinguishes omitted values from explicit `null`;
- rejects duplicate object keys before schema evaluation;
- produces all applicable diagnostics in stable path/code order, subject to a
  documented maximum diagnostic count.

The canonical schema profile and its machine-readable metaschema are deliverables
of #5 implementation. Examples and negative fixtures MUST validate against the
same artifact used by the runtime.

Output validation is mandatory. A provider result that fails its declared
schema is `provider_protocol_error`; raw invalid output MUST NOT pass through.

### Resource and environment scope

`resource.kinds` is a non-empty allowlist of stable domain kinds.
`resource.cardinality` is `one` or `many`. `many` requires an explicit finite
maximum and atomicity/partial-result semantics.

The client supplies a logical resource reference in the request. The gateway
canonicalizes and resolves it server-side, then binds its canonical identity to
authorization, plan, provider invocation, verification, result, and evidence.
A provider MUST NOT substitute or widen the target.

Every request is bound to one canonical environment. `environment.required`
MUST be true in contract version 1. Environment names are logical policy keys,
not credential or deployment locators.

### Risk, mutation, and approval

`risk.level` is `low`, `medium`, `high`, or `critical`. `risk.data_classes` is a
bounded set from a versioned classification registry. Risk is descriptive input
to policy and cannot lower policy requirements.

`mutation.mode` is `none`, `planned`, or `transactional`:

- `none` permits no intentional target-state change;
- `planned` requires plan and apply as distinct operations;
- `transactional` additionally declares an atomic provider boundary, without
  implying distributed atomicity.

`mutation.destructive: true` requires `operation.class` to include mutation,
`approval.mode: explicit`, `max_attempts: 1`, no automatic retry, declared stop
conditions, and a rollback or explicit non-recoverability statement. A mismatch
between effects and mutation metadata invalidates registration.

`approval.mode` is `never`, `policy`, or `explicit`. `never` is valid only for
read-only, non-destructive definitions. `policy` means the authorization
decision determines whether an approval obligation applies. `explicit` means
apply always requires a valid plan-bound approval. Approval cannot expand the
authorized scope.

### Execution, idempotency, and retry

`execution.timeout_ms`, input/output byte limits, and any item limits are finite
positive integers within gateway maxima. `execution.max_attempts` counts the
initial attempt and MUST be at least one. `execution.concurrency` is one of
`unrestricted_read`, `per_subject`, `per_resource`, or `exclusive_scope`;
gateway policy may impose a stricter value.

`idempotency.classification` is one of:

- `naturally_idempotent` — repeated execution has the same intended effect;
- `keyed` — one caller-supplied opaque key identifies the same bound operation;
- `non_idempotent` — repetition may produce another effect.

`idempotency.key` is `required`, `optional`, or `forbidden`. Keys are bound to
subject, capability version, canonical resource, environment, normalized input
digest, and plan identity where applicable. Reuse with different bindings is a
conflict, not a new execution.

`retry.policy` is one of:

- `never`;
- `safe_before_start_only`;
- `safe_on_declared_transient_before_effect`;
- `provider_verified_idempotent`.

Automatic retry is forbidden after an ambiguous outcome, for destructive
operations, or for `non_idempotent` definitions. Retry permission never implies
retry obligation. Backoff, attempt, and total-duration limits are gateway
controlled and observable; providers cannot hide additional attempts.

### Verification and rollback

`verification.mode` is `required` or `not_applicable`. Mutation requires
`required`. A read capability may use `not_applicable` only if schema validation
and resource-identity binding are sufficient and the rationale is reviewed.

`verification.postconditions` is a non-empty set of stable verifier identifiers
when verification is required. Verifiers are server-registered, receive bounded
data, and cannot treat provider success as proof of their own postcondition.
Verification returns `verified`, `failed`, or `inconclusive`; only `verified`
satisfies success for a mutation.

`rollback.mode` is `not_applicable`, `compensating`, `restore`, or
`unavailable`. Mutation definitions MUST declare one exact value. `unavailable`
requires rationale, explicit approval, elevated risk review, and documented
operator recovery. Rollback is a separately authorized, planned, and verified
capability; it is never an automatic hidden retry.

## Capability request

```yaml
request_version: 1
request_id: req_example7f3a
capability:
  id: node.inspect
  version: 1.0.0
resource:
  kind: node
  ref: node-example-01
environment: development
input:
  include: [health, platform]
idempotency_key: null
```

The authenticated subject is derived from transport/session context and MUST
NOT be accepted from this payload. The gateway resolves the exact definition,
normalizes and validates input, canonicalizes scope, evaluates authorization,
and only then invokes planning or read execution. Unknown fields are rejected.

`request_id` is caller-generated correlation data with strict syntax and length
bounds. It supplies no identity, ordering, uniqueness, or idempotency authority.

## Capability plan

The complete lifecycle is governed by #4. This RFC requires at minimum:

```yaml
plan_version: 1
plan_id: plan_example91c2
plan_digest: sha256:0000000000000000000000000000000000000000000000000000000000000000
request_id: req_example7f3a
capability:
  id: example.setting.update
  version: 1.0.0
subject_ref: sub_example
resource_ref: resource_example
environment: development
policy_decision_ref: decision_example
created_at: 2026-08-03T00:00:00Z
expires_at: 2026-08-03T00:05:00Z
preconditions: []
effects: []
verification: []
rollback: unavailable
```

The digest covers the canonical plan, including exact definition version,
normalized input digest, subject, canonical resource, environment, policy
decision/version, preconditions, effects, verification, rollback, and expiry.
Changed preconditions or bindings invalidate the plan.

## Capability result

```yaml
result_version: 1
request_id: req_example7f3a
capability:
  id: node.inspect
  version: 1.0.0
status: succeeded
resource_ref: node-example-01
environment: development
attempts: 1
started_at: 2026-08-03T00:00:00Z
finished_at: 2026-08-03T00:00:01Z
output: {}
verification:
  status: verified
  evidence_refs: [evidence_example2ad4]
error: null
```

`status` is `succeeded`, `denied`, `failed`, `partial`, or `indeterminate`.
`succeeded` for mutation requires verified postconditions. `indeterminate` means
the effect cannot safely be classified and prohibits automatic retry. `partial`
requires item/effect-level structured results and declared recovery guidance.

Output and error records are size bounded and schema validated. Evidence is
referenced by opaque identifier; secrets, credentials, raw prompts, private
reasoning, and unrestricted provider output are forbidden.

## Error taxonomy

Every failure uses a stable code, phase, retry classification, sanitized message,
bounded diagnostics, and correlation identifiers. Provider bodies, stack traces,
credentials, policy inputs, and sensitive resource details are excluded.

Phases are `resolve`, `validate`, `authorize`, `plan`, `approve`, `execute`,
`verify`, `rollback`, and `audit`.

Contract version 1 reserves these top-level codes:

| Code | Meaning | Retry classification |
| --- | --- | --- |
| `unsupported_contract_version` | Record version is unsupported | never |
| `capability_not_found` | Exact capability identity/version is unavailable or undisclosed | never |
| `invalid_request` | Request shape or field is invalid | after_correction |
| `schema_validation_failed` | Input or output violates the declared schema | after_correction for input; never for provider output |
| `scope_resolution_failed` | Resource or environment cannot be resolved safely | after_correction |
| `authorization_denied` | Policy returned explicit deny | after_policy_change |
| `authorization_unavailable` | Policy decision is missing, invalid, stale, or unavailable | caller_must_replan |
| `plan_invalidated` | Plan expired or a binding/precondition changed | caller_must_replan |
| `approval_required` | Exact plan lacks a valid required approval | after_approval |
| `approval_invalid` | Approval binding, signer, policy, or validity failed | caller_must_replan |
| `execution_timeout` | Provider exceeded its declared execution bound | indeterminate unless no effect is proven |
| `provider_unavailable` | Provider could not start safely | policy_declared |
| `provider_protocol_error` | Provider violated its registered contract | never |
| `verification_failed` | Declared postcondition is false | operator_review |
| `verification_inconclusive` | Postcondition cannot be established | operator_review |
| `partial_failure` | Only a declared subset completed | operator_review |
| `outcome_indeterminate` | Effects cannot be classified safely | operator_review |
| `rollback_failed` | Authorized rollback did not verify | operator_review |
| `audit_unavailable` | Required evidence cannot be committed | never; fail closed |
| `rate_limited` | A declared gateway/provider bound was reached before effect | policy_declared |
| `internal_error` | Sanitized unexpected failure | policy_declared only when no effect is proven |

Diagnostics contain `code`, JSON Pointer `path`, and sanitized `message`.
Ordering is lexical by path, then code, then discovery index. Implementations
MUST return byte-stable diagnostics for identical invalid input and contract
version, excluding correlation identifiers and timestamps.

## Discovery and authorization

Discovery returns only exact definitions the gateway is willing to disclose for
the authenticated subject and environment. Discovery is not authorization:
every invocation receives a fresh server-side decision. Definitions never expose
provider identity, credentials, internal endpoints, policy contents, or target
inventory beyond explicitly authorized public metadata.

## Registration and conformance

A definition is accepted into the server registry only when:

- its complete record and schemas validate canonically;
- identity/version is unique and its digest is immutable;
- operation, effects, mutation, approval, retry, verification, and rollback
  declarations are internally consistent;
- schemas and provider behavior contain no unrestricted execution or credential
  channel;
- provider qualification proves input/output bounds and negative cases;
- threat-model impact and required RFC review are complete;
- examples are synthetic and contain no sensitive identifiers.

Registration failure returns deterministic diagnostics and makes the capability
undiscoverable and uninvokable. Hot replacement under an existing exact version
is forbidden.

## Compatibility

`contract_version` governs record shape and semantics. A change that removes or
reinterprets a field, weakens validation, changes canonicalization, changes an
error meaning, or expands authority requires a new contract version and RFC.

Capability SemVer governs one capability:

- PATCH may clarify metadata or fix provider behavior without changing valid
  inputs, structured outputs, authority, effects, or failure semantics;
- MINOR may add optional bounded input, additive output, or stricter safe
  behavior that preserves existing successful requests;
- MAJOR is required for removed/required input, changed output meaning, wider
  authority, changed effects, mutation/risk/approval changes, or incompatible
  verification, rollback, timeout, retry, or error behavior.

Any authority expansion requires explicit review even when SemVer would
otherwise classify the data shape as additive. Clients MUST ignore neither
unknown contract fields nor unknown enum values; they reject unsupported
semantics. Gateways may support multiple exact versions concurrently.

Deprecation does not redirect requests. Removal requires published support and
migration policy; an unavailable exact version fails closed.

## Trust boundaries and threat analysis

This contract crosses the client/gateway and gateway/provider boundaries and
binds the identity/policy, provider/target, and runtime/audit boundaries.

- Prompt and content injection cannot change a registered definition or select
  provider mechanics.
- Confused-deputy risk is controlled by canonical scope binding across decision,
  plan, provider call, verification, and evidence.
- Command injection is constrained by static provider selection, bounded data
  schemas, and the typed-operation invariant; provider conformance remains
  necessary because schema cannot prove implementation semantics.
- Approval replay is controlled by exact plan and policy bindings.
- Unsafe retry is controlled by explicit classification and indeterminate stop
  states.
- Credential disclosure is controlled by excluding credential material and
  locators from every public schema and record.
- Malicious provider output is bounded, validated, classified, and redacted
  before reaching clients or audit records.

The threat model MUST be reviewed again when the machine-readable contract,
first provider, plan lifecycle, policy protocol, or audit envelope is proposed.

## Validation and acceptance evidence

Implementation under #5 is complete only when one canonical machine-readable
schema validates definitions, requests, plans, results, and errors, with:

- valid synthetic read-only and mutating examples;
- deterministic golden diagnostics;
- negative fixtures for unknown fields, unsupported versions, unbounded schema,
  inconsistent mutation metadata, unsafe retries, missing verification,
  credential-shaped inputs, and unrestricted execution semantics;
- property or generative tests for bounds, canonicalization, and diagnostic
  stability;
- provider conformance fixtures proving output validation and fail-closed
  behavior.

## Rollout and rollback

1. Accept this RFC explicitly through human review.
2. Add the contract package and machine-readable schemas without a provider or
   network listener.
3. Add synthetic examples and negative/conformance tests.
4. Review threat-model impact and compatibility evidence.
5. Use the accepted contract in #3, #4, #6, #8, and #9.

Before any released consumer exists, rollback removes the unaccepted package and
returns to documentation-only Foundation. After publication, exact previous
contract and capability versions remain addressable for their support window;
rollback never mutates an existing version or moves an immutable reference.

## Alternatives

### Expose provider tools directly

Rejected because provider mechanics and credentials would leak into the public
authority boundary and compatibility would become vendor-specific.

### Treat every MCP tool schema as a complete capability contract

Rejected because ordinary tool schemas do not necessarily declare canonical
scope, effects, mutation, risk, approval, idempotency, retry, verification,
rollback, or audit semantics.

### Offer one generic command capability

Rejected because typed syntax around a command string still transfers
unrestricted operational authority and defeats policy review.

### Make mutation a separate contract generation

Rejected because one definition model can represent read and mutation safely
when mutation metadata and lifecycle gates are mandatory and mechanically
consistent.

### Allow provider-defined error strings

Rejected because callers could not distinguish safe correction, replan,
operator review, or indeterminate effect, and sensitive provider details could
escape.

## Open questions

Human acceptance is requested for these choices:

1. Is JSON Schema 2020-12 with the restricted embedded profile the correct
   schema basis for contract version 1?
2. Should `mixed` operation class exist in version 1, or should every read and
   mutation path require a separate capability identity?
3. Is `rollback.mode: unavailable` acceptable for high-risk non-destructive
   mutation with explicit approval, or should it be forbidden until a later
   contract version?
4. Should discovery hide nonexistent and unauthorized capabilities behind one
   indistinguishable result to reduce enumeration?
5. Are the initial effect and error registries small and precise enough for the
   Foundation slice?
