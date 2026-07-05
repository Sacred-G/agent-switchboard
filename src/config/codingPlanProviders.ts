import { createUsageScript } from "@/types";
import { TEMPLATE_TYPES } from "@/config/constants";

export interface CodingPlanProviderEntry {
  id: "kimi" | "zhipu" | "minimax" | "zenmux" | "volcengine";

  label: string;

  pattern: RegExp;
}

export const CODING_PLAN_PROVIDERS: readonly CodingPlanProviderEntry[] = [
  { id: "kimi", label: "Kimi For Coding", pattern: /api\.kimi\.com\/coding/i },
  {
    id: "zhipu",
    label: "Zhipu GLM",
    pattern: /bigmodel\.cn|api\.z\.ai/i,
  },
  {
    id: "minimax",
    label: "MiniMax",
    pattern: /api\.minimaxi?\.com|api\.minimax\.io/i,
  },
  {
    id: "zenmux",
    label: "ZenMux",
    pattern: /zenmux\./i,
  },
  {
    id: "volcengine",
    label: "Volcengine Ark (Volcengine)",
    pattern: /volces\.com\/api\/coding/i,
  },
] as const;

export function detectCodingPlanProvider(
  baseUrl: string | undefined | null,
): CodingPlanProviderEntry["id"] | null {
  if (!baseUrl) return null;
  for (const cp of CODING_PLAN_PROVIDERS) {
    if (cp.pattern.test(baseUrl)) return cp.id;
  }
  return null;
}

export function injectCodingPlanUsageScript<
  T extends {
    settingsConfig?: Record<string, any>;
    meta?: Record<string, any>;
  },
>(appId: string, provider: T): T {
  if (appId !== "claude") return provider;
  if (provider.meta?.usage_script) return provider;

  const baseUrl = provider.settingsConfig?.env?.ANTHROPIC_BASE_URL;
  const codingPlanProvider = detectCodingPlanProvider(
    typeof baseUrl === "string" ? baseUrl : null,
  );
  if (!codingPlanProvider) return provider;

  return {
    ...provider,
    meta: {
      ...(provider.meta ?? {}),
      usage_script: createUsageScript({
        enabled: true,
        templateType: TEMPLATE_TYPES.TOKEN_PLAN,
        codingPlanProvider,
      }),
    },
  };
}
