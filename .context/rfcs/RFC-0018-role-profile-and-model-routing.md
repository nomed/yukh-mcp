# RFC-0018 — Role profiles and model-aware engagement

- Status: Accepted
- Authors: Nomed with Codex implementation support
- Created: 2026-08-15
- Accepted: 2026-08-15
- Decider: project owner
- Governing issue: https://github.com/nomed/yukh-mcp/issues/131
- Depends on: RFC-0017

## Decision

Add a versioned role-profile catalog to the team control plane. A profile names
one professional role and fixes its preferred runtime, model class, skill
bundle, operating instructions and delegation default. Initial profiles cover
backend development, frontend development, product management, QA and review.

Managers inspect the catalog and call `agent.engage` with a profile and task.
The server resolves and persists the effective profile before launch. The
existing low-level `agent.spawn` remains available for explicit qualification,
but it cannot claim a catalog profile.

## Routing boundary

Natural-language task analysis belongs to the manager model. The manager must
select a declared profile; the server does not infer authority from message
text. Runtime and model overrides may only narrow to values allowed by the
profile. Model classes are stable policy names mapped to concrete locally
configured model identifiers, keeping changing provider model names out of the
catalog.

Coordination requests identify the required capability and work, while the
team manager chooses and starts a matching profile. A recipient may delegate
only through the bounded parent-child rules in RFC-0017.

## Skills and instructions

Profiles reference bounded, versioned skill identifiers and contain concise
role instructions. Before launch the runtime verifies that every referenced
skill is available to that runtime. Prompt text carries only the resolved role,
task, instructions and skill identifiers; credentials and private reasoning
are excluded.

## Evidence and failure

Agent state records include profile version, model class, effective model,
skills and an instruction digest. Status and logs therefore show who was
engaged and with which operating profile. Missing profiles, model mappings or
skills fail before a process starts; there is no silent downgrade.

## Qualification

Create a product manager, backend developer and frontend developer from one
goal. Verify distinct effective profiles, model mappings and skill bundles;
deny an unknown profile, missing skill, widened model and cross-team spawn.

## Rollback

Remove `agent.engage` and the profile catalog. Existing explicit `agent.spawn`
records and RFC-0017 team state remain readable.
