# Session — CI and software supply-chain baseline

- Date: 2026-08-03
- Governing issue: https://github.com/nomed/yukh-mcp/issues/10
- Branch: `agent/issue-10-supply-chain-baseline`
- Status: implementation complete locally; draft PR pending

## Outcome

Consolidated path-filtered validation into one always-on CI gate. Added locked
install, formatting, typecheck, tests, build, dependency audit, strict docs, and
container build; Dependency Review; CodeQL security-extended analysis; private
OpenSSF Scorecard results; expanded Dependabot coverage; and tests enforcing
full action SHA pins, explicit permissions, timeouts, and absence of
`pull_request_target`.

Documented current GitHub settings, the post-merge branch-protection checklist,
and an evidence-gated SBOM, signing, attestation, SLSA, tag, and release roadmap.
Added the corresponding threat-model review.

## External state

At session start, `main` had no protection/ruleset and Dependabot security
updates were disabled. Secret scanning and push protection were enabled.
Dependabot vulnerability alerts and security updates were enabled during this
session so Dependency Review can use the dependency graph. Branch protection
remains intentionally pending until the new checks exist on `main` after merge.

## Boundary

No artifact was published; no release, signing key, OIDC federation, package
permission, production credential, or release-integrity claim was introduced.
