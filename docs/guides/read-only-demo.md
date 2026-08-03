# Five-minute read-only demo

This synthetic demo proves the Yukh flow without credentials, elevated
privileges, production targets, or persistent state.

From a clean checkout with Node.js 22 or newer:

```sh
npm ci --ignore-scripts
npm run demo
```

The command starts a loopback gateway on an ephemeral port, connects an MCP
client, discovers `node.inspect`, performs one explicitly allowed read and one
explicitly denied read, prints structured results and sanitized evidence, then
removes its temporary fixture and stops the gateway.

The output is labelled `synthetic_local_demo`. Its evidence projection is
classified `protected` and marked `in_memory_demo_only`: it demonstrates
structure and correlation but is not a durable RFC-0004 audit record. The
ordinary gateway remains inert and exposes no operational tools.
