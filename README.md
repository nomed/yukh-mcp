# Yukh MCP

> **Give agents capability, not custody.**

Yukh MCP is an open-source, policy-governed capability gateway for safe, auditable, and verifiable AI operations.

It is designed around a strict lifecycle:

```text
intent → capability → policy → plan → approval → execution → verification → audit
```

Yukh MCP does not aim to be an unrestricted remote shell broker. It exposes typed capabilities, evaluates explicit policy, plans mutations before execution, verifies outcomes, and produces structured evidence.

## Status

Yukh MCP is in its foundation phase. Public contracts and security boundaries are being designed in the open before operational capabilities are implemented.

## Principles

- Capability, not custody.
- Deny by default.
- No mutation without a plan.
- No success without verification.
- Structured evidence over opaque output.
- Security decisions are public and reviewable.
- Vendor-neutral MCP interoperability.

## Project

Work is coordinated through [GitHub Issues](https://github.com/nomed/yukh-mcp/issues) and the [Yukh project](https://github.com/users/nomed/projects/5).

Documentation source lives under `docs/` and will be published with GitHub Pages.

## Security

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
