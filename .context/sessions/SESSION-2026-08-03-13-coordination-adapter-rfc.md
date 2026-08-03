# Session — stable Coordination adapter proposal

- Date: 2026-08-03
- Governing issue: https://github.com/nomed/yukh-mcp/issues/47
- Branch: `agent/issue-47-coordination-adapter-rfc`
- Status: RFC draft complete locally; owner acceptance pending

## Outcome

Proposed RFC-0005 for an MCP-owned HTTPS adapter to the immutable Coordination
primitives v1 contract merged at commit
`03a64aa84a530273c452ba28d369b4b877dbfea4`. The proposal records artifact
digests, binding translation, explicit authentication, closed response
validation, secret capability handling, timeout/no-retry behavior, synthetic
qualification, rollback, and exclusions.

## Stop condition

No adapter was implemented. The accepted upstream RFC describes acquisition
contention as `contended`, while the merged schema, client and handler use a
`409 conflict` Problem Details response and accept only `acquired` as success.
Implementation remains blocked until the normative behavior is clarified and
the MCP owner explicitly accepts RFC-0005.

No Coordination component was copied or imported and no real request,
credential, endpoint, gateway wiring, provider execution, mutation, deployment,
or live apply was introduced.
