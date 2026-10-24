import { homedir } from "node:os";
import { join } from "node:path";
import {
  createOpenAICompatibleProvider,
  isMaskedSecret,
  isModelHitchError,
  MemoryKeyStore,
  ModelHitch,
  policyFromConfig,
  readConfigFile,
  type ChatResult,
  type ModelHitchConfig,
  type ModelHitchErrorCode,
  type ModelMessage,
} from "modelhitch";

export type HitchTransport = "bridge" | "direct";

export interface HitchLane {
  provider: string;
  model: string;
  /** Where the call actually went: a local ModelHitch bridge, or the library. */
  transport?: HitchTransport;
  /** Bridge base URL when `transport` is `"bridge"`. */
  endpoint?: string;
}

export interface HitchChat {
  lane: HitchLane;
  complete: (messages: ModelMessage[]) => Promise<string>;
  /** Non-fatal routing notes worth showing the operator (for example a config plan that could not be used). */
  notes?: string[];
}

export interface CreateHitchChatOptions {
  provider?: string;
  model?: string;
  mock?: boolean;
  /**
   * A bridge base URL to force, or `false` to skip bridge auto-detection.
   * Omitted means "auto": probe `MODELHITCH_BRIDGE_URL`, else
   * `http://127.0.0.1:$MODELHITCH_PORT` (default 3939).
   */
  bridge?: string | false;
  /** Config file path override (defaults to `$MODELHITCH_HOME/config.json`). */
  configPath?: string;
  config?: ModelHitchConfig | null;
  env?: NodeJS.ProcessEnv;
  /** Injectable fetch, used by tests and the bridge client. */
  fetchImpl?: typeof fetch;
  /** Health-probe timeout for bridge auto-detection. */
  healthTimeoutMs?: number;
}

const BRIDGE_PROVIDER_ID = "modelhitch-bridge";
const BRIDGE_AUTO_MODEL = "modelhitch/auto";
const DEFAULT_BRIDGE_PORT = "3939";
const DEFAULT_BRIDGE_HOST = "127.0.0.1";
const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "vllm", "llamacpp", "koboldcpp", "mock"]);

export function hitchConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.MODELHITCH_HOME?.trim() || join(homedir(), ".modelhitch");
  return join(home, "config.json");
}

/** The bridge URL Fieldguide probes, matching ModelHitch's own client default. */
export function defaultBridgeUrl(env: NodeJS.ProcessEnv = process.env): string {
  const port = env.MODELHITCH_PORT?.trim() || DEFAULT_BRIDGE_PORT;
  return normalizeBridgeUrl(`http://${DEFAULT_BRIDGE_HOST}:${port}`);
}

/** Trim trailing slashes and tolerate a scheme-less `host:port`. */
export function normalizeBridgeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("ModelHitch bridge URL is empty.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

/**
 * The model id a bridge request should name.
 *
 * - explicit provider + model -> `providerId/modelId` (the bridge route form)
 * - explicit model only -> that model id (bare ids go to the bridge's default provider)
 * - neither -> `modelhitch/auto`, the bridge's whole configured rotation
 *
 * A provider without a model has no bridge meaning (the bridge cannot derive
 * that provider's default), so fail loudly instead of sending a model id the
 * bridge would misinterpret.
 */
export function bridgeModelRoute(provider?: string, model?: string): string {
  const providerId = provider?.trim();
  const modelId = model?.trim();
  if (providerId && modelId) return `${providerId}/${modelId}`;
  if (modelId) return modelId;
  if (providerId) {
    throw new Error(
      `--provider "${providerId}" needs --model when talking to a ModelHitch bridge. Pass both, or use --direct.`,
    );
  }
  return BRIDGE_AUTO_MODEL;
}

export function textFromChatResult(result: ChatResult): string {
  const content = result.message.content;
  const fromParts =
    typeof content === "string"
      ? content
      : content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
  if (fromParts.trim()) return fromParts;
  if (result.message.role === "assistant" && result.message.reasoningContent) {
    return result.message.reasoningContent;
  }
  return fromParts;
}

export async function createHitchChat(options: CreateHitchChatOptions = {}): Promise<HitchChat> {
  const env = options.env ?? process.env;
  if (options.mock) {
    const mh = new ModelHitch({ defaultProviderId: "mock", defaultModel: "mock-model" });
    return wrap(mh, {
      provider: "mock",
      model: "mock-model",
      transport: "direct",
    });
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const provider = options.provider?.trim() || env.FIELDGUIDE_PROVIDER?.trim();
  const model = options.model?.trim() || env.FIELDGUIDE_MODEL?.trim();
  const laneOverride = Boolean(provider || model);
  const forcedBridge = typeof options.bridge === "string";

  if (options.bridge !== false) {
    const bridgeUrl = normalizeBridgeUrl(
      (forcedBridge ? (options.bridge as string) : env.MODELHITCH_BRIDGE_URL) || defaultBridgeUrl(env),
    );
    // An explicit provider/model means "run exactly this lane". Keep the old
    // direct behavior unless the caller also forced --bridge.
    if (forcedBridge || !laneOverride) {
      const healthy = await bridgeHealthy(bridgeUrl, fetchImpl, options.healthTimeoutMs ?? 750);
      if (healthy) {
        return createBridgeChat(bridgeUrl, bridgeModelRoute(provider, model), fetchImpl);
      }
      if (forcedBridge) {
        throw new Error(
          `ModelHitch bridge is not reachable at ${bridgeUrl}. Start it with \`modelhitch bridge --background\`, or use --direct.`,
        );
      }
    }
  }

  return createDirectChat(options, env, provider, model);
}

async function bridgeHealthy(
  bridgeUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(`${bridgeUrl}/healthz`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function createBridgeChat(bridgeUrl: string, route: string, fetchImpl: typeof fetch): HitchChat {
  // The bridge is an OpenAI-compatible endpoint. ModelHitch's own provider
  // factory keeps retries/error mapping consistent with the direct path, while
  // the bridge owns the rotation, intents, and failover behind `modelhitch/auto`.
  const provider = createOpenAICompatibleProvider({
    id: BRIDGE_PROVIDER_ID,
    name: "ModelHitch bridge",
    baseUrl: `${bridgeUrl}/v1`,
    defaultModel: route,
    requiresKey: false,
    fetchImpl,
  });
  const mh = new ModelHitch({
    providers: [provider],
    defaultProviderId: BRIDGE_PROVIDER_ID,
    defaultModel: route,
  });
  return wrap(mh, {
    provider: BRIDGE_PROVIDER_ID,
    model: route,
    transport: "bridge",
    endpoint: bridgeUrl,
  });
}

async function createDirectChat(
  options: CreateHitchChatOptions,
  env: NodeJS.ProcessEnv,
  provider: string | undefined,
  model: string | undefined,
): Promise<HitchChat> {
  const cfg = options.config !== undefined
    ? options.config
    : readConfigFile(options.configPath ?? hitchConfigPath(env));
  const resolvedProvider = provider || cfg?.defaultProviderId || "ollama";
  const resolvedModel = model || cfg?.defaultModel;
  const keystore = new MemoryKeyStore();
  if (cfg?.keys) {
    for (const [id, key] of Object.entries(cfg.keys)) {
      if (!key || isMaskedSecret(key)) continue;
      await keystore.set(id, key);
    }
  }

  const base = {
    defaultProviderId: resolvedProvider,
    defaultModel: resolvedModel,
    keystore,
  };
  // An explicit lane pins routing. Otherwise honor the current ModelHitch
  // config's policy/intents (rotation + in-process failover) when the registry
  // can serve it. Advanced configs (custom lanes, chatgpt-plan, ...) may not be
  // constructible through the library alone; those fall back to the base lane.
  const notes: string[] = [];
  const usePlan = !provider && !model;
  let mh: ModelHitch;
  if (usePlan) {
    const policy = safePolicyFromConfig(cfg);
    const intents = cfg?.intents;
    if (policy || intents) {
      try {
        mh = new ModelHitch({ ...base, policy, intents });
        notes.push("routing: ModelHitch config plan (rotation + failover)");
      } catch (error) {
        mh = new ModelHitch(base);
        notes.push(`routing: base lane (config plan not usable here: ${errorMessage(error)})`);
      }
    } else {
      mh = new ModelHitch(base);
    }
  } else {
    mh = new ModelHitch(base);
  }

  const lane: HitchLane = {
    provider: resolvedProvider,
    model: resolvedModel ?? laneModel(mh, resolvedProvider),
    transport: "direct",
  };
  const chat = wrap(mh, lane);
  if (notes.length) chat.notes = notes;
  return chat;
}

function safePolicyFromConfig(cfg: ModelHitchConfig | null): ReturnType<typeof policyFromConfig> {
  if (!cfg) return undefined;
  try {
    return policyFromConfig(cfg);
  } catch {
    return undefined;
  }
}

function laneModel(mh: ModelHitch, provider: string): string {
  try {
    return mh.provider(provider).defaultModel;
  } catch {
    return "default";
  }
}

function wrap(mh: ModelHitch, lane: HitchLane): HitchChat {
  return {
    lane,
    async complete(messages) {
      try {
        const result = await mh.chat({
          provider: lane.provider,
          model: lane.model,
          messages,
          temperature: 0.15,
          maxTokens: 8192,
        });
        const text = textFromChatResult(result).trim();
        if (!text) {
          throw new Error("ModelHitch returned an empty message.");
        }
        return text;
      } catch (error) {
        throw hitchError(error, lane);
      }
    },
  };
}

function hitchError(error: unknown, lane: HitchLane): Error {
  if (isModelHitchError(error)) {
    const hint = hintFor(error.code, lane);
    return new Error(`ModelHitch unavailable (${error.code}) on ${laneLabel(lane)}. ${hint}`, {
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`ModelHitch failed on ${laneLabel(lane)}: ${message}`, { cause: error });
}

function laneLabel(lane: HitchLane): string {
  return lane.transport === "bridge" ? `bridge ${lane.endpoint ?? ""} (${lane.model})` : `${lane.provider}/${lane.model}`;
}

function hintFor(code: ModelHitchErrorCode, lane: HitchLane): string {
  const bridge = lane.transport === "bridge";
  switch (code) {
    case "missing-api-key":
    case "invalid-api-key":
      return bridge
        ? "The bridge has no usable credential for that lane. Run `modelhitch settings --web`, or use --direct with a local provider (`ollama`, `lmstudio`)."
        : "Set a key in `modelhitch settings --web`, or use a local provider (`ollama`, `lmstudio`).";
    case "network-error":
      if (bridge) return `Check \`modelhitch status\`; the bridge or its upstream lane is unreachable.`;
      return LOCAL_PROVIDERS.has(lane.provider)
        ? "Start the local runtime, or `modelhitch status` / `modelhitch bridge --background`."
        : "Network error talking to the provider.";
    case "provider-not-found":
      return "Unknown provider id. Check `modelhitch config` or pass --provider.";
    case "model-not-found":
      return "Unknown model id. Pass --model or set FIELDGUIDE_MODEL.";
    case "rate-limited":
    case "provider-error":
    case "bad-request":
    case "capability-unavailable":
      return bridge
        ? `Every usable bridge lane returned ${code}. Try again, or check \`modelhitch status\` / \`modelhitch settings --web\`.`
        : `Provider returned ${code}. Try another model with --model, or check \`modelhitch status\`.`;
    default: {
      const _never: never = code;
      return _never;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
