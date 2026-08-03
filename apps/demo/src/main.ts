import { runReadOnlyDemo } from "./demo.js";

process.stdout.write(`${JSON.stringify(await runReadOnlyDemo(), null, 2)}\n`);
