# RFC-0006 — Private staging Coordination connection

- Status: Draft
- Authors: Codex
- Created: 2026-08-03
- Governing issue: https://github.com/nomed/yukh-mcp/issues/50
- Depends on: RFC-0002, RFC-0003, RFC-0004, RFC-0005 and proposed `nomed/yukh-coordination` RFC-0022

## Summary

Define the first real Yukh MCP connection to Coordination as a disabled-by-
default staging profile consuming
`yukh-coordination/private-primitives-staging-v1`. The profile adds an
MCP-native direct TLS transport, explicit private trust, descriptor-delivered
short-lived credential and P-256 signing key, and an RFC 9449 DPoP
authenticator behind the already accepted adapter ports.

The connection is exercised only by a separate qualification runner using
synthetic lifecycle bindings. It is not wired into the MCP gateway, capability
provider or mutation lifecycle.

Acceptance authorizes implementation and hermetic interoperability
qualification only after the upstream RFC is accepted. It does not authorize
an endpoint value, trust root, credential, provisioning, live request, gateway
wiring, provider execution, mutation, deployment or production use.

## Motivation

RFC-0005 and merge `cb3e8f808a47c7c226ec414b2f1ed39351b4189e`
provide an independent, synthetically TLS-qualified consumer adapter. They
deliberately contain no real transport or authentication implementation. A
real connection adds concrete server identity, private trust, workload
credential, proof signing, clock, secret custody, startup and operational
failure boundaries that must be frozen before source can obtain remote
authority.

The paired Coordination proposal under issue #90 defines the server side. This
RFC defines only the MCP consumer side and cannot become implementable until
the upstream record is accepted.

## Goals

- connect only to one exact qualified private staging HTTPS origin;
- use a dedicated Node HTTPS transport with an explicit trust bundle and no
  ambient proxy or system-root fallback;
- authenticate every request with one short-lived opaque token and a fresh
  ES256 DPoP proof from an ephemeral key;
- receive secret inputs only through explicit inherited file descriptors;
- preserve fixed routes, canonical bodies, one deadline and no retry from
  RFC-0005;
- keep errors, logs, audit projections and process inspection free of secret
  material by construction;
- qualify one real nonce and lease lifecycle with synthetic bindings and no
  provider path;
- make disablement immediate and the default configuration inert.

## Non-goals

- importing any Coordination source, client, schema, package or deployment
  component;
- provisioning Coordination, JetStream, TLS, policy, audit or credentials;
- OAuth discovery, token exchange, refresh, cloud metadata, environment
  credentials, generic key stores or command execution;
- wiring the consumer into MCP request handling, policy, plan, approval,
  provider, verification or audit execution;
- public or production deployment, live apply or protected target mutation;
- retries, polling, discovery, proxy use, redirects, fallback trust or
  credential switching.

## Detailed design

### Profile boundary

The profile identifier is `yukh-mcp/private-coordination-staging-v1`. It is
constructed only by a dedicated qualification entry point. The ordinary
gateway and demo retain their current behavior and cannot discover or activate
the profile through MCP input, environment variables or default configuration.

Construction requires one closed value containing:

- the exact profile/version;
- one exact HTTPS origin with no path, user information, query or fragment;
- an absolute explicit private trust-bundle path and expected server name;
- token and DPoP-key inherited descriptor numbers;
- a trusted registration expiry and expected DPoP thumbprint;
- one deadline from 1 to 2,000 milliseconds;
- a positive restore epoch matching the approved deployment plan;
- the exact synthetic environment reference permitted for qualification.

There are no defaults. Unknown fields, duplicate keys, relative paths,
symlinks, unsafe file permissions, wildcard names, system roots, environment
overrides and caller-selected suffixes fail construction before secret reads or
network access. Endpoint and trust values are deployment inputs and never enter
public examples, logs, errors or durable context.

### Secret acquisition and lifecycle

The accountable supervisor delivers the uniformly random 256-bit opaque token
and ephemeral P-256 PKCS#8 private key through two distinct already-open file
descriptors. Each is read exactly once under an independent byte and time
bound, then closed. The token and source key bytes are copied into redacted
runtime wrappers; source buffers are zeroed immediately.

The private key is parsed into a non-exported Node `KeyObject`. The public JWK
thumbprint is derived locally and compared to the expected registration value
before readiness. The private key, token and descriptor values are not
serializable, inspectable, loggable or returnable. They never appear in command
arguments, environment variables, generic configuration, crash diagnostics,
audit events or model context.

The trusted expiry is no more than 15 minutes after issuance. Readiness becomes
false at expiry and no refresh occurs. Rotation is a complete process/profile
replacement with new descriptors and an accepted server registration; there is
no overlapping credential or fallback.

### DPoP authenticator

For every frozen adapter request the authenticator returns:

```text
credential = "DPoP " + opaque_token
proof = compact ES256 DPoP JWS
```

The protected header contains exactly `typ=dpop+jwt`, `alg=ES256` and the public
P-256 JWK. The claims contain exactly:

- fresh random base64url `jti` with 128 bits of entropy;
- exact adapter-supplied uppercase `htm`;
- exact adapter-supplied HTTPS target as `htu`, without query or fragment;
- integer current `iat` from an injected trusted UTC clock;
- base64url SHA-256 `ath` over the exact ASCII token.

No nonce, body claim, custom audience, key ID, certificate, private JWK member
or additional claim is emitted. The proof is generated only after the adapter
freezes the target and canonical request body. Signing has the same single
request deadline and failure normalizes to `coordination_unavailable` without
retry.

The signer maintains no proof history; server-side durable replay reservation
is authoritative. Local CSPRNG, clock or signing failure makes the profile
unready and emits no request.

### Direct HTTPS transport

The transport uses Node platform `https` APIs directly. It creates one
non-global agent with:

- the exact supplied private CA bundle;
- certificate and server-name verification enabled;
- no client certificate;
- no environment proxy, global dispatcher, redirect or DNS search fallback;
- keep-alive disabled for the first profile;
- explicit connect, TLS, response-header and whole-request deadlines bounded by
  the adapter's one deadline;
- response decompression disabled and the existing 4 KiB streamed bound.

The transport accepts only adapter-generated `https` targets whose origin
exactly equals the configured origin and whose path is one of the five fixed
routes. It rejects informational responses, upgrade, redirect, multiple final
responses, conflicting framing and every certificate/hostname error. It sends
exactly one request and never retries connection, TLS, authentication or HTTP
failure.

Raw TLS, socket, certificate, DNS and operating-system errors are discarded and
mapped through the accepted closed MCP taxonomy. The transport returns only the
bounded `Response` abstraction already validated independently by RFC-0005.

### Readiness, observability and disablement

The qualification runner reports ready only when configuration is valid,
trust material has safe ownership/mode, token/key descriptors were consumed,
key thumbprint matches, credential is unexpired and clock is within the
deployment's five-second fence. It does not probe a primitive route for
readiness because every route has state semantics.

Operational output is one closed record containing profile version, phase,
ready/not-ready, sanitized outcome code and monotonic duration bucket. It
contains no endpoint, path, descriptor, token, proof, JWK, thumbprint, TLS
identity, body, binding digest, lease capability, fence or upstream text.

The kill switch is absence of the explicit profile invocation. Termination
aborts the one active request, destroys the private agent, drops token/key
wrappers and zeroes mutable buffers. It cannot retry or infer remote state.

### Qualification lifecycle

The hermetic test composes the independent MCP transport/authenticator against
the separately implemented upstream profile with generated private trust,
descriptor-delivered ephemeral secrets, a disposable real JetStream service
and synthetic bindings. It proves:

- TLS trust and server-name success plus wrong-root/name/expiry negatives;
- exact DPoP header/claims/signature, `ath`, target and thumbprint;
- proof replay denial across server restart;
- nonce first-consume and replay;
- lease acquire, conflict, inspect, renew, stale capability, release and fence
  monotonicity;
- one-call timeout and ambiguous response with no hidden retry;
- expired credential, policy denial, audit outage, epoch mismatch and key loss;
- no secret in errors, logs, test diagnostics, process arguments or build
  output;
- gateway discovery and provider invocation remain unchanged and inert.

Live staging qualification is a separate human-gated run after both
implementations merge. It uses one pre-reviewed plan containing only public
digests of implementation commits, profile versions, trust/registration
artifacts, limits, epoch and teardown steps. The actual endpoint and secrets
remain outside public evidence.

The owner separately approves (1) provisioning and credential minting and (2)
the single live qualification window. The runner performs only synthetic nonce
and lease operations, releases or records ambiguous state, exits, and requires
credential revocation plus server listener disablement. It cannot invoke the
gateway or a provider.

## Trust boundaries and threat analysis

New boundaries are supervisor-to-MCP secret delivery, MCP-to-private trust
bundle, token/key-to-DPoP signer, MCP-to-real TLS endpoint and qualification
runner-to-remote coordination state.

Threats include endpoint substitution, CA broadening, credential/key leakage,
proof replay, target substitution, ambient proxy use, retry after ambiguity,
secret-bearing diagnostics, credential persistence and treating Coordination
success as MCP/provider authority.

Controls are exact origin/name/private CA, descriptor-only short-lived secrets,
thumbprint check, strict DPoP, fixed routes, platform-only dedicated transport,
one deadline, no retry, redacted wrappers, closed output and complete separation
from gateway/provider paths.

Residual risk includes compromise of the MCP host/supervisor, plaintext secret
presence in process memory, staging CA compromise, private-network denial of
service and remote state left ambiguous after timeout. These are accepted only
for the bounded staging qualification, not production.

## Compatibility

The existing consumer port and RFC-0005 wire mapping do not change. The direct
transport and authenticator are optional implementations injected behind the
same ports. Ordinary gateway, demo and provider behavior remain byte- and
discovery-compatible.

The implementation consumes only the immutable public Coordination wire
contract and accepted deployment profile. It neither imports nor republishes
upstream code, schemas, clients, storage or configuration.

## Rollout and rollback

1. Accept upstream Coordination RFC-0022.
2. Accept this RFC explicitly.
3. Implement and hermetically qualify the upstream staging service.
4. Record its immutable commit and contract evidence in issue #50.
5. Implement and hermetically qualify the MCP transport, signer and runner.
6. Review a redacted provisioning plan and obtain explicit owner approval.
7. Provision without traffic and review readiness evidence.
8. Obtain separate owner approval for one live qualification window.
9. Run synthetic-only qualification, revoke credentials and disable both
   profiles.

Acceptance authorizes steps 3–5 only after their dependencies. Steps 6–9 keep
their explicit gates. Gateway wiring and provider/mutation use require a later
RFC even after successful live qualification.

Rollback omits the profile invocation, closes the agent, drops secrets and
revokes the server registration. Remote nonce/lease state is preserved and
never deleted to manufacture retry safety.

## Alternatives

### Use global `fetch`

Rejected because the profile needs an exact private CA, server name, agent and
proxy-independent transport boundary without ambient global configuration.

### Store token or key in environment variables or files

Rejected because those are ambient, inheritable and more likely to enter
diagnostics or durable host state. Short-lived inherited descriptors provide a
narrower staging boundary.

### Reuse the upstream JavaScript client

Rejected because MCP must preserve independent trust and compatibility
validation and must not copy Coordination components.

### Wire the gateway immediately

Rejected because a real Coordination connection proves remote primitives, not
MCP authentication, policy, approval, audit or provider admission.

### Automatically retry transient failures

Rejected because a timeout can conceal nonce consumption or a lease state
transition. Reconciliation remains explicit and lifecycle-aware.

## Open questions

1. Which supervisor will supply inherited descriptors in the first staging
   environment? The public MCP contract remains independent of that selection.
2. Which exact origin, trust root and registration will be used? They are
   private deployment evidence and are deliberately absent from this RFC.
