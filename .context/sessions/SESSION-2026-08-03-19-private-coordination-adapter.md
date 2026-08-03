# Session — private Coordination adapter implementation

- Date: 2026-08-03
- Governing issue: https://github.com/nomed/yukh-mcp/issues/50
- Branch: `agent/issue-50-private-adapter`
- Accepted design: RFC-0006
- Upstream candidate: `d122f31ce6a74dcec97dfcf8095a4447e23ee593`
- Upstream tree: `a59ba3f7ad6018d96f7329710eb593766acda676`

## Outcome

Implemented a disabled-by-default MCP-native private Coordination profile
behind the existing consumer contract. It owns exact private TLS trust,
descriptor-delivered short-lived token and P-256 PKCS#8 material, RFC 7638
thumbprint validation, fresh ES256 DPoP proofs, exact origin/routes, one
deadline and a no-retry dedicated HTTPS agent.

The profile binds every consumer request to the configured positive epoch and
synthetic environment before authentication or transport. It is absent from
the gateway and has no environment/default discovery or provider path.

## Qualification

Hermetic tests generate temporary TLS and P-256 material, pass secrets through
already-open descriptors, cross a real verified TLS socket, validate exact DPoP
header/claims/signature and `ath`, prove descriptor consumption, one request,
binding denial before transport and redacted/non-serializable wrappers. All
fixture material is removed after the test.

## Intentionally incomplete

No real endpoint, trust root, credential, registration, provisioning, bucket
bootstrap, live request, gateway wiring, provider execution, protected
mutation, deployment or production use exists. The complete Coordination
operator packet and explicit RFC-0022 provisioning approval remain prerequisites
to any real configuration; a live synthetic window remains separately gated.

## Next boundary

After review and merge, return to Coordination for the distinct operator packet
and provisioning gate. Do not configure this profile or send traffic until the
owner approves that packet; a second approval remains required for a live
synthetic window.

