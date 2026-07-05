import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2, Loader2, Info, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { FailoverQueueItem } from "@/types/proxy";
import type { AppId } from "@/lib/api";
import {
  useFailoverQueue,
  useAvailableProvidersForFailover,
  useAddToFailoverQueue,
  useRemoveFromFailoverQueue,
  useAutoFailoverEnabled,
  useSetAutoFailoverEnabled,
} from "@/lib/query/failover";

interface FailoverQueueManagerProps {
  appType: AppId;
  disabled?: boolean;
}

export function FailoverQueueManager({
  appType,
  disabled = false,
}: FailoverQueueManagerProps) {
  const { t } = useTranslation();
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");

  const { data: isFailoverEnabled = false } = useAutoFailoverEnabled(appType);
  const setFailoverEnabled = useSetAutoFailoverEnabled();

  const {
    data: queue,
    isLoading: isQueueLoading,
    error: queueError,
  } = useFailoverQueue(appType);
  const { data: availableProviders, isLoading: isProvidersLoading } =
    useAvailableProvidersForFailover(appType);

  // Mutations
  const addToQueue = useAddToFailoverQueue();
  const removeFromQueue = useRemoveFromFailoverQueue();

  const handleToggleFailover = (enabled: boolean) => {
    setFailoverEnabled.mutate({ appType, enabled });
  };

  const handleAddProvider = async () => {
    if (!selectedProviderId) return;

    try {
      await addToQueue.mutateAsync({
        appType,
        providerId: selectedProviderId,
      });
      setSelectedProviderId("");
      toast.success(
        t("proxy.failoverQueue.addSuccess", "Added to failover queue"),
        { closeButton: true },
      );
    } catch (error) {
      toast.error(
        t("proxy.failoverQueue.addFailed", "Failed to add") +
          ": " +
          String(error),
      );
    }
  };

  const handleRemoveProvider = async (providerId: string) => {
    try {
      await removeFromQueue.mutateAsync({ appType, providerId });
      toast.success(
        t("proxy.failoverQueue.removeSuccess", "Removed from failover queue"),
        { closeButton: true },
      );
    } catch (error) {
      toast.error(
        t("proxy.failoverQueue.removeFailed", "Failed to remove") +
          ": " +
          String(error),
      );
    }
  };

  if (isQueueLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (queueError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>{String(queueError)}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {}
      <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border border-border/50">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {t("proxy.failover.autoSwitch", {
                defaultValue: "Auto Failover",
              })}
            </span>
            {isFailoverEnabled && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                {t("common.enabled", { defaultValue: "Enabled" })}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("proxy.failover.autoSwitchDescription", {
              defaultValue:
                "When enabled, switches to queue P1 immediately and automatically tries the next provider in the queue on failures",
            })}
          </p>
        </div>
        <Switch
          checked={isFailoverEnabled}
          onCheckedChange={handleToggleFailover}
          disabled={disabled || setFailoverEnabled.isPending}
        />
      </div>

      {}
      <Alert className="border-blue-500/40 bg-blue-500/10">
        <Info className="h-4 w-4" />
        <AlertDescription className="text-sm">
          {t(
            "proxy.failoverQueue.info",
            "The queue order is consistent with the provider list order on the homepage. When a request fails, the system will try the providers in the queue in order.",
          )}
        </AlertDescription>
      </Alert>

      {}
      <div className="flex items-center gap-2">
        <Select
          value={selectedProviderId}
          onValueChange={setSelectedProviderId}
          disabled={disabled || isProvidersLoading}
        >
          <SelectTrigger className="flex-1">
            <SelectValue
              placeholder={t(
                "proxy.failoverQueue.selectProvider",
                "Select provider to add to queue",
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {availableProviders?.map((provider) => (
              <SelectItem key={provider.id} value={provider.id}>
                {provider.name}
                {provider.notes && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({provider.notes})
                  </span>
                )}
              </SelectItem>
            ))}
            {(!availableProviders || availableProviders.length === 0) && (
              <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                {t(
                  "proxy.failoverQueue.noAvailableProviders",
                  "No providers available to add",
                )}
              </div>
            )}
          </SelectContent>
        </Select>
        <Button
          onClick={handleAddProvider}
          disabled={disabled || !selectedProviderId || addToQueue.isPending}
          size="icon"
          variant="outline"
        >
          {addToQueue.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
        </Button>
      </div>

      {}
      {!queue || queue.length === 0 ? (
        <div className="rounded-lg border border-dashed border-muted-foreground/40 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {t(
              "proxy.failoverQueue.empty",
              "Failover queue is empty. Add providers to enable auto-failover.",
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {queue.map((item, index) => (
            <QueueItem
              key={item.providerId}
              item={item}
              index={index}
              disabled={disabled}
              onRemove={handleRemoveProvider}
              isRemoving={removeFromQueue.isPending}
            />
          ))}
        </div>
      )}

      {}
      {queue && queue.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t(
            "proxy.failoverQueue.orderHint",
            "The queue order is consistent with the homepage provider list order, drag to adjust the order on the homepage.",
          )}
        </p>
      )}
    </div>
  );
}

interface QueueItemProps {
  item: FailoverQueueItem;
  index: number;
  disabled: boolean;
  onRemove: (providerId: string) => void;
  isRemoving: boolean;
}

function QueueItem({
  item,
  index,
  disabled,
  onRemove,
  isRemoving,
}: QueueItemProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors",
      )}
    >
      {}
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
        {index + 1}
      </div>

      {}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate block">
          {item.providerName}
          {item.providerNotes && (
            <span className="ml-1 text-xs text-muted-foreground">
              ({item.providerNotes})
            </span>
          )}
        </span>
      </div>

      {}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={() => onRemove(item.providerId)}
        disabled={disabled || isRemoving}
        aria-label={t("common.delete", "Delete")}
      >
        {isRemoving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
