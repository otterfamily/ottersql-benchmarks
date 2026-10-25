import { ok } from "node:assert/strict";
import { access, constants } from "node:fs/promises";
import { test } from "node:test";

import { measured } from "./process.ts";

const timeAvailable = await access("/usr/bin/time", constants.X_OK).then(
  () => true,
  () => false,
);

await test(
  "reads the peak memory /usr/bin/time reports for a command",
  { skip: !timeAvailable && "this system has no /usr/bin/time" },
  async () => {
    const ran = await measured("node", ["--eval", "0"], import.meta.dirname);
    ok(ran.exitCode === 0 && ran.peakBytes !== null && ran.peakBytes > 0);
  },
);
