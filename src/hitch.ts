import { homedir } from "node:os";
import { join } from "node:path";
import {
  isMaskedSecret,
  isModelHitchError,
  MemoryKeyStore,
  ModelHitch,
  readConfigFile,
  type ChatResult,
  type ModelHitchErrorCode,
  type ModelMessage,
} from "modelhitch";

export interface HitchLane {
  provider: string;
  model: string;
}

export interface HitchChat {
  lane: HitchLane;
  complete: (messages: ModelMessage[]) => Promise<string>;
}

const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "vllm", "llamacpp", "koboldcpp", "mock"]);

export function hitchConfigPath(): string {
  const home = process.env.MODELHITCH_HOME?.trim() || join(homedir(), ".modelhitch");
  return join(home, "config.json");
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

export async function createHitchChat(options: {
  provider?: string;
  model?: string;
  mock?: boolean;
}): Promise<HitchChat> {
  if (options.mock) {
    const mh = new ModelHitch({ defaultProviderId: "mock", defaultModel: "mock-model" });
    return wrap(mh, { provider: "mock", model: "mock-model" });
  }

  const cfg = readConfigFile(hitchConfigPath());
  const provider =
    options.provider?.trim() ||
    process.env.FIELDGUIDE_PROVIDER?.trim() ||
    cfg?.defaultProviderId ||
    "ollama";
  const model =
    options.model?.trim() ||
    process.env.FIELDGUIDE_MODEL?.trim() ||
    cfg?.defaultModel;

  const keystore = new MemoryKeyStore();
  if (cfg?.keys) {
    for (const [id, key] of Object.entries(cfg.keys)) {
      if (!key || isMaskedSecret(key)) continue;
      await keystore.set(id, key);
    }
  }

  const mh = new ModelHitch({
    defaultProviderId: provider,
    defaultModel: model,
    keystore,
  });
  const resolvedModel = model ?? mh.provider(provider).defaultModel;
  return wrap(mh, { provider, model: resolvedModel });
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
    return new Error(`ModelHitch unavailable (${error.code}) on ${lane.provider}/${lane.model}. ${hint}`, {
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`ModelHitch failed on ${lane.provider}/${lane.model}: ${message}`, { cause: error });
}

function hintFor(code: ModelHitchErrorCode, lane: HitchLane): string {
  switch (code) {
    case "missing-api-key":
    case "invalid-api-key":
      return "Set a key in `npx modelhitch settings`, or use a local provider (`ollama`, `lmstudio`).";
    case "network-error":
      return LOCAL_PROVIDERS.has(lane.provider)
        ? "Start the local runtime, or `npx modelhitch status` / `npx modelhitch bridge --background`."
        : "Network error talking to the provider.";
    case "provider-not-found":
      return "Unknown provider id. Check `~/.modelhitch/config.json` or pass `--provider`.";
    case "model-not-found":
      return "Unknown model id. Pass `--model` or set FIELDGUIDE_MODEL.";
    case "rate-limited":
    case "provider-error":
    case "bad-request":
    case "capability-unavailable":
      return `Provider returned ${code}. Try another model with --model, or check \`npx modelhitch status\`.`;
    default: {
      const _never: never = code;
      return _never;
    }
  }
}
