# SESSION-2026-08-06-01 — Protected apply material delivery proposal

- Governing issue: https://github.com/nomed/yukh-mcp/issues/82
- Migration issue: https://github.com/nomed/yukh-mcp/issues/27
- Status: review required

## Outcome

The owner accepted the fresh v1.7.0 shadow plan and authorized preparation of a
reviewable protected-activation implementation. Interface review found that
RFC-0008 and RFC-0009 define only provider-token delivery, while the immutable
apply Action also requires an approval envelope, independently selected trust
root, and host capsule. Repository rules prohibit implementing that unresolved
trust boundary without an accepted RFC.

RFC-0010 therefore proposes a fixed protected-environment delivery contract and
the matching threat-model delta. No workflow, secret, environment, provider,
Coordination, Project, deployment, or legacy state changed.

## Evidence

- accepted fresh plan:
  `db1e1afb742828404798cbea29f24613f14148c2eaaf132ffbe530b50dac7865`;
- producer: immutable yukh-projects v1.7.0 at
  `71784218366805922e5a12903eef9073f715f59f`;
- consumer main baseline:
  `c720de3bfbc783e21ac2f88c3e9853008e32ce20`;
- proposed contract: RFC-0010;
- implementation remains blocked on explicit RFC acceptance.

## Next gate

The owner reviews and accepts or rejects RFC-0010. Acceptance authorizes a
separate inert implementation PR with hermetic tests, not provisioning,
activation, provider access, or live apply.
