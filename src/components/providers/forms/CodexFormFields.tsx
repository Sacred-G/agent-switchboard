import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import EndpointSpeedTest from "./EndpointSpeedTest";
import { ApiKeySection, EndpointField, ModelDropdown } from "./shared";
import {
  fetchModelsForConfig,
  showFetchModelsError,
  type FetchedModel,
} from "@/lib/api/model-fetch";
import { CustomUserAgentField } from "./CustomUserAgentField";
import { LocalProxyRequestOverridesField } from "./LocalProxyRequestOverridesField";
import { cn } from "@/lib/utils";
import type {
  CodexApiFormat,
  CodexCatalogModel,
  CodexChatReasoning,
  ProviderCategory,
} from "@/types";

interface EndpointCandidate {
  url: string;
}

interface CodexFormFieldsProps {
  providerId?: string;
  // API Key
  codexApiKey: string;
  onApiKeyChange: (key: string) => void;
  category?: ProviderCategory;
  shouldShowApiKeyLink: boolean;
  websiteUrl: string;
  isPartner?: boolean;
  partnerPromotionKey?: string;

  // Base URL
  shouldShowSpeedTest: boolean;
  codexBaseUrl: string;
  onBaseUrlChange: (url: string) => void;
  isFullUrl: boolean;
  onFullUrlChange: (value: boolean) => void;
  isEndpointModalOpen: boolean;
  onEndpointModalToggle: (open: boolean) => void;
  onCustomEndpointsChange?: (endpoints: string[]) => void;
  autoSelect: boolean;
  onAutoSelectChange: (checked: boolean) => void;

  // Local routing / takeover
  // takeoverEnabled gates model mapping + reasoning visibility; it is decoupled
  // from the wire format so a native Responses provider can use model mapping
  // without Chat Completions conversion.
  takeoverEnabled: boolean;
  onTakeoverEnabledChange: (enabled: boolean) => void;

  // API Format
  // Note: wire_api is always "responses" for Codex; apiFormat controls proxy-layer conversion
  apiFormat: CodexApiFormat;
  onApiFormatChange: (format: CodexApiFormat) => void;
  codexChatReasoning?: CodexChatReasoning;
  onCodexChatReasoningChange?: (value: CodexChatReasoning) => void;

  // Model Catalog
  catalogModels?: CodexCatalogModel[];
  onCatalogModelsChange?: (models: CodexCatalogModel[]) => void;

  // Speed Test Endpoints
  speedTestEndpoints: EndpointCandidate[];

  // Local proxy User-Agent override
  customUserAgent: string;
  onCustomUserAgentChange: (value: string) => void;
  localProxyHeadersOverride: string;
  onLocalProxyHeadersOverrideChange: (value: string) => void;
  localProxyBodyOverride: string;
  onLocalProxyBodyOverrideChange: (value: string) => void;
}

type CodexCatalogRow = CodexCatalogModel & { rowId: string };

function createCatalogRow(seed?: Partial<CodexCatalogModel>): CodexCatalogRow {
  return {
    rowId: crypto.randomUUID(),
    model: seed?.model ?? "",
    displayName: seed?.displayName ?? "",
    contextWindow: seed?.contextWindow ?? "",
  };
}

// Compares rows (with rowId) to incoming models (without) by data fields only,
// so both sync effects can use the same equality definition.
function catalogRowsMatchModels(
  rows: Array<Pick<CodexCatalogRow, "model" | "displayName" | "contextWindow">>,
  models: CodexCatalogModel[],
): boolean {
  if (rows.length !== models.length) return false;
  return rows.every((row, i) => {
    const incoming = models[i];
    return (
      row.model === (incoming.model ?? "") &&
      (row.displayName ?? "") === (incoming.displayName ?? "") &&
      String(row.contextWindow ?? "") === String(incoming.contextWindow ?? "")
    );
  });
}

export function CodexFormFields({
  providerId,
  codexApiKey,
  onApiKeyChange,
  category,
  shouldShowApiKeyLink,
  websiteUrl,
  isPartner,
  partnerPromotionKey,
  shouldShowSpeedTest,
  codexBaseUrl,
  onBaseUrlChange,
  isFullUrl,
  onFullUrlChange,
  isEndpointModalOpen,
  onEndpointModalToggle,
  onCustomEndpointsChange,
  autoSelect,
  onAutoSelectChange,
  takeoverEnabled,
  onTakeoverEnabledChange,
  apiFormat,
  onApiFormatChange,
  codexChatReasoning = {},
  onCodexChatReasoningChange,
  catalogModels = [],
  onCatalogModelsChange,
  speedTestEndpoints,
  customUserAgent,
  onCustomUserAgentChange,
  localProxyHeadersOverride,
  onLocalProxyHeadersOverrideChange,
  localProxyBodyOverride,
  onLocalProxyBodyOverrideChange,
}: CodexFormFieldsProps) {
  const { t } = useTranslation();

  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const isChatFormat = apiFormat === "openai_chat";
  const canEditCatalog = Boolean(onCatalogModelsChange);
  const canEditReasoning = Boolean(onCodexChatReasoningChange);
  const supportsThinking =
    codexChatReasoning.supportsThinking === true ||
    codexChatReasoning.supportsEffort === true;
  const supportsEffort = codexChatReasoning.supportsEffort === true;

  const hasRequestOverrides = Boolean(
    localProxyHeadersOverride.trim() || localProxyBodyOverride.trim(),
  );
  const hasAnyAdvancedValue =
    !!customUserAgent || hasRequestOverrides || takeoverEnabled;
  const [advancedExpanded, setAdvancedExpanded] = useState(hasAnyAdvancedValue);

  useEffect(() => {
    if (hasAnyAdvancedValue) {
      setAdvancedExpanded(true);
    }
  }, [hasAnyAdvancedValue]);

  const [catalogRows, setCatalogRows] = useState<CodexCatalogRow[]>(() =>
    catalogModels.map((m) => createCatalogRow(m)),
  );

  const lastSentModelsRef = useRef<CodexCatalogModel[]>(catalogModels);

  useEffect(() => {
    setCatalogRows((current) => {
      if (catalogRowsMatchModels(current, catalogModels)) return current;
      return catalogModels.map((m) => createCatalogRow(m));
    });
    lastSentModelsRef.current = catalogModels;
  }, [catalogModels]);

  useEffect(() => {
    if (!onCatalogModelsChange) return;
    const next: CodexCatalogModel[] = catalogRows.map(
      ({ rowId: _rowId, ...rest }) => rest,
    );
    if (catalogRowsMatchModels(catalogRows, lastSentModelsRef.current)) return;
    lastSentModelsRef.current = next;
    onCatalogModelsChange(next);
  }, [catalogRows, onCatalogModelsChange]);

  const handleReasoningThinkingChange = useCallback(
    (checked: boolean) => {
      if (!onCodexChatReasoningChange) return;
      onCodexChatReasoningChange({
        ...codexChatReasoning,
        supportsThinking: checked,
        supportsEffort: checked ? codexChatReasoning.supportsEffort : false,
      });
    },
    [codexChatReasoning, onCodexChatReasoningChange],
  );

  const handleReasoningEffortChange = useCallback(
    (checked: boolean) => {
      if (!onCodexChatReasoningChange) return;
      onCodexChatReasoningChange({
        ...codexChatReasoning,
        supportsThinking: checked ? true : codexChatReasoning.supportsThinking,
        supportsEffort: checked,
        effortParam: checked
          ? (codexChatReasoning.effortParam ?? "reasoning_effort")
          : "none",
      });
    },
    [codexChatReasoning, onCodexChatReasoningChange],
  );

  const handleFetchModels = useCallback(() => {
    if (!codexBaseUrl || !codexApiKey) {
      showFetchModelsError(null, t, {
        hasApiKey: !!codexApiKey,
        hasBaseUrl: !!codexBaseUrl,
      });
      return;
    }
    setIsFetchingModels(true);
    fetchModelsForConfig(
      codexBaseUrl,
      codexApiKey,
      isFullUrl,
      undefined,
      customUserAgent,
    )
      .then((models) => {
        setFetchedModels(models);
        if (models.length === 0) {
          toast.info(t("providerForm.fetchModelsEmpty"));
        } else {
          toast.success(
            t("providerForm.fetchModelsSuccess", { count: models.length }),
          );
        }
      })
      .catch((err) => {
        console.warn("[ModelFetch] Failed:", err);
        showFetchModelsError(err, t);
      })
      .finally(() => setIsFetchingModels(false));
  }, [codexBaseUrl, codexApiKey, isFullUrl, customUserAgent, t]);

  const handleAddCatalogRow = useCallback(() => {
    if (!onCatalogModelsChange) return;
    setCatalogRows((current) => [...current, createCatalogRow()]);
  }, [onCatalogModelsChange]);

  const handleUpdateCatalogRow = useCallback(
    (index: number, patch: Partial<CodexCatalogModel>) => {
      setCatalogRows((current) =>
        current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
      );
    },
    [],
  );

  const handleRemoveCatalogRow = useCallback((index: number) => {
    setCatalogRows((current) => current.filter((_, i) => i !== index));
  }, []);

  const renderCatalogActionButtons = (onAdd: () => void, addLabel: string) => (
    <div className="flex gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleFetchModels}
        disabled={isFetchingModels}
        className="h-7 gap-1"
      >
        {isFetchingModels ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        {t("providerForm.fetchModels")}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAdd}
        className="h-7 gap-1"
      >
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </Button>
    </div>
  );

  return (
    <>
      {}
      <ApiKeySection
        id="codexApiKey"
        label="API Key"
        value={codexApiKey}
        onChange={onApiKeyChange}
        category={category}
        shouldShowLink={shouldShowApiKeyLink}
        websiteUrl={websiteUrl}
        isPartner={isPartner}
        partnerPromotionKey={partnerPromotionKey}
        placeholder={{
          official: t("providerForm.codexOfficialNoApiKey", {
            defaultValue: "Official does not require API Key, save directly",
          }),
          thirdParty: t("providerForm.codexApiKeyAutoFill", {
            defaultValue:
              "Just fill in here, auth.json below will be auto-filled",
          }),
        }}
      />

      {}
      {shouldShowSpeedTest && (
        <EndpointField
          id="codexBaseUrl"
          label={t("codexConfig.apiUrlLabel")}
          value={codexBaseUrl}
          onChange={onBaseUrlChange}
          placeholder={t("providerForm.codexApiEndpointPlaceholder")}
          hint={t("providerForm.codexApiHint")}
          showFullUrlToggle
          isFullUrl={isFullUrl}
          onFullUrlChange={onFullUrlChange}
          onManageClick={() => onEndpointModalToggle(true)}
        />
      )}

      {}
      {category !== "official" && (
        <Collapsible
          open={advancedExpanded}
          onOpenChange={setAdvancedExpanded}
          className="rounded-lg border border-border-default p-4"
        >
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant={null}
              size="sm"
              className="h-8 w-full justify-start gap-1.5 px-0 text-sm font-medium text-foreground hover:opacity-70"
            >
              {advancedExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              {t("providerForm.advancedOptionsToggle", {
                defaultValue: "Advanced Options",
              })}
            </Button>
          </CollapsibleTrigger>
          {!advancedExpanded && (
            <p className="mt-1 ml-1 text-xs text-muted-foreground">
              {t("codexConfig.advancedSectionHint", {
                defaultValue:
                  "Includes local routing, upstream format, model mapping, reasoning overrides and custom User-Agent. Enable local routing here when your provider uses the Chat Completions protocol or non-GPT models.",
              })}
            </p>
          )}
          <CollapsibleContent className="space-y-3 pt-3">
            {}
            {shouldShowSpeedTest && (
              <div className="space-y-3">
                {}
                <div className="space-y-1.5">
                  <FormLabel htmlFor="codex-upstream-format">
                    {t("codexConfig.upstreamFormatLabel", {
                      defaultValue: "Upstream Format",
                    })}
                  </FormLabel>
                  <Select
                    value={apiFormat}
                    onValueChange={(value) =>
                      onApiFormatChange(value as CodexApiFormat)
                    }
                  >
                    <SelectTrigger
                      id="codex-upstream-format"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai_chat">
                        {t("codexConfig.upstreamFormatChat", {
                          defaultValue: "Chat Completions (convert)",
                        })}
                      </SelectItem>
                      <SelectItem value="openai_responses">
                        {t("codexConfig.upstreamFormatResponses", {
                          defaultValue: "Responses (native)",
                        })}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("codexConfig.upstreamFormatHint", {
                      defaultValue:
                        "Pick Responses when your provider is natively a Responses API (direct, no format conversion); pick Chat when it uses the Chat Completions protocol (converts to Chat Completions).",
                    })}
                  </p>
                </div>

                {}
                <div className="flex items-center justify-between gap-4 border-t border-border-default pt-3">
                  <div className="space-y-1">
                    <FormLabel>
                      {t("codexConfig.localRoutingToggle", {
                        defaultValue: "Needs Local Routing",
                      })}
                    </FormLabel>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {takeoverEnabled
                        ? t("codexConfig.localRoutingOnHint", {
                            defaultValue:
                              "When on, configure model mapping below: show custom model names in Codex's /model menu and map requests to the real upstream model.",
                          })
                        : t("codexConfig.localRoutingOffHint", {
                            defaultValue:
                              "Keep off when the provider's model names need no rewriting and you don't need custom names shown in the /model menu; enable it when you need model mapping.",
                          })}
                    </p>
                  </div>
                  <Switch
                    checked={takeoverEnabled}
                    onCheckedChange={onTakeoverEnabledChange}
                    aria-label={t("codexConfig.localRoutingToggle", {
                      defaultValue: "Needs Local Routing",
                    })}
                  />
                </div>
              </div>
            )}

            {takeoverEnabled && isChatFormat && canEditReasoning && (
              <div
                className={cn(
                  "space-y-3",
                  shouldShowSpeedTest && "border-t border-border-default pt-3",
                )}
              >
                <div className="space-y-1">
                  <FormLabel>
                    {t("codexConfig.reasoningGroupTitle", {
                      defaultValue: "Reasoning Capability",
                    })}
                  </FormLabel>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("codexConfig.reasoningSectionHint", {
                      defaultValue:
                        "Preset providers are configured automatically; custom providers are inferred from name/URL. Override manually only when auto-detection is wrong.",
                    })}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <FormLabel>
                      {t("codexConfig.reasoningModeToggle", {
                        defaultValue: "Supports Thinking Mode",
                      })}
                    </FormLabel>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {t("codexConfig.reasoningModeHint", {
                        defaultValue:
                          "Enable when the upstream Chat Completions API supports toggling thinking on/off. Providers like Kimi, GLM and Qwen usually fall into this category.",
                      })}
                    </p>
                  </div>
                  <Switch
                    checked={supportsThinking}
                    onCheckedChange={handleReasoningThinkingChange}
                    aria-label={t("codexConfig.reasoningModeToggle", {
                      defaultValue: "Supports Thinking Mode",
                    })}
                  />
                </div>

                <div className="flex items-center justify-between gap-4 border-t border-border-default pt-3">
                  <div className="space-y-1">
                    <FormLabel>
                      {t("codexConfig.reasoningEffortToggle", {
                        defaultValue: "Supports Reasoning Effort",
                      })}
                    </FormLabel>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {t("codexConfig.reasoningEffortHint", {
                        defaultValue:
                          "Enable when the upstream supports thinking-depth control such as low/high/max. Enabling this also turns on thinking mode and converts Codex's reasoning.effort into the upstream Chat parameter.",
                      })}
                    </p>
                  </div>
                  <Switch
                    checked={supportsEffort}
                    onCheckedChange={handleReasoningEffortChange}
                    aria-label={t("codexConfig.reasoningEffortToggle", {
                      defaultValue: "Supports Reasoning Effort",
                    })}
                  />
                </div>
              </div>
            )}

            <div
              className={cn(
                "space-y-3",
                (shouldShowSpeedTest ||
                  (takeoverEnabled && isChatFormat && canEditReasoning)) &&
                  "border-t border-border-default pt-3",
              )}
            >
              <CustomUserAgentField
                id="codex-custom-user-agent"
                value={customUserAgent}
                onChange={onCustomUserAgentChange}
              />
              <div className="border-t border-border-default pt-3">
                <LocalProxyRequestOverridesField
                  headersJson={localProxyHeadersOverride}
                  bodyJson={localProxyBodyOverride}
                  onHeadersJsonChange={onLocalProxyHeadersOverrideChange}
                  onBodyJsonChange={onLocalProxyBodyOverrideChange}
                />
              </div>
            </div>

            {}
            {takeoverEnabled && canEditCatalog && (
              <div className="space-y-4 border-t border-border-default pt-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <FormLabel>
                      {t("codexConfig.modelMappingTitle", {
                        defaultValue: "Model Mapping",
                      })}
                    </FormLabel>
                    {renderCatalogActionButtons(
                      handleAddCatalogRow,
                      t("codexConfig.addCatalogModel", {
                        defaultValue: "Add Model",
                      }),
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("codexConfig.modelMappingHint", {
                      defaultValue:
                        "Generates Codex model_catalog_json so /model can show these third-party model names; entries are saved exactly as listed. Codex must be restarted to refresh the model list after changes.",
                    })}
                  </p>
                </div>

                {catalogRows.length > 0 && (
                  <div className="space-y-2">
                    {}
                    <div className="hidden grid-cols-[1fr_1fr_140px_36px] gap-2 px-1 text-xs font-medium text-muted-foreground md:grid">
                      <span>
                        {t("codexConfig.catalogColumnDisplay", {
                          defaultValue: "Menu Display Name",
                        })}
                      </span>
                      <span>
                        {t("codexConfig.catalogColumnModel", {
                          defaultValue: "Actual Request Model",
                        })}
                      </span>
                      <span>
                        {t("codexConfig.catalogColumnContext", {
                          defaultValue: "Context Window",
                        })}
                      </span>
                      <span />
                    </div>

                    {catalogRows.map((row, index) => (
                      <div
                        key={row.rowId}
                        className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_140px_36px]"
                      >
                        <Input
                          value={row.displayName ?? ""}
                          onChange={(event) =>
                            handleUpdateCatalogRow(index, {
                              displayName: event.target.value,
                            })
                          }
                          placeholder={t(
                            "codexConfig.catalogDisplayNamePlaceholder",
                            {
                              defaultValue: "e.g., DeepSeek V4 Flash",
                            },
                          )}
                          aria-label={t("codexConfig.catalogColumnDisplay", {
                            defaultValue: "e.g., DeepSeek V4 Flash",
                          })}
                        />
                        <div className="flex gap-1">
                          <Input
                            value={row.model}
                            onChange={(event) =>
                              handleUpdateCatalogRow(index, {
                                model: event.target.value,
                              })
                            }
                            placeholder={t(
                              "codexConfig.catalogModelPlaceholder",
                              {
                                defaultValue: "e.g., deepseek-v4-flash",
                              },
                            )}
                            aria-label={t("codexConfig.catalogColumnModel", {
                              defaultValue: "e.g., deepseek-v4-flash",
                            })}
                            className="flex-1"
                          />
                          {fetchedModels.length > 0 && (
                            <ModelDropdown
                              models={fetchedModels}
                              onSelect={(id) =>
                                handleUpdateCatalogRow(index, {
                                  model: id,
                                  displayName: row.displayName?.trim()
                                    ? row.displayName
                                    : id,
                                })
                              }
                            />
                          )}
                        </div>
                        <Input
                          type="number"
                          min={1}
                          inputMode="numeric"
                          value={row.contextWindow ?? ""}
                          onChange={(event) =>
                            handleUpdateCatalogRow(index, {
                              contextWindow: event.target.value.replace(
                                /[^\d]/g,
                                "",
                              ),
                            })
                          }
                          placeholder={t(
                            "codexConfig.contextWindowPlaceholder",
                            {
                              defaultValue: "e.g., 128000",
                            },
                          )}
                          aria-label={t("codexConfig.catalogColumnContext", {
                            defaultValue: "e.g., 128000",
                          })}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveCatalogRow(index)}
                          title={t("common.delete", { defaultValue: "Delete" })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}

      {}
      {shouldShowSpeedTest && isEndpointModalOpen && (
        <EndpointSpeedTest
          appId="codex"
          providerId={providerId}
          value={codexBaseUrl}
          onChange={onBaseUrlChange}
          initialEndpoints={speedTestEndpoints}
          visible={isEndpointModalOpen}
          onClose={() => onEndpointModalToggle(false)}
          autoSelect={autoSelect}
          onAutoSelectChange={onAutoSelectChange}
          onCustomEndpointsChange={onCustomEndpointsChange}
        />
      )}
    </>
  );
}
