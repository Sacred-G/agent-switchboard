import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import { useForm } from "react-hook-form";
import { Form } from "@/components/ui/form";
import type { ProviderCategory } from "@/types";
import {
  ProviderPresetSelector,
  filterPresetEntries,
  getPresetDisplayName,
  getPresetSearchText,
  getVisiblePresetEntries,
  sortPresetEntries,
  type PresetSortMode,
} from "@/components/providers/forms/ProviderPresetSelector";

vi.mock("@/components/ProviderIcon", () => ({
  ProviderIcon: ({
    icon,
    name,
    color,
    size,
  }: {
    icon?: string;
    name: string;
    color?: string;
    size?: number;
  }) => (
    <span
      data-testid="provider-icon"
      data-icon={icon}
      data-name={name}
      data-color={color}
      data-size={size}
    />
  ),
}));

const presetCategoryLabels = {
  official: "Official",
  cn_official: "CN Official",
  aggregator: "Aggregators",
  third_party: "Third Party",
};

const translations: Record<string, string> = {
  "preset.alpha": "Alpha Local Name",
  "preset.gamma": "Gamma Local Name",
};

const t = ((key: string) => translations[key] ?? key) as TFunction;

type TestPresetEntry = {
  id: string;
  preset: {
    name: string;
    nameKey?: string;
    websiteUrl: string;
    settingsConfig: Record<string, never>;
    category: ProviderCategory;
    primePartner?: boolean;
  };
};

const presetEntries: TestPresetEntry[] = [
  {
    id: "gamma",
    preset: {
      name: "Gamma Raw",
      nameKey: "preset.gamma",
      websiteUrl: "https://gamma.example.com",
      settingsConfig: {},
      category: "aggregator",
    },
  },
  {
    id: "alpha",
    preset: {
      name: "Alpha Raw",
      nameKey: "preset.alpha",
      websiteUrl: "https://alpha.example.com/v1",
      settingsConfig: {},
      category: "official",
    },
  },
  {
    id: "beta",
    preset: {
      name: "Beta Gateway",
      websiteUrl: "https://CN-Gateway.example.com",
      settingsConfig: {},
      category: "cn_official",
    },
  },
  {
    id: "delta",
    preset: {
      name: "Delta Mirror",
      websiteUrl: "https://delta.example.com",
      settingsConfig: {},
      category: "third_party",
    },
  },
] satisfies TestPresetEntry[];

function getIds(entries: ReadonlyArray<{ id: string }>) {
  return entries.map((entry) => entry.id);
}

function renderSelector({
  entries = presetEntries,
  onPresetChange = vi.fn(),
}: {
  entries?: TestPresetEntry[];
  onPresetChange?: (value: string) => void;
} = {}) {
  const Wrapper = () => {
    const form = useForm();

    return (
      <Form {...form}>
        <ProviderPresetSelector
          selectedPresetId="custom"
          presetEntries={entries}
          presetCategoryLabels={presetCategoryLabels}
          onPresetChange={onPresetChange}
        />
      </Form>
    );
  };

  return render(<Wrapper />);
}

function getPresetButtonTexts() {
  const knownNames = new Set([
    "providerPreset.custom",
    ...presetEntries.flatMap((entry) => [
      entry.preset.name,
      entry.preset.nameKey ?? entry.preset.name,
    ]),
  ]);

  return screen
    .getAllByRole("button")
    .map((button) => button.textContent?.trim() ?? "")
    .filter((text) => knownNames.has(text));
}

function getSearchButton() {
  return screen.getByRole("button", {
    name: /providerPreset\.(search|searchAriaLabel|openSearch)|search/i,
  });
}

function getSortButton() {
  return screen.getByRole("button", {
    name: /providerPreset\.(sort|sortByName|restoreOriginalOrder)|sort/i,
  });
}

function getSearchInput() {
  return screen.getByRole("textbox", {
    name: /providerPreset\.(searchInput|searchPlaceholder)|search/i,
  });
}

describe("ProviderPresetSelector pure helpers", () => {
  it("uses nameKey translation if available, otherwise raw name", () => {
    expect(getPresetDisplayName(presetEntries[1].preset, t)).toBe(
      "Alpha Local Name",
    );
    expect(getPresetDisplayName(presetEntries[2].preset, t)).toBe(
      "Beta Gateway",
    );
  });

  it("joins display name and raw name in lower-case, excluding URL or category label", () => {
    const searchText = getPresetSearchText(presetEntries[1], t);

    expect(searchText).toContain("alpha local name");
    expect(searchText).toContain("alpha raw");
    expect(searchText).not.toContain("example.com");
    expect(searchText).not.toContain("official");
    expect(searchText).toBe(searchText.toLowerCase());
  });

  it("returns original array for empty query, case-insensitive match for non-empty", () => {
    expect(filterPresetEntries(presetEntries, "   ", t)).toBe(presetEntries);
    expect(
      getIds(filterPresetEntries(presetEntries, "ALPHA LOCAL NAME", t)),
    ).toEqual(["alpha"]);
  });

  it("does not search via URL or category label (matches name only)", () => {
    expect(
      getIds(filterPresetEntries(presetEntries, "cn-gateway.example.com", t)),
    ).toEqual([]);
    expect(getIds(filterPresetEntries(presetEntries, "aggregators", t))).toEqual([]);
  });

  it("supports A-Z sorting, pins official category in original mode, and filters before sorting in getVisible", () => {
    const originalMode: PresetSortMode = "original";
    const nameAscMode: PresetSortMode = "nameAsc";

    const original = sortPresetEntries(presetEntries, originalMode, t);
    expect(original).not.toBe(presetEntries);
    expect(getIds(original)).toEqual(["alpha", "gamma", "beta", "delta"]);

    expect(getIds(sortPresetEntries(presetEntries, nameAscMode, t))).toEqual([
      "alpha",
      "beta",
      "delta",
      "gamma",
    ]);
    expect(getIds(presetEntries)).toEqual(["gamma", "alpha", "beta", "delta"]);

    expect(
      getIds(
        getVisiblePresetEntries(presetEntries, {
          query: "a",
          sortMode: nameAscMode,
          t,
        }),
      ),
    ).toEqual(["alpha", "beta", "delta", "gamma"]);
  });

  it("orders official -> prime -> others in original mode, keeping internal order", () => {
    const mixed: TestPresetEntry[] = [
      {
        id: "restFirst",
        preset: {
          name: "Rest First",
          websiteUrl: "https://rest-first.example.com",
          settingsConfig: {},
          category: "third_party",
        },
      },
      {
        id: "primeOnly",
        preset: {
          name: "Prime Only",
          websiteUrl: "https://prime-only.example.com",
          settingsConfig: {},
          category: "cn_official",
          primePartner: true,
        },
      },
      {
        id: "officialOnly",
        preset: {
          name: "Official Only",
          websiteUrl: "https://official-only.example.com",
          settingsConfig: {},
          category: "official",
        },
      },
      {
        id: "officialPrime",
        preset: {
          name: "Official Prime",
          websiteUrl: "https://official-prime.example.com",
          settingsConfig: {},
          category: "official",
          primePartner: true,
        },
      },
      {
        id: "restLast",
        preset: {
          name: "Rest Last",
          websiteUrl: "https://rest-last.example.com",
          settingsConfig: {},
          category: "aggregator",
        },
      },
    ];

    expect(getIds(sortPresetEntries(mixed, "original", t))).toEqual([
      "officialOnly",
      "officialPrime",
      "primeOnly",
      "restFirst",
      "restLast",
    ]);
  });
});

describe("ProviderPresetSelector", () => {
  it("Default (original mode) pins official category, others retain incoming order", () => {
    renderSelector();

    expect(getPresetButtonTexts()).toEqual([
      "providerPreset.custom",
      "preset.alpha",
      "preset.gamma",
      "Beta Gateway",
      "Delta Mirror",
    ]);
  });

  it("sorts presets A-Z after clicking sort button, then restores original order on second click", async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(getSortButton());

    expect(getPresetButtonTexts()).toEqual([
      "providerPreset.custom",
      "Beta Gateway",
      "Delta Mirror",
      "preset.alpha",
      "preset.gamma",
    ]);

    await user.click(getSortButton());

    expect(getPresetButtonTexts()).toEqual([
      "providerPreset.custom",
      "preset.alpha",
      "preset.gamma",
      "Beta Gateway",
      "Delta Mirror",
    ]);
  });

  it("filters normal presets only, keeping custom config button visible", async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(getSearchButton());
    await user.type(getSearchInput(), "gateway");

    expect(
      screen.getByRole("button", { name: "providerPreset.custom" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Beta Gateway" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "preset.gamma" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "preset.alpha" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delta Mirror" }),
    ).not.toBeInTheDocument();
  });

  it("shows empty state and keeps custom option when no presets match search", async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(getSearchButton());
    await user.type(getSearchInput(), "not-found");

    expect(
      screen.getByRole("button", { name: "providerPreset.custom" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "preset.gamma" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "preset.alpha" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Beta Gateway" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delta Mirror" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /providerPreset\.(empty|noResults)|no matching presets|no provider presets match your search/i,
      ),
    ).toBeInTheDocument();
  });

  it("ensures all preset buttons are full width for grid alignment", () => {
    renderSelector();

    const presetButtons = screen.getAllByRole("button");
    const fullWidthButtons = presetButtons.filter((btn) =>
      btn.className.includes("w-full"),
    );

    expect(fullWidthButtons.length).toBeGreaterThanOrEqual(5);
  });

  it("renders icon element (img/svg) if preset.icon exists", () => {
    const entriesWithIcon = [
      {
        id: "with-icon",
        preset: {
          name: "With Icon",
          websiteUrl: "https://icon.example.com",
          settingsConfig: {},
          category: "official" as ProviderCategory,
          icon: "claude-api",
          iconColor: "#D4915D",
        },
      },
    ];

    renderSelector({ entries: entriesWithIcon });

    const button = screen.getByRole("button", { name: /with icon/i });
    const icon = button.querySelector('[data-testid="provider-icon"]');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("data-icon")).toBe("claude-api");
    expect(icon?.getAttribute("data-color")).toBe("#D4915D");
  });

  it("renders placeholder element if preset has no icon, to maintain text alignment", () => {
    const entriesWithoutIcon = [
      {
        id: "no-icon",
        preset: {
          name: "No Icon",
          websiteUrl: "https://noicon.example.com",
          settingsConfig: {},
          category: "official" as ProviderCategory,
        },
      },
    ];

    renderSelector({ entries: entriesWithoutIcon });

    const button = screen.getByRole("button", { name: /no icon/i });
    const placeholder = button.querySelector("span[aria-hidden]");
    expect(placeholder).not.toBeNull();
  });

  it("renders placeholder for custom button to align text with icon presets", () => {
    renderSelector();

    const customButton = screen.getByRole("button", {
      name: "providerPreset.custom",
    });
    const placeholder = customButton.querySelector("span[aria-hidden]");
    expect(placeholder).not.toBeNull();
  });

  it("toggles search input visibility on search button click, clears and hides on ESC", async () => {
    const user = userEvent.setup();
    renderSelector();

    expect(
      screen.queryByRole("textbox", {
        name: /providerPreset\.(searchInput|searchPlaceholder)|search/i,
      }),
    ).not.toBeInTheDocument();

    await user.click(getSearchButton());
    const input = getSearchInput();
    expect(input).toBeInTheDocument();

    await user.type(input, "gateway");
    expect(
      screen.getByRole("button", { name: "Beta Gateway" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("textbox", {
        name: /providerPreset\.(searchInput|searchPlaceholder)|search/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "preset.gamma" }),
    ).toBeInTheDocument();
  });

  it("opens search input on Ctrl+F shortcut", async () => {
    const user = userEvent.setup();
    renderSelector();

    expect(
      screen.queryByRole("textbox", {
        name: /providerPreset\.(searchInput|searchPlaceholder)|search/i,
      }),
    ).not.toBeInTheDocument();

    await user.keyboard("{Control>}f{/Control}");
    expect(getSearchInput()).toBeInTheDocument();
  });

  it("selects preset on click after search without clearing search query", async () => {
    const user = userEvent.setup();
    const onPresetChange = vi.fn();
    renderSelector({ onPresetChange });

    await user.click(getSearchButton());
    await user.type(getSearchInput(), "gateway");

    await user.click(screen.getByRole("button", { name: "Beta Gateway" }));

    expect(onPresetChange).toHaveBeenCalledWith("beta");
    expect(getSearchInput()).toBeInTheDocument();
    expect(getSearchInput()).toHaveValue("gateway");
  });

  it("focuses back to search input on Ctrl+F if already open", async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(getSearchButton());
    await user.type(getSearchInput(), "gateway");

    await user.click(screen.getByRole("button", { name: "Beta Gateway" }));
    expect(getSearchInput()).not.toHaveFocus();

    await user.keyboard("{Control>}f{/Control}");
    await waitFor(() => expect(getSearchInput()).toHaveFocus());
    expect(getSearchInput()).toHaveValue("gateway");
  });

  it("closes and clears search query on click outside", async () => {
    const user = userEvent.setup();
    const Wrapper = () => {
      const form = useForm();
      return (
        <Form {...form}>
          <ProviderPresetSelector
            selectedPresetId="custom"
            presetEntries={presetEntries}
            presetCategoryLabels={presetCategoryLabels}
            onPresetChange={vi.fn()}
          />
          <div data-testid="outside">Outside</div>
        </Form>
      );
    };
    render(<Wrapper />);

    await user.click(getSearchButton());
    await user.type(getSearchInput(), "gateway");
    expect(getSearchInput()).toBeInTheDocument();

    await user.click(screen.getByTestId("outside"));

    expect(
      screen.queryByRole("textbox", {
        name: /providerPreset\.(searchInput|searchPlaceholder)|search/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "preset.gamma" }),
    ).toBeInTheDocument();
  });
});
