import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("documentation exposes the four reader intents", async () => {
  const navigation = await read("mkdocs.yml");

  for (const section of ["Tutorial", "How-to", "Reference", "Explanation"]) {
    assert.match(navigation, new RegExp(`^  - ${section}:`, "m"));
  }
});

test("documentation uses the black header and canonical component mark", async () => {
  const config = await read("mkdocs.yml");

  assert.equal((config.match(/primary: black/g) ?? []).length, 2);
  assert.match(config, /logo: assets\/repository-mark\.svg/);
});

test("documentation uses SVG and contains no Mermaid source", async () => {
  const [navigation, architecture] = await Promise.all([
    read("mkdocs.yml"),
    read("docs/architecture/overview.md"),
  ]);

  assert.doesNotMatch(`${navigation}\n${architecture}`, /mermaid/i);
  assert.match(architecture, /assets\/architecture-boundaries\.svg/);
});

test("the landing page starts with the runnable synthetic demo", async () => {
  const home = await read("docs/index.md");

  assert.match(home, /npm ci --ignore-scripts/);
  assert.match(home, /npm run demo/);
  assert.match(home, /not production-ready/i);
  assert.match(home, /ordinary gateway is inert/i);
});

test("Proposed RFC-0011 conforms to the Accepted Projects Effect B", async () => {
  const [rfc, contracts, threatModel, session] = await Promise.all([
    read(".context/rfcs/RFC-0011-sandbox-github-projects-capability.md"),
    read("docs/reference/contracts.md"),
    read("docs/security/threat-model.md"),
    read(".context/sessions/SESSION-2026-08-09-01-effect-b-capability-rfc.md"),
  ]);
  const surface = `${rfc}\n${contracts}\n${threatModel}\n${session}`;

  assert.match(rfc, /- Status: Proposed/);
  assert.match(rfc, /projects\.add-dependency\.v1/);
  assert.match(rfc, /add_dependency\(201 blocks 202\)/);
  assert.match(rfc, /yukh-projects-approval-bridge-v2/);
  assert.match(rfc, /runMcpEffectBControlledApplyV1/);
  assert.match(rfc, /521be0d0ef1297579e84a6322dea29f80c2549dc/);
  assert.match(rfc, /mode: unavailable/);
  assert.match(rfc, /properties: \{\}/);
  assert.doesNotMatch(surface, /github\.projects\.item\.status/);
  assert.doesNotMatch(surface, /mcp_pending|mcp_verified/);
  assert.doesNotMatch(surface, /set_field_value\(status\).*Effect B/);
  assert.match(surface, /no implementation|implementation authority/i);
  assert.match(surface, /artifact.*unpublished|unpublished.*artifact/i);
});
