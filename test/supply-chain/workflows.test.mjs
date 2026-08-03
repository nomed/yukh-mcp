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
    "yukh-projects-shadow.yml",
    "yukh-reconcile.yml",
  ]);
  assert.equal(basename(join(".github", "workflows")), "workflows");
});

test("Yukh Projects migration remains manual, immutable, and shadow-only", () => {
  const source = readFileSync(new URL("yukh-projects-shadow.yml", directory), "utf8");
  assert.match(
    source,
    /nomed\/yukh-projects@e086e89395808377845567325b3a0fa73ef6e926/u,
  );
  assert.match(source, /workflow_dispatch:/u);
  assert.equal(source.includes("issues:"), true);
  assert.equal(source.includes("types: [opened"), false);
  assert.equal(source.includes("apply-action"), false);
  assert.equal(source.includes("apply-enabled"), false);
  assert.equal(source.includes("github-write-token"), false);
  assert.equal(source.includes("mode:"), true);
  assert.match(source, /mode: read-only shadow/u);
  assert.match(source, /retention-days: 1/u);
});
