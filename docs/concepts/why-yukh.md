# Why Yukh MCP

Generic command execution gives a model broad syntax-level power. Prompts then
carry responsibilities that belong at the server boundary: authorization,
scope, approval, verification, and evidence.

Yukh MCP exposes a smaller interface:

- a named, versioned capability;
- typed input and output;
- an exact subject, resource, environment, and policy binding;
- server-side provider authority;
- explicit verification and redacted evidence.

For mutations, the server adds a bound plan and any required approval before
apply. Execution success alone is never verification.

This boundary makes clients replaceable and keeps credentials outside model
context. It does not make Yukh MCP an orchestrator, project tracker, or agent
supervisor.

See the [project charter](project-charter.md) for formal scope and terminology.
