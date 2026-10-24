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

Default verify path: `npm run lint` → `npm run test` → `tsx scripts/verify-smoke.ts` (also wired as `npm run verify`). No API keys required. Default verify does **not** call a live ModelHitch lane or a live bridge (`llm: false` / injected mock / injected fetch).

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
| Commander program name is `fieldguide`. Arguments: optional `[dir]` (default `.`). Flags: `--dry-run`, `--force`, `--only <kinds>`, `--json`, `--no-llm`, `--provider`, `--model`, `--bridge <url>`, `--direct`. | Code-inspected; flag parse for `--only` **proven (verify)** via `parseKinds` | `src/cli.ts`, `src/generate.ts` `parseKinds`. Full argv parse of Commander is not spawned in default tests. |
| `--only` accepts `readme,map,agent,skill` and rejects unknown tokens. | Proven (verify) | `test/generate.test.ts`. |
| `--json` prints the inferred `ProjectModel` to stdout and does not write files or call ModelHitch. | Code-inspected | `src/cli.ts`. |
| `--dry-run` prints artifact bodies to stdout and writes nothing. | Code-inspected | `src/generate.ts` status `dry-run`. |
| `--no-llm` writes inventory templates without ModelHitch. Default CLI path calls ModelHitch. | Proven (verify) for `llm: false`; live hitch **unverified (env-gated)** | Tests pass `llm: false`. Stubbed hitch path in `test/reason.test.ts`. |
| `--bridge <url>` forces a bridge and fails loudly when it is unreachable; `--direct` skips bridge auto-detection; `--provider` / `--model` select one direct lane unless `--bridge` is also set. | Proven (verify) for the `createHitchChat` behavior; argv wiring **code-inspected** | `src/hitch.ts`, `src/cli.ts`; `test/hitch.test.ts`. |
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

---

## ModelHitch integration

Fieldguide targets **modelhitch ^2.10.0**.

| Claim | Grade | Evidence |
| --- | --- | --- |
| A reachable ModelHitch bridge is preferred; requests go to `modelhitch/auto`, so the bridge owns rotation, intents, failover, and usage. | Proven (verify) with injected fetch; live bridge **unverified (env-gated)** | `src/hitch.ts` `createBridgeChat`, `test/hitch.test.ts`. |
| Bridge URL precedence: `--bridge <url>` > `MODELHITCH_BRIDGE_URL` > `http://127.0.0.1:$MODELHITCH_PORT` (default `http://127.0.0.1:3939`). `/healthz` decides reachability. | Proven (verify) | `defaultBridgeUrl` / `normalizeBridgeUrl` tests in `test/hitch.test.ts`. |
| `--direct` (or an unreachable auto-detected bridge) uses the library. Explicit `--provider` / `--model` pins one direct lane unless `--bridge` forces the same route through a bridge. | Proven (verify) | `test/hitch.test.ts`. |
| On the direct path, the config `policy` / `intents` plan is used when the built-in provider registry can serve it; otherwise Fieldguide falls back to the base lane and reports a routing note. | Proven (verify) for a valid mock-lane plan; advanced custom-lane configs **code-inspected** | `src/hitch.ts` `createDirectChat`, `test/hitch.test.ts`. |
| A forced bridge that is unreachable fails loudly with the URL and a `--direct` hint. | Proven (verify) | `test/hitch.test.ts`. |
| Direct fallback lane is `~/.modelhitch/config.json` (`MODELHITCH_HOME`) else **ollama**. | Code-inspected | `src/hitch.ts`. A running Ollama/LM Studio/bridge is not part of default verify. |
| Live bridge calls are shown in the CLI (`bridge <url> · <model>`); no bridge is started by Fieldguide. | Code-inspected | `src/cli.ts`, `src/hitch.ts`. |

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
| Writes reasoned `README.md` / map / agent / skill from ModelHitch marker or JSON replies. | Proven (verify) | `test/reason.test.ts` injects marker and JSON `complete` fixtures. |
| Combined hitch replies may be markers or JSON; if that fails, Fieldguide asks for one Markdown file at a time and fills gaps with inventory templates. A bad JSON blob does **not** abort the run. | Proven (verify) | `test/reason.test.ts` unusable-JSON fixture still writes files. |
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
| `dependencies.modelhitch` is `^2.10.0` (the current bridge/intent/policy release line). | Proven (verify) | Smoke reads `package.json`. |
| Typecheck and tests succeed without secret env. | Proven (verify) | Default verify. |
| CI workflow `.github/workflows/ci.yml` runs `npm ci` then `npm run verify` on GitHub-hosted Ubuntu. | Code-inspected; live Actions **unverified (env-gated)** | Workflow file. A green badge is not proven from this checkout alone. |
| Package manager is npm (`package-lock.json` after install). | Code-inspected | Expected for CI. |
| `prepublishOnly` builds before npm publish. | Code-inspected | `package.json`. A real publish is **unverified**. |

---

## Explicitly out of scope / not shipped

Do **not** treat README copy as implemented unless a row above says so:

- LLM / agent “understanding” without ModelHitch — **not the default path**; `--no-llm` is inventory templates only.
- A live Ollama / LM Studio / hosted ModelHitch lane or a live bridge during `npm run verify` — **not called**.
- Starting, stopping, or configuring a ModelHitch bridge — **not present**; Fieldguide only probes `/healthz` and talks to one that is already running.
- Executing the target project's servers, tests, or vendor APIs — **not present**.
- npm publish of `@genoventures-labs/fieldguide` — **unverified**.
- Live GitHub Actions on `bobbybacklogs/Fieldguide` — **code exists**; **unverified (env-gated)**.
- Overwriting handmade READMEs by default — **not shipped** (skip unless `--force` / marker).
- Python/Go/Rust deep feature maps beyond manifest + extension hints — **shallow / code-inspected**.
- Watching the filesystem or a daemon mode — **not present**.

Do not invent: a model-backed architecture review, a proven npm release, or a guarantee that generated docs match runtime behavior of the target app.
