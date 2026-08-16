#!/usr/bin/env node

if (process.argv[2] === "conversation" && process.argv[3] === "watch") {
  process.argv.splice(2, 2);
  await import("../dist/apps/conversation-watch/src/main.js");
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
} else {
  process.stderr.write(
    "usage: yukh conversation watch [--full] [--verbose]\n       yukh team serve\n       yukh team propose [--preset suite-qualification] [--role backend-reviewer] [--work-profile implementation]\n       yukh team preflight-engage [--preset suite-qualification] [--role backend-reviewer] [--work-profile implementation] [--format json|text] [--output preflight.json]\n       yukh team run-approved --preflight file --approved-digest sha-256:... [--format json|text]\n",
  );
  process.exitCode = 2;
}
