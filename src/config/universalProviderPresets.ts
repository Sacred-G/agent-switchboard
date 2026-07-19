import type {
  UniversalProvider,
  UniversalProviderApps,
  UniversalProviderModels,
} from "@/types";
import { deepClone } from "@/utils/deepClone";

export interface UniversalProviderPreset {
  name: string;

  providerType: string;

  apiFormat: UniversalProvider["apiFormat"];

  defaultApps: UniversalProviderApps;

  defaultModels: UniversalProviderModels;

  websiteUrl?: string;

  icon?: string;

  iconColor?: string;

  description?: string;

  isCustomTemplate?: boolean;
}

const NEWAPI_DEFAULT_MODELS: UniversalProviderModels = {
  claude: {
    model: "claude-sonnet-4-6",
    haikuModel: "claude-haiku-4-5-20251001",
    sonnetModel: "claude-sonnet-4-6",
    opusModel: "claude-opus-4-8",
  },
  codex: {
    model: "gpt-5.5",
    reasoningEffort: "high",
  },
  gemini: {
    model: "gemini-3.5-flash",
  },
  opencode: {
    model: "gpt-5.5",
  },
};

export const universalProviderPresets: UniversalProviderPreset[] = [
  {
    name: "NewAPI",
    providerType: "newapi",
    apiFormat: "openai_responses",
    defaultApps: {
      claude: true,
      codex: true,
      gemini: true,
      opencode: true,
    },
    defaultModels: NEWAPI_DEFAULT_MODELS,
    websiteUrl: "https://www.newapi.pro",
    icon: "newapi",
    iconColor: "#00A67E",
    description:
      "NewAPI is a self-deployable API gateway supporting Anthropic, OpenAI, Gemini, etc.",
  },
  {
    name: "Custom Gateway",
    providerType: "custom_gateway",
    apiFormat: "openai_chat",
    defaultApps: {
      claude: true,
      codex: true,
      gemini: true,
      opencode: true,
    },
    defaultModels: NEWAPI_DEFAULT_MODELS,
    icon: "openai",
    iconColor: "#6366F1",
    description: "Custom configured API Gateway",
    isCustomTemplate: true,
  },
  {
    name: "OpenRouter",
    providerType: "openrouter",
    apiFormat: "openai_chat",
    defaultApps: {
      claude: false,
      codex: true,
      gemini: false,
      opencode: true,
    },
    defaultModels: {
      codex: { model: "openai/gpt-5.5", reasoningEffort: "high" },
      opencode: { model: "anthropic/claude-sonnet-4.6" },
    },
    websiteUrl: "https://openrouter.ai",
    icon: "openrouter",
    iconColor: "#6566F1",
    description: "OpenRouter's OpenAI-compatible API for Codex and OpenCode.",
  },
];

export function createUniversalProviderFromPreset(
  preset: UniversalProviderPreset,
  id: string,
  baseUrl: string,
  apiKey: string,
  customName?: string,
): UniversalProvider {
  return {
    id,
    name: customName || preset.name,
    providerType: preset.providerType,
    apiFormat: preset.apiFormat,
    apps: { ...preset.defaultApps },
    baseUrl,
    apiKey,
    models: deepClone(preset.defaultModels),
    websiteUrl: preset.websiteUrl,
    icon: preset.icon,
    iconColor: preset.iconColor,
    createdAt: Date.now(),
  };
}

export function getPresetDisplayName(preset: UniversalProviderPreset): string {
  return preset.name;
}

export function findPresetByType(
  providerType: string,
): UniversalProviderPreset | undefined {
  return universalProviderPresets.find((p) => p.providerType === providerType);
}
