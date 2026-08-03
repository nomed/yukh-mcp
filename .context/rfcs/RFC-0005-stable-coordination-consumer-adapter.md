# RFC-0005 — Stable Coordination consumer adapter

- Status: Draft
- Authors: Codex
- Created: 2026-08-03
- Governing issue: https://github.com/nomed/yukh-mcp/issues/47
- Depends on: RFC-0002, RFC-0003, RFC-0004

## Summary

Define a Yukh MCP-owned HTTPS adapter from the inert coordination consumer port
to the immutable client-neutral Coordination primitives v1 contract merged at
`nomed/yukh-coordination@03a64aa84a530273c452ba28d369b4b877dbfea4`.

The adapter translates exact MCP lifecycle bindings into the five closed public
operations for nonce consumption and fenced leases. It uses platform APIs and
the reviewed wire contract only. It does not copy or import Coordination source,
generated schemas, bundles, clients, storage adapters, authentication providers,
or deployment configuration.

Acceptance would authorize only a separately reviewed adapter implementation
and synthetic loopback HTTPS qualification. It would not authorize a real
endpoint, credential, gateway wiring, provider execution, mutation, deployment,
public listener, or live apply.

## Motivation

RFC-0003 requires durable nonce consumption and fenced exclusion before
protected mutation can cross the provider boundary. The inert MCP port merged
under issue #45 freezes those application needs without choosing a transport.
Coordination PR #71 now provides a stable external contract, but consuming it
adds network, authentication, untrusted-response, timeout, and secret-capability
boundaries that must be explicit before implementation.

The inert port and the wire contract are not shape-compatible by design. The
MCP port carries lifecycle bindings and currently models evidence references;
the wire contract accepts digests and returns minimal outcomes without MCP audit
evidence. An adapter must translate semantics without fabricating evidence or
letting transport success advance the lifecycle.

## Goals

- bind every call to the exact subject, capability, resources, environment,
  plan, approval, operation, and configured restore epoch;
- consume only the five closed TLS operations defined by Coordination v1;
- keep authentication explicit and separate from MCP authorization;
- validate canonical bounded responses independently and fail closed;
- keep nonce values and lease capabilities outside logs, errors, audit payloads,
  model context, Action output, and durable repository context;
- perform exactly one request with an explicit deadline and no hidden retry;
- qualify the adapter against a synthetic loopback HTTPS server;
- retain an implementation-independent MCP consumer port.

## Non-goals

- copy, vendor, import, execute, or republish the Coordination client or schema;
- address NATS, KV storage, Coordination internal packages, buckets, keys,
  revisions, sealing keys, or capability plaintext;
- configure a real base URI, credential issuer, DPoP key, proxy, trust store, or
  production identity;
- wire coordination into the gateway or make a mutating capability executable;
- treat Coordination authentication or authorization as MCP authorization,
  approval, provider authority, or proof of a protected effect;
- add retry, polling, discovery, redirects, credential switching, subprocesses,
  consumer-time installation, or background work;
- claim apply compatibility, deployment readiness, or production security.

## Upstream compatibility baseline

The reviewed immutable baseline and SHA-256 evidence is:

| Upstream artifact | SHA-256 |
| --- | --- |
| `schema/coordination-primitives-1.schema.json` | `c241d390faba792cbedd8049a30ac05da621fe4a7a3304e54b9538db324f0679` |
| `js/dist/primitives-client.mjs` | `846a7316f3c584dd45e0697476d0bfaf072b023f056feeb1b2e67a21896a53e6` |
| `RFC-0015-client-neutral-coordination-primitives-api.md` | `f78477b43e4056b504b0062d39c658b9b097987eb41cb55eea54747e7859440f` |
| `RFC-0017-two-phase-capability-authorization.md` | `4c86d664a8eb97760c0d75d76d48c9eb1581c2c1af4d7a1f48fbdc8c2feb10de` |
| `RFC-0019-bounded-capability-accounting.md` | `b300262cd7efc61bdfc578d896ef2661241f876b89a6cef65f89cde1859788e8` |

These digests are review evidence, not runtime downloads. The MCP build does not
fetch or embed the artifacts. Any later upstream baseline requires a new focused
compatibility review and updated immutable commit and digests.

## Detailed design

### Authority separation

The MCP lifecycle remains authoritative for request validation, scope
resolution, authorization, plan creation, approval verification, preconditions,
provider admission, verification, and audit. The adapter may obtain a nonce
outcome or lease fence only after those earlier MCP stages provide an immutable
binding. Neither a `2xx` response nor possession of a lease capability permits
provider invocation.

Coordination independently authenticates and authorizes its five primitive
actions. That protects its service and storage; it does not replace MCP policy.
Failure at either layer denies progression.

### MCP binding and derived digests

The consumer request MUST carry one closed binding containing:

- operation reference;
- subject reference;
- exact capability identity and version;
- canonical resource-set digest;
- logical environment reference;
- plan digest;
- approval digest;
- immutable requested expiry;
- configured positive restore epoch.

The existing consumer port MUST be revised before adapter implementation so
nonce expiry and epoch are explicit trusted inputs, rather than inferred from
wall-clock defaults. Lease acquisition uses an exact expiry, not a relative TTL.
Coordination responses do not contain MCP evidence references, so the port MUST
also stop requiring or synthesizing such a reference. MCP audit events are
created independently from validated local bindings and sanitized outcome codes.

`scope_digest` is the lowercase hexadecimal portion of the accepted canonical
MCP binding digest after verifying its `sha256:` prefix. It therefore binds the
complete subject, capability, resource, environment, plan, approval, operation,
expiry, and epoch record rather than a caller-selected resource string.

`value_digest` is a domain-separated SHA-256 digest of the validated one-shot
nonce bytes. `holder_digest` is a distinct domain-separated SHA-256 digest of a
closed canonical record containing the subject, operation, plan, approval, and
scope digest. The exact domain strings and canonical byte vectors are frozen in
implementation fixtures before any adapter is accepted. Raw nonce, subject,
approval, plan, or resource values never cross the wire.

### Closed operation mapping

The adapter exposes only:

| MCP consumer operation | Coordination route | Request |
| --- | --- | --- |
| consume nonce | `POST /coordination-primitives/v1/nonces:consume` | epoch, expiry, scope digest, value digest |
| acquire lease | `POST /coordination-primitives/v1/leases:acquire` | epoch, expiry, holder digest, scope digest |
| inspect lease | `POST /coordination-primitives/v1/leases:inspect` | lease capability |
| renew lease | `POST /coordination-primitives/v1/leases:renew` | expiry, lease capability |
| release lease | `POST /coordination-primitives/v1/leases:release` | lease capability |

The base URI is an exact prevalidated HTTPS origin plus optional fixed path
prefix. It contains no query, fragment, user information, wildcard host, or
caller-selected suffix. Route construction uses fixed constants. Redirects are
rejected. Proxy environment variables and ambient credential discovery are not
consulted.

### Authentication boundary

Construction requires an explicit request-authentication callback. It receives
only the fixed target, method, canonical body digest, and deadline and returns a
closed bounded credential/proof record for the one request. The callback cannot
change the target, body, action, timeout, or transport. Authentication material
is attached only after the complete request is frozen and is never returned,
logged, cached, serialized into errors, or exposed to the consumer port.

No default, allow-all, environment-discovered, header-forwarding, or
caller-supplied authentication adapter exists. Synthetic tests use a deterministic
fake with non-production values.

### Lease capability handling

The opaque lease capability is confidential runtime material. The adapter wraps
it in a class whose string, JSON, inspection, and error projections are redacted
or rejected. Only the adapter's private request encoder can reveal it into the
fixed inspect, renew, or release body. It is never part of an MCP result, audit
event, log, diagnostic, Action output, cache key, command argument, or durable
record.

Renew atomically replaces the locally held wrapper with the returned capability
only after the complete response validates. The prior wrapper is invalidated in
process. Timeout or ambiguous response does not infer ownership; the lifecycle
enters a bounded unavailable/operator-review path and does not retry.

### Framing and response validation

Requests use canonical UTF-8 JSON with media type
`application/yukh-coordination-primitives+json;version=1`, at most 4 KiB and
depth four. Duplicate keys, unknown fields, non-canonical numbers, invalid
digests, invalid timestamps, and unsafe integers fail before authentication or
network I/O.

Responses must be the same media type, `Cache-Control: no-store`, at most 4 KiB,
well-formed UTF-8, one closed canonical object, and one route-valid outcome or
Problem Details record. Unknown status, media type, field, outcome, problem
code, status/code pairing, fencing token, expiry, or capability shape becomes a
local `coordination_response_invalid` denial. Raw body and upstream error text
are discarded and never included in diagnostics.

The consumer performs one request under a configured deadline no greater than
two seconds and shorter than the server maximum. It aborts once and performs no
automatic retry. Connection, TLS, authentication, abort, framing, response, and
provider failures normalize to closed MCP coordination error codes.

### Outcome semantics

`consumed` is the only nonce outcome that may satisfy one-shot admission.
`replayed` denies. `acquired` is the only successful acquisition outcome.
Inspect `valid` may confirm current lease state; `expired`, `released`, and
`stale` deny continued admission. `renewed` replaces the capability and fence.
`released` records local release completion but grants no authority.

Every Problem Details code denies progression. Conflict, replay, stale fence,
temporary unavailability, and timeout are never implicitly retried. Transport
success is not provider success and never produces MCP lifecycle success.

## Trust boundaries and threat analysis

The adapter introduces boundaries from MCP to an authentication provider and
from MCP across TLS to an untrusted Coordination response. Principal threats
are binding substitution, SSRF/redirect/proxy abuse, credential disclosure,
capability leakage, replay, stale fencing, ambiguous timeout, oversized or
malformed responses, upstream drift, and accidental elevation of Coordination
outcomes into MCP authority.

Controls are exact digest binding, fixed HTTPS targets and routes, explicit
authentication, closed schemas, canonical bytes, byte/depth/deadline bounds,
one call, no retry, secret wrappers, normalized errors, immutable upstream
evidence, independent MCP authorization, and synthetic negative tests.

Residual deployment risks include TLS trust and pinning, DNS control, concrete
credential issuance and key custody, clock synchronization, endpoint
availability, audit durability, and topology. They remain outside this RFC and
must be accepted before any real endpoint is configured.

## Compatibility

The inert port has no gateway consumer and is experimental, so it may be changed
in the same implementation PR to carry epoch/expiry and remove synthetic
evidence fields. Tests must prove existing gateway and demo discovery remain
unchanged and inert.

The upstream RFC text says lease acquisition may return `contended`, while the
merged schema, bundled client, and handler represent contention as a `409`
`conflict` Problem Details response and accept only `acquired` as a successful
outcome. This proposal does not choose silently between conflicting sources.
Implementation is blocked until the upstream contract owner confirms the
normative behavior or publishes an immutable correction.

## Rollout and rollback

1. Resolve the acquisition-contention contract discrepancy.
2. Accept this RFC explicitly.
3. Revise the inert MCP port and freeze canonical digest vectors.
4. Implement the adapter with platform APIs only.
5. Qualify it against a synthetic loopback HTTPS server, including every
   negative and ambiguous path.
6. Review dependency, threat-model, and redaction evidence.
7. Merge with no gateway wiring or real configuration.

Rollback removes the adapter and restores the inert port. No remote or provider
state exists to migrate or undo. Any future real integration requires a new
deployment and identity profile, a separate issue, and explicit authorization.

## Alternatives

### Import or vendor the upstream client

Rejected because it copies Coordination implementation into MCP, couples
release and build provenance, and weakens independent validation.

### Invoke a Coordination CLI or shell command

Rejected because secret-bearing command arguments, PATH resolution,
subprocesses, and consumer-time installation violate the gateway boundary.

### Connect directly to NATS or KV

Rejected because it exposes storage credentials and topology and duplicates
provider CAS, ambiguity, recovery, and fencing semantics.

### Reuse Coordination receipts as MCP audit evidence

Rejected because the wire contract provides minimal outcomes, not RFC-0004
events. Inventing evidence references would create false audit claims.

### Add retry for transient failures

Rejected because timeout may hide nonce consumption or lease state changes.
Reconciliation is explicit and lifecycle-aware; the adapter never retries.

## Open questions

1. Will Coordination make `contended` a closed `2xx` outcome or confirm `409`
   `conflict` as the normative acquisition-contention result?
2. Which deployment-specific authentication and TLS profile will later be
   accepted for a real endpoint? This does not block synthetic implementation.
