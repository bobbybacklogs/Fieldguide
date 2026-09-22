# Feature Map — Fieldguide

Package name: **@genoventures-labs/fieldguide**. Repo / folder: **Fieldguide**.

This map records what the product **actually does** today, what the default verify path **proves**, and what remains **env-gated or unfinished**. It is not a roadmap.

**Evidence grades**

| Grade | Meaning |
| --- | --- |
| **Proven (verify)** | Asserted by `npm run verify` on a clean checkout with no secret env. |
| **Code-inspected** | Present in source as of this map. Not exercised by the default verify path. |
| **Unverified (env-gated)** | Requires credentials, npm publish, or a live GitHub/npm network call. Do not treat as proven. |
| **Gap** | Source or copy hints at the work, but the behavior is missing or incomplete. Copy is **not** proof of shipped behavior. |

Default verify path: `npm run lint` → `npm run test` → `tsx scripts/verify-smoke.ts` (also wired as `npm run verify`). No API keys required. Default verify does **not** call a live ModelHitch lane (`llm: false` / injected mock).

---

## Naming (as shipped)

| Surface | String |
| --- | --- |
| npm package | @genoventures-labs/fieldguide |
| CLI bin | fieldguide |
| Folder | Fieldguide |
| README title | Fieldguide |

The map uses **Fieldguide** as the product name, **fieldguide** as the CLI bin, and **@genoventures-labs/fieldguide** as the npm package.

---

## CLI

| Claim | Grade | Evidence |
| --- | --- | --- |
| `package.json` `bin.fieldguide` points at `dist/cli.js`. | Proven (verify) | `package.json`; smoke/typecheck of the publish shape. Tests import the TypeScript entry, not the published bin. |
| Commander program name is `fieldguide`. Arguments: optional `[dir]` (default `.`). Flags: `--dry-run`, `--force`, `--only <kinds>`, `--json`, `--no-llm`, `--provider`, `--model`. | Code-inspected; flag parse for `--only` **proven (verify)** via `parseKinds` | `src/cli.ts`, `src/generate.ts` `parseKinds`. Full argv parse of Commander is not spawned in default tests. |
| `--only` accepts `readme,map,agent,skill` and rejects unknown tokens. | Proven (verify) | `test/generate.test.ts`. |
| `--json` prints the inferred `ProjectModel` to stdout and does not write files or call ModelHitch. | Code-inspected | `src/cli.ts`. |
| `--dry-run` prints artifact bodies to stdout and writes nothing. | Code-inspected | `src/generate.ts` status `dry-run`. |
| `--no-llm` writes inventory templates without ModelHitch. Default CLI path calls ModelHitch. | Proven (verify) for `llm: false`; live hitch **unverified (env-gated)** | Tests pass `llm: false`. Stubbed hitch path in `test/reason.test.ts`. |
| Programmatic API: `analyze`, `generateDocs`, `renderDoc` from `src/index.ts`. | Proven (verify) | Tests and smoke call `generateDocs` / `analyze` / `renderDoc`. |

**Must still do / do not claim**

- That `npx @genoventures-labs/fieldguide` was executed against this repo as part of default verify (tests call the library API).
- That the compiled `dist/cli.js` bin was spawned.

---

## Crawl / infer

| Claim | Grade | Evidence |
| --- | --- | --- |
| Crawl is gitignore-aware, skips `node_modules` / `dist` / VCS and lockfile bodies, caps tree size and source reads. | Code-inspected | `src/crawl.ts` `DEFAULT_IGNORES`, `MAX_FILES`, `MAX_SOURCE_READS`. |
| Infers display name from `metadata.json` `name`, else title-cased `package.json` name, else folder. | Proven (verify) | Fixture `harbor-desk` → **Harbor Desk**. |
| Detects Express-style `app.get/post(...)` routes and `process.env` keys; marks `.env.example` membership. | Proven (verify) | Fixture `/api/health`, `/api/tides`, `TIDE_API_KEY` in example. |
| Route / env / integration needles ignore tests, scripts, and markdown so fixture strings and docs copy are not treated as product surface. | Proven (verify) | Fixture README mentions `initializeApp` / `signInWithPopup` and does not create a Firebase integration. |
| Detects GitHub slug from `.git/config`. | Proven (verify) | Fixture `example/harbor-desk`. |
| Composes a default verify plan from `scripts.verify` or lint/test/build. | Proven (verify) | Fixture `npm run verify`. |
| Integrates known packages (Firebase, Stripe, Gemini, …) as code-inspected or env-gated. | Code-inspected | `INTEGRATIONS` in `src/infer.ts`. Express fixture does not cover Gemini. |
| Crawl/infer is deterministic inventory. Reasoning is a ModelHitch `chat()` pass over that inventory plus source excerpts. | Proven (verify) for prompt/parse + injected hitch; live lane **unverified (env-gated)** | `src/reason.ts`, `src/hitch.ts`, `test/reason.test.ts`. Default verify uses `llm: false` or a stub `complete`. |
| `createHitchChat({ mock: true })` uses ModelHitch `mock`/`mock-model` with no key. | Proven (verify) | Echoes the last user message. Mock cannot author the four docs; tests inject JSON. |
| Live default lane is `~/.modelhitch/config.json` (`MODELHITCH_HOME`) else **ollama**. | Code-inspected | `src/hitch.ts`. A running Ollama/LM Studio/bridge is not part of default verify. |

---

## README generation

| Claim | Grade | Evidence |
| --- | --- | --- |
| Generated README includes `<!-- fieldguide:readme -->`, title, badges, quick start, inferred features, scripts, layout, license. | Proven (verify) | Smoke + generate test read the written file. |
| Existing README **without** the marker is skipped unless `--force`. | Proven (verify) | `test/generate.test.ts`. |
| Existing README **with** the marker is overwritten. | Code-inspected | `readmeShouldWrite` in `src/docs-readme-agent.ts`. |
| This repository's own README is handmade product copy and **does not** include the marker. | Code-inspected | `README.md`. Generating against this repo without `--force` will skip README. |

---

## Feature Map / AGENT.md / verify skill generation

| Claim | Grade | Evidence |
| --- | --- | --- |
| Writes reasoned `README.md` / map / agent / skill from ModelHitch JSON (`readme`, `map`, `agent`, `skill` + `reasoning`). | Proven (verify) | `test/reason.test.ts` injects a hitch `complete` that returns fixture JSON. |
| `parseReasonedDocs` requires Feature Map heading and `name: verify-` skill YAML; stamps README marker. | Proven (verify) | `test/reason.test.ts`. |
| `--no-llm` / `llm: false` still writes the four artifacts from inventory templates. | Proven (verify) | generate tests + smoke. |
| Skill links the Feature Map as `../../../docs/FEATURE_MAP.md`. | Proven (verify) | Smoke. |
| Regenerates map / agent / skill on every write run (no handmade-skip). | Code-inspected | `generateDocs` only special-cases README. |

---

## Health / runtime

| Claim | Grade | Evidence |
| --- | --- | --- |
| `npm run lint` is `tsc --noEmit`. | Proven (verify) | `package.json`; lint runs in `npm run verify`. |
| `npm run test` is `tsx --test test/*.test.ts`. | Proven (verify) | Default verify. |
| `npm run build` is `tsc` → `dist/`. | Code-inspected | `package.json`. Build is `prepublishOnly`, not the default verify path. |
| `npm run verify` is lint + test + `tsx scripts/verify-smoke.ts`. | Proven (verify) | `package.json`; this skill. |
| Typecheck and tests succeed without secret env. | Proven (verify) | Default verify. |
| CI workflow `.github/workflows/ci.yml` runs `npm ci` then `npm run verify` on GitHub-hosted Ubuntu. | Code-inspected; live Actions **unverified (env-gated)** | Workflow file. A green badge is not proven from this checkout alone. |
| Package manager is npm (`package-lock.json` after install). | Code-inspected | Expected for CI. |
| `prepublishOnly` builds before npm publish. | Code-inspected | `package.json`. A real publish is **unverified**. |

---

## Explicitly out of scope / not shipped

Do **not** treat README copy as implemented unless a row above says so:

- LLM / agent “understanding” without ModelHitch — **not the default path**; `--no-llm` is inventory templates only.
- A live Ollama / LM Studio / hosted ModelHitch lane during `npm run verify` — **not called**.
- Executing the target project's servers, tests, or vendor APIs — **not present**.
- npm publish of `@genoventures-labs/fieldguide` — **unverified**.
- Live GitHub Actions on `bobbybacklogs/Fieldguide` — **code exists**; **unverified (env-gated)**.
- Overwriting handmade READMEs by default — **not shipped** (skip unless `--force` / marker).
- Python/Go/Rust deep feature maps beyond manifest + extension hints — **shallow / code-inspected**.
- Watching the filesystem or a daemon mode — **not present**.

Do not invent: a model-backed architecture review, a proven npm release, or a guarantee that generated docs match runtime behavior of the target app.
