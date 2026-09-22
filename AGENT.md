# AGENT.md — Fieldguide

Instructions for coding agents working in this repository.

## Product

**Fieldguide** (`@genoventures-labs/fieldguide`, bin `fieldguide`) is a Node/TypeScript CLI. It crawls a directory, infers a project model, reasons over that inventory with **ModelHitch**, and writes current-state documentation: `README.md`, `docs/FEATURE_MAP.md`, `AGENT.md`, and `.agents/skills/verify-<slug>/SKILL.md`.

This file is **current-state**. Do not claim Fieldguide executes the target app. Do not claim default verify calls a live model. Do not claim handmade READMEs are overwritten without `--force`.

## Docs of record

1. [docs/FEATURE_MAP.md](docs/FEATURE_MAP.md) — claims, evidence grades, gaps.
2. [.agents/skills/verify-fieldguide/SKILL.md](.agents/skills/verify-fieldguide/SKILL.md) — how to prove this checkout still matches the map.
3. This file — navigation and constraints.

When product behavior drifts, update the Feature Map and the verify skill **in the same change**. Do not change app logic solely so verify passes. Do not weaken docs to hide gaps.

## Default verify

`npm run verify`

This is `npm run lint && npm run test && tsx scripts/verify-smoke.ts`.

- Default path: **no secrets**. Expected exit: **0** after `npm install`.
- Do not publish, hit npm registry, or call GitHub APIs as part of verify.

## Layout

- `src/cli.ts` — Commander entry (`bin`: `fieldguide`).
- `src/crawl.ts` — gitignore-aware walk + capped source reads.
- `src/infer.ts` — stack, routes, env, integrations, verify plan, feature sections.
- `src/hitch.ts` — ModelHitch client (config, local providers, mock). Does not force JSON mode; local models often ignore it.
- `src/reason.ts` — markdown inventory (not JSON), combined markers, then one file per hitch call; templates fill gaps.
- `src/report.ts` — boxed CLI tables.
- `src/generate.ts` — render + write orchestration.
- `src/docs-readme-agent.ts` / `src/docs-map-skill.ts` — inventory templates (`--no-llm`).
- `src/index.ts` — programmatic API (`analyze`, `generateDocs`).
- `test/generate.test.ts` / `test/reason.test.ts` — fixtures, skip README, stubbed hitch.
- `scripts/verify-smoke.ts` — temp-dir generate with `llm: false`.

## Stack

TypeScript, Node 18+, Commander, `ignore`, picocolors, **modelhitch**. Build is `tsc` → `dist/`. Tests run with `tsx --test`.

## Environment

Default verify does **not** call ModelHitch and does not need keys. Live `fieldguide` reads `~/.modelhitch/config.json` (or `MODELHITCH_HOME`) and optional `FIELDGUIDE_PROVIDER` / `FIELDGUIDE_MODEL`. Local providers (`ollama`, `lmstudio`, …) need no API key. Hosted providers use ModelHitch BYOK.

## Commands

| Script | Command |
| --- | --- |
| `lint` | `tsc --noEmit` |
| `test` | `tsx --test test/*.test.ts` |
| `build` | `tsc` |
| `verify` | `npm run lint && npm run test && tsx scripts/verify-smoke.ts` |
| `prepublishOnly` | `npm run build` |

## Do not claim

- That Fieldguide executes the target application or its tests.
- That default `npm run verify` calls a live ModelHitch lane.
- That a handmade README is overwritten without `--force` or a `<!-- fieldguide:readme -->` marker.
- That live vendor integrations in a *target* repo are proven by generating docs.
- That `--no-llm` output is a reasoned architecture review. It is inventory templates.

## Extending the project

- Keep the default verify path free of secrets and network.
- New user-facing CLI flags need a Feature Map row and a test or smoke assertion.
- Generators must stay honest: Gap and Unverified (env-gated) are features, not failures.
