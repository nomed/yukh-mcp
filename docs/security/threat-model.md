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
write authority is separated from ordinary provider authority. The initial
model does not yet claim immutable or independently witnessed storage; those
limitations must remain explicit until #9 supplies an accepted design.

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

- #3 defines the complete authorization decision and failure contract.
- #5 defines the versioned capability contract and bounded provider semantics.
- #9 defines audit envelopes, redaction, retention, ordering, and integrity.
- #10 qualifies repository, CI, dependency, and release supply-chain controls.

Until those records are accepted, this model establishes constraints and stop
conditions; it does not authorize operational capabilities or production use.
