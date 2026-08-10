<p align="center">
  <a href="https://nomed.github.io/system/mcp/"><img src="docs/assets/repository-mark.svg" width="96" alt="Yukh MCP"></a>
</p>

<h1 align="center">Yukh MCP</h1>

<p align="center"><a href="https://nomed.github.io/system/mcp/">Role in the Yukh system</a></p>

> **Give agents capability, not custody.**

Yukh MCP is a policy-governed capability gateway for bounded AI operations.

## Try the supported demo

Requires Node.js 22 or newer:

```sh
npm ci --ignore-scripts
npm run demo:e2e
```

The demo starts an isolated child gateway on an ephemeral loopback port, then a
real MCP client discovers `node.inspect`, shows one allowed read, one denied
read, and the resulting in-memory evidence. It needs no credentials and cleans
up its process and fixture before exit.

[Follow the tutorial](https://nomed.github.io/yukh-mcp/guides/read-only-demo/)
· [Read the documentation](https://nomed.github.io/yukh-mcp/)

## Status

**Foundation; not production-ready.** The ordinary gateway is inert: it exposes
no operational tools, providers, credentials, persistence, or mutation path.
Only the synthetic local demo exposes `node.inspect`.

Accepted contracts and their executable, network-free reference packages:

- [capability contract](contracts/capability/v1/README.md);
- [deny-by-default authorization](contracts/authorization/v1/README.md).

The complete lifecycle is `intent → capability → policy → plan → approval →
execution → verification → audit`. See the [architecture](https://nomed.github.io/yukh-mcp/architecture/overview/)
and [contract reference](https://nomed.github.io/yukh-mcp/reference/contracts/).

## Security

Do not report vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
