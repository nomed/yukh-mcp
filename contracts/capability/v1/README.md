# Capability contract v1

This directory is the network-free reference implementation of accepted
[RFC-0001](../../../.context/rfcs/RFC-0001-versioned-capability-contract.md).
It does not expose an MCP listener, invoke a provider, hold credentials, or
authorize an operation.

## Contents

- `schemas/`: JSON Schema 2020-12 records for definitions, requests, plans,
  results, errors, and shared types;
- `examples/`: entirely synthetic valid records;
- `fixtures/`: synthetic negative conformance cases;
- `validator.mjs`: deterministic structural and semantic validation.

## Validation API

`validateRecord(kind, value)` validates one public record. Supported kinds are
`definition`, `request`, `plan`, `result`, and `error`.

`validateRequestAgainstDefinition(request, definition)` additionally binds an
exact capability version, resource kind, idempotency requirement, and input
schema.

`validateOutputAgainstDefinition(output, definition)` prevents invalid provider
output from crossing the public boundary.

`validateResultAgainstDefinition(result, definition)` binds result identity,
attempt bounds, output, and mutation-verification requirements.

All functions return:

```json
{
  "valid": false,
  "diagnostics": [
    {
      "code": "schema_required",
      "path": "/input/include",
      "message": "required field is missing"
    }
  ]
}
```

Diagnostics are sorted by JSON Pointer path and stable code, capped at 64, and
contain no input values, provider bodies, credentials, or stack traces.

## Run tests

```text
npm ci --ignore-scripts
npm test
```

The schema profile rejects open objects, unbounded strings and arrays, unbounded
numbers, remote or cyclic references, unsupported keywords, credential or
execution-shaped fields, and unsafe regular-expression constructs. Schema
checks remain defense in depth: provider qualification and human security review
are still mandatory.

## Boundary

This implementation is experimental and unreleased. Plan canonicalization and
the full approval/apply lifecycle remain governed by #4; authorization remains
governed by #3; audit envelopes and retention remain governed by #9. Do not use
these schemas to claim that an operation is authorized or production-ready.
