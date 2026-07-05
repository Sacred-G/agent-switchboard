import type {
  UniversalProvider,
  UniversalProviderApps,
  UniversalProviderModels,
} from "@/types";
import { deepClone } from "@/utils/deepClone";

export interface UniversalProviderPreset {
  name: string;

  providerType: string;

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
};

export const universalProviderPresets: UniversalProviderPreset[] = [
  {
    name: "NewAPI",
    providerType: "newapi",
    defaultApps: {
      claude: true,
      codex: true,
      gemini: true,
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
    defaultApps: {
      claude: true,
      codex: true,
      gemini: true,
    },
    defaultModels: NEWAPI_DEFAULT_MODELS,
    icon: "openai",
    iconColor: "#6366F1",
    description: "Custom configured API Gateway",
    isCustomTemplate: true,
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
