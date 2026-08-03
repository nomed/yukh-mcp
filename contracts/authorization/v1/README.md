# Authorization contract v1

This network-free reference package implements the deny-by-default contract in
[RFC-0002](../../../.context/rfcs/RFC-0002-deny-by-default-authorization.md).
It does not authenticate identities, contact a policy evaluator, invoke a
provider, expose an MCP listener, or hold credentials.

`authorization.mjs` exports pure builders and validators, a deterministic
deny-override combiner, sanitized evidence construction, and a process-local
one-shot enforcement reference. The JSON Schemas define request, evaluation,
decision, constraint, obligation, and evidence records.

Only `effect: allow` with `basis: explicit` can authorize. Invalid or mismatched
evaluation is error-deny, no applicable allow is default-deny, and an empty or
unenforceable intersection is indeterminate-deny. Multi-resource requests are
all-or-nothing.

The reference enforcer consumes a decision on its first attempt. It validates
the exact request and decision digests, subject and authentication context,
capability definition, resource set, environment, policy, attribute snapshot,
time bounds, constraint handlers, and decision-bound obligation receipts.
`approval_required` always remains pending here: issue #4 must define the
verifiable approval receipt before this package may accept one.

Run all contract checks with:

```sh
npm test
```

The package is reference logic, not a production security boundary. A durable
gateway must replace process-local consumption state, provide registered
constraint enforcers, re-evaluate every invocation, and emit the complete audit
envelope governed by issue #9.
