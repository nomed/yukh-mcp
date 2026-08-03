import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

const directory = new URL("../../.github/workflows/", import.meta.url);
const workflows = readdirSync(directory).filter((name) => name.endsWith(".yml")).sort();

for (const filename of workflows) {
  const source = readFileSync(new URL(filename, directory), "utf8");

  test(`${filename} pins every external action to a commit`, () => {
    const actionLines = source.split("\n").filter((line) => /^\s*uses:\s*/.test(line));
    assert(actionLines.length > 0, `${filename} has no inspectable action references`);
    for (const line of actionLines) {
      const reference = line.replace(/^\s*uses:\s*/, "").split(/\s+#/, 1)[0]?.trim();
      assert.match(reference ?? "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\/-]+@[a-f0-9]{40}$/, line);
    }
  });

  test(`${filename} avoids privileged pull-request execution`, () => {
    assert.equal(source.includes("pull_request_target:"), false);
  });

  test(`${filename} declares explicit permissions and a timeout`, () => {
    assert.match(source, /^permissions:\n/m);
    assert.match(source, /^\s+timeout-minutes:\s+[0-9]+$/m);
  });
}

test("workflow inventory is explicit", () => {
  assert.deepEqual(workflows, [
    "ci.yml",
    "codeql.yml",
    "dependency-review.yml",
    "pages.yml",
    "scorecard.yml",
    "yukh-bootstrap.yml",
    "yukh-reconcile.yml",
  ]);
  assert.equal(basename(join(".github", "workflows")), "workflows");
});
