# Yukh MCP context system

`.context/` is the repository-owned, durable operating memory for humans and agents.

## Precedence

When sources conflict:

1. current explicit human instruction;
2. accepted decisions;
3. accepted RFCs;
4. security and quality models;
5. project charter and architecture;
6. nearest `AGENTS.md`;
7. governing Issue and pull request;
8. latest applicable handoff;
9. session records;
10. temporary notes.

Sessions and handoffs preserve continuity and evidence. They do not silently change architecture.

## Records

- `manifest.yaml`: machine-readable loading and write rules.
- `decisions/`: durable decisions; accepted records are immutable.
- `rfcs/`: substantial, costly, public-contract, or security proposals.
- `handoffs/`: transfers of incomplete work.
- `sessions/`: chronological evidence; non-authoritative.
- `quality-attributes/`: measurable system requirements.
- `templates/`: canonical record formats.

Never store secrets, credentials, personal data, sensitive infrastructure details, or private reasoning in this public directory.
