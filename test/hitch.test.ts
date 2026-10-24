import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bridgeModelRoute,
  createHitchChat,
  defaultBridgeUrl,
  hitchConfigPath,
  normalizeBridgeUrl,
} from "../src/hitch.js";

let home = "";

before(async () => {
  home = await mkdtemp(join(tmpdir(), "fieldguide-hitch-"));
  await writeFile(
    join(home, "config.json"),
    JSON.stringify({ version: 1, defaultProviderId: "mock", defaultModel: "mock-model" }),
  );
});

after(async () => {
  await rm(home, { recursive: true, force: true });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function openAICompletion(text: string): unknown {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: "mock-model",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function fetchKey(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe("bridge URL and route helpers", () => {
  it("defaults to the local bridge and honors MODELHITCH_PORT", () => {
    assert.equal(defaultBridgeUrl({}), "http://127.0.0.1:3939");
    assert.equal(defaultBridgeUrl({ MODELHITCH_PORT: "4040" }), "http://127.0.0.1:4040");
  });

  it("normalizes scheme-less URLs and trailing slashes", () => {
    assert.equal(normalizeBridgeUrl("127.0.0.1:3939/"), "http://127.0.0.1:3939");
    assert.equal(normalizeBridgeUrl("https://hitch.example.com///"), "https://hitch.example.com");
  });

  it("builds bridge routes from lane overrides", () => {
    assert.equal(bridgeModelRoute(undefined, undefined), "modelhitch/auto");
    assert.equal(bridgeModelRoute(undefined, "llama3.2"), "llama3.2");
    assert.equal(bridgeModelRoute("ollama", "llama3.2"), "ollama/llama3.2");
    assert.throws(() => bridgeModelRoute("ollama", undefined), /needs --model/);
  });

  it("finds the config path under MODELHITCH_HOME", () => {
    assert.equal(hitchConfigPath({ MODELHITCH_HOME: "/tmp/mh" }), "/tmp/mh/config.json");
  });
});

describe("createHitchChat bridge first", () => {
  it("uses a reachable bridge and routes the whole plan through modelhitch/auto", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = fetchKey(input);
      urls.push(url);
      if (url.endsWith("/healthz")) return jsonResponse({ status: "ok" });
      if (url.endsWith("/v1/chat/completions")) return jsonResponse(openAICompletion("from bridge"));
      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    const hitch = await createHitchChat({
      bridge: "http://127.0.0.1:4555",
      fetchImpl,
      env: { MODELHITCH_HOME: home },
    });

    assert.equal(hitch.lane.transport, "bridge");
    assert.equal(hitch.lane.endpoint, "http://127.0.0.1:4555");
    assert.equal(hitch.lane.model, "modelhitch/auto");
    const text = await hitch.complete([{ role: "user", content: "Clock in." }]);
    assert.equal(text, "from bridge");
    assert.ok(urls.some((url) => url === "http://127.0.0.1:4555/healthz"));
    assert.ok(urls.some((url) => url === "http://127.0.0.1:4555/v1/chat/completions"));
  });

  it("routes a forced bridge with an explicit provider/model as providerId/modelId", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = fetchKey(input);
      if (url.endsWith("/healthz")) return jsonResponse({ status: "ok" });
      body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return jsonResponse(openAICompletion("lane"));
    }) as typeof fetch;

    const hitch = await createHitchChat({
      bridge: "http://127.0.0.1:4555",
      provider: "ollama",
      model: "llama3.2",
      fetchImpl,
      env: { MODELHITCH_HOME: home },
    });

    assert.equal(hitch.lane.model, "ollama/llama3.2");
    assert.equal(await hitch.complete([{ role: "user", content: "hi" }]), "lane");
    assert.equal(body.model, "ollama/llama3.2");
  });

  it("fails loudly when a forced bridge is unreachable", async () => {
    const fetchImpl = (async () => jsonResponse({ status: "nope" }, 503)) as typeof fetch;
    await assert.rejects(
      () =>
        createHitchChat({
          bridge: "http://127.0.0.1:4555",
          fetchImpl,
          env: { MODELHITCH_HOME: home },
        }),
      /not reachable/,
    );
  });

  it("keeps explicit provider/model on the direct path unless a bridge is forced", async () => {
    const fetchImpl = (async () => {
      throw new Error("direct mode must not probe the bridge");
    }) as typeof fetch;

    const hitch = await createHitchChat({
      provider: "mock",
      model: "mock-model",
      configPath: join(home, "config.json"),
      fetchImpl,
      env: { MODELHITCH_HOME: home },
    });

    assert.equal(hitch.lane.transport, "direct");
    assert.equal(hitch.lane.provider, "mock");
    assert.match(await hitch.complete([{ role: "user", content: "Clock in." }]), /Clock in/);
  });

  it("falls back to the library config when auto-detection misses", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      assert.match(fetchKey(input), /\/healthz$/);
      return jsonResponse({ status: "down" }, 503);
    }) as typeof fetch;

    const hitch = await createHitchChat({
      configPath: join(home, "config.json"),
      fetchImpl,
      env: { MODELHITCH_HOME: home },
    });

    assert.equal(hitch.lane.transport, "direct");
    assert.equal(hitch.lane.provider, "mock");
    assert.match(await hitch.complete([{ role: "user", content: "Clock in." }]), /Clock in/);
  });

  it("honors the config policy plan on the direct path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fieldguide-plan-"));
    try {
      const configPath = join(dir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({
          version: 1,
          defaultProviderId: "mock",
          defaultModel: "mock-model",
          policy: { trusted: [{ providerId: "mock", models: ["mock-model"] }], fallback: [] },
        }),
      );
      const fetchImpl = (async () => jsonResponse({ status: "down" }, 503)) as typeof fetch;
      const hitch = await createHitchChat({
        configPath,
        fetchImpl,
        env: { MODELHITCH_HOME: dir },
      });
      assert.equal(hitch.lane.transport, "direct");
      assert.ok(
        hitch.notes?.some((note) => /^routing: ModelHitch config plan \(rotation \+ failover\)$/.test(note)),
        `expected the config plan note, got: ${JSON.stringify(hitch.notes)}`,
      );
      assert.match(await hitch.complete([{ role: "user", content: "Plan." }]), /Plan/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports and survives an unusable config plan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fieldguide-plan-"));
    try {
      const configPath = join(dir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({
          version: 1,
          defaultProviderId: "mock",
          defaultModel: "mock-model",
          policy: { trusted: [{ providerId: "not-a-provider", models: ["x"] }], fallback: [] },
        }),
      );
      const fetchImpl = (async () => jsonResponse({ status: "down" }, 503)) as typeof fetch;
      const hitch = await createHitchChat({
        configPath,
        fetchImpl,
        env: { MODELHITCH_HOME: dir },
      });
      assert.equal(hitch.lane.transport, "direct");
      assert.ok(
        hitch.notes?.some((note) => /^routing: base lane \(config plan not usable here:/.test(note)),
        `expected the fallback note, got: ${JSON.stringify(hitch.notes)}`,
      );
      assert.match(await hitch.complete([{ role: "user", content: "Fallback." }]), /Fallback/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("honors MODELHITCH_BRIDGE_URL over the default URL", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = fetchKey(input);
      urls.push(url);
      if (url.endsWith("/healthz")) return jsonResponse({ status: "ok" });
      return jsonResponse(openAICompletion("env bridge"));
    }) as typeof fetch;

    const hitch = await createHitchChat({
      fetchImpl,
      env: { MODELHITCH_HOME: home, MODELHITCH_BRIDGE_URL: "http://127.0.0.1:4666/" },
    });

    assert.equal(hitch.lane.endpoint, "http://127.0.0.1:4666");
    assert.ok(urls.includes("http://127.0.0.1:4666/healthz"));
    assert.equal(await hitch.complete([{ role: "user", content: "hi" }]), "env bridge");
  });
});
