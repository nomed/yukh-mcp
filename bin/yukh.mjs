#!/usr/bin/env node

if (process.argv[2] !== "conversation" || process.argv[3] !== "watch") {
  process.stderr.write("usage: yukh conversation watch [--verbose]\n");
  process.exit(2);
}
process.argv.splice(2, 2);
await import("../dist/apps/conversation-watch/src/main.js");
