# Session — synthetic Coordination adapter implementation

- Date: 2026-08-03
- Governing issue: https://github.com/nomed/yukh-mcp/issues/47
- Branch: `agent/issue-47-synthetic-coordination-adapter`
- Status: implementation and TLS loopback qualification complete

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

The accepted RFC's loopback requirement is qualified by a test-only HTTPS
server on `127.0.0.1`. A fixed-argument OpenSSL invocation generates a one-day
self-signed certificate and private key in a mode-`0700` temporary directory;
the key is mode `0600`, is trusted only by the test transport, and the complete
fixture is removed in `finally`. Certificate verification remains enabled.
This owner-authorized test helper is absent from the runtime and build output,
adds no dependency, uses no shell, and does not weaken the product prohibition
on subprocesses or ambient trust.
