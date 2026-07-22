import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { ExternalLink, RotateCw, Save } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useDarkMode } from "@/hooks/useDarkMode";
import { terminalApi } from "@/lib/api";
import { extractErrorMessage } from "@/utils/errorUtils";
import { CodeEditor, type CodeLanguage } from "./CodeEditor";
import { sketchStore, useSketch, composeHtml, type SketchMode } from "./store";

type SplitTab = "html" | "css" | "js";

export function SketchPage() {
  const { t } = useTranslation();
  const sketch = useSketch();
  const darkMode = useDarkMode();
  const [splitTab, setSplitTab] = useState<SplitTab>("html");
  const [autoRun, setAutoRun] = useState(true);
  const [previewNonce, setPreviewNonce] = useState(0);

  const composed = useMemo(() => composeHtml(sketch), [sketch]);

  // srcDoc used by the preview iframe. When auto-run is on it tracks the
  // composed document live; otherwise it only updates on manual "Run".
  const [previewDoc, setPreviewDoc] = useState(composed);
  useEffect(() => {
    if (autoRun) setPreviewDoc(composed);
  }, [autoRun, composed]);

  const runPreview = () => {
    setPreviewDoc(composed);
    setPreviewNonce((n) => n + 1);
  };

  const openInBrowser = async () => {
    try {
      await terminalApi.openHtmlInBrowser(composed);
    } catch (error) {
      toast.error(t("sketch.openFailed"), {
        description: extractErrorMessage(error) || undefined,
      });
    }
  };

  const saveHtml = async () => {
    try {
      const path = await saveFileDialog({
        title: t("sketch.save"),
        defaultPath: "sketch.html",
        filters: [{ name: "HTML", extensions: ["html", "htm"] }],
      });
      if (!path) return;
      const saved = await terminalApi.saveHtml(path, composed);
      toast.success(t("sketch.saved", { path: saved }));
    } catch (error) {
      toast.error(t("sketch.saveFailed"), {
        description: extractErrorMessage(error) || undefined,
      });
    }
  };

  const editorFor = (tab: SplitTab) => {
    const config: Record<
      SplitTab,
      { value: string; language: CodeLanguage; onChange: (v: string) => void }
    > = {
      html: {
        value: sketch.markup,
        language: "html",
        onChange: sketchStore.setMarkup,
      },
      css: { value: sketch.css, language: "css", onChange: sketchStore.setCss },
      js: {
        value: sketch.js,
        language: "javascript",
        onChange: sketchStore.setJs,
      },
    };
    const c = config[tab];
    return (
      <CodeEditor
        value={c.value}
        language={c.language}
        onChange={c.onChange}
        darkMode={darkMode}
      />
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-6 pb-2">
      <div className="mb-2 flex h-9 shrink-0 items-center gap-3">
        <div className="inline-flex rounded-md border border-border bg-background p-0.5">
          {(["single", "split"] as SketchMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => sketchStore.setMode(mode)}
              aria-pressed={sketch.mode === mode}
              className={cn(
                "h-6 rounded-[4px] px-2 text-xs font-medium transition-colors",
                sketch.mode === mode
                  ? "bg-muted text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {mode === "single"
                ? t("sketch.modeSingle")
                : t("sketch.modeSplit")}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={autoRun}
            onChange={(event) => setAutoRun(event.target.checked)}
            className="h-3.5 w-3.5"
          />
          {t("sketch.autoRun")}
        </label>
        <button
          type="button"
          onClick={runPreview}
          disabled={autoRun}
          title={t("sketch.run")}
          className="flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <RotateCw className="h-3.5 w-3.5" />
          {t("sketch.run")}
        </button>
        <button
          type="button"
          onClick={() => void saveHtml()}
          title={t("sketch.save")}
          className="flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Save className="h-3.5 w-3.5" />
          {t("sketch.save")}
        </button>
        <button
          type="button"
          onClick={() => void openInBrowser()}
          title={t("sketch.openInBrowser")}
          className="flex h-7 items-center gap-1 rounded-md bg-blue-500/90 px-2 text-xs font-medium text-white transition-colors hover:bg-blue-500"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t("sketch.openInBrowser")}
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border">
          {sketch.mode === "split" && (
            <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border bg-muted/60 px-1">
              {(["html", "css", "js"] as SplitTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSplitTab(tab)}
                  aria-pressed={splitTab === tab}
                  className={cn(
                    "h-6 rounded px-2 text-[11px] font-medium uppercase transition-colors",
                    splitTab === tab
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1">
            {sketch.mode === "single" ? (
              <CodeEditor
                value={sketch.html}
                language="html"
                onChange={sketchStore.setHtml}
                darkMode={darkMode}
                placeholder={t("sketch.pastePlaceholder")}
              />
            ) : (
              editorFor(splitTab)
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-white">
          <iframe
            key={previewNonce}
            title={t("sketch.previewTitle")}
            srcDoc={previewDoc}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-modals allow-forms allow-popups"
          />
        </div>
      </div>
    </div>
  );
}
