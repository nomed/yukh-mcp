# Software supply-chain baseline

Issue #10 establishes the minimum contribution and delivery controls for Yukh
MCP. This baseline validates source; it does not publish a package, container,
release, signature, SBOM, or provenance statement.

## Current repository evidence

Verified on 2026-08-03:

- secret scanning and push protection are enabled;
- `main` is protected by a branch-protection rule;
- Dependabot vulnerability alerts and security updates are enabled;
- workflow actions are pinned to full commit SHAs;
- workflows use explicit least-privilege token permissions;
- no workflow uses `pull_request_target`;
- no release or artifact publication workflow exists.

Normal merges into `main` require a pull request, one approving review, stale
approval dismissal, approval after the latest push, conversation resolution,
strict successful `validate`, `review`, and `analyze` checks, and linear
history. Force pushes and branch deletion are blocked. Merged branches are
deleted automatically.

The repository currently has one administrator and direct collaborator,
`nomed`. Administrator enforcement is intentionally disabled so that this solo
owner can use GitHub's explicit administrative merge path when normal approval
separation is unavailable. This is a break-glass governance exception, not the
normal merge path: an administrative merge can bypass every applicable branch
protection, including reviews and required checks. It therefore requires the
owner's explicit authorization for the specific change and a durable record in
the pull request or session handoff of the reason, validation state, and exact
merged commit.

Repository administrator bypass is independent of MCP authorization. It does
not create a runtime approval, expand a capability, authorize a provider
operation, or weaken the plan-bound and default-deny execution model.

## Pull-request gates

Every pull request runs these checks without path filtering:

| Check | Evidence |
| --- | --- |
| `CI / validate` | locked install without scripts, formatting, typecheck, all tests, build, dependency audit, strict documentation build, inert container build |
| `Dependency review / review` | newly introduced dependencies fail at moderate-or-higher known severity |
| `CodeQL / analyze` | JavaScript/TypeScript `security-extended` static analysis and code-scanning upload |

OpenSSF Scorecard runs on `main`, manually, and weekly. Its SARIF is uploaded to
GitHub code scanning and retained as a five-day artifact. Results are not
published to the public Scorecard API in this phase.

Untrusted pull requests receive only read-only `contents` permission in CI and
dependency review. CodeQL receives only `security-events: write` in addition to
read-only contents. No pull-request workflow receives a repository secret,
OIDC permission, package permission, release permission, Pages deployment
permission, or write access to source.

## Reproducibility

Node dependencies use `package-lock.json`, `npm ci --ignore-scripts`, exact
direct dependency versions, and a fixed Node version. Documentation pins its
direct tool version; a complete hashed Python transitive lock remains future
hardening because the current repository contains no Python application or
release artifact.

The container uses a versioned official Node tag and a locked npm dependency
graph. The tag is not yet digest-pinned. Issue #10 therefore does not claim
bit-for-bit reproducible images or verified base-image provenance.

Dependabot monitors npm, pip, GitHub Actions, and Docker inputs weekly. Action
updates must retain full-SHA pins after review. A repository test rejects tag-
only external actions, `pull_request_target`, missing explicit permissions, and
jobs without timeouts.

## Branch-protection operating model

The current `main` rule provides:

- require a pull request before merging;
- require at least one approving review and dismiss stale approvals;
- require conversation resolution;
- require `CI / validate`, `Dependency review / review`, and `CodeQL / analyze`;
- require branches to be current before merge;
- require linear history;
- block force pushes and branch deletion;
- enable automatic deletion of merged branches;

Administrator enforcement remains disabled only for the documented solo-owner
break-glass path above. When another independent maintainer can provide timely
review, prefer the normal protected merge path and reassess whether the
administrator exception is still needed.

Signed commits are not required until contributor key/recovery and bot behavior
have an accepted operational profile. Merge queue and multiple approvals can be
added when contribution volume justifies their availability cost.

## Release-integrity roadmap

No release integrity claim is made until issue #13 implements and verifies all
of the following:

1. build from an immutable reviewed commit on protected `main`;
2. use a protected release environment with required reviewers;
3. grant `contents`, `packages`, and `id-token` write permissions only to the
   release job that needs them;
4. generate SPDX and CycloneDX SBOMs from the final artifact graph;
5. create GitHub artifact attestations and SLSA provenance bound to artifact
   digests and workflow identity;
6. sign artifacts keylessly through an accepted Sigstore/OIDC profile, or
   document the selected equivalent and recovery model;
7. verify signatures, provenance, source commit, builder identity, dependency
   lock, and SBOM before publication;
8. protect tags and prohibit rebuilding an existing version;
9. retain verification evidence under RFC-0004 without credentials or OIDC
   assertions;
10. rehearse revocation, compromised workflow, failed publication, and yanked
    release procedures.

The roadmap names intended controls, not completed evidence. Badges, release
notes, and documentation must not say “SLSA”, “signed”, “reproducible”,
“tamper-proof”, or equivalent until verification artifacts support the claim.
