import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { providersApi, settingsApi, openclawApi, type AppId } from "@/lib/api";
import type {
  Provider,
  UsageScript,
  OpenClawProviderConfig,
  OpenClawDefaultModel,
} from "@/types";
import type { OpenClawSuggestedDefaults } from "@/config/openclawProviderPresets";
import { injectCodingPlanUsageScript } from "@/config/codingPlanProviders";
import {
  useAddProviderMutation,
  useUpdateProviderMutation,
  useDeleteProviderMutation,
  useSwitchProviderMutation,
} from "@/lib/query";
import { extractErrorMessage } from "@/utils/errorUtils";
import { openclawKeys } from "@/hooks/useOpenClaw";
import {
  extractCodexWireApi,
  isCodexChatWireApi,
} from "@/utils/providerConfigUtils";

/**
 * Hook for managing provider actions (add, update, delete, switch)
 * Extracts business logic from App.tsx
 */
export function useProviderActions(
  activeApp: AppId,
  isProxyRunning?: boolean,
  isProxyTakeover?: boolean,
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const addProviderMutation = useAddProviderMutation(activeApp);
  const updateProviderMutation = useUpdateProviderMutation(activeApp);
  const deleteProviderMutation = useDeleteProviderMutation(activeApp);
  const switchProviderMutation = useSwitchProviderMutation(activeApp);

  const syncClaudePlugin = useCallback(
    async (provider: Provider) => {
      if (activeApp !== "claude") return;

      try {
        const settings = await settingsApi.get();
        if (!settings?.enableClaudePluginIntegration) {
          return;
        }

        const isOfficial = provider.category === "official";
        await settingsApi.applyClaudePluginConfig({ official: isOfficial });
      } catch (error) {
        const detail =
          extractErrorMessage(error) ||
          t("notifications.syncClaudePluginFailed", {
            defaultValue: "Failed to sync Claude plugin",
          });
        toast.error(detail, { duration: 4200 });
      }
    },
    [activeApp, t],
  );

  const addProvider = useCallback(
    async (
      provider: Omit<Provider, "id"> & {
        providerKey?: string;
        suggestedDefaults?: OpenClawSuggestedDefaults;
        addToLive?: boolean;
        ensureClaudeDesktopOfficialSeed?: boolean;
      },
    ) => {
      const enhanced = injectCodingPlanUsageScript(activeApp, provider);
      await addProviderMutation.mutateAsync(enhanced);

      // OpenClaw: register models to allowlist after adding provider
      if (activeApp === "openclaw" && provider.suggestedDefaults) {
        const { model, modelCatalog } = provider.suggestedDefaults;
        let modelsRegistered = false;

        try {
          // 1. Merge model catalog (allowlist)
          if (modelCatalog && Object.keys(modelCatalog).length > 0) {
            const existingCatalog = (await openclawApi.getModelCatalog()) || {};
            const mergedCatalog = { ...existingCatalog, ...modelCatalog };
            await openclawApi.setModelCatalog(mergedCatalog);
            await queryClient.invalidateQueries({
              queryKey: openclawKeys.health,
            });
            modelsRegistered = true;
          }

          // 2. Set default model (only if not already set)
          if (model) {
            const existingDefault = await openclawApi.getDefaultModel();
            if (!existingDefault?.primary) {
              await openclawApi.setDefaultModel(model);
              await queryClient.invalidateQueries({
                queryKey: openclawKeys.health,
              });
            }
          }

          // Show success toast if models were registered
          if (modelsRegistered) {
            toast.success(
              t("notifications.openclawModelsRegistered", {
                defaultValue: "Models have been registered to /model list",
              }),
              { closeButton: true },
            );
          }
        } catch (error) {
          // Log warning but don't block main flow - provider config is already saved
          console.warn(
            "[OpenClaw] Failed to register models to allowlist:",
            error,
          );
        }
      }
    },
    [addProviderMutation, activeApp, queryClient, t],
  );

  const updateProvider = useCallback(
    async (provider: Provider, originalId?: string) => {
      await updateProviderMutation.mutateAsync({ provider, originalId });

      try {
        await providersApi.updateTrayMenu();
      } catch (trayError) {
        console.error(
          "Failed to update tray menu after updating provider",
          trayError,
        );
      }
    },
    [updateProviderMutation],
  );

  const switchProvider = useCallback(
    async (provider: Provider) => {
      const isCopilotProvider =
        activeApp === "claude" &&
        provider.meta?.providerType === "github_copilot";
      const isCodexChatFormat =
        activeApp === "codex" &&
        (provider.meta?.apiFormat === "openai_chat" ||
          (typeof (provider.settingsConfig as Record<string, any>)?.config ===
            "string" &&
            isCodexChatWireApi(
              extractCodexWireApi(
                (provider.settingsConfig as Record<string, any>).config,
              ),
            )));

      // Determine why this provider requires the proxy
      let proxyRequiredReason: string | null = null;
      if (!isProxyRunning && provider.category !== "official") {
        if (isCopilotProvider) {
          proxyRequiredReason = t("notifications.proxyReasonCopilot", {
            defaultValue: "uses GitHub Copilot as a Claude provider",
          });
        } else if (
          provider.meta?.apiFormat === "openai_chat" &&
          activeApp === "claude"
        ) {
          proxyRequiredReason = t("notifications.proxyReasonOpenAIChat", {
            defaultValue: "uses OpenAI Chat API format",
          });
        } else if (
          provider.meta?.apiFormat === "openai_responses" &&
          activeApp === "claude"
        ) {
          proxyRequiredReason = t("notifications.proxyReasonOpenAIResponses", {
            defaultValue: "uses OpenAI Responses API format",
          });
        } else if (isCodexChatFormat) {
          proxyRequiredReason = t("notifications.proxyReasonOpenAIChat", {
            defaultValue: "uses OpenAI Chat API format",
          });
        } else if (
          activeApp === "claude-desktop" &&
          provider.meta?.claudeDesktopMode === "proxy"
        ) {
          proxyRequiredReason = t("notifications.proxyReasonClaudeDesktop", {
            defaultValue: "Using Claude Desktop local routing mode",
          });
        } else if (
          provider.meta?.isFullUrl &&
          (activeApp === "claude" || activeApp === "codex")
        ) {
          proxyRequiredReason = t("notifications.proxyReasonFullUrl", {
            defaultValue: "has full URL connection mode enabled",
          });
        }
      }

      if (proxyRequiredReason) {
        toast.warning(
          t("notifications.proxyRequiredForSwitch", {
            reason: proxyRequiredReason,
            defaultValue:
              "This provider {{reason}}, requires the routing service to work properly. Start routing first.",
          }),
        );
      }

      // Block official providers when proxy takeover is active
      if (isProxyTakeover && provider.category === "official") {
        toast.error(
          t("notifications.officialBlockedByProxy", {
            defaultValue:
              "Cannot switch to official provider while local routing is active. Using routing with official APIs may cause account bans.",
          }),
          { duration: 6000 },
        );
        return;
      }

      try {
        const result = await switchProviderMutation.mutateAsync(provider.id);
        await syncClaudePlugin(provider);

        // Show backfill warning if present
        if (result?.warnings?.length) {
          toast.warning(
            t("notifications.backfillWarning", {
              defaultValue:
                "Switched successfully, but failed to save changes back to the previous provider",
            }),
            { duration: 5000 },
          );
        }

        if (!proxyRequiredReason) {
          let messageKey = "notifications.switchSuccess";
          let defaultMessage = "Switch successful!";
          if (activeApp === "codex") {
            messageKey = "notifications.codexRestartRequired";
            defaultMessage =
              "Switch successful, please restart the client for changes to take effect";
          } else if (activeApp === "claude-desktop") {
            if (provider.meta?.claudeDesktopMode === "proxy") {
              messageKey = "notifications.claudeDesktopProxyRestartRequired";
              defaultMessage =
                "Switch successful, please keep Agent Switchboard running and restart Claude Desktop for changes to take effect";
            } else {
              messageKey = "notifications.claudeDesktopRestartRequired";
              defaultMessage =
                "Switch successful, restart Claude Desktop for changes to take effect";
            }
          } else if (activeApp === "opencode" || activeApp === "openclaw") {
            messageKey = "notifications.addToConfigSuccess";
            defaultMessage = "Added to configuration";
          }
          toast.success(t(messageKey, { defaultValue: defaultMessage }), {
            closeButton: true,
          });
        }
      } catch {}
    },
    [
      switchProviderMutation,
      syncClaudePlugin,
      activeApp,
      isProxyRunning,
      isProxyTakeover,
      t,
    ],
  );

  const deleteProvider = useCallback(
    async (id: string) => {
      await deleteProviderMutation.mutateAsync(id);
    },
    [deleteProviderMutation],
  );

  const saveUsageScript = useCallback(
    async (provider: Provider, script: UsageScript) => {
      try {
        const updatedProvider: Provider = {
          ...provider,
          meta: {
            ...provider.meta,
            usage_script: script,
          },
        };

        await providersApi.update(updatedProvider, activeApp);
        await queryClient.invalidateQueries({
          queryKey: ["providers", activeApp],
        });
        await queryClient.invalidateQueries({
          queryKey: ["usage", provider.id, activeApp],
        });
        await queryClient.invalidateQueries({
          queryKey: ["subscription", "quota", activeApp],
        });
        toast.success(
          t("provider.usageSaved", {
            defaultValue: "Usage query configuration saved",
          }),
          { closeButton: true },
        );
      } catch (error) {
        const detail =
          extractErrorMessage(error) ||
          t("provider.usageSaveFailed", {
            defaultValue: "Failed to save usage query configuration",
          });
        toast.error(detail);
      }
    },
    [activeApp, queryClient, t],
  );

  // Set provider as default model (OpenClaw only)
  const setAsDefaultModel = useCallback(
    async (provider: Provider) => {
      const config = provider.settingsConfig as OpenClawProviderConfig;
      if (!config.models || config.models.length === 0) {
        toast.error(
          t("notifications.openclawNoModels", {
            defaultValue: "No models configured",
          }),
        );
        return;
      }

      const model: OpenClawDefaultModel = {
        primary: `${provider.id}/${config.models[0].id}`,
        fallbacks: config.models.slice(1).map((m) => `${provider.id}/${m.id}`),
      };

      try {
        await openclawApi.setDefaultModel(model);
        await queryClient.invalidateQueries({
          queryKey: openclawKeys.defaultModel,
        });
        await queryClient.invalidateQueries({
          queryKey: openclawKeys.health,
        });
        toast.success(
          t("notifications.openclawDefaultModelSet", {
            defaultValue: "Set as default model",
          }),
          { closeButton: true },
        );
      } catch (error) {
        const detail =
          extractErrorMessage(error) ||
          t("notifications.openclawDefaultModelSetFailed", {
            defaultValue: "Failed to set default model",
          });
        toast.error(detail);
      }
    },
    [queryClient, t],
  );

  return {
    addProvider,
    updateProvider,
    switchProvider,
    deleteProvider,
    saveUsageScript,
    setAsDefaultModel,
    isLoading:
      addProviderMutation.isPending ||
      updateProviderMutation.isPending ||
      deleteProviderMutation.isPending ||
      switchProviderMutation.isPending,
  };
}
