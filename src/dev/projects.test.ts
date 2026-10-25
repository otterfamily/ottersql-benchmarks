import { ok } from "node:assert/strict";
import { test } from "node:test";

import { devLibraries } from "./projects.ts";
import { generate, typeCheck, writeProject } from "./typecheck.ts";

// The type-check benchmark is only fair if every project is correct, so each must check cleanly.
for (const library of devLibraries) {
  await test(`the ${library} project type-checks without errors`, async () => {
    const project = await writeProject(library, 2);
    try {
      await generate(project);
      const check = await typeCheck(project);
      ok(check.types > 0);
    } finally {
      await project.remove();
    }
  });
}
