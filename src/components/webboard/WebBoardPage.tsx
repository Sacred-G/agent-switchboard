import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Columns2,
  Grid2X2,
  Grid3X3,
  LayoutPanelTop,
  Plus,
  Rows2,
  Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { WebPagePane } from "./WebPagePane";
import {
  webBoardStore,
  useWebBoard,
  WEB_LAYOUTS,
  MAX_PAGES,
  type WebLayoutPreset,
} from "./store";

const LAYOUT_ICON: Record<WebLayoutPreset, typeof Square> = {
  single: Square,
  "split-h": Columns2,
  "split-v": Rows2,
  "grid-2x2": Grid2X2,
  "one-top-row": LayoutPanelTop,
  "grid-3x3": Grid3X3,
};

// Grid template for each layout. "one-top-row" is a full-width pane on top of a
// row of the remaining panes ("1 horizontal and several below it").
function layoutContainerClass(layout: WebLayoutPreset): string {
  switch (layout) {
    case "single":
      return "grid grid-cols-1 grid-rows-1";
    case "split-h":
      return "grid grid-cols-2 grid-rows-1";
    case "split-v":
      return "grid grid-cols-1 grid-rows-2";
    case "grid-2x2":
      return "grid grid-cols-2 grid-rows-2";
    case "grid-3x3":
      return "grid grid-cols-3 grid-rows-3";
    case "one-top-row":
      return "flex flex-col";
    default:
      return "grid grid-cols-1";
  }
}

export function WebBoardPage() {
  const { t } = useTranslation();
  const { pages, layout } = useWebBoard();
  const [newUrl, setNewUrl] = useState("");

  const capacity = WEB_LAYOUTS.find((l) => l.id === layout)?.capacity ?? 1;
  const visiblePages = pages.slice(0, capacity);
  const hiddenCount = pages.length - visiblePages.length;

  const addPage = () => {
    if (!newUrl.trim()) {
      webBoardStore.addBlankPage();
      return;
    }
    if (webBoardStore.addPage(newUrl)) setNewUrl("");
  };

  const renderPane = (index: number) => {
    const page = visiblePages[index];
    if (!page) return null;
    return (
      <WebPagePane
        key={page.id}
        page={page}
        index={pages.indexOf(page)}
        total={pages.length}
      />
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-6 pb-2">
      <div className="mb-2 flex h-9 shrink-0 items-center gap-3">
        <div className="flex flex-1 items-center gap-2">
          <Input
            value={newUrl}
            onChange={(event) => setNewUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addPage();
            }}
            placeholder={t("webBoard.addUrlPlaceholder")}
            disabled={pages.length >= MAX_PAGES}
            className="h-7 max-w-md font-mono text-xs"
          />
          <button
            type="button"
            onClick={addPage}
            disabled={pages.length >= MAX_PAGES}
            title={t("webBoard.addPage")}
            className="flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("webBoard.addPage")}
          </button>
          <span className="text-[11px] text-muted-foreground">
            {t("webBoard.pageCount", { count: pages.length, max: MAX_PAGES })}
          </span>
        </div>
        <div className="flex items-center rounded-md border border-border bg-background p-0.5">
          {WEB_LAYOUTS.map(({ id }) => {
            const Icon = LAYOUT_ICON[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => webBoardStore.setLayout(id)}
                aria-pressed={layout === id}
                title={t(`webBoard.layouts.${id}`)}
                className={cn(
                  "flex h-6 w-7 items-center justify-center rounded-[4px] transition-colors",
                  layout === id
                    ? "bg-muted text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>
      </div>

      {pages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
          <p className="text-sm">{t("webBoard.emptyBoard")}</p>
          <p className="text-xs">{t("webBoard.emptyBoardHint")}</p>
        </div>
      ) : layout === "one-top-row" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="min-h-0 flex-1">{renderPane(0)}</div>
          {visiblePages.length > 1 && (
            <div className="grid min-h-0 flex-1 auto-cols-fr grid-flow-col gap-2">
              {visiblePages.slice(1).map((_, i) => renderPane(i + 1))}
            </div>
          )}
        </div>
      ) : (
        <div
          className={cn("min-h-0 flex-1 gap-2", layoutContainerClass(layout))}
        >
          {visiblePages.map((_, i) => renderPane(i))}
        </div>
      )}

      {hiddenCount > 0 && (
        <p className="mt-1 shrink-0 text-center text-[11px] text-amber-500">
          {t("webBoard.hiddenPages", { count: hiddenCount })}
        </p>
      )}
    </div>
  );
}
