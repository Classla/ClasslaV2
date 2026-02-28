import type { LanguageModelV3 } from "@ai-sdk/provider";
import { logger } from "../utils/logger";

type ProviderType = "bedrock" | "openai" | "google";

const PROVIDER = (process.env.AI_PROVIDER || "bedrock") as ProviderType;

// Default model ID per provider (single model for all tasks)
const DEFAULT_MODEL: Record<ProviderType, string> = {
  bedrock: "us.anthropic.claude-sonnet-4-6",
  openai: "gpt-5.2",
  google: "gemini-3-flash-preview",
};

// Lazy-initialized provider instances
let _bedrockProvider: any = null;
let _openaiProvider: any = null;
let _googleProvider: any = null;

function getBedrockProvider() {
  if (!_bedrockProvider) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createAmazonBedrock } = require("@ai-sdk/amazon-bedrock");
    const config: Record<string, any> = {
      region: process.env.AWS_REGION || "us-east-1",
    };
    if (process.env.BEDROCK_ACCESS_KEY_ID && process.env.BEDROCK_SECRET_ACCESS_KEY) {
      config.accessKeyId = process.env.BEDROCK_ACCESS_KEY_ID;
      config.secretAccessKey = process.env.BEDROCK_SECRET_ACCESS_KEY;
      logger.info("AI provider: Bedrock with explicit credentials");
    } else if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      config.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      config.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
      logger.info("AI provider: Bedrock with AWS credentials");
    } else {
      logger.info("AI provider: Bedrock with IAM role credentials");
    }
    _bedrockProvider = createAmazonBedrock(config);
  }
  return _bedrockProvider;
}

function getOpenAIProvider() {
  if (!_openaiProvider) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createOpenAI } = require("@ai-sdk/openai");
    _openaiProvider = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    logger.info("AI provider: OpenAI");
  }
  return _openaiProvider;
}

function getGoogleProvider() {
  if (!_googleProvider) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createGoogleGenerativeAI } = require("@ai-sdk/google");
    _googleProvider = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_AI_API_KEY,
    });
    logger.info("AI provider: Google");
  }
  return _googleProvider;
}

function createModel(modelId: string): LanguageModelV3 {
  switch (PROVIDER) {
    case "bedrock":
      return getBedrockProvider()(modelId);
    case "openai":
      return getOpenAIProvider()(modelId);
    case "google":
      return getGoogleProvider()(modelId);
    default:
      throw new Error(`Unknown AI_PROVIDER: ${PROVIDER}`);
  }
}

// Single model getter — all tasks use the same model.
// Override with AI_MODEL env var, otherwise uses the provider default.
let _cachedModel: LanguageModelV3 | null = null;

export function getModel(): LanguageModelV3 {
  if (!_cachedModel) {
    const modelId = process.env.AI_MODEL || DEFAULT_MODEL[PROVIDER];
    _cachedModel = createModel(modelId);
    logger.info("AI model initialized", { provider: PROVIDER, modelId });
  }
  return _cachedModel;
}

// Aliases for backward compat with call sites
export const getMainModel = getModel;
export const getQuickModel = getModel;
export const getChatModel = getModel;
