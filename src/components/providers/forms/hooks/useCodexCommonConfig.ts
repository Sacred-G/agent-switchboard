import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { parse as parseToml } from "smol-toml";
import {
  updateTomlCommonConfigSnippet,
  hasTomlCommonConfigSnippet,
} from "@/utils/providerConfigUtils";
import { configApi } from "@/lib/api";
import { normalizeTomlText } from "@/utils/textNormalization";

const LEGACY_STORAGE_KEY = "agent-switchboard:codex-common-config-snippet";
const DEFAULT_CODEX_COMMON_CONFIG_SNIPPET = `# Common Codex config
# Add your common TOML configuration here`;

interface UseCodexCommonConfigProps {
  codexConfig: string;
  onConfigChange: (config: string) => void;
  initialData?: {
    settingsConfig?: Record<string, unknown>;
  };
  initialEnabled?: boolean;
  selectedPresetId?: string;
}

export function useCodexCommonConfig({
  codexConfig,
  onConfigChange,
  initialData,
  initialEnabled,
  selectedPresetId,
}: UseCodexCommonConfigProps) {
  const { t } = useTranslation();
  const [useCommonConfig, setUseCommonConfig] = useState(false);
  const [commonConfigSnippet, setCommonConfigSnippetState] = useState<string>(
    DEFAULT_CODEX_COMMON_CONFIG_SNIPPET,
  );
  const [commonConfigError, setCommonConfigError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);

  const isUpdatingFromCommonConfig = useRef(false);
  const hasInitializedNewMode = useRef(false);
  const hasInitializedEditMode = useRef(false);

  useEffect(() => {
    hasInitializedNewMode.current = false;
    hasInitializedEditMode.current = false;
  }, [selectedPresetId, initialEnabled]);

  const parseCommonConfigSnippet = useCallback((snippetString: string) => {
    const trimmed = snippetString.trim();
    if (!trimmed) {
      return {
        hasContent: false,
      };
    }

    try {
      const parsed = parseToml(normalizeTomlText(snippetString)) as Record<
        string,
        unknown
      >;
      return {
        hasContent: Object.keys(parsed).length > 0,
      };
    } catch (error) {
      return {
        hasContent: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadSnippet = async () => {
      try {
        const snippet = await configApi.getCommonConfigSnippet("codex");

        if (snippet && snippet.trim()) {
          if (mounted) {
            setCommonConfigSnippetState(snippet);
          }
        } else {
          if (typeof window !== "undefined") {
            try {
              const legacySnippet =
                window.localStorage.getItem(LEGACY_STORAGE_KEY);
              if (legacySnippet && legacySnippet.trim()) {
                await configApi.setCommonConfigSnippet("codex", legacySnippet);
                if (mounted) {
                  setCommonConfigSnippetState(legacySnippet);
                }
                window.localStorage.removeItem(LEGACY_STORAGE_KEY);
                console.log(
                  "[Migration] Codex common configuration migrated from localStorage to config.json",
                );
              }
            } catch (e) {
              console.warn(
                "[Migration] Failed to migrate from localStorage:",
                e,
              );
            }
          }
        }
      } catch (error) {
        console.error("Failed to load Codex common configuration:", error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadSnippet();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (
      !initialData?.settingsConfig ||
      isLoading ||
      hasInitializedEditMode.current
    ) {
      return;
    }

    hasInitializedEditMode.current = true;

    const parsedSnippet = parseCommonConfigSnippet(commonConfigSnippet);
    if (parsedSnippet.error) {
      if (commonConfigSnippet.trim()) {
        setCommonConfigError(parsedSnippet.error);
      }
      setUseCommonConfig(false);
      return;
    }

    const config =
      typeof initialData.settingsConfig.config === "string"
        ? initialData.settingsConfig.config
        : "";
    const inferredHasCommon = hasTomlCommonConfigSnippet(
      config,
      commonConfigSnippet,
    );

    const hasCommon =
      initialEnabled !== undefined ? initialEnabled : inferredHasCommon;

    if (hasCommon && !inferredHasCommon && parsedSnippet.hasContent) {
      const { updatedConfig, error } = updateTomlCommonConfigSnippet(
        codexConfig,
        commonConfigSnippet,
        true,
      );
      if (error) {
        setCommonConfigError(error);
        setUseCommonConfig(false);
        return;
      }

      setCommonConfigError("");
      setUseCommonConfig(true);
      isUpdatingFromCommonConfig.current = true;
      onConfigChange(updatedConfig);
      setTimeout(() => {
        isUpdatingFromCommonConfig.current = false;
      }, 0);
      return;
    }

    setCommonConfigError("");
    setUseCommonConfig(hasCommon);
  }, [
    codexConfig,
    commonConfigSnippet,
    initialData,
    initialEnabled,
    isLoading,
    onConfigChange,
    parseCommonConfigSnippet,
  ]);

  useEffect(() => {
    if (initialData || isLoading || hasInitializedNewMode.current) {
      return;
    }

    hasInitializedNewMode.current = true;

    const parsedSnippet = parseCommonConfigSnippet(commonConfigSnippet);
    if (parsedSnippet.error) {
      if (commonConfigSnippet.trim()) {
        setCommonConfigError(parsedSnippet.error);
      }
      setUseCommonConfig(false);
      return;
    }
    if (!parsedSnippet.hasContent) {
      return;
    }

    const { updatedConfig, error } = updateTomlCommonConfigSnippet(
      codexConfig,
      commonConfigSnippet,
      true,
    );
    if (error) {
      setCommonConfigError(error);
      setUseCommonConfig(false);
      return;
    }

    setCommonConfigError("");
    setUseCommonConfig(true);
    isUpdatingFromCommonConfig.current = true;
    onConfigChange(updatedConfig);
    setTimeout(() => {
      isUpdatingFromCommonConfig.current = false;
    }, 0);
  }, [
    initialData,
    commonConfigSnippet,
    isLoading,
    codexConfig,
    onConfigChange,
    parseCommonConfigSnippet,
  ]);

  const handleCommonConfigToggle = useCallback(
    (checked: boolean) => {
      const parsedSnippet = parseCommonConfigSnippet(commonConfigSnippet);
      if (parsedSnippet.error) {
        setCommonConfigError(parsedSnippet.error);
        setUseCommonConfig(false);
        return;
      }
      if (!parsedSnippet.hasContent) {
        setCommonConfigError(
          t("codexConfig.noCommonConfigToApply", {
            defaultValue:
              "Common config snippet is empty or has no content to write",
          }),
        );
        setUseCommonConfig(false);
        return;
      }

      const { updatedConfig, error: snippetError } =
        updateTomlCommonConfigSnippet(
          codexConfig,
          commonConfigSnippet,
          checked,
        );

      if (snippetError) {
        setCommonConfigError(snippetError);
        setUseCommonConfig(false);
        return;
      }

      setCommonConfigError("");
      setUseCommonConfig(checked);
      isUpdatingFromCommonConfig.current = true;
      onConfigChange(updatedConfig);
      setTimeout(() => {
        isUpdatingFromCommonConfig.current = false;
      }, 0);
    },
    [
      codexConfig,
      commonConfigSnippet,
      onConfigChange,
      parseCommonConfigSnippet,
      t,
    ],
  );

  const handleCommonConfigSnippetChange = useCallback(
    (value: string): boolean => {
      const previousSnippet = commonConfigSnippet;

      if (!value.trim()) {
        setCommonConfigError("");

        if (useCommonConfig) {
          const previousParsed = parseCommonConfigSnippet(previousSnippet);
          let updatedConfig = codexConfig;

          if (!previousParsed.error && previousParsed.hasContent) {
            const removeResult = updateTomlCommonConfigSnippet(
              codexConfig,
              previousSnippet,
              false,
            );
            if (removeResult.error) {
              setCommonConfigError(removeResult.error);
              return false;
            }
            updatedConfig = removeResult.updatedConfig;
          }

          onConfigChange(updatedConfig);
          setUseCommonConfig(false);
        }

        setCommonConfigSnippetState("");
        configApi
          .setCommonConfigSnippet("codex", "")
          .catch((error: unknown) => {
            console.error("Failed to save Codex common configuration:", error);
            setCommonConfigError(
              t("codexConfig.saveFailed", { error: String(error) }),
            );
          });
        return true;
      }

      const parsedNextSnippet = parseCommonConfigSnippet(value);
      if (parsedNextSnippet.error) {
        setCommonConfigError(parsedNextSnippet.error);
        return false;
      }

      if (useCommonConfig) {
        let nextConfig = codexConfig;
        const previousParsed = parseCommonConfigSnippet(previousSnippet);

        if (!previousParsed.error && previousParsed.hasContent) {
          const removeResult = updateTomlCommonConfigSnippet(
            codexConfig,
            previousSnippet,
            false,
          );
          if (removeResult.error) {
            setCommonConfigError(removeResult.error);
            return false;
          }
          nextConfig = removeResult.updatedConfig;
        }

        const addResult = updateTomlCommonConfigSnippet(
          nextConfig,
          value,
          true,
        );

        if (addResult.error) {
          setCommonConfigError(addResult.error);
          return false;
        }

        isUpdatingFromCommonConfig.current = true;
        onConfigChange(addResult.updatedConfig);
        setTimeout(() => {
          isUpdatingFromCommonConfig.current = false;
        }, 0);
      }

      setCommonConfigError("");
      setCommonConfigSnippetState(value);
      configApi
        .setCommonConfigSnippet("codex", value)
        .catch((error: unknown) => {
          console.error("Failed to save Codex common configuration:", error);
          setCommonConfigError(
            t("codexConfig.saveFailed", { error: String(error) }),
          );
        });

      return true;
    },
    [
      commonConfigSnippet,
      codexConfig,
      onConfigChange,
      parseCommonConfigSnippet,
      t,
      useCommonConfig,
    ],
  );

  useEffect(() => {
    if (isUpdatingFromCommonConfig.current || isLoading) {
      return;
    }
    const parsedSnippet = parseCommonConfigSnippet(commonConfigSnippet);
    if (parsedSnippet.error) {
      setUseCommonConfig(false);
      return;
    }
    const hasCommon = hasTomlCommonConfigSnippet(
      codexConfig,
      commonConfigSnippet,
    );
    setUseCommonConfig(hasCommon);
  }, [codexConfig, commonConfigSnippet, isLoading, parseCommonConfigSnippet]);

  const handleExtract = useCallback(async () => {
    setIsExtracting(true);
    setCommonConfigError("");

    try {
      const extracted = await configApi.extractCommonConfigSnippet("codex", {
        settingsConfig: JSON.stringify({
          config: codexConfig ?? "",
        }),
      });

      if (!extracted || !extracted.trim()) {
        setCommonConfigError(t("codexConfig.extractNoCommonConfig"));
        return;
      }

      setCommonConfigSnippetState(extracted);

      await configApi.setCommonConfigSnippet("codex", extracted);
    } catch (error) {
      console.error("Failed to extract Codex common configuration:", error);
      setCommonConfigError(
        t("codexConfig.extractFailed", { error: String(error) }),
      );
    } finally {
      setIsExtracting(false);
    }
  }, [codexConfig, t]);

  const clearCommonConfigError = useCallback(() => {
    setCommonConfigError("");
  }, []);

  return {
    useCommonConfig,
    commonConfigSnippet,
    commonConfigError,
    isLoading,
    isExtracting,
    handleCommonConfigToggle,
    handleCommonConfigSnippetChange,
    handleExtract,
    clearCommonConfigError,
  };
}
