# Why Yukh

Most remote-operation MCP servers expose command execution. That approach gives a model syntax-level power while leaving policy, intent, verification, and evidence to prompts.

Yukh MCP takes a different position:

> An agent receives a governed capability, not custody of credentials or infrastructure.

A capability is typed, versioned, scoped to resources and environments, evaluated by policy, and paired with evidence. Mutations follow plan, approval, apply, verification, and rollback semantics.

## Non-goals

Yukh MCP is not:

- an unrestricted remote shell broker;
- a replacement for configuration management or orchestration systems;
- a credential vault exposed to models;
- an approval mechanism implemented only in prompts;
- a system that treats successful process termination as verified intent.
