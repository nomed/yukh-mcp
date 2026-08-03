<p align="center">
  <a href="https://nomed.github.io/system/mcp/"><img src="docs/assets/repository-mark.svg" width="96" alt="Yukh MCP"></a>
</p>

<h1 align="center">Yukh MCP</h1>

<p align="center"><a href="https://nomed.github.io/system/mcp/">Role in the Yukh system</a></p>

> **Give agents capability, not custody.**

Yukh MCP is an open-source, policy-governed capability gateway for safe, auditable, and verifiable AI operations.

It is designed around a strict lifecycle:

```text
intent → capability → policy → plan → approval → execution → verification → audit
```

Yukh MCP does not aim to be an unrestricted remote shell broker. It exposes typed capabilities, evaluates explicit policy, plans mutations before execution, verifies outcomes, and produces structured evidence.

## Status

Yukh MCP is in its foundation phase. Public contracts and security boundaries are being designed in the open before operational capabilities are implemented.

The versioned capability contract is governed by accepted
[RFC-0001](.context/rfcs/RFC-0001-versioned-capability-contract.md). Its
[network-free reference package](contracts/capability/v1/README.md) validates
synthetic contract records without exposing a provider or MCP runtime.

The deny-by-default authorization contract is governed by accepted
[RFC-0002](.context/rfcs/RFC-0002-deny-by-default-authorization.md). Its
[network-free reference package](contracts/authorization/v1/README.md) binds
policy evaluation to the exact request, combines deny-overrides deterministically,
and rejects decision replay without implementing identity, policy, or provider
integrations.

## Principles

- Capability, not custody.
- Deny by default.
- No mutation without a plan.
- No success without verification.
- Structured evidence over opaque output.
- Security decisions are public and reviewable.
- Vendor-neutral MCP interoperability.

The [project charter](docs/concepts/project-charter.md) defines these principles
operationally, identifies the intended audience and use cases, and supplies the
review questions and terminology used to keep the boundary testable.

## Project

Work is coordinated through [GitHub Issues](https://github.com/nomed/yukh-mcp/issues) and the [Yukh project](https://github.com/users/nomed/projects/5).

Documentation source lives under `docs/` and will be published with GitHub Pages.

## Security

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
