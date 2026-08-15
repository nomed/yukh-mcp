# Threat model

- Status: Initial
- Last reviewed: 2026-08-08
- Scope: Foundation architecture, read-only vertical slice, inert Project 5 controlled-apply credential boundary, durable network-free audit profile, and provider-neutral mutation lifecycle reference
- Security owner: Yukh MCP maintainers
- Review authority: an independent maintainer for security-boundary changes

## Security objectives

Yukh MCP gives an authenticated subject only the capabilities explicitly
authorized for an exact resource and environment. Credentials remain outside
model context; mutations cannot occur without a bound plan and any required
approval; outcomes and failures remain explainable through redacted evidence.

The system fails closed. Availability loss is preferable to an operation whose
identity, scope, policy, plan, or provider result cannot be established safely.

## Assets

- subject, node, workload, and provider identities;
- authorization policy, decisions, constraints, and obligations;
- infrastructure credentials and provider authority;
- capability definitions, schemas, and compatibility metadata;
- plans, approvals, idempotency state, and rollback information;
- execution results and verification evidence;
- audit records, correlation data, integrity metadata, and retention policy;
- source, dependencies, workflows, build outputs, and release provenance.

## Actors and assumptions

The model assumes that MCP clients, model-generated input, repository content,
provider output, target data, network responses, logs, and dependency metadata
may be malicious or malformed. An authenticated subject may be compromised or
may attempt to exceed its authority. Providers and policy dependencies may fail,
stall, return stale data, or be compromised.

The Foundation model does not assume a trusted prompt, a trusted client-side
approval, a trusted process exit code, or a trusted target response. It does not
claim protection after compromise of every gateway runtime control, policy
authority, provider credential, and audit integrity mechanism at the same time.
Deployment-specific identity, key custody, policy-engine, audit-storage, and
availability guarantees require later accepted provider profiles.

## Trust boundaries

| Boundary                               | Principal threats                                                                                                               | Initial controls                                                                                                                                                            | Residual Foundation risk                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| MCP client → gateway                   | prompt injection, forged identity context, schema abuse, oversized or repeated input, capability enumeration                    | authenticated transport profile, server-derived subject, exact versioned capability allowlist, strict schemas, input and request bounds, deny before disclosure             | concrete authentication and rate-limit profiles are not yet selected                |
| Gateway → identity and policy services | authentication confused with authorization, stale or substituted policy, dependency failure, cross-resource confused deputy     | canonical subject/action/resource/environment request, policy version binding, explicit deny, fail-closed timeout/error handling, decision evidence                         | policy-engine protocol and freshness bounds require an RFC                          |
| Gateway → capability provider          | provider selected by untrusted input, argument injection, excessive authority, unsafe retry, result confusion                   | server-side provider registry, typed arguments, least-privilege credential profile, bounded time/output, idempotency and retry declaration, correlation binding             | no operational provider is implemented yet                                          |
| Provider → target node                 | traversal or symlink escape, command injection, target substitution, credential disclosure, malicious output, partial effect    | configured canonical roots and target identity, no unrestricted shell interface, argument allowlists, credential isolation, output sanitization, postcondition verification | provider-specific sandbox and target identity require separate review               |
| Runtime → audit storage                | secret retention, prompt retention, event forgery, deletion, reordering, correlation substitution, storage exhaustion           | allowlisted redacted event schemas, bounded records, correlation and causation identifiers, integrity metadata, restricted writer/reader roles                              | storage, retention, export, and tamper-evidence implementation are not yet selected |
| Source → workflow → release            | malicious dependency or contributor, mutable action reference, artifact substitution, secret exposure, untrusted-PR publication | reviewed changes, immutable action pins, least-privilege workflow permissions, deterministic checks, dependency review, SBOM/provenance roadmap, protected release          | repository settings and release signing require qualification evidence              |

## Abuse cases and required response

### Prompt and content injection

An inspected file, issue, target response, or tool result instructs the model to
invoke a stronger capability, reveal a credential, or ignore policy. All such
content remains data. Capability selection, authorization, approval, argument
validation, and output classification are enforced server-side and cannot be
overridden by content or prompt text.

### Command and argument injection

A caller embeds shell syntax, path traversal, option smuggling, control bytes, or
provider-specific expressions in an input. Public capabilities do not accept
unrestricted command strings. Schemas constrain values; providers build typed
operations without shell interpolation, canonicalize paths and targets, reject
unknown options, and bound input and output. Negative tests cover traversal,
symlink escape, quoting, separator, encoding, and oversized-input cases relevant
to each provider.

### Confused deputy and target substitution

A valid subject attempts to use its identity or one authorized resource to act
on another resource, environment, or provider. The gateway binds the canonical
subject, action, resource, environment, capability version, policy decision,
plan, approval, and provider target. Authentication or Project/Coordination
state never supplies execution authority. Any mismatch denies before provider
invocation and produces sanitized decision evidence.

### Approval replay or substitution

An approval is copied to another plan, target, subject, policy version, or later
state. Approval binds an immutable plan identity and digest, subject, capability,
resource, environment, policy decision/version, validity interval, and current
preconditions. Changed or expired bindings invalidate it. Destructive operations
are never silently retried.

### Credential and sensitive-output disclosure

A capability input, provider response, exception, or audit record attempts to
move credentials or sensitive target data into model context. Credentials remain
behind the provider boundary and are excluded from public schemas. Outputs use
allowlisted structured fields, classification, size limits, and redaction;
unknown fields or failed redaction stop the response rather than pass through.

### Audit deletion or tampering

An actor suppresses a denial, substitutes correlation identifiers, reorders
events, or deletes evidence. Events bind request, decision, plan, execution, and
verification identifiers and include integrity and ordering metadata. Audit
write authority is separated from ordinary provider authority. RFC-0004 defines
hash-chained, integrity-verifiable evidence and explicitly does not claim
immutable or independently witnessed storage without a qualified deployment
profile.

### Supply-chain compromise

A dependency, workflow action, contributor, build environment, tag, or artifact
is substituted. Workflows use minimum permissions and immutable action commits;
untrusted pull requests cannot publish or receive release credentials. Releases
must be derived from reviewed protected source and accompanied by verifiable
integrity evidence. Unsupported provenance or signing claims are forbidden.

### Exhaustion and unsafe retry

A caller or dependency consumes request, compute, provider, or audit capacity,
or induces a retry after an ambiguous result. Capabilities declare time, input,
output, concurrency, and retry bounds. Unknown completion state is observable
and is not treated as safe to retry. Policy or evidence dependency exhaustion
fails closed.

## Security review requirements

The security owner reviews this model at least:

- before accepting a new public capability or provider;
- before any mutating capability becomes implementable;
- for every identity, authorization, approval, credential, audit, deployment,
  or release trust-boundary change;
- after a material vulnerability, abuse finding, dependency incident, or change
  in attacker assumptions;
- before each security-reviewed release and at least once every twelve months
  while the project is maintained.

Every review records the date, scope, governing issue or RFC, changed threats,
controls, residual risks, validation evidence, and reviewer. New mutating
capabilities require an RFC, threat-model impact review, negative and abuse-case
tests, and explicit human acceptance before implementation. Accepted ADRs and
RFCs are superseded rather than edited.

## Open Foundation work

- RFC-0002 defines the authorization decision and failure contract. Its v1
  network-free reference package validates exact bindings, deny overrides,
  all-or-nothing resource sets, constraint intersection, obligation
  accumulation, and one-shot decision consumption. External identity and policy
  adapters, durable replay state, and production enforcement remain absent.
- #5 defines the versioned capability contract and bounded provider semantics.
- RFC-0004 defines audit envelopes, redaction, retention, ordering, integrity
  verification, and the limits of those guarantees. A network-free writer
  foundation exists under #84; no durable backend is implemented.
- #10 qualifies repository, CI, dependency, and release supply-chain controls.

Until those records are accepted, this model establishes constraints and stop
conditions; it does not authorize operational capabilities or production use.

## Accepted local Coordination conversation preview — 2026-08-14

- Governing issue: #109
- Accepted architecture: RFC-0012
- Scope: isolated STDIO tools for local Codex–Copilot question and answer tests
- New trust boundary: MCP model tool call to a fixed native Coordination client

The accepted preview keeps the ordinary gateway inert and grants no provider or
protected-target authority. Fixed commands, closed schemas, no shell, bounded
I/O, sanitized failures and native receipt verification constrain the local
preview. Transcript content remains untrusted data. Implementation requires
negative tests for command, profile, credential and output-boundary
substitution.

## Accepted explicit local Coordination bootstrap — 2026-08-14

- Governing issue: #111
- Accepted architecture: RFC-0013
- Scope: one no-input, preview-only MCP action for explicit session bootstrap
- Changed trust boundary: model-selected call reaches native credential custody

The tool cannot select an agent, command, launcher, endpoint, descriptor,
profile or credential. The native client refuses replacement of a live session
and uses exact-revision CAS for an expired session. Bootstrap is never invoked
implicitly and never retries a failed Coordination operation. Credential and
key material remain outside MCP input, output and logs. Residual risks are
local issuance denial of service and availability loss. This accepted boundary
grants no provider or protected-target authority and authorizes only the
local-preview implementation and qualification in RFC-0013.

## Accepted bounded local conversation coordinator — 2026-08-14

- Governing issue: #113
- Accepted architecture: RFC-0014
- Scope: local wake-up of fixed Codex and Copilot CLI adapters

The coordinator treats transcript bodies as untrusted data and passes adapters
only a server-owned instruction plus a validated event ID. Fixed absolute
executables, no shell, a trusted workspace, one in-flight turn, deduplication,
timeouts, run lifetime and turn ceilings constrain execution. Authentication
recovery may repeat replay only; publications are never retried. Closed logs
exclude prompts, model output, credentials and arbitrary errors. Residual risk
is bounded local workspace mutation or availability loss; no provider or
protected-target authority is granted.

## Accepted local conversation observer — 2026-08-14

- Governing issue: #115
- Accepted architecture: RFC-0015
- Scope: read-only local transcript display and closed coordinator lifecycle

The observer intentionally displays verified conversation bodies to the local
operator terminal. It has no remote listener or mutation command. Credentials,
private reasoning, raw stderr and unknown fields remain excluded. Receipt
identifiers require an explicit verbose flag. Malformed transcript data fails
closed. Coordinator lifecycle logs contain identifiers and states only, not
message bodies.

## Accepted usable local conversation console — 2026-08-15

- Governing issue: #117
- Accepted architecture: RFC-0016
- Scope: concise observer output and fixed-workspace Copilot read/write access

In the owner-approved temporary local qualification profile, Copilot runs with
`--allow-all`, including arbitrary tools, shell commands, filesystem paths and
URLs. This is explicitly not a production-safe boundary. The host, configured
tools, repository content and transcript are all trusted for this session;
agent-authored changes require operator review. Compact rendering is a display
policy only and does not alter the verified transcript.

## Capability contract implementation review — 2026-08-03

- Governing issue: #5
- Accepted architecture: RFC-0001
- Scope: network-free schemas, validator, synthetic fixtures, and tests
- New trust boundary: none

The contract package processes untrusted record and embedded-schema data but
does not accept network traffic, resolve identity or policy, invoke a provider,
hold credentials, persist audit events, or mutate a target.

Implementation-specific threats and controls are:

| Threat                                                 | Control                                                                                                | Residual risk                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| schema bombs or recursive references                   | node/depth/property limits; remote and cyclic references rejected before compilation                   | complex but acyclic schemas still consume bounded local CPU                  |
| regular-expression denial of service                   | pattern length and construct restrictions; provider schema review remains mandatory                    | the conservative filter is not a formal regex complexity proof               |
| prototype or credential channel through property names | closed objects; dangerous and credential-shaped names rejected; input values excluded from diagnostics | semantic intent still requires human provider review                         |
| diagnostic disclosure or nondeterminism                | allowlisted messages without values; stable path/code ordering; 64-item cap; repeatability tests       | paths reveal only submitted field names                                      |
| malicious or incompatible dependency                   | exact Ajv version and lockfile; install scripts disabled in validation; dependency audit evidence      | registry and build-environment integrity remain governed by #10              |
| invalid provider output represented as success         | result and output validation; mutating success requires verified postconditions                        | real verification semantics remain governed by #4 and evidence uses RFC-0004 |

No operational capability is authorized by this review. A first provider,
listener, authentication profile, policy adapter, plan executor, or audit store
requires another threat-model impact review under its governing issue and RFC.

## Proposed mutation lifecycle review — 2026-08-03

- Governing issue: #4
- Proposed architecture: RFC-0003
- Scope: plan, approval, apply, verification, partial failure, and rollback
- New trust boundaries: approval authority, durable attempt reservation,
  provider apply, target observation, and verifier

RFC-0003 proposes controls before any mutating implementation exists:

| Threat                          | Proposed control                                                                                                 | Residual risk / dependency                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| plan or approval substitution   | canonical digests bind subject, capability, input, target, environment, policy, observations, plan, and approval | approval identity and assertion integrity profile is not selected             |
| stale-plan execution            | fresh authorization and immediate server-side precondition re-observation before apply                           | observation source integrity is provider/deployment specific                  |
| duplicate or unsafe retry       | durable exact-binding reservation, capability attempt ceiling, no retry from ambiguous completion                | durable storage and distributed atomicity are not designed                    |
| provider reports false success  | declared postconditions and independent verification where required                                              | verifier independence and target identity need provider review                |
| partial effect is hidden        | append-only per-step outcomes, aggregate `partial_effect`, and operator-review state                             | operator response process is not defined                                      |
| rollback overwrites newer state | rollback is a new authorized lifecycle with current preconditions                                                | safe compensation may be unavailable                                          |
| evidence omission or reordering | RFC-0004 event registry, durable pre-effect commit, causal correlation, hash chaining, and checkpoints           | durable writer, journal, and checkpoint deployment profiles remain unselected |

This review changes no operational boundary and authorizes no implementation.
RFC-0004 now satisfies the audit-contract dependency; RFC-0003 still requires
explicit project-owner acceptance before it can authorize implementation.

## Proposed audit evidence contract review — 2026-08-03

- Governing issue: #9
- Proposed architecture: RFC-0004
- Scope: typed evidence, correlation, classification, projection, ordering,
  integrity verification, retention, export, and failure behavior
- New trust boundaries: evidence producer, audit writer, checkpoint authority,
  protected store, resolver, verifier, and exporter

RFC-0004 proposes the following controls before an audit backend exists:

| Threat                          | Proposed control                                                                                           | Residual risk / dependency                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| secret or prompt retention      | closed typed payloads, structural allowlist projections, forbidden-content registry, no raw fallback       | producer semantic bugs and side channels still require review               |
| identity or target disclosure   | opaque references, protected resource-set digests, separately controlled resolvers                         | low-entropy digests and resolver misuse require deployment privacy controls |
| event substitution or reorder   | canonical digest binding, per-stream sequence, previous hash, causal references                            | compromised writer can omit facts before emission                           |
| deletion or chain replacement   | periodic checkpoints and optional independent witnessing                                                   | unwitnessed tail truncation remains possible                                |
| misleading immutability claim   | contract says hash-chained/integrity-verifiable; deployment must prove stronger properties                 | storage and checkpoint profile not selected                                 |
| audit outage hides an effect    | fail closed before provider start; durable recovery fact and withheld success after start                  | recovery journal and atomicity require deployment design                    |
| over-retention or unsafe export | registered retention classes, explicit holds, deterministic projections, bounded integrity-bound manifests | legal durations and jurisdictions are deployment-specific                   |

This review authorizes no store, key, identity resolver, export service,
provider, mutation, or production integrity claim. Each deployment profile must
document durability, confidentiality, checkpoint custody, access, retention,
backup deletion, recovery, and monitoring evidence.

## Inert MCP runtime implementation review — 2026-08-03

- Governing issue: #6
- Scope: Node.js listener, stateless MCP initialization and empty discovery,
  configuration, health/readiness, closed operational logs, tests, and Compose
- New trust boundary: unauthenticated network client to inert gateway listener

The runtime exposes no operational capability, provider, credential, target
resolver, policy adapter, approval service, task API, audit store, or mutation
path. Its controls and residual risks are:

| Threat                                  | Control                                                                                                                                   | Residual risk                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| DNS rebinding or virtual-host confusion | exact host allowlist on `/mcp`; wildcard bind requires explicit configuration                                                             | reverse-proxy host rewriting requires a future deployment profile        |
| cross-origin browser invocation         | any `Origin` is denied unless exactly allowlisted                                                                                         | non-browser clients have no Origin and authentication is not implemented |
| oversized or slow request               | content-length and streamed byte bound before SDK parsing; request/header/keep-alive timeouts, connection and per-socket request ceilings | distributed rate limiting still needs a deployment edge profile          |
| protocol parser or SDK defect           | official modular SDK pinned to 2.0.0; strict TypeScript; protocol integration tests; empty registries                                     | dependency compromise and future protocol drift remain possible          |
| accidental operational authority        | empty tools/resources/prompts; no provider or credential modules; discovery test asserts empty lists                                      | later capability registration requires its own review                    |
| log disclosure or injection             | closed records, server-generated correlation, no headers/body/URL/error text                                                              | stdout transport, retention, and integrity are not RFC-0004 audit        |
| container privilege or exhaustion       | non-root user, read-only Compose filesystem, dropped capabilities, no-new-privileges, CPU/memory/PID bounds                               | base image is tag-pinned, not digest-qualified; #10 remains open         |

This review authorizes only the inert development skeleton. Non-loopback
deployment, authentication, authorization integration, a real capability,
provider access, credentials, persistence, or production readiness requires a
separate accepted threat-model impact review.

## CI and supply-chain baseline review — 2026-08-03

- Governing issue: #10
- Scope: pull-request CI, dependency review, CodeQL, Scorecard, Dependabot,
  workflow pinning/permissions, and branch/release protection plan
- New trust boundaries: third-party workflow actions, dependency registries,
  hosted runners, code-scanning ingestion, and retained analysis artifacts

| Threat                                        | Control                                                                                                           | Residual risk                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| untrusted PR obtains authority                | `pull_request` only, read-only default permissions, no secrets/OIDC/publication, no persisted checkout credential | hosted runner and action compromise remain possible                       |
| action tag or dependency substitution         | actions pinned to full SHA; npm lock and install scripts disabled; exact direct versions; automated pin test      | Python transitive dependencies and Node base image lack full digest locks |
| vulnerable dependency enters source           | dependency review and npm audit fail at moderate severity; Dependabot coverage                                    | advisory databases can lag and malicious packages may have no advisory    |
| vulnerable source reaches main                | always-on formatting/type/test/build/docs/container gate plus CodeQL security-extended                            | static analysis and tests are incomplete proofs                           |
| workflow gains excess token authority         | explicit workflow/job permissions; publication separated from validation                                          | repository setting changes require periodic external audit                |
| Scorecard or scanner publishes sensitive data | source contains no secrets; Scorecard public publishing disabled; bounded five-day SARIF artifact                 | filenames and findings remain repository-visible security metadata        |
| unsupported release-integrity claim           | documented evidence gates; no release workflow; SBOM/signing/SLSA are roadmap only                                | issue #13 and deployment controls remain incomplete                       |

This baseline authorizes source validation and security-analysis uploads only.
It does not authorize package/container publication, a signing identity, release
credentials, OIDC federation, or a production release.

## Local read-only node provider implementation review — 2026-08-03

- Governing issue: #8
- Scope: network-free `node.inspect` definition, configured-root resolver,
  authorization-enforced invocation boundary, bounded metadata result, and tests
- New trust boundary: capability invocation to a local read-only filesystem provider

| Threat                                 | Control                                                                                                             | Residual risk                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| traversal or absolute-path escape      | relative path grammar, canonical configured roots, containment checks before observation                            | platform path semantics require qualification on every supported OS                                     |
| symbolic-link escape                   | every path component is inspected and any symlink is rejected; canonical target is checked again                    | filesystem replacement races remain possible without an OS-level directory-handle sandbox               |
| authorization bypass                   | malformed requests fail before authorization; denied requests record zero provider attempts                         | the injected authorizer is not yet connected to an authenticated transport or durable decision enforcer |
| malicious or oversized provider output | closed runtime schema, 4 KiB serialized bound, invalid output withheld as `provider_protocol_error`                 | metadata such as requested relative paths may still be sensitive in a deployment-specific root          |
| content or credential disclosure       | capability returns file type, size, modification time, source, and freshness only; no contents or directory listing | file names supplied by an authorized caller remain visible in its own result                            |
| accidental public authority            | inert MCP discovery remains empty and no provider configuration is loaded by the listener                           | a future MCP binding requires identity, policy, configuration, and audit review                         |

This review authorizes the network-free experimental provider boundary and its
tests only. It does not authorize MCP exposure, production roots, credentials,
non-loopback deployment, filesystem contents, directory enumeration, mutation,
or a claim that application-level checks eliminate local TOCTOU races.

## Synthetic read-only demo review — 2026-08-03

- Governing issue: #11
- Scope: loopback MCP demo binding, synthetic temporary fixture, explicit demo
  policy, allow/deny transcript, and protected in-memory evidence projection
- New trust boundary: local demo MCP client to a fixture-only provider profile

The ordinary gateway remains inert. The demo registers only `node.inspect`,
binds only synthetic node references, returns metadata without fixture content,
uses no credential or elevated privilege, and removes its temporary root during
success or failure teardown. Input, provider output, request size, host, origin,
and timeout bounds remain enforced by the existing runtime and capability
layers.

The printed evidence is a sanitized protected projection marked
`in_memory_demo_only`. It is not a durable RFC-0004 event, integrity chain,
checkpoint, production audit claim, authentication profile, or authorization
adapter. Production MCP exposure remains forbidden pending separate accepted
identity, policy, audit-writer, and deployment profiles.

## Inert coordination consumer contract review — 2026-08-03

- Governing issue: #45
- Scope: MCP-owned consumer types, closed response validation, bounded timeout,
  and network-free fake conformance tests
- New live trust boundary: none; the driver is not connected to the gateway or
  to a transport

| Threat                                                           | Control                                                                                                                                                  | Residual risk / dependency                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| malformed or substituted coordination receipt advances lifecycle | strict closed schemas plus exact operation and binding-digest checks                                                                                     | the future canonical digest implementation must be reviewed against the stable upstream contract |
| stale lease is treated as current                                | expiry is checked against an injected trusted clock and equality is stale                                                                                | clock source and skew policy remain deployment-specific                                          |
| dependency detail leaks through errors                           | all driver exceptions and timeouts normalize to one bounded code                                                                                         | future observability must retain the closed error surface                                        |
| hidden retry duplicates nonce or lease operations                | the consumer performs one bounded driver call and never retries                                                                                          | a future transport adapter must prove it does not retry, redirect, or poll internally            |
| nonce or sealed lease handle enters evidence                     | sensitive values are absent from receipts intended for evidence and explicitly forbidden from logs, audit, errors, model context, and repository context | future adapter memory handling and crash diagnostics require review                              |
| Coordination implementation becomes coupled into MCP             | only an MCP-owned port and fake driver exist; no source, bundle, client, schema, or transport is imported                                                | compatibility cannot be claimed until PR #71 merges and an adapter is separately reviewed        |

This review authorizes only the inert consumer contract. It does not authorize
an HTTP adapter, Coordination client import, endpoint, credential,
authentication profile, real nonce consumption, real lease, gateway wiring,
provider invocation, mutation, deployment, or release claim.

## Accepted stable Coordination adapter design review — 2026-08-03

- Governing issue: #47
- Accepted architecture: RFC-0005
- Scope: MCP-owned HTTPS translation to the immutable Coordination primitives
  v1 contract and synthetic loopback qualification
- New implementation trust boundaries: MCP to request authenticator; MCP across TLS to
  untrusted Coordination framing and responses

| Threat                                                              | Accepted control                                                                                                                          | Residual risk / dependency                                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| lifecycle binding is substituted or narrowed                        | one canonical MCP scope digest covers subject, capability, resources, environment, plan, approval, operation, expiry and epoch            | canonical vectors require review before implementation                              |
| attacker redirects requests or abuses ambient network configuration | exact HTTPS base URI and fixed routes; redirects, proxy discovery and caller-selected targets forbidden                                   | DNS and TLS trust remain deployment-specific                                        |
| credential or lease capability leaks                                | explicit bounded authenticator, private redacted capability wrapper, closed errors and no raw-body diagnostics                            | concrete key custody and runtime memory handling need deployment review             |
| timeout causes unsafe replay                                        | one bounded request, abort once, no retry; ambiguous outcomes deny and require lifecycle reconciliation                                   | availability loss can stop protected operations                                     |
| malformed response becomes authority                                | independent closed response validation and route-specific outcomes; transport success never implies MCP authorization or provider success | upstream compatibility drift requires immutable re-review                           |
| copied client couples trust domains                                 | platform APIs and public wire contract only; no upstream source, bundle, schema or client import                                          | independent implementation may contain semantic defects requiring conformance tests |

Coordination RFC-0021, merged in PR #85 at
`91c1e5097e47026f63c34126a379949833bb7e00`, resolves acquisition contention as
bounded `409 conflict` Problem Details and excludes `contended` as a successful
outcome. RFC-0005 is explicitly accepted for a separately reviewed MCP-native
adapter and synthetic loopback qualification only. This review authorizes no
real endpoint, credential, request, gateway wiring, provider execution,
mutation, deployment, public listener, or live apply.

## Coordination adapter implementation review — 2026-08-03

- Governing issue: #47
- Accepted architecture: RFC-0005
- Scope: MCP-native digest translation, closed HTTPS framing, explicit
  authenticator/transport ports, secret capability wrapper, synthetic
  transport conformance, and verified loopback TLS qualification

The implementation imports no Coordination code or artifact and is not wired
into the gateway. Exact HTTPS targets, fixed routes, canonical bounded bodies,
streamed response limits, strict media/cache headers, closed outcomes, one
deadline and no retry enforce the accepted boundary. Raw identities and nonce
values are replaced by domain-separated digests; lease capabilities reject JSON
and redact string/inspection output.

The loopback qualification crosses a real TLS socket on `127.0.0.1` with
certificate verification enabled. Its owner-authorized test-only helper invokes
OpenSSL with fixed arguments and no shell to generate a one-day certificate and
private key in a private temporary directory, then removes all fixture material
in `finally`. No key is committed, no dependency is added, and subprocess use is
absent from runtime and build output. This evidence does not select or qualify
production trust, DNS, identity, key custody, or endpoint configuration. No real
endpoint, credential, gateway wiring, provider execution, mutation, deployment,
public listener or live apply is authorized.

## Accepted private staging Coordination connection — 2026-08-03

- Governing issue: #50
- Accepted architecture: RFC-0006 and upstream Coordination RFC-0022
- Scope: disabled-by-default direct TLS transport, explicit private trust,
  descriptor-delivered short-lived DPoP credential/key and synthetic-only real
  staging qualification

| Threat                                | Accepted control                                                                                                                | Residual risk / dependency                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| endpoint or trust substitution        | exact HTTPS origin/server name, explicit private CA, dedicated verified Node HTTPS agent, no proxy/system-root fallback         | staging CA or supervisor compromise can still redirect the consumer                 |
| credential or signing-key disclosure  | separate inherited descriptors, bounded one-time reads, redacted wrappers, source-buffer zeroing and 15-minute maximum lifetime | plaintext exists in process memory and host compromise defeats this staging control |
| proof replay or target confusion      | fresh ES256 DPoP with exact `htu`/`htm`/`ath`, expected thumbprint and server-side durable replay reservation                   | server replay-store availability is an upstream dependency                          |
| hidden network retry after ambiguity  | one fixed request under the adapter deadline, keep-alive off, no redirect/retry/polling                                         | ambiguous remote state requires explicit lifecycle reconciliation                   |
| remote success elevates MCP authority | qualification runner is separate from gateway/provider paths and uses synthetic bindings only                                   | later gateway wiring still requires identity, policy, audit and provider reviews    |
| secret-bearing diagnostics            | closed error/output schemas omit endpoint, TLS, credential, proof, key, capability, body and upstream text                      | process/core-dump controls remain deployment-specific                               |
| accidental activation                 | no defaults or environment activation; explicit profile entry point is the kill switch                                          | supervisor control of process arguments remains trusted for staging activation      |

RFC-0006 authorizes only implementation and hermetic interoperability
qualification. Endpoint configuration, provisioning, credential minting, live
requests, gateway wiring, provider execution, mutation, deployment and
production use remain separately gated.

## Project 5 Area Phase A review — 2026-08-03

- Governing issue: #60
- Scope: distinct `Area` representation contract and bounded read-only schema
  plan
- New trust boundary: none; provider observation is read-only and outside the
  MCP runtime

The reviewed Project snapshot contains no `Area` field and proves that
`Component` and human/Project-owned `Status` are distinct existing
single-select fields. The contract derives the exact `Area` option vocabulary
from the repository policy and produces one non-executable create-field plan.

| Threat                                | Control                                                                                                      | Residual risk / dependency                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| silently collapse area into component | exact names and semantic separation; both existing fields are preserve-only                                  | future policy edits require the same semantic review          |
| stale or incomplete Project schema    | snapshot count, update time and canonical redacted digest; fresh complete preflight required before Phase B  | Project can change after Phase A                              |
| schema confused deputy                | exact user-owned Project 5 binding in the operator workflow; no provider IDs in the retained plan            | operator account and repository settings remain trusted       |
| GraphQL exhaustion                    | one bounded field page, observed cost 1, declared future request ceiling and reserve, no retry/polling/sleep | provider cost behavior may change and must fail closed        |
| partial or destructive repair         | Phase A is structurally non-executable; future plan forbids rename/delete and stops on ambiguity             | a separately authorized mutation could still partially commit |

Phase A performs no mutation and grants no Phase B, consumer apply, release,
legacy removal, deployment or production authority.

## Private Coordination adapter implementation review — 2026-08-03

- Governing issue: #50
- Accepted architecture: RFC-0005, RFC-0006 and upstream Coordination RFC-0022
- Upstream immutable candidate: commit
  `d122f31ce6a74dcec97dfcf8095a4447e23ee593`, tree
  `a59ba3f7ad6018d96f7329710eb593766acda676`
- Scope: disabled-by-default MCP-native trust, descriptor custody, ES256 DPoP
  and direct HTTPS transport behind the existing Coordination consumer port

The implementation adds no gateway import, configuration default, discovery
surface, environment activation, provider binding or executable live target.
Construction requires one exact closed profile, private trust file, two already
open descriptors, a short registration interval, expected RFC 7638 thumbprint,
positive epoch and one synthetic environment reference.

Token and PKCS#8 P-256 source bytes are bounded, consumed once, closed and
cleared. The derived private `KeyObject`, held token and profile expose only
redacted inspection and reject JSON serialization. Every request creates one
fresh 128-bit proof ID and an exact ES256 DPoP proof binding `POST`, the fixed
HTTPS target and token `ath`. Epoch and environment mismatches deny before
authentication or transport.

The dedicated Node HTTPS agent trusts only the supplied CA, verifies the exact
origin identity, disables keep-alive, proxy discovery, redirect, decompression
and retry, and accepts only the five fixed primitives paths. The existing
adapter retains canonical 4 KiB framing and one total deadline. Provider and
TLS errors collapse to the closed Coordination taxonomy.

Hermetic qualification generates ephemeral trust and keys in a private
temporary directory, consumes already-open descriptors, verifies DPoP claims
and signature over a real TLS socket, proves a single request, checks binding
denial before transport, verifies secret redaction and confirms the ordinary
gateway imports no profile. It sends no request to a real Coordination
deployment and imports no upstream source, client, schema, storage or
configuration.

This increment grants no endpoint, trust material, credential, provisioning,
bootstrap execution, live request, gateway wiring, provider execution,
protected mutation, deployment or production authority.

## Accepted Project 5 controlled-apply credential delivery — 2026-08-05

- Governing issue: #27
- Accepted architecture: RFC-0008; it supersedes RFC-0007 only for credential
  delivery
- Scope: manual planning, independent approval, one fixed controlled apply, and
  redacted result handling
- Credential boundary: a manually configured GitHub Actions secret named
  `YUKH_PROJECTS_WRITE_TOKEN`; neither OIDC nor a materializer is a permitted delivery path

RFC-0008 retains RFC-0007's exact fresh-plan, independent-approval, fixed-scope,
single-attempt, verification, and redacted-evidence controls. It authorizes no
live implementation. Its principal threats and controls are:

| Threat                                                                                | Required control                                                                                                                                                                                                                                             | Residual risk / dependency                                                                          |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| dispatch, issue state, secret presence, or environment review becomes approval        | independent approval bound to the exact plan, operation digest, scope, policy commit, and environment                                                                                                                                                        | approval identity and custody profile still require separate qualification                          |
| `YUKH_PROJECTS_WRITE_TOKEN` is committed, printed, or retained                        | configure it manually as a GitHub Actions secret; keep its sole workflow expression job-local to the permanently skipped contract; no output, artifact, cache, summary, log, or repository value may contain it                                              | a runner or GitHub secret-store compromise can expose a secret available to a future authorized run |
| the deprecated OIDC/materializer path is reintroduced                                 | no `id-token: write` permission, materializer request, package, endpoint, or OIDC trust is allowed in this profile                                                                                                                                           | reviewed workflow changes could still attempt an unauthorized redesign                              |
| one credential silently gains all authority                                           | keep the workflow `GITHUB_TOKEN` at `contents: read` and never pass it to the producer; the reviewed `legacy-single-token-apply-v1` exception may use `YUKH_PROJECTS_WRITE_TOKEN` as both producer credentials only for this fixed Project 5 issue #27 scope | sharing credentials outside that exact reviewed mode remains prohibited                             |
| an absent approval or host-capsule/Coordination control is mistaken for authorization | the only apply job has a hard-coded false condition, no steps, runner, or producer invocation; its job-local secret expression cannot resolve; a future review must separately qualify the approval and host controls                                        | GitHub source alone cannot establish either external control                                        |
| changed or ambiguous state is mutated or retried                                      | fresh exact replan, independent approval, one attempt, no retry, and final zero-operation verification                                                                                                                                                       | unknown completion still requires operator reconciliation                                           |
| an approved plan exceeds the run budget partway through                               | producer pre-admits the complete request graph before the first mutation; `yukh-projects#131` blocks implementation                                                                                                                                          | provider cost changes require a fresh qualification                                                 |
| consumer silently broadens scope                                                      | reviewed source fixes repository, Project, issue, mode, producer, and environment                                                                                                                                                                            | any generalized or batch profile requires another RFC                                               |

The `future-controlled-apply` workflow job remains permanently skipped. Its
sole `secrets.YUKH_PROJECTS_WRITE_TOKEN` expression is job-local, and no runner
exists to resolve it. No approval authority or reviewed host-capsule/Coordination
profile is configured by this source. Manually configuring the secret, enabling
the job, passing the secret to a producer, invoking a provider, or applying a
plan each require separate explicit authorization.

## Audit writer foundation implementation review — 2026-08-06

- Governing issue: #84
- Accepted architecture: RFC-0003 and RFC-0004
- Scope: closed event subset, structural projection, causal validation,
  per-stream sequence/hash commit, retained-range verification, pre-effect
  durable-receipt enforcement, and bounded post-start recovery facts
- New live trust boundary: none; all implementations and tests are network-free

| Threat                                                                                 | Control                                                                                                                                                                                                                                                                 | Residual risk / dependency                                                                                              |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| prompt, secret, provider body, policy, or stack trace becomes evidence                 | closed objects, registry-owned fields/classification, bounded identifier/digest/enumeration values, and no raw error fallback                                                                                                                                           | producer semantic correctness still needs review when lifecycle producers are integrated                                |
| correlation, causal predecessor, or digest binding is substituted                      | required correlation slots, exact parent event types, digest links, and operation/subject/capability/scope equality against committed parents                                                                                                                           | cross-stream parent availability and consistency require a deployment profile                                           |
| concurrent producers reorder or overwrite evidence                                     | one writer serializes candidates; the store port requires atomic sequence, previous hash, event bytes, and identity commit                                                                                                                                              | multi-writer/distributed atomicity is not implemented                                                                   |
| retained events are modified, removed, reordered, reset, or moved across streams       | canonical event hash, strictly increasing sequence, previous-hash links, and deterministic retained-range verifier                                                                                                                                                      | unwitnessed tail truncation and compromised-writer replacement remain undetectable without qualified checkpoints        |
| audit loss, non-explicit allow, or stale planning authorization permits provider start | lifecycle guard requires a distinct apply-phase evaluation/explicit allow/enforcement triplet after plan and approval, binds apply admission to that decision, accepts only `durable` receipts, and invokes the provider-start callback only after all required commits | no durable store is selected; the in-memory conformance store is explicitly rejected                                    |
| post-start audit failure hides possible effect or triggers retry                       | one bounded recovery-journal fact preserves the validated completion observation's result, plan, attempt, parent binding, and original time while separately recording `completion_unknown`; success is withheld and no retry occurs                                    | durable journal capacity, confidentiality, import, reconciliation, and recovery operations require a deployment profile |

This increment supplies an executable RFC-0004 foundation but no durability
claim. It authorizes no gateway integration, provider registration, credential,
endpoint, checkpoint key, live mutation, Project apply, deployment, or
production-readiness claim.

## Repository-local durable audit implementation review — 2026-08-08

- Governing issue: #86
- Accepted architecture: RFC-0010
- Scope: one-process repository-local primary audit store, separate recovery
  journal, deterministic restart/replay, local checkpoints, bounded retention,
  and prospective retention/export requirements with both implementations
  blocked on storage-neutral contract extensions
- New live provider or network boundary: none

| Threat                                                                                                                                   | Implemented control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Residual risk / dependency                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| repository path, symlink, hard link, ownership, or mode substitutes audit state                                                          | fixed ignored runtime root, canonical no-follow traversal, regular-file/owner/mode/link-count checks, closed topology, and exclusive profile lock                                                                                                                                                                                                                                                                                                                                                                                    | compromise of the effective user, host, kernel, or repository filesystem remains authoritative over local state                                                                                                                                         |
| a crash exposes a partial event, or a separately stored identity survives while its event is lost                                        | immutable per-sequence commit files; the commit is published and its containing directory synced before any identity temporary or final is created; identity publication and its directory sync follow; startup completes identity only from a validated final commit; receipt follows both barriers                                                                                                                                                                                                                                 | filesystem or hardware that violates documented sync semantics can still lose acknowledged data; an orphan identity is retained as conflict protection and fails health rather than making the event ID reusable                                        |
| retention removes the only event-ID or candidate-digest binding and permits reuse after restart                                          | immutable bounded identity records bind event ID, candidate digest, stream, sequence, event hash and commit digest; they are cross-checked at startup and never retention-eligible                                                                                                                                                                                                                                                                                                                                                   | profile-lifetime identity capacity is finite and exhaustion fails closed; the current store port needs an extension before expired bodies can be removed                                                                                                |
| concurrent processes assign the same sequence or hide an identity conflict                                                               | one exclusive non-blocking writer lock and fail-closed startup; no stale-lock deletion or multi-process mode                                                                                                                                                                                                                                                                                                                                                                                                                         | lock denial is an availability attack and distributed writers remain unsupported                                                                                                                                                                        |
| truncation, replacement, or deletion is mistaken for immutable evidence                                                                  | canonical hash chain, strict restart verification, local checkpoint manifests, and explicit `local_unwitnessed_not_complete` labeling                                                                                                                                                                                                                                                                                                                                                                                                | same-account chain replacement and unwitnessed tail truncation remain undetectable; an independent checkpoint authority is absent                                                                                                                       |
| post-start audit failure loses, reorders, or retries a possible effect, or leaves durable recovery identity without its pending fact     | the pending fact is published and `recovery/pending` synced before any recovery identity write; identity publication and its directory sync follow; startup completes identity only from a validated pending fact; deterministic bounded replay, withheld success, and no provider retry                                                                                                                                                                                                                                             | filesystem-contract violation can still produce orphan state; its identity remains reserved, nothing is replayed, and health fails pending explicit recovery; importer schemas, reconciliation authority, and operational response still require review |
| an acknowledgement becomes visible before recovery-ID conflict protection or receipt binding is durable                                  | the permanent `acknowledgement_prepared` identity extension contains the complete receipt binding and reproducible acknowledgement digest; its file and directory are synced before acknowledgement publication; acknowledgement commits only when its own directory is synced; startup deterministically rolls back pre-identity temporary state, completes a valid prepared identity, or quarantines conflicts before readiness                                                                                                    | filesystem or hardware may violate sync semantics; acknowledgement remains blocked pending the storage-neutral import registry extension                                                                                                                |
| acknowledgement retention frees a recovery ID or loses receipt binding                                                                   | acknowledged source and acknowledgement records have a 24-hour minimum and 30-day maximum; the shared 8 MiB recovery cap permits at most 512 recovery IDs by reserving 16 KiB each for 4 KiB pending, 4 KiB acknowledgement, and four 2 KiB identity versions (`append`, `acknowledgement_prepared`, `deletion_admitted`, and `expired_by_policy`); profile-lifetime recovery identity records retain recovery ID, fact digest, append receipt, source/acknowledgement digests, transaction ID, and complete import receipt bindings | identity capacity is finite and fails closed; malformed or orphaned acknowledgement state is quarantined and fails health                                                                                                                               |
| disk pressure silently deletes evidence or permits provider start without capacity                                                       | fixed byte/count limits, free-space reservation check, degraded export denial, hard fail-closed limit, and no automatic evidence eviction                                                                                                                                                                                                                                                                                                                                                                                            | local disk denial remains possible and no backup or disaster-recovery profile exists                                                                                                                                                                    |
| unauthorized, held, or partially audited retention erases evidence or is mislabeled complete                                             | fresh independent exact-plan authorization and `not_held` decision; durable attempt/allow-or-deny/enforcement/admission before unlink; intent and identity versions before deletion; synced outcome, expired identity version, and terminal outcome afterward; incomplete phases fail health and deny export                                                                                                                                                                                                                         | required control-event, hold-authority, and expired-identity port extensions are absent, so the first adapter must deny all retention; local operator/writer separation, legal duration, jurisdiction, and backup deletion remain unqualified           |
| an export attempt is denied or fails without durable control evidence, or export bypasses capability authorization and leaks raw content | no exporter is authorized until an accepted storage-neutral registry extension represents durable attempt, explicit allow/deny, enforcement, and exactly one terminal outcome; prospective export remains independently authorized, bounded, deterministic, and atomically manifested                                                                                                                                                                                                                                                | RFC-0004 currently has only `audit.export_created`, so all exporter implementation is blocked; no production identity/export authority exists and host filesystem readers remain outside application enforcement                                        |
| filesystem errors or rejected records disclose paths or evidence                                                                         | closed health codes and counters; no raw exceptions, paths, record bytes, references, or operating-system text                                                                                                                                                                                                                                                                                                                                                                                                                       | coarse capacity and timing signals remain observable to the local operator                                                                                                                                                                              |

RFC-0010 now authorizes only the disabled, network-free reference implemented
in PR #91. Recovery import, acknowledgement, retention, and export remain
blocked until their specified storage-neutral registry/store extensions are
separately accepted. The profile does not authorize gateway wiring,
provider registration, credentials, endpoints, live mutation, Project apply, or
production claims of durability, confidentiality, completeness, immutability,
tamper-proofing, backup, or availability.

## Mutation lifecycle reference implementation review — 2026-08-08

- Governing issue: #92
- Accepted architecture: RFC-0003, RFC-0004, and RFC-0010
- Scope: closed lifecycle records, exact approval binding, fresh apply
  authorization, durable attempt reservation, provider-neutral execution state,
  verification-gated result release, rollback-as-new-lifecycle, and audit/recovery
  ordering
- New live provider or network boundary: none

| Threat                                                                                                                | Implemented control                                                                                                                                                                                                                                                           | Residual risk / dependency                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a plan, approval, subject, capability version, target scope, policy snapshot, or ordered operation set is substituted | immutable closed records repeat the security bindings and verify canonical digests; approval independently binds the exact plan, separate actor, authentication context, nonce, level, and expiry                                                                             | no real approval identity or assertion-integrity adapter is selected                                                                                     |
| stale planning authorization or current policy denial is bypassed                                                     | approval validation precedes a distinct apply-phase authorization request; the existing authorization validator and one-shot enforcer require an exact explicit allow, current authentication-context digest, post-approval issue time, and every obligation receipt          | identity, attribute, policy, and constraint adapters remain injected ports with no production profile                                                    |
| concurrent or replayed admission invokes an effect twice                                                              | the separate repository-local ledger atomically binds idempotency scope, plan, approval nonce, fresh authorization, operation set, and attempt; immutable transitions make exact retry deterministic and conflicting reuse deny                                               | the profile is single-process, host-local, bounded to 1,024 reservations and 16 MiB, and has no distributed transaction or stale-lock recovery authority |
| a crash occurs after authority may have crossed the effect boundary                                                   | `started` is durable before the effect call; restart never retries started or incomplete work and reports `completion_unknown`; real child-process qualification covers reservation, start, result, and verification boundaries                                               | reconciliation and operator-review workflows are not implemented                                                                                         |
| provider return, timeout, or partial execution is reported as success                                                 | closed step states distinguish observed effect, proven no effect, failure, and ambiguity; bounded effect timeout becomes unknown; aggregate partial and unknown outcomes remain distinct; provider return never releases success                                              | concrete effect and observation semantics require a separately reviewed capability/provider                                                              |
| verifier outage, timeout, mismatch, or forged provider evidence releases success                                      | every mutation declares finite postconditions and a verifier profile; bounded verification timeout is inconclusive, and only exact current observations matching every declared digest can release success                                                                    | verifier independence, target identity, and observation integrity are provider/deployment specific                                                       |
| pre-effect audit outage permits mutation or post-start audit loss hides an effect                                     | health, capacity, and every required pre-effect commit fail closed before the effect port; post-start failure appends the existing durable recovery fact and withholds success                                                                                                | recovery import, acknowledgement, and operational reconciliation remain blocked as described by RFC-0010                                                 |
| rollback silently reuses old authority, bypasses an unavailable declaration, or erases the original failure           | rollback records bind the validated original plan, its declared exact rollback capability, original execution, and observed state, while rollback execution repeats planning, approval, fresh authorization, reservation, effect accounting, verification, and terminal audit | safe compensation may be unavailable, and no real rollback capability is registered                                                                      |
| local state is substituted, exhausted, or concurrently written                                                        | fixed ignored root, owned private directories/files, canonical bounded records, no-follow metadata checks, immutable no-replace publication, directory sync before receipt, closed topology, one exclusive writer, capacity checks, and fail-closed restart validation        | effective-user, host, kernel, filesystem, disk-denial, backup, and independent-witness risks remain; this is not a production durability claim           |

The package is not imported by the gateway and registers no provider. Its generic
effect, verification, and rollback test doubles are network-free. Concrete
synthetic fixture semantics are reviewed separately below. This review authorizes
no gateway activation, real mutation, credential, endpoint, Project apply,
deployment, production-readiness claim, or MCP Step 9.

## Synthetic setting mutation qualification review — 2026-08-08

- Governing issue: #94
- Accepted constraints: RFC-0001, RFC-0002, RFC-0003, RFC-0004, and RFC-0010
- Scope: one in-memory `example.setting.update@1.0.0` effect port, independent
  state verifier, health/capacity preconditions, keyed replay behavior, and one
  separately authorized synthetic restore lifecycle
- New live provider, credential, endpoint, network, or production boundary: none

| Threat                                                                                    | Implemented control                                                                                                                                                                                                                                            | Residual risk / dependency                                                                                           |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| a different capability, target, environment, input, verifier, or operation is substituted | the provider accepts only the frozen definition digest, one canonical synthetic resource, `development`, exact input digest, exact verifier, closed lifecycle step, and both public-fixture and internal lifecycle operation-set bindings                      | a future registry must bind the reviewed evidence digest and must not hot-replace this exact version                 |
| a keyed replay applies the setting twice or conflicting intent reuses a key               | the in-memory fixture atomically stores one exact binding/result before returning; exact replay returns that result, while any changed binding raises a state conflict; the durable lifecycle ledger independently prevents another effect call across restart | the provider map is deliberately process-local and is not a production idempotency store                             |
| provider return, stale state, or target substitution is reported as success               | `setting_value_matches` re-hashes resource, environment, name, value, and version from current fixture state; only the exact declared digest verifies, and lifecycle success remains withheld until durable terminal evidence                                  | a live target identity and independently operated verifier require a separately accepted provider/deployment profile |
| a lost response or post-effect evidence failure is retried                                | the lifecycle durably records `started`, reports `completion_unknown`, appends a recovery fact, and exact restart returns the stored unknown outcome without invoking the effect port                                                                          | recovery import, acknowledgement, reconciliation, and operator workflow remain absent                                |
| restore silently reuses original authority or overwrites newer state                      | restore has a distinct capability, input digest, idempotency key, plan, approval, fresh authorization, reservation, exact current-state precondition, effect, verifier, and terminal rollback record                                                           | the restore capability is synthetic and unregistered; no live rollback authority or safety claim exists              |
| health, capacity, policy, approval, audit, or reservation failure still reaches an effect | all such paths fail before the effect port; qualification asserts zero effect calls and the implementation has no external-call mechanism                                                                                                                      | deployment availability, rate limits, distributed concurrency, and production storage remain unselected              |

The fixture source is compiled but not imported by the gateway or another runtime
entry point. It has no filesystem, process, credential, endpoint, or network
adapter and mutates only instance-local synthetic memory. Canonical evidence is
for a future registration review, not registration authority.

This review does **not** authorize gateway/provider registration, discovery,
approval issuance for Step 9, Step 9 execution, credentials/endpoints, external
or production state, Projects apply, deployment, recovery automation, or any
production-readiness claim.

## Proposed sandbox Projects add-dependency Effect B capability - 2026-08-09

- Governing issue: #96
- Suite authority: accepted `nomed.github.io` RFC-0005 on `main` at
  `12d9215f10c4b7fb1762a5025367e3e81543800f` (PR #42)
- Autonomous mandate: accepted `nomed.github.io` RFC-0007 at
  `bb8628edf7a07c2af56f07e4f9140f58c851ef47`
- Accepted Projects contract:
  `nomed/yukh-projects@521be0d0ef1297579e84a6322dea29f80c2549dc`
- Proposed component contract: RFC-0011
- Scope: contract review for fixed capability `projects.add-dependency.v1`,
  exactly one `add_dependency(201 blocks 202)` operation, and the Accepted
  compound-admission contract
- New live provider, credential, endpoint, network, gateway, or mutation
  boundary: none in this proposal

| Threat                                                                                                                                                                               | Proposed required control                                                                                                                                                                                                                                    | Residual risk / later gate                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| stale status semantics or Effect A authority is reused for Effect B                                                                                                                  | remove the nonconforming status capability; bind empty input to the Accepted fixed dependency target and one `add_dependency`; separate plans, approvals, bridge, snapshots, nonces, lease, credentials, verifiers, and audit chains                         | conformance tests must prove no status or dependency-removal path and exact Effect A/B disjointness                                    |
| a caller reverses or widens the relationship into arbitrary Projects, fields, values, GraphQL, REST, workflows, or commands                                                          | empty closed input, server-owned `201 blocks 202` target, one operation, fixed environment and native mode, and no provider identifiers or execution mechanics in public schemas                                                                             | trusted target resolution and provider conformance require later accepted profiles and adversarial fixtures                            |
| authentication, discovery, planning allow, either assertion, the bridge, workflow admission, OIDC, Coordination, credential possession, or provider output becomes MCP authorization | distinct fresh RFC-0002 planning and apply decisions; only exact explicit allow with enforced constraints and obligations can progress                                                                                                                       | production identity, policy, attribute, assertion, bridge, and obligation adapters remain unselected                                   |
| one approval envelope is forced through incompatible strict schemas or one assertion authorizes the other                                                                            | strict MCP `ApprovalReceiptV1` and unchanged Projects `SignedApprovalEnvelope` v1 remain separately authenticated; Accepted `yukh-projects-approval-bridge-v2` exact-matches them but grants no authority                                                    | executable bridge-verifier artifact and deployment trust profiles remain unpublished                                                   |
| either assertion, its trust root, or the bridge is replayed, substituted, shared with Effect A, or selected by repository content                                                    | distinct plans, principals, schemas, trust profiles, nonces, expiry, verification receipts, and accepted cross-binding; neither assertion is presented as the other                                                                                          | identity, signing-key custody, trust-root delivery, and separation of duties require later deployment review                           |
| OIDC claims or a one-shot package are replayed, broadened, redirected, logged, or treated as authority                                                                               | fixed audience/workflow/environment/run/attempt/commit/both-plan binding; atomic one-shot bounded package; both assertions and bridge; distinct short-lived read/write credentials; direct TLS; no retry, fallback, output, artifact, cache, summary, or log | identity-provider, materializer, TLS, runner, and credential-issuer compromise remain operational dependencies                         |
| MCP preconsumes the Projects assertion nonce or competes for the lease required by controlled apply                                                                                  | MCP consumes only its distinct assertion nonce and binds both nonce digests; the producer remains the sole consumer of the Projects nonce and fenced lease                                                                                                   | exact host-capsule and Coordination deployment qualification remains a later gate                                                      |
| direct composition of v1.7.0 primitives, wrapper replacement, dynamic execution, or a generic network path bypasses Projects semantics                                               | only the Accepted `runMcpEffectBControlledApplyV1` contract is eligible; direct primitives, CLI, shell, dispatcher, dynamic install, generic HTTP, GraphQL, REST, and SDK paths are forbidden                                                                | immutable wrapper implementation, provenance, SBOM, digest, conformance vectors, and loader integrity remain unpublished               |
| pre-effect audit outage permits mutation or post-start evidence failure hides a possible effect                                                                                      | durable RFC-0010 reservation and every required RFC-0004 pre-effect commit before provider start; post-start failure journals recovery, withholds success, and records `completion_unknown`                                                                  | the existing event registry may need a separate RFC if it cannot represent every package, Coordination, producer, and verifier binding |
| provider acknowledgement or final report is released as MCP success                                                                                                                  | separate read-only verifier proves `201 blocks 202`, exact `effectBPostconditionBinding`, and a fresh zero-operation Projects plan                                                                                                                           | verifier implementation, observation integrity, and read-credential profile require later acceptance                                   |
| crash, timeout, lost response, lease loss, cleanup failure, or conflicting observation triggers a duplicate effect                                                                   | one durable attempt, retry `never`, restart-stable `completion_unknown`, no redispatch or replacement intent before reconciliation                                                                                                                           | operator reconciliation and recovery acknowledgement remain unimplemented                                                              |
| reverse mutation or teardown is presented as automatic rollback                                                                                                                      | capability rollback is explicitly unavailable because dependency removal is not Accepted; teardown remains separate sandbox-owner authority and cannot rewrite effect outcome                                                                                | teardown implementation, credentials, final-state verifier, and operational authority remain unselected                                |
| credentials, approvals, capsules, provider identifiers, observations, or private target data enter evidence                                                                          | closed structural projections with only allowlisted references, digests, states, stable codes, counts, and duration buckets                                                                                                                                  | host, effective-user, runner, filesystem, and administrator compromise can still observe runtime material                              |

RFC-0011 is **Proposed**. Projects #150 accepted the bridge v2 and MCP-safe
wrapper specifications, not an implementation or release. Immutable
bridge-verifier and wrapper artifacts, provenance, SBOM, digests, and
conformance evidence remain unpublished. RFC-0011 must pin those future
artifacts and receive acceptance before a separate implementation issue.
OIDC, assertion authorities, bridge trust, materializer, Coordination, audit,
verifier, workflow, target, credentials, endpoints, network, gateway
activation, live synthetic apply, teardown, deployment, and operational
readiness each require later explicit review.
# Accepted dynamic local team control plane — 2026-08-15

- Governing issue: #127
- Accepted architecture: RFC-0017

The persistent local supervisor accepts only structured MCP/CLI control
requests. Server-generated identities, fixed executable paths, bounded team
size/depth/lifetime and inherited workspace constraints prevent transcript text
from directly spawning unbounded processes. Parent-child relationships are
auditable but do not grant authority. The temporarily unrestricted Copilot
profile remains explicitly local, high trust and non-production.
