import assert from "node:assert/strict";
import test from "node:test";
import { createLogger } from "../../packages/logging/src/logger.js";

test("logger emits only its closed redacted record", () => {
  const lines: string[] = [];
  const logger = createLogger({ sink: (line) => lines.push(line), now: () => new Date("2026-08-03T00:00:00Z") });
  logger.write("warn", "request_rejected", { correlation_ref: "request_example001", status: 403, code: "origin_rejected" });
  assert.deepEqual(JSON.parse(lines[0] ?? "null"), {
    timestamp: "2026-08-03T00:00:00.000Z", level: "warn", event: "request_rejected",
    correlation_ref: "request_example001", status: 403, code: "origin_rejected",
  });
});
