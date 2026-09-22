import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyze, generateDocs, parseKinds, renderDoc } from "../src/generate.js";

async function writeFixture(root: string): Promise<void> {
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: "harbor-desk",
        version: "2.0.0",
        description: "A tiny Express desk that lists tides.",
        license: "MIT",
        scripts: {
          lint: "tsc --noEmit",
          build: "esbuild server.ts --outfile=dist/server.js",
          test: "node --test",
          verify: "npm run lint && npm run test && npm run build",
        },
        dependencies: { express: "^4.21.0" },
        engines: { node: ">=18" },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(root, ".env.example"),
    "TIDE_API_KEY=\nPORT=3000\n",
  );
  await writeFile(
    join(root, "server.ts"),
    `
import express from "express";
const app = express();
const port = process.env.PORT ?? 3000;
const key = process.env.TIDE_API_KEY;
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.post("/api/tides", (_req, res) => res.json({ tides: [] }));
app.listen(port);
`,
  );
  await writeFile(
    join(root, "README.md"),
    "# Harbor Desk\n\nMentions initializeApp and signInWithPopup without shipping Firebase.\n",
  );
  await mkdir(join(root, ".git"), { recursive: true });
  await writeFile(
    join(root, ".git", "config"),
    `[remote "origin"]\n\turl = git@github.com:example/harbor-desk.git\n`,
  );
}

describe("parseKinds", () => {
  it("defaults to all kinds", () => {
    assert.deepEqual(parseKinds(undefined), ["readme", "map", "agent", "skill"]);
  });

  it("rejects unknown kinds", () => {
    assert.throws(() => parseKinds("readme,nope"));
  });
});

describe("infer + generate", () => {
  it("crawls a sample Express app and writes the four docs", async () => {
    const root = await mkdtemp(join(tmpdir(), "fieldguide-"));
    try {
      await writeFixture(root);
      const model = await analyze(root);
      assert.equal(model.displayName, "Harbor Desk");
      assert.equal(model.slug, "harbor-desk");
      assert.ok(model.routes.some((route) => route.path === "/api/health"));
      assert.ok(model.envHits.some((hit) => hit.key === "TIDE_API_KEY" && hit.inExample));
      assert.ok(model.stack.some((layer) => layer.id === "express"));
      assert.equal(model.github, "example/harbor-desk");
      assert.ok(model.defaultVerify.command?.includes("verify"));
      assert.equal(model.integrations.some((item) => item.id === "firebase"), false);

      const map = renderDoc("map", model);
      assert.match(map, /Feature Map — Harbor Desk/);
      assert.match(map, /Proven \(verify\)/);
      assert.match(map, /\/api\/health/);

      const skill = renderDoc("skill", model);
      assert.match(skill, /name: verify-harbor-desk/);
      assert.match(skill, /npm run verify/);

      const { results } = await generateDocs({
        root,
        dryRun: false,
        force: true,
        kinds: ["readme", "map", "agent", "skill"],
        llm: false,
      });
      assert.equal(results.every((item) => item.status === "wrote"), true);
      const readme = await readFile(join(root, "README.md"), "utf8");
      assert.match(readme, /fieldguide:readme/);
      const agent = await readFile(join(root, "AGENT.md"), "utf8");
      assert.match(agent, /docs\/FEATURE_MAP.md/);
      const skillFile = await readFile(
        join(root, ".agents/skills/verify-harbor-desk/SKILL.md"),
        "utf8",
      );
      assert.match(skillFile, /Default path: \*\*no secrets\*\*/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips a custom README without --force", async () => {
    const root = await mkdtemp(join(tmpdir(), "fieldguide-"));
    try {
      await writeFixture(root);
      await writeFile(join(root, "README.md"), "# Handmade\n");
      const { results } = await generateDocs({
        root,
        dryRun: false,
        force: false,
        kinds: ["readme"],
        llm: false,
      });
      assert.equal(results[0]?.status, "skipped");
      const readme = await readFile(join(root, "README.md"), "utf8");
      assert.equal(readme, "# Handmade\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
