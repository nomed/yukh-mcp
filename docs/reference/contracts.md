# Contracts and implementations

Use these sources when building or testing an integration. Accepted RFCs define
semantics; reference packages validate records without network or provider
access.

| Contract | Accepted decision | Executable reference |
| --- | --- | --- |
| Capability v1 | [RFC-0001](https://github.com/nomed/yukh-mcp/blob/main/.context/rfcs/RFC-0001-versioned-capability-contract.md) | [Package and API](https://github.com/nomed/yukh-mcp/tree/main/contracts/capability/v1) |
| Authorization v1 | [RFC-0002](https://github.com/nomed/yukh-mcp/blob/main/.context/rfcs/RFC-0002-deny-by-default-authorization.md) | [Package and API](https://github.com/nomed/yukh-mcp/tree/main/contracts/authorization/v1) |
| Mutation lifecycle | [RFC-0003](https://github.com/nomed/yukh-mcp/blob/main/.context/rfcs/RFC-0003-bound-plan-approval-apply-lifecycle.md) | No public runtime |
| Audit evidence | [RFC-0004](https://github.com/nomed/yukh-mcp/blob/main/.context/rfcs/RFC-0004-structured-redacted-audit-evidence.md) | [Network-free writer foundation](audit-writer.md); no durable backend |
| Coordination adapter | [RFC-0005](https://github.com/nomed/yukh-mcp/blob/main/.context/rfcs/RFC-0005-stable-coordination-consumer-adapter.md) | Synthetic loopback qualification only |

## Validate the repository

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
```

Unknown versions, fields, bindings, or policy outcomes fail closed. Reference
packages do not authorize a provider, credential, target, or deployment.
