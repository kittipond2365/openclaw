import { serializePayload } from "@buape/carbon";
import { ComponentType } from "discord-api-types/v10";
import { describe, expect, it, vi } from "vitest";
import type { ModelsProviderData } from "../../auto-reply/reply/commands-models.js";
import type { OpenClawConfig } from "../../config/config.js";
import * as modelsCommandModule from "../../auto-reply/reply/commands-models.js";
import {
  DISCORD_CUSTOM_ID_MAX_CHARS,
  DISCORD_MODEL_PICKER_MODEL_PAGE_SIZE,
  DISCORD_MODEL_PICKER_PROVIDER_PAGE_SIZE,
  DISCORD_MODEL_PICKER_PROVIDER_SINGLE_PAGE_MAX,
  buildDiscordModelPickerCustomId,
  getDiscordModelPickerModelPage,
  getDiscordModelPickerProviderPage,
  loadDiscordModelPickerData,
  parseDiscordModelPickerCustomId,
  parseDiscordModelPickerData,
  renderDiscordModelPickerModelsView,
  renderDiscordModelPickerProvidersView,
  toDiscordModelPickerMessagePayload,
} from "./model-picker.js";

function createModelsProviderData(entries: Record<string, string[]>): ModelsProviderData {
  const byProvider = new Map<string, Set<string>>();
  for (const [provider, models] of Object.entries(entries)) {
    byProvider.set(provider, new Set(models));
  }
  return {
    byProvider,
    providers: Object.keys(entries).toSorted(),
    resolvedDefault: {
      provider: Object.keys(entries)[0] ?? "openai",
      model: entries[Object.keys(entries)[0]]?.[0] ?? "gpt-4o",
    },
  };
}

type SerializedComponent = {
  type: number;
  custom_id?: string;
  options?: Array<{ value: string; default?: boolean }>;
  components?: SerializedComponent[];
};

function extractContainerRows(components?: SerializedComponent[]): SerializedComponent[] {
  const container = components?.find(
    (component) => component.type === Number(ComponentType.Container),
  );
  if (!container) {
    return [];
  }
  return (container.components ?? []).filter(
    (component) => component.type === Number(ComponentType.ActionRow),
  );
}

describe("loadDiscordModelPickerData", () => {
  it("reuses buildModelsProviderData as source of truth", async () => {
    const expected = createModelsProviderData({ openai: ["gpt-4o"] });
    const spy = vi
      .spyOn(modelsCommandModule, "buildModelsProviderData")
      .mockResolvedValue(expected);

    const result = await loadDiscordModelPickerData({} as OpenClawConfig);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toBe(expected);
  });
});

describe("Discord model picker custom_id", () => {
  it("encodes and decodes command/provider/page/user context", () => {
    const customId = buildDiscordModelPickerCustomId({
      command: "models",
      action: "provider",
      view: "models",
      provider: "OpenAI",
      page: 3,
      userId: "1234567890",
    });

    const parsed = parseDiscordModelPickerCustomId(customId);

    expect(parsed).toEqual({
      command: "models",
      action: "provider",
      view: "models",
      provider: "openai",
      page: 3,
      userId: "1234567890",
    });
  });

  it("parses component data payloads", () => {
    const parsed = parseDiscordModelPickerData({
      cmd: "model",
      act: "nav",
      view: "providers",
      u: "42",
      p: "anthropic",
      pg: "2",
    });

    expect(parsed).toEqual({
      command: "model",
      action: "nav",
      view: "providers",
      userId: "42",
      provider: "anthropic",
      page: 2,
    });
  });

  it("parses optional submit model index", () => {
    const parsed = parseDiscordModelPickerData({
      cmd: "models",
      act: "submit",
      view: "models",
      u: "42",
      p: "openai",
      pg: "1",
      mi: "7",
    });

    expect(parsed).toEqual({
      command: "models",
      action: "submit",
      view: "models",
      userId: "42",
      provider: "openai",
      page: 1,
      modelIndex: 7,
    });
  });

  it("rejects invalid command/action/view values", () => {
    expect(
      parseDiscordModelPickerData({
        cmd: "status",
        act: "nav",
        view: "providers",
        u: "42",
      }),
    ).toBeNull();
    expect(
      parseDiscordModelPickerData({
        cmd: "model",
        act: "unknown",
        view: "providers",
        u: "42",
      }),
    ).toBeNull();
    expect(
      parseDiscordModelPickerData({
        cmd: "model",
        act: "nav",
        view: "unknown",
        u: "42",
      }),
    ).toBeNull();
  });

  it("enforces Discord custom_id max length", () => {
    const longProvider = `provider-${"x".repeat(DISCORD_CUSTOM_ID_MAX_CHARS)}`;
    expect(() =>
      buildDiscordModelPickerCustomId({
        command: "model",
        action: "provider",
        view: "models",
        provider: longProvider,
        page: 1,
        userId: "42",
      }),
    ).toThrow(/custom_id exceeds/i);
  });
});

describe("provider paging", () => {
  it("keeps providers on a single page when count fits Discord button rows", () => {
    const entries: Record<string, string[]> = {};
    for (let i = 1; i <= DISCORD_MODEL_PICKER_PROVIDER_SINGLE_PAGE_MAX - 2; i += 1) {
      entries[`provider-${String(i).padStart(2, "0")}`] = [`model-${i}`];
    }
    const data = createModelsProviderData(entries);

    const page = getDiscordModelPickerProviderPage({ data, page: 1 });

    expect(page.items).toHaveLength(DISCORD_MODEL_PICKER_PROVIDER_SINGLE_PAGE_MAX - 2);
    expect(page.totalPages).toBe(1);
    expect(page.pageSize).toBe(DISCORD_MODEL_PICKER_PROVIDER_SINGLE_PAGE_MAX);
    expect(page.hasPrev).toBe(false);
    expect(page.hasNext).toBe(false);
  });

  it("paginates providers when count exceeds one-page Discord button limits", () => {
    const entries: Record<string, string[]> = {};
    for (let i = 1; i <= DISCORD_MODEL_PICKER_PROVIDER_SINGLE_PAGE_MAX + 3; i += 1) {
      entries[`provider-${String(i).padStart(2, "0")}`] = [`model-${i}`];
    }
    const data = createModelsProviderData(entries);

    const page1 = getDiscordModelPickerProviderPage({ data, page: 1 });
    const lastPage = getDiscordModelPickerProviderPage({ data, page: 99 });

    expect(page1.items).toHaveLength(DISCORD_MODEL_PICKER_PROVIDER_PAGE_SIZE);
    expect(page1.totalPages).toBe(2);
    expect(page1.hasNext).toBe(true);

    expect(lastPage.page).toBe(2);
    expect(lastPage.items).toHaveLength(8);
    expect(lastPage.hasPrev).toBe(true);
    expect(lastPage.hasNext).toBe(false);
  });

  it("caps custom provider page size at Discord-safe max", () => {
    const compactData = createModelsProviderData({
      anthropic: ["claude-sonnet-4-5"],
      openai: ["gpt-4o"],
      google: ["gemini-3-pro"],
    });
    const compactPage = getDiscordModelPickerProviderPage({
      data: compactData,
      page: 1,
      pageSize: 999,
    });
    expect(compactPage.pageSize).toBe(DISCORD_MODEL_PICKER_PROVIDER_SINGLE_PAGE_MAX);

    const pagedEntries: Record<string, string[]> = {};
    for (let i = 1; i <= DISCORD_MODEL_PICKER_PROVIDER_SINGLE_PAGE_MAX + 1; i += 1) {
      pagedEntries[`provider-${String(i).padStart(2, "0")}`] = [`model-${i}`];
    }
    const pagedData = createModelsProviderData(pagedEntries);
    const pagedPage = getDiscordModelPickerProviderPage({
      data: pagedData,
      page: 1,
      pageSize: 999,
    });
    expect(pagedPage.pageSize).toBe(DISCORD_MODEL_PICKER_PROVIDER_PAGE_SIZE);
  });
});

describe("model paging", () => {
  it("sorts models and paginates with Discord select-option constraints", () => {
    const models = Array.from(
      { length: DISCORD_MODEL_PICKER_MODEL_PAGE_SIZE + 4 },
      (_, idx) =>
        `model-${String(DISCORD_MODEL_PICKER_MODEL_PAGE_SIZE + 4 - idx).padStart(2, "0")}`,
    );
    const data = createModelsProviderData({ openai: models });

    const page1 = getDiscordModelPickerModelPage({ data, provider: "openai", page: 1 });
    const page2 = getDiscordModelPickerModelPage({ data, provider: "openai", page: 2 });

    expect(page1).not.toBeNull();
    expect(page2).not.toBeNull();
    expect(page1?.items).toHaveLength(DISCORD_MODEL_PICKER_MODEL_PAGE_SIZE);
    expect(page1?.items[0]).toBe("model-01");
    expect(page1?.hasNext).toBe(true);

    expect(page2?.items).toHaveLength(4);
    expect(page2?.page).toBe(2);
    expect(page2?.hasPrev).toBe(true);
    expect(page2?.hasNext).toBe(false);
  });

  it("returns null for unknown provider", () => {
    const data = createModelsProviderData({ anthropic: ["claude-sonnet-4-5"] });
    const page = getDiscordModelPickerModelPage({ data, provider: "openai", page: 1 });
    expect(page).toBeNull();
  });

  it("caps custom model page size at Discord select-option max", () => {
    const data = createModelsProviderData({ openai: ["gpt-4o", "gpt-4.1"] });
    const page = getDiscordModelPickerModelPage({ data, provider: "openai", pageSize: 999 });
    expect(page?.pageSize).toBe(DISCORD_MODEL_PICKER_MODEL_PAGE_SIZE);
  });
});

describe("Discord model picker rendering", () => {
  it("renders provider view on one page when provider count is <= 25", () => {
    const entries: Record<string, string[]> = {};
    for (let i = 1; i <= 22; i += 1) {
      entries[`provider-${String(i).padStart(2, "0")}`] = [`model-${i}`];
    }
    entries["azure-openai-responses"] = ["gpt-4.1"];
    entries["vercel-ai-gateway"] = ["gpt-4o-mini"];
    const data = createModelsProviderData(entries);

    const rendered = renderDiscordModelPickerProvidersView({
      command: "models",
      userId: "42",
      data,
      currentModel: "provider-01/model-1",
    });

    const payload = serializePayload(toDiscordModelPickerMessagePayload(rendered)) as {
      content?: string;
      components?: SerializedComponent[];
    };

    expect(payload.content).toBeUndefined();
    expect(payload.components?.[0]?.type).toBe(ComponentType.Container);

    const rows = extractContainerRows(payload.components);
    expect(rows.length).toBeGreaterThan(0);

    const rowProviderCounts = rows.map(
      (row) =>
        (row.components ?? []).filter((component) => {
          const parsed = parseDiscordModelPickerCustomId(component.custom_id ?? "");
          return parsed?.action === "provider";
        }).length,
    );
    expect(rowProviderCounts).toEqual([4, 5, 5, 5, 5]);

    const allButtons = rows.flatMap((row) => row.components ?? []);
    const providerButtons = allButtons.filter((component) => {
      const parsed = parseDiscordModelPickerCustomId(component.custom_id ?? "");
      return parsed?.action === "provider";
    });
    expect(providerButtons).toHaveLength(Object.keys(entries).length);
    expect(
      allButtons.some((component) => {
        const parsed = parseDiscordModelPickerCustomId(component.custom_id ?? "");
        return parsed?.action === "nav";
      }),
    ).toBe(false);
  });

  it("renders provider navigation controls when provider count exceeds one page", () => {
    const entries: Record<string, string[]> = {};
    for (let i = 1; i <= DISCORD_MODEL_PICKER_PROVIDER_SINGLE_PAGE_MAX + 4; i += 1) {
      entries[`provider-${String(i).padStart(2, "0")}`] = [`model-${i}`];
    }
    const data = createModelsProviderData(entries);

    const rendered = renderDiscordModelPickerProvidersView({
      command: "models",
      userId: "42",
      data,
      currentModel: "provider-01/model-1",
    });

    const payload = serializePayload(toDiscordModelPickerMessagePayload(rendered)) as {
      components?: SerializedComponent[];
    };

    const rows = extractContainerRows(payload.components);
    expect(rows.length).toBeGreaterThan(0);

    const navRow = rows.at(-1);
    const navButtons = navRow?.components ?? [];
    expect(navButtons).toHaveLength(3);

    const parsedNavState = parseDiscordModelPickerCustomId(navButtons[2]?.custom_id ?? "");
    expect(parsedNavState?.action).toBe("nav");
    expect(parsedNavState?.view).toBe("providers");
  });

  it("supports classic fallback rendering with content + action rows", () => {
    const data = createModelsProviderData({ openai: ["gpt-4o"], anthropic: ["claude-sonnet-4-5"] });

    const rendered = renderDiscordModelPickerProvidersView({
      command: "model",
      userId: "99",
      data,
      layout: "classic",
    });

    const payload = serializePayload(toDiscordModelPickerMessagePayload(rendered)) as {
      content?: string;
      components?: SerializedComponent[];
    };

    expect(payload.content).toContain("Model Picker");
    expect(payload.components?.[0]?.type).toBe(ComponentType.ActionRow);
  });

  it("renders model view with select menu and explicit submit button", () => {
    const data = createModelsProviderData({
      openai: ["gpt-4.1", "gpt-4o", "o3"],
      anthropic: ["claude-sonnet-4-5"],
    });

    const rendered = renderDiscordModelPickerModelsView({
      command: "models",
      userId: "42",
      data,
      provider: "openai",
      page: 1,
      providerPage: 2,
      currentModel: "openai/gpt-4o",
      pendingModel: "openai/o3",
      pendingModelIndex: 3,
    });

    const payload = serializePayload(toDiscordModelPickerMessagePayload(rendered)) as {
      components?: SerializedComponent[];
    };

    const rows = extractContainerRows(payload.components);
    expect(rows).toHaveLength(3);

    const providerSelect = rows[0]?.components?.find(
      (component) => component.type === Number(ComponentType.StringSelect),
    );
    expect(providerSelect).toBeTruthy();
    expect(providerSelect?.options?.length).toBe(2);
    expect(providerSelect?.options?.find((option) => option.value === "openai")?.default).toBe(
      true,
    );
    const parsedProviderState = parseDiscordModelPickerCustomId(providerSelect?.custom_id ?? "");
    expect(parsedProviderState?.action).toBe("provider");

    const modelSelect = rows[1]?.components?.find(
      (component) => component.type === Number(ComponentType.StringSelect),
    );
    expect(modelSelect).toBeTruthy();
    expect(modelSelect?.options?.length).toBe(3);
    expect(modelSelect?.options?.find((option) => option.value === "o3")?.default).toBe(true);

    const parsedModelSelectState = parseDiscordModelPickerCustomId(modelSelect?.custom_id ?? "");
    expect(parsedModelSelectState?.action).toBe("model");
    expect(parsedModelSelectState?.provider).toBe("openai");

    const navButtons = rows[2]?.components ?? [];
    expect(navButtons).toHaveLength(5);

    const submitState = parseDiscordModelPickerCustomId(navButtons[3]?.custom_id ?? "");
    expect(submitState?.action).toBe("submit");
    expect(submitState?.provider).toBe("openai");
    expect(submitState?.modelIndex).toBe(3);

    const resetState = parseDiscordModelPickerCustomId(navButtons[4]?.custom_id ?? "");
    expect(resetState?.action).toBe("reset");
    expect(resetState?.provider).toBe("openai");
  });

  it("renders not-found model view with a back button", () => {
    const data = createModelsProviderData({ openai: ["gpt-4o"] });

    const rendered = renderDiscordModelPickerModelsView({
      command: "model",
      userId: "42",
      data,
      provider: "does-not-exist",
      providerPage: 3,
    });

    const payload = serializePayload(toDiscordModelPickerMessagePayload(rendered)) as {
      components?: SerializedComponent[];
    };

    const rows = extractContainerRows(payload.components);
    expect(rows).toHaveLength(1);

    const backButton = rows[0]?.components?.[0];
    expect(backButton?.type).toBe(ComponentType.Button);

    const state = parseDiscordModelPickerCustomId(backButton?.custom_id ?? "");
    expect(state?.action).toBe("back");
    expect(state?.view).toBe("providers");
    expect(state?.page).toBe(3);
  });
});
