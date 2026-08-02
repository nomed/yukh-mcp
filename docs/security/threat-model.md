# Threat model

- Status: Initial
- Last reviewed: 2026-08-02
- Scope: Foundation architecture

## Assets

- node and workload identities;
- authorization policy;
- infrastructure credentials;
- capability definitions;
- approval decisions;
- execution and verification evidence;
- software supply chain.

## Trust boundaries

1. MCP client to gateway.
2. Gateway to identity and policy services.
3. Gateway to capability provider.
4. Provider to target node.
5. Runtime to audit storage.
6. Source repository to released artifact.

## Primary threats

- prompt injection causing unauthorized tool use;
- authentication or authorization bypass;
- confused-deputy and cross-resource access;
- command or argument injection;
- credential or sensitive-output disclosure;
- approval replay or substitution;
- unsafe retries of non-idempotent operations;
- provider compromise;
- audit deletion or tampering;
- malicious dependency or workflow compromise;
- denial of service and resource exhaustion.

## Baseline controls

- deny-by-default authorization;
- typed input schemas and server-side validation;
- capability allowlists;
- credentials isolated from model context;
- explicit approval binding;
- idempotency keys and bounded retries;
- time, output, and resource limits;
- structured redaction;
- tamper-evident audit design;
- pinned and reviewed build dependencies;
- negative and abuse-case tests.

This model must evolve with every new trust boundary or mutating capability.
