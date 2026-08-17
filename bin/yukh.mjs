#!/usr/bin/env node

if (process.argv[2] === "conversation" && process.argv[3] === "watch") {
  process.argv.splice(2, 2);
  await import("../dist/apps/conversation-watch/src/main.js");
} else if (process.argv[2] === "suite" && process.argv[3] === "baseline") {
  process.argv.splice(2, 2);
  await import("../dist/apps/suite-baseline/src/main.js");
} else if (process.argv[2] === "team" && process.argv[3] === "serve") {
  process.argv.splice(2, 2);
  await import("../dist/apps/team-control/src/main.js");
} else if (process.argv[2] === "team" && process.argv[3] === "preflight-engage") {
  process.argv.splice(2, 2);
  await import("../dist/apps/team-preflight/src/main.js");
} else if (process.argv[2] === "team" && process.argv[3] === "propose") {
  process.argv.splice(2, 2);
  await import("../dist/apps/team-preflight/src/propose-main.js");
} else if (process.argv[2] === "team" && process.argv[3] === "run-approved") {
  process.argv.splice(2, 2);
  await import("../dist/apps/team-preflight/src/run-approved-main.js");
} else if (process.argv[2] === "team" && process.argv[3] === "run-plan-approved") {
  process.argv.splice(2, 2);
  await import("../dist/apps/team-preflight/src/plan-execute-main.js");
} else if (process.argv[2] === "team" && process.argv[3] === "status") {
  process.argv.splice(2, 2);
  await import("../dist/apps/team-preflight/src/status-main.js");
} else if (process.argv[2] === "team" && process.argv[3] === "stop") {
  process.argv.splice(2, 2);
  await import("../dist/apps/team-preflight/src/stop-main.js");
} else {
  process.stderr.write(
    "usage: yukh conversation watch [--full] [--verbose]\n       yukh suite baseline [--workspace path] [--format json|text]\n       yukh team serve\n       yukh team propose [--preset suite-qualification|suite-readonly-verifier|micro-doc-edit|micro-code-edit] [--role backend-reviewer] [--work-profile implementation] [--worker-budget N] [--worker-max-commands N] [--worker-timeout-ms N]\n       yukh team preflight-engage [--preset suite-qualification|suite-readonly-verifier|micro-doc-edit|micro-code-edit] [--role backend-reviewer] [--work-profile implementation] [--worker-budget N] [--worker-max-commands N] [--worker-timeout-ms N] [--format json|text] [--output preflight.json]\n       yukh team run-approved --preflight file --approved-digest sha-256:... [--allow-micro-launch true] [--format json|text]\n" +
      "       yukh team run-plan-approved --team team-... --plan plan-... --approved-digest sha-256:... [--format json|text]\n" +
      "       yukh team status --team team-... [--workspace path] [--format json|text]\n       yukh team stop --team team-... [--workspace path] [--format json|text]\n",
  );
  process.exitCode = 2;
}
