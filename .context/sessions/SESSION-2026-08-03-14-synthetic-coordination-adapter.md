# Session — synthetic Coordination adapter implementation

- Date: 2026-08-03
- Governing issue: https://github.com/nomed/yukh-mcp/issues/47
- Branch: `agent/issue-47-synthetic-coordination-adapter`
- Status: implementation candidate complete; TLS loopback qualification pending

## Outcome

Revised the experimental consumer port to carry trusted epoch and exact expiry
and removed invented evidence references. Added an independent MCP-native
adapter for the accepted Coordination primitives v1 wire contract using only
Node platform APIs and injected authentication/transport ports.

The adapter derives domain-separated scope, nonce and holder digests; emits only
the five fixed HTTPS routes; bounds canonical request and streamed response
bytes; rejects redirects, framing drift and unknown outcomes; applies one
deadline across authentication, transport and response; performs no retry; and
keeps lease capabilities in a redacted, non-serializable private wrapper.

## Validation and boundary

Synthetic transport tests cover binding minimization, all lease operations,
normative `409 conflict`, nonce replay, stale input, malformed output, secret
error normalization, deadline and one-call behavior. The adapter is not wired
into the gateway and no Coordination component, endpoint, real credential,
provider execution, mutation, deployment or live apply exists.

The accepted RFC additionally requires a real synthetic loopback HTTPS server.
That qualification remains pending because the repository must not commit a
private key and the implementation may not add a subprocess or dependency to
generate one. The current injected transport evidence is not represented as a
real TLS crossing; the PR must remain draft until a compliant ephemeral TLS
fixture is reviewed or the owner explicitly narrows that qualification.
