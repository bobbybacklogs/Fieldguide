import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { generateDocs } from "../src/generate.js";

const root = await mkdtemp(join(tmpdir(), "fieldguide-smoke-"));

try {
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "smoke-app",
      version: "0.0.1",
      description: "Smoke fixture for Fieldguide.",
      scripts: { lint: "tsc --noEmit", build: "tsc" },
      bin: { "smoke-app": "dist/cli.js" },
    }),
  );
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/cli.ts"), `console.log(process.env.SMOKE_TOKEN ?? "ok");\n`);
  await writeFile(join(root, ".env.example"), "SMOKE_TOKEN=\n");

  const { model, results } = await generateDocs({
    root,
    dryRun: false,
    force: true,
    kinds: ["readme", "map", "agent", "skill"],
    llm: false,
  });

  assert.equal(results.length, 4);
  assert.ok(results.every((item) => item.status === "wrote"));
  assert.equal(model.slug, "smoke-app");

  const map = await readFile(join(root, "docs/FEATURE_MAP.md"), "utf8");
  assert.match(map, /Feature Map — Smoke App/);
  assert.match(map, /SMOKE_TOKEN/);

  const skill = await readFile(join(root, ".agents/skills/verify-smoke-app/SKILL.md"), "utf8");
  assert.match(skill, /name: verify-smoke-app/);
  assert.match(skill, /docs\/FEATURE_MAP.md/);

  const agent = await readFile(join(root, "AGENT.md"), "utf8");
  assert.match(agent, /Do not claim/);

  const readme = await readFile(join(root, "README.md"), "utf8");
  assert.match(readme, /<!-- fieldguide:readme -->/);
  assert.match(readme, /smoke-app/);

  process.stdout.write("verify-smoke: ok\n");
} finally {
  await rm(root, { recursive: true, force: true });
}
