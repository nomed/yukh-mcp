# Session — private staging Coordination connection proposal

- Date: 2026-08-03
- Governing issue: https://github.com/nomed/yukh-mcp/issues/50
- Branch: `agent/issue-50-real-coordination-profile`
- Status: proposal ready for owner review; upstream RFC dependency unresolved

## Outcome

Proposed RFC-0006 for a disabled-by-default MCP-native connection to the paired
private staging Coordination profile. The design selects explicit private TLS
trust, a dedicated Node HTTPS transport, descriptor-delivered short-lived token
and P-256 key, strict DPoP signing, closed readiness/output and a separate
synthetic-only qualification runner.

## Dependency and boundary

The proposal depends on acceptance and implementation of Coordination RFC-0022
under `nomed/yukh-coordination#90`. MCP continues to import no Coordination
component and the ordinary gateway remains inert.

No endpoint, trust root, credential, private key, provisioning, request,
gateway wiring, provider execution, mutation, deployment or live apply was
introduced. RFC acceptance would authorize implementation and hermetic
qualification only; provisioning and live traffic retain later explicit human
gates.
