# Threat model

- Status: Initial
- Last reviewed: 2026-08-03
- Scope: Foundation architecture and read-only vertical slice
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

| Boundary | Principal threats | Initial controls | Residual Foundation risk |
| --- | --- | --- | --- |
| MCP client → gateway | prompt injection, forged identity context, schema abuse, oversized or repeated input, capability enumeration | authenticated transport profile, server-derived subject, exact versioned capability allowlist, strict schemas, input and request bounds, deny before disclosure | concrete authentication and rate-limit profiles are not yet selected |
| Gateway → identity and policy services | authentication confused with authorization, stale or substituted policy, dependency failure, cross-resource confused deputy | canonical subject/action/resource/environment request, policy version binding, explicit deny, fail-closed timeout/error handling, decision evidence | policy-engine protocol and freshness bounds require an RFC |
| Gateway → capability provider | provider selected by untrusted input, argument injection, excessive authority, unsafe retry, result confusion | server-side provider registry, typed arguments, least-privilege credential profile, bounded time/output, idempotency and retry declaration, correlation binding | no operational provider is implemented yet |
| Provider → target node | traversal or symlink escape, command injection, target substitution, credential disclosure, malicious output, partial effect | configured canonical roots and target identity, no unrestricted shell interface, argument allowlists, credential isolation, output sanitization, postcondition verification | provider-specific sandbox and target identity require separate review |
| Runtime → audit storage | secret retention, prompt retention, event forgery, deletion, reordering, correlation substitution, storage exhaustion | allowlisted redacted event schemas, bounded records, correlation and causation identifiers, integrity metadata, restricted writer/reader roles | storage, retention, export, and tamper-evidence implementation are not yet selected |
| Source → workflow → release | malicious dependency or contributor, mutable action reference, artifact substitution, secret exposure, untrusted-PR publication | reviewed changes, immutable action pins, least-privilege workflow permissions, deterministic checks, dependency review, SBOM/provenance roadmap, protected release | repository settings and release signing require qualification evidence |

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
  verification, and the limits of those guarantees. No backend is implemented.
- #10 qualifies repository, CI, dependency, and release supply-chain controls.

Until those records are accepted, this model establishes constraints and stop
conditions; it does not authorize operational capabilities or production use.

## Capability contract implementation review — 2026-08-03

- Governing issue: #5
- Accepted architecture: RFC-0001
- Scope: network-free schemas, validator, synthetic fixtures, and tests
- New trust boundary: none

The contract package processes untrusted record and embedded-schema data but
does not accept network traffic, resolve identity or policy, invoke a provider,
hold credentials, persist audit events, or mutate a target.

Implementation-specific threats and controls are:

| Threat | Control | Residual risk |
| --- | --- | --- |
| schema bombs or recursive references | node/depth/property limits; remote and cyclic references rejected before compilation | complex but acyclic schemas still consume bounded local CPU |
| regular-expression denial of service | pattern length and construct restrictions; provider schema review remains mandatory | the conservative filter is not a formal regex complexity proof |
| prototype or credential channel through property names | closed objects; dangerous and credential-shaped names rejected; input values excluded from diagnostics | semantic intent still requires human provider review |
| diagnostic disclosure or nondeterminism | allowlisted messages without values; stable path/code ordering; 64-item cap; repeatability tests | paths reveal only submitted field names |
| malicious or incompatible dependency | exact Ajv version and lockfile; install scripts disabled in validation; dependency audit evidence | registry and build-environment integrity remain governed by #10 |
| invalid provider output represented as success | result and output validation; mutating success requires verified postconditions | real verification semantics remain governed by #4 and evidence uses RFC-0004 |

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

| Threat | Proposed control | Residual risk / dependency |
| --- | --- | --- |
| plan or approval substitution | canonical digests bind subject, capability, input, target, environment, policy, observations, plan, and approval | approval identity and assertion integrity profile is not selected |
| stale-plan execution | fresh authorization and immediate server-side precondition re-observation before apply | observation source integrity is provider/deployment specific |
| duplicate or unsafe retry | durable exact-binding reservation, capability attempt ceiling, no retry from ambiguous completion | durable storage and distributed atomicity are not designed |
| provider reports false success | declared postconditions and independent verification where required | verifier independence and target identity need provider review |
| partial effect is hidden | append-only per-step outcomes, aggregate `partial_effect`, and operator-review state | operator response process is not defined |
| rollback overwrites newer state | rollback is a new authorized lifecycle with current preconditions | safe compensation may be unavailable |
| evidence omission or reordering | RFC-0004 event registry, durable pre-effect commit, causal correlation, hash chaining, and checkpoints | durable writer, journal, and checkpoint deployment profiles remain unselected |

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

| Threat | Proposed control | Residual risk / dependency |
| --- | --- | --- |
| secret or prompt retention | closed typed payloads, structural allowlist projections, forbidden-content registry, no raw fallback | producer semantic bugs and side channels still require review |
| identity or target disclosure | opaque references, protected resource-set digests, separately controlled resolvers | low-entropy digests and resolver misuse require deployment privacy controls |
| event substitution or reorder | canonical digest binding, per-stream sequence, previous hash, causal references | compromised writer can omit facts before emission |
| deletion or chain replacement | periodic checkpoints and optional independent witnessing | unwitnessed tail truncation remains possible |
| misleading immutability claim | contract says hash-chained/integrity-verifiable; deployment must prove stronger properties | storage and checkpoint profile not selected |
| audit outage hides an effect | fail closed before provider start; durable recovery fact and withheld success after start | recovery journal and atomicity require deployment design |
| over-retention or unsafe export | registered retention classes, explicit holds, deterministic projections, bounded integrity-bound manifests | legal durations and jurisdictions are deployment-specific |

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

| Threat | Control | Residual risk |
| --- | --- | --- |
| DNS rebinding or virtual-host confusion | exact host allowlist on `/mcp`; wildcard bind requires explicit configuration | reverse-proxy host rewriting requires a future deployment profile |
| cross-origin browser invocation | any `Origin` is denied unless exactly allowlisted | non-browser clients have no Origin and authentication is not implemented |
| oversized or slow request | content-length and streamed byte bound before SDK parsing; request/header/keep-alive timeouts, connection and per-socket request ceilings | distributed rate limiting still needs a deployment edge profile |
| protocol parser or SDK defect | official modular SDK pinned to 2.0.0; strict TypeScript; protocol integration tests; empty registries | dependency compromise and future protocol drift remain possible |
| accidental operational authority | empty tools/resources/prompts; no provider or credential modules; discovery test asserts empty lists | later capability registration requires its own review |
| log disclosure or injection | closed records, server-generated correlation, no headers/body/URL/error text | stdout transport, retention, and integrity are not RFC-0004 audit |
| container privilege or exhaustion | non-root user, read-only Compose filesystem, dropped capabilities, no-new-privileges, CPU/memory/PID bounds | base image is tag-pinned, not digest-qualified; #10 remains open |

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

| Threat | Control | Residual risk |
| --- | --- | --- |
| untrusted PR obtains authority | `pull_request` only, read-only default permissions, no secrets/OIDC/publication, no persisted checkout credential | hosted runner and action compromise remain possible |
| action tag or dependency substitution | actions pinned to full SHA; npm lock and install scripts disabled; exact direct versions; automated pin test | Python transitive dependencies and Node base image lack full digest locks |
| vulnerable dependency enters source | dependency review and npm audit fail at moderate severity; Dependabot coverage | advisory databases can lag and malicious packages may have no advisory |
| vulnerable source reaches main | always-on formatting/type/test/build/docs/container gate plus CodeQL security-extended | static analysis and tests are incomplete proofs |
| workflow gains excess token authority | explicit workflow/job permissions; publication separated from validation | repository setting changes require periodic external audit |
| Scorecard or scanner publishes sensitive data | source contains no secrets; Scorecard public publishing disabled; bounded five-day SARIF artifact | filenames and findings remain repository-visible security metadata |
| unsupported release-integrity claim | documented evidence gates; no release workflow; SBOM/signing/SLSA are roadmap only | issue #13 and deployment controls remain incomplete |

This baseline authorizes source validation and security-analysis uploads only.
It does not authorize package/container publication, a signing identity, release
credentials, OIDC federation, or a production release.

## Local read-only node provider implementation review — 2026-08-03

- Governing issue: #8
- Scope: network-free `node.inspect` definition, configured-root resolver,
  authorization-enforced invocation boundary, bounded metadata result, and tests
- New trust boundary: capability invocation to a local read-only filesystem provider

| Threat | Control | Residual risk |
| --- | --- | --- |
| traversal or absolute-path escape | relative path grammar, canonical configured roots, containment checks before observation | platform path semantics require qualification on every supported OS |
| symbolic-link escape | every path component is inspected and any symlink is rejected; canonical target is checked again | filesystem replacement races remain possible without an OS-level directory-handle sandbox |
| authorization bypass | malformed requests fail before authorization; denied requests record zero provider attempts | the injected authorizer is not yet connected to an authenticated transport or durable decision enforcer |
| malicious or oversized provider output | closed runtime schema, 4 KiB serialized bound, invalid output withheld as `provider_protocol_error` | metadata such as requested relative paths may still be sensitive in a deployment-specific root |
| content or credential disclosure | capability returns file type, size, modification time, source, and freshness only; no contents or directory listing | file names supplied by an authorized caller remain visible in its own result |
| accidental public authority | inert MCP discovery remains empty and no provider configuration is loaded by the listener | a future MCP binding requires identity, policy, configuration, and audit review |

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

| Threat | Control | Residual risk / dependency |
| --- | --- | --- |
| malformed or substituted coordination receipt advances lifecycle | strict closed schemas plus exact operation and binding-digest checks | the future canonical digest implementation must be reviewed against the stable upstream contract |
| stale lease is treated as current | expiry is checked against an injected trusted clock and equality is stale | clock source and skew policy remain deployment-specific |
| dependency detail leaks through errors | all driver exceptions and timeouts normalize to one bounded code | future observability must retain the closed error surface |
| hidden retry duplicates nonce or lease operations | the consumer performs one bounded driver call and never retries | a future transport adapter must prove it does not retry, redirect, or poll internally |
| nonce or sealed lease handle enters evidence | sensitive values are absent from receipts intended for evidence and explicitly forbidden from logs, audit, errors, model context, and repository context | future adapter memory handling and crash diagnostics require review |
| Coordination implementation becomes coupled into MCP | only an MCP-owned port and fake driver exist; no source, bundle, client, schema, or transport is imported | compatibility cannot be claimed until PR #71 merges and an adapter is separately reviewed |

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

| Threat | Accepted control | Residual risk / dependency |
| --- | --- | --- |
| lifecycle binding is substituted or narrowed | one canonical MCP scope digest covers subject, capability, resources, environment, plan, approval, operation, expiry and epoch | canonical vectors require review before implementation |
| attacker redirects requests or abuses ambient network configuration | exact HTTPS base URI and fixed routes; redirects, proxy discovery and caller-selected targets forbidden | DNS and TLS trust remain deployment-specific |
| credential or lease capability leaks | explicit bounded authenticator, private redacted capability wrapper, closed errors and no raw-body diagnostics | concrete key custody and runtime memory handling need deployment review |
| timeout causes unsafe replay | one bounded request, abort once, no retry; ambiguous outcomes deny and require lifecycle reconciliation | availability loss can stop protected operations |
| malformed response becomes authority | independent closed response validation and route-specific outcomes; transport success never implies MCP authorization or provider success | upstream compatibility drift requires immutable re-review |
| copied client couples trust domains | platform APIs and public wire contract only; no upstream source, bundle, schema or client import | independent implementation may contain semantic defects requiring conformance tests |

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
  authenticator/transport ports, secret capability wrapper, and synthetic
  transport conformance

The implementation imports no Coordination code or artifact and is not wired
into the gateway. Exact HTTPS targets, fixed routes, canonical bounded bodies,
streamed response limits, strict media/cache headers, closed outcomes, one
deadline and no retry enforce the accepted boundary. Raw identities and nonce
values are replaced by domain-separated digests; lease capabilities reject JSON
and redact string/inspection output.

The synthetic tests do not yet cross a real TLS socket. Ephemeral loopback TLS
qualification remains required without committing private keys, adding a
dependency or invoking a subprocess. Until that evidence exists, the adapter
PR remains draft and no compatibility-complete claim is made. No endpoint,
credential, gateway wiring, provider execution, mutation, deployment, public
listener or live apply is authorized.
