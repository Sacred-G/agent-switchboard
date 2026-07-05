import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  updateCommonConfigSnippet,
  hasCommonConfigSnippet,
  validateJsonConfig,
} from "@/utils/providerConfigUtils";
import { configApi } from "@/lib/api";

const LEGACY_STORAGE_KEY = "agent-switchboard:common-config-snippet";
const DEFAULT_COMMON_CONFIG_SNIPPET = `{
  "includeCoAuthoredBy": false
}`;

interface UseCommonConfigSnippetProps {
  settingsConfig: string;
  onConfigChange: (config: string) => void;
  initialData?: {
    settingsConfig?: Record<string, unknown>;
  };
  initialEnabled?: boolean;
  selectedPresetId?: string;
  /** When false, the hook skips all logic and returns disabled state. Default: true */
  enabled?: boolean;
}

export function useCommonConfigSnippet({
  settingsConfig,
  onConfigChange,
  initialData,
  initialEnabled,
  selectedPresetId,
  enabled = true,
}: UseCommonConfigSnippetProps) {
  const { t } = useTranslation();
  const [useCommonConfig, setUseCommonConfig] = useState(false);
  const [commonConfigSnippet, setCommonConfigSnippetState] = useState<string>(
    DEFAULT_COMMON_CONFIG_SNIPPET,
  );
  const [commonConfigError, setCommonConfigError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);

  const isUpdatingFromCommonConfig = useRef(false);
  const hasInitializedNewMode = useRef(false);
  const hasInitializedEditMode = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    hasInitializedNewMode.current = false;
    hasInitializedEditMode.current = false;
  }, [selectedPresetId, enabled, initialEnabled]);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    let mounted = true;

    const loadSnippet = async () => {
      try {
        const snippet = await configApi.getCommonConfigSnippet("claude");

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
                await configApi.setCommonConfigSnippet("claude", legacySnippet);
                if (mounted) {
                  setCommonConfigSnippetState(legacySnippet);
                }
                window.localStorage.removeItem(LEGACY_STORAGE_KEY);
                console.log(
                  "[Migration] Claude common config migrated from localStorage to config.json",
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
        console.error("Failed to load common config:", error);
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
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (initialData && !isLoading && !hasInitializedEditMode.current) {
      hasInitializedEditMode.current = true;

      const configString = JSON.stringify(initialData.settingsConfig, null, 2);
      const inferredHasCommon = hasCommonConfigSnippet(
        configString,
        commonConfigSnippet,
      );

      const hasCommon =
        initialEnabled !== undefined ? initialEnabled : inferredHasCommon;
      setUseCommonConfig(hasCommon);

      if (hasCommon && !inferredHasCommon) {
        const { updatedConfig, error } = updateCommonConfigSnippet(
          settingsConfig,
          commonConfigSnippet,
          true,
        );
        if (!error) {
          isUpdatingFromCommonConfig.current = true;
          onConfigChange(updatedConfig);
          setTimeout(() => {
            isUpdatingFromCommonConfig.current = false;
          }, 0);
        }
      }
    }
  }, [
    enabled,
    initialData,
    initialEnabled,
    commonConfigSnippet,
    isLoading,
    onConfigChange,
    settingsConfig,
  ]);

  useEffect(() => {
    if (!enabled) return;
    if (!initialData && !isLoading && !hasInitializedNewMode.current) {
      hasInitializedNewMode.current = true;

      try {
        const snippetObj = JSON.parse(commonConfigSnippet);
        const hasContent = Object.keys(snippetObj).length > 0;
        if (hasContent) {
          setUseCommonConfig(true);
          const { updatedConfig, error } = updateCommonConfigSnippet(
            settingsConfig,
            commonConfigSnippet,
            true,
          );
          if (!error) {
            isUpdatingFromCommonConfig.current = true;
            onConfigChange(updatedConfig);
            setTimeout(() => {
              isUpdatingFromCommonConfig.current = false;
            }, 0);
          }
        }
      } catch {
        // ignore parse error
      }
    }
  }, [
    enabled,
    initialData,
    commonConfigSnippet,
    isLoading,
    settingsConfig,
    onConfigChange,
  ]);

  const handleCommonConfigToggle = useCallback(
    (checked: boolean) => {
      const { updatedConfig, error: snippetError } = updateCommonConfigSnippet(
        settingsConfig,
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
    [settingsConfig, commonConfigSnippet, onConfigChange],
  );

  const handleCommonConfigSnippetChange = useCallback(
    (value: string) => {
      const previousSnippet = commonConfigSnippet;
      setCommonConfigSnippetState(value);

      if (!value.trim()) {
        setCommonConfigError("");
        configApi
          .setCommonConfigSnippet("claude", "")
          .catch((error: unknown) => {
            console.error("Failed to save common config:", error);
            setCommonConfigError(
              t("claudeConfig.saveFailed", { error: String(error) }),
            );
          });

        if (useCommonConfig) {
          const { updatedConfig } = updateCommonConfigSnippet(
            settingsConfig,
            previousSnippet,
            false,
          );
          onConfigChange(updatedConfig);
          setUseCommonConfig(false);
        }
        return;
      }

      const validationError = validateJsonConfig(
        value,
        "Common config snippet",
      );
      if (validationError) {
        setCommonConfigError(validationError);
      } else {
        setCommonConfigError("");
        configApi
          .setCommonConfigSnippet("claude", value)
          .catch((error: unknown) => {
            console.error("Failed to save common config:", error);
            setCommonConfigError(
              t("claudeConfig.saveFailed", { error: String(error) }),
            );
          });
      }

      if (useCommonConfig && !validationError) {
        const removeResult = updateCommonConfigSnippet(
          settingsConfig,
          previousSnippet,
          false,
        );
        if (removeResult.error) {
          setCommonConfigError(removeResult.error);
          return;
        }
        const addResult = updateCommonConfigSnippet(
          removeResult.updatedConfig,
          value,
          true,
        );

        if (addResult.error) {
          setCommonConfigError(addResult.error);
          return;
        }

        isUpdatingFromCommonConfig.current = true;
        onConfigChange(addResult.updatedConfig);
        setTimeout(() => {
          isUpdatingFromCommonConfig.current = false;
        }, 0);
      }
    },
    [commonConfigSnippet, settingsConfig, useCommonConfig, onConfigChange],
  );

  useEffect(() => {
    if (!enabled) return;
    if (isUpdatingFromCommonConfig.current || isLoading) {
      return;
    }
    const hasCommon = hasCommonConfigSnippet(
      settingsConfig,
      commonConfigSnippet,
    );
    setUseCommonConfig(hasCommon);
  }, [enabled, settingsConfig, commonConfigSnippet, isLoading]);

  const handleExtract = useCallback(async () => {
    setIsExtracting(true);
    setCommonConfigError("");

    try {
      const extracted = await configApi.extractCommonConfigSnippet("claude", {
        settingsConfig,
      });

      if (!extracted || extracted === "{}") {
        setCommonConfigError(t("claudeConfig.extractNoCommonConfig"));
        return;
      }

      const validationError = validateJsonConfig(extracted, "Extracted config");
      if (validationError) {
        setCommonConfigError(validationError);
        return;
      }

      setCommonConfigSnippetState(extracted);

      await configApi.setCommonConfigSnippet("claude", extracted);
    } catch (error) {
      console.error("Failed to extract common config:", error);
      setCommonConfigError(
        t("claudeConfig.extractFailed", { error: String(error) }),
      );
    } finally {
      setIsExtracting(false);
    }
  }, [settingsConfig, t]);

  return {
    useCommonConfig,
    commonConfigSnippet,
    commonConfigError,
    isLoading,
    isExtracting,
    handleCommonConfigToggle,
    handleCommonConfigSnippetChange,
    handleExtract,
  };
}
