#!/usr/bin/env node

if (process.argv[2] === "conversation" && process.argv[3] === "watch") {
  process.argv.splice(2, 2);
  await import("../dist/apps/conversation-watch/src/main.js");
} else if (process.argv[2] === "team" && process.argv[3] === "serve") {
  process.argv.splice(2, 2);
  await import("../dist/apps/team-control/src/main.js");
} else {
  process.stderr.write(
    "usage: yukh conversation watch [--full] [--verbose]\n       yukh team serve\n",
  );
  process.exitCode = 2;
}
