import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProviderIcon } from "@/components/ProviderIcon";
import { cn } from "@/lib/utils";
import { providersApi, type AppId } from "@/lib/api";
import type { Provider } from "@/types";
import type {
  AddSessionOptions,
  WorkbenchAgent,
  WorkbenchAuthMode,
} from "./store";

interface AgentChoice {
  agent: WorkbenchAgent;
  label: string;
  icon?: string;
  /** App whose provider profiles supply env vars in API mode. */
  app?: AppId;
  /** Whether the CLI supports a subscription login (no env override). */
  hasSubscription: boolean;
}

const AGENT_CHOICES: AgentChoice[] = [
  {
    agent: "claude",
    label: "Claude Code",
    icon: "claude",
    app: "claude",
    hasSubscription: true,
  },
  {
    agent: "codex",
    label: "Codex",
    icon: "openai",
    app: "codex",
    hasSubscription: true,
  },
  {
    agent: "gemini",
    label: "Gemini",
    icon: "gemini",
    app: "gemini",
    hasSubscription: true,
  },
  {
    agent: "opencode",
    label: "OpenCode",
    icon: "opencode",
    app: "opencode",
    hasSubscription: true,
  },
  { agent: "shell", label: "Shell", hasSubscription: false },
  { agent: "custom", label: "Custom", hasSubscription: false },
];

interface AddSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (options: AddSessionOptions) => Promise<void>;
}

export function AddSessionDialog({
  open,
  onOpenChange,
  onSubmit,
}: AddSessionDialogProps) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<AgentChoice>(AGENT_CHOICES[0]);
  const [authMode, setAuthMode] = useState<WorkbenchAuthMode>("subscription");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState<string>("");
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const supportsAuthModes = Boolean(choice.app);
  const effectiveAuthMode: WorkbenchAuthMode = supportsAuthModes
    ? choice.hasSubscription
      ? authMode
      : "api"
    : "subscription";

  useEffect(() => {
    if (!open) return;
    setSubmitting(false);
  }, [open]);

  useEffect(() => {
    if (!open || !choice.app || effectiveAuthMode !== "api") {
      setProviders([]);
      setProviderId("");
      return;
    }
    let cancelled = false;
    void providersApi
      .getAll(choice.app)
      .then((map) => {
        if (cancelled) return;
        const list = Object.values(map).sort(
          (a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0),
        );
        setProviders(list);
        setProviderId((prev) =>
          prev && map[prev] ? prev : (list[0]?.id ?? ""),
        );
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, choice.app, effectiveAuthMode]);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === providerId),
    [providers, providerId],
  );

  const canSubmit =
    !submitting &&
    (choice.agent !== "custom" || command.trim().length > 0) &&
    (effectiveAuthMode !== "api" || !choice.app || Boolean(providerId));

  const handleBrowse = async () => {
    const selected = await openFileDialog({
      directory: true,
      multiple: false,
      title: t("workbench.pickDirectory"),
    });
    if (typeof selected === "string") {
      setCwd(selected);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        agent: choice.agent,
        authMode: effectiveAuthMode,
        app: effectiveAuthMode === "api" ? choice.app : undefined,
        providerId: effectiveAuthMode === "api" ? providerId : undefined,
        providerName:
          effectiveAuthMode === "api" ? selectedProvider?.name : undefined,
        command: choice.agent === "custom" ? command.trim() : undefined,
        cwd: cwd.trim() || undefined,
      });
      onOpenChange(false);
      setCommand("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("workbench.addSession")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {AGENT_CHOICES.map((item) => (
              <button
                key={item.agent}
                type="button"
                onClick={() => setChoice(item)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-colors",
                  choice.agent === item.agent
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {item.icon ? (
                  <ProviderIcon icon={item.icon} name={item.label} size={20} />
                ) : (
                  <span className="h-5 w-5 inline-flex items-center justify-center font-mono text-sm">
                    &gt;_
                  </span>
                )}
                {item.label}
              </button>
            ))}
          </div>

          {supportsAuthModes && choice.hasSubscription && (
            <div className="space-y-1.5">
              <Label>{t("workbench.authMode")}</Label>
              <div className="inline-flex w-full bg-muted rounded-lg p-1 gap-1">
                {(["subscription", "api"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAuthMode(mode)}
                    className={cn(
                      "flex-1 h-8 rounded-md text-sm font-medium transition-colors",
                      effectiveAuthMode === mode
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {mode === "subscription"
                      ? t("workbench.authSubscription")
                      : t("workbench.authApi")}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {effectiveAuthMode === "subscription"
                  ? t("workbench.authSubscriptionHint")
                  : t("workbench.authApiHint")}
              </p>
            </div>
          )}

          {supportsAuthModes && effectiveAuthMode === "api" && (
            <div className="space-y-1.5">
              <Label>{t("workbench.provider")}</Label>
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("workbench.providerPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {providers.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("workbench.noProviders")}
                </p>
              )}
            </div>
          )}

          {choice.agent === "custom" && (
            <div className="space-y-1.5">
              <Label>{t("workbench.command")}</Label>
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={t("workbench.commandPlaceholder")}
                className="font-mono"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{t("workbench.workingDirectory")}</Label>
            <div className="flex gap-2">
              <Input
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder={t("workbench.workingDirectoryPlaceholder")}
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void handleBrowse()}
                title={t("workbench.pickDirectory")}
              >
                <FolderOpen className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
              {t("workbench.launch")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
