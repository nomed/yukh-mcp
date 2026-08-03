import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { runReadOnlyDemo } from "../../apps/demo/src/demo.js";

test("five-minute demo discovers one read tool and proves allow plus deny", async () => {
  const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith("yukh-demo-")));
  const transcript = await runReadOnlyDemo();
  assert.deepEqual(transcript.discovery.tools, ["node.inspect"]);
  assert.equal((transcript.allowed as { isError?: boolean }).isError, false);
  assert.equal((transcript.denied as { isError?: boolean }).isError, true);
  assert.deepEqual(
    transcript.evidence_projection.map(({ effect }) => effect),
    ["allow", "deny"],
  );
  assert.ok(
    transcript.evidence_projection.every(
      ({ durability, classification }) =>
        durability === "in_memory_demo_only" && classification === "protected",
    ),
  );
  assert.equal(JSON.stringify(transcript).includes("synthetic healthy fixture"), false);
  const after = (await readdir(tmpdir())).filter((name) => name.startsWith("yukh-demo-"));
  assert.deepEqual(
    after.filter((name) => !before.has(name)),
    [],
  );
});
