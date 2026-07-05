import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRequestDetail } from "@/lib/query/usage";
import { getFreshInputTokens, isUnpricedUsage } from "@/types/usage";

interface RequestDetailPanelProps {
  requestId: string;
  onClose: () => void;
}

export function RequestDetailPanel({
  requestId,
  onClose,
}: RequestDetailPanelProps) {
  const { t, i18n } = useTranslation();
  const { data: request, isLoading } = useRequestDetail(requestId);
  const dateLocale =
    i18n.language === "zh"
      ? "zh-CN"
      : i18n.language === "zh-TW"
        ? "zh-TW"
        : i18n.language === "ja"
          ? "ja-JP"
          : "en-US";

  if (isLoading) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-2xl">
          <div className="h-[400px] animate-pulse rounded bg-gray-100" />
        </DialogContent>
      </Dialog>
    );
  }

  if (!request) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("usage.requestDetail", "Request Detail")}
            </DialogTitle>
          </DialogHeader>
          <div className="text-center text-muted-foreground">
            {t("usage.requestNotFound", "Request not found")}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const freshInput = getFreshInputTokens(request);
  const isCacheInclusive = request.inputTokens !== freshInput;
  const unpriced = isUnpricedUsage(request);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("usage.requestDetail", "Request Detail")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {}
          <div className="rounded-lg border p-4">
            <h3 className="mb-3 font-semibold">
              {t("usage.basicInfo", "Basic Info")}
            </h3>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">
                  {t("usage.requestId", "Request ID")}
                </dt>
                <dd className="font-mono">{request.requestId}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t("usage.time", "Time")}
                </dt>
                <dd>
                  {new Date(request.createdAt * 1000).toLocaleString(
                    dateLocale,
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t("usage.provider", "Provider")}
                </dt>
                <dd className="text-sm">
                  <span className="font-medium">
                    {request.providerName ||
                      t("usage.unknownProvider", "Unknown Provider")}
                  </span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {request.providerId}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t("usage.appType", "App Type")}
                </dt>
                <dd>{request.appType}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t("usage.model", "Model")}
                </dt>
                <dd className="font-mono">{request.model}</dd>
                {request.requestModel &&
                  request.requestModel !== request.model && (
                    <>
                      <dt className="mt-1 text-muted-foreground">
                        {t("usage.requestModel", "Request Model")}
                      </dt>
                      <dd className="font-mono text-xs">
                        {request.requestModel}
                      </dd>
                    </>
                  )}
                {request.pricingModel &&
                  request.pricingModel !== request.model && (
                    <>
                      <dt className="mt-1 text-muted-foreground">
                        {t("usage.pricingModel", "Pricing Model")}
                      </dt>
                      <dd className="font-mono text-xs">
                        {request.pricingModel}
                      </dd>
                    </>
                  )}
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t("usage.status", "Status")}
                </dt>
                <dd>
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs ${
                      request.statusCode >= 200 && request.statusCode < 300
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {request.statusCode}
                  </span>
                </dd>
              </div>
            </dl>
          </div>

          {}
          <div className="rounded-lg border p-4">
            <h3 className="mb-3 font-semibold">
              {t("usage.tokenUsage", "Token Usage")}
            </h3>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">
                  {t("usage.inputTokens", "Input")}
                </dt>
                <dd className="font-mono">
                  {freshInput.toLocaleString()}
                  {isCacheInclusive && (
                    <span className="ml-2 text-xs text-muted-foreground/70 font-normal">
                      ({t("usage.rawInputLabel", "Raw")}:{" "}
                      {request.inputTokens.toLocaleString()})
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t("usage.outputTokens", "Output")}
                </dt>
                <dd className="font-mono">
                  {request.outputTokens.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t("usage.cacheReadTokens", "Cache Hit")}
                </dt>
                <dd className="font-mono">
                  {request.cacheReadTokens.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t("usage.cacheCreationTokens", "Cache Creation")}
                </dt>
                <dd className="font-mono">
                  {request.cacheCreationTokens.toLocaleString()}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">
                  {t("usage.totalTokens", "New Tokens (Input+Output)")}
                </dt>
                <dd className="text-lg font-semibold">
                  {(freshInput + request.outputTokens).toLocaleString()}
                </dd>
              </div>
            </dl>
          </div>

          {}
          <div className="rounded-lg border p-4">
            <h3 className="mb-3 font-semibold">
              {t("usage.costBreakdown", "Cost Breakdown")}
            </h3>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">
                  {t("usage.inputCost", "Input Cost")}
                  <span className="ml-1 text-xs">
                    ({t("usage.baseCost", "Base")})
                  </span>
                </dt>
                <dd className="font-mono">
                  ${parseFloat(request.inputCostUsd).toFixed(6)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t("usage.outputCost", "Output Cost")}
                  <span className="ml-1 text-xs">
                    ({t("usage.baseCost", "Base")})
                  </span>
                </dt>
                <dd className="font-mono">
                  ${parseFloat(request.outputCostUsd).toFixed(6)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t("usage.cacheReadCost", "Cache Hit")}
                  <span className="ml-1 text-xs">
                    ({t("usage.baseCost", "Base")})
                  </span>
                </dt>
                <dd className="font-mono">
                  ${parseFloat(request.cacheReadCostUsd).toFixed(6)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {t("usage.cacheCreationCost", "Cache Creation Cost")}
                  <span className="ml-1 text-xs">
                    ({t("usage.baseCost", "Base")})
                  </span>
                </dt>
                <dd className="font-mono">
                  ${parseFloat(request.cacheCreationCostUsd).toFixed(6)}
                </dd>
              </div>
              {}
              {request.costMultiplier &&
                parseFloat(request.costMultiplier) !== 1 && (
                  <div className="col-span-2 border-t pt-3">
                    <dt className="text-muted-foreground">
                      {t("usage.costMultiplier", "Cost Multiplier")}
                    </dt>
                    <dd className="font-mono">×{request.costMultiplier}</dd>
                  </div>
                )}
              <div
                className={`col-span-2 ${request.costMultiplier && parseFloat(request.costMultiplier) !== 1 ? "" : "border-t"} pt-3`}
              >
                <dt className="text-muted-foreground">
                  {t("usage.totalCost", "Total Cost")}
                  {request.costMultiplier &&
                    parseFloat(request.costMultiplier) !== 1 && (
                      <span className="ml-1 text-xs">
                        ({t("usage.withMultiplier", "with multiplier")})
                      </span>
                    )}
                </dt>
                <dd
                  className={`text-lg font-semibold ${
                    unpriced ? "text-muted-foreground" : "text-primary"
                  }`}
                >
                  {unpriced
                    ? t("usage.unpriced", "Unpriced")
                    : `$${parseFloat(request.totalCostUsd).toFixed(6)}`}
                </dd>
              </div>
            </dl>
          </div>

          {}
          <div className="rounded-lg border p-4">
            <h3 className="mb-3 font-semibold">
              {t("usage.performance", "Performance")}
            </h3>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">
                  {t("usage.latency", "Latency")}
                </dt>
                <dd className="font-mono">{request.latencyMs}ms</dd>
              </div>
            </dl>
          </div>

          {}
          {request.errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <h3 className="mb-2 font-semibold text-red-800">
                {t("usage.errorMessage", "Error Message")}
              </h3>
              <p className="text-sm text-red-700">{request.errorMessage}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
