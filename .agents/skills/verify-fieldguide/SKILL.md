---
name: verify-fieldguide
description: "use this when verifying Fieldguide still matches its Feature Map"
---

# Verify Fieldguide

Use this skill to prove the checkout still matches [docs/FEATURE_MAP.md](../../../docs/FEATURE_MAP.md). Do not treat README marketing copy as a live npm publish or a live ModelHitch generation. Do not call npm publish, the GitHub API, or a live model lane unless the user explicitly asked.

Default path: **no secrets**. Expected exit: **0** on a clean checkout after `npm install`.

## Default command

```bash
npm run verify
```

This is:

```bash
npm run lint && npm run test && tsx scripts/verify-smoke.ts
```

Run the three stages separately only when isolating a failure. Do not skip `lint` or `test` and still claim the Feature Map is green.

| Step | Command | Expected exit | What it proves | Feature Map claims |
| --- | --- | --- | --- | --- |
| Lint | `npm run lint` (`tsc --noEmit`) | 0 | Typecheck of `src/` without emit. | Health / runtime: lint script; typecheck succeeds without secret env. |
| Tests | `npm run test` (`tsx --test test/*.test.ts`) | 0 | Infer + generate against an Express fixture; README skip without `--force`. | CLI generate; README marker; routes/env inference. |
| Smoke | `tsx scripts/verify-smoke.ts` | 0 | Writes all four artifacts for a temp CLI fixture and asserts headings, skill frontmatter, and the README marker. | CLI; Feature Map; verify skill; AGENT.md. |

If `node_modules` is missing: `npm install` (this repo expects a `package-lock.json` for CI `npm ci`). Then re-run `npm run verify`.

## Smoke coverage

`scripts/verify-smoke.ts` is deterministic. It must not hit the network. It creates a temp project, runs `generateDocs` with `llm: false`, then deletes the temp dir.

| Check | Proves | Map section |
| --- | --- | --- |
| `package.json` `bin.fieldguide` is `dist/cli.js` | CLI publish shape. | CLI |
| `src/cli.ts` shebang + Commander program name `fieldguide` | Entry exists. | CLI |
| Generate writes `README.md`, `docs/FEATURE_MAP.md`, `AGENT.md`, `.agents/skills/verify-<slug>/SKILL.md` | Default artifact set. | CLI |
| README contains `<!-- fieldguide:readme -->` | Overwrite marker. | README generation |
| Handmade README without marker is skipped unless `--force` | Non-destructive default. | README generation |
| Skill YAML `name: verify-<slug>` and relative Feature Map link | Skill contract. | Verify skill |
| Fixture Express routes `/api/health` and env `TIDE_API_KEY` appear in the map | Source inference. | Crawl / infer |
| Markdown mentioning `initializeApp` does not invent a Firebase integration | Product-source filtering. | Crawl / infer |
| Injected ModelHitch JSON writes reasoned README/map | Reason path without a live lane. | ModelHitch |
| `createHitchChat({ mock: true })` echoes without a key | Mock provider. | ModelHitch |
| Typecheck + tests succeed without secret env | Health. | Health / runtime |

## Out of default scope (env-gated)

These Feature Map rows stay **Unverified (env-gated)** or **Gap** after a green `npm run verify`. Do not “fix” the map by claiming them.

- Publishing `fieldguide` to npm.
- GitHub Actions actually running on `main` from this machine.
- A live ModelHitch lane (Ollama, LM Studio, gateway) during `npm run verify`.
- Executing a *target* project's tests, servers, or live vendor APIs.
- Overwriting a handmade README without `--force`.

Do not run UI e2e as part of this skill. Do not weaken docs to hide gaps (no model crawl, no target-app execution).

## Failure handling

1. Restate the failed command and exit code.
2. Map the failure to a Feature Map row (typecheck, fixture assertion, skipped write, missing artifact, smoke temp dir).
3. If product behavior drifted, update `docs/FEATURE_MAP.md` and this skill in the same change. Do not change app logic so verify passes.

## Cleanup

Smoke uses `fs.mkdtemp` and `fs.rm` in `finally`. If a run is interrupted, delete leftover `os.tmpdir()` folders named `fieldguide-smoke-*`.
