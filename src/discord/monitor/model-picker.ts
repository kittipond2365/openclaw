import type { APISelectMenuOption } from "discord-api-types/v10";
import {
  Button,
  Container,
  Row,
  Separator,
  StringSelectMenu,
  TextDisplay,
  type ComponentData,
  type MessagePayloadObject,
  type TopLevelComponents,
} from "@buape/carbon";
import { ButtonStyle } from "discord-api-types/v10";
import type { OpenClawConfig } from "../../config/config.js";
import { normalizeProviderId } from "../../agents/model-selection.js";
import {
  buildModelsProviderData,
  type ModelsProviderData,
} from "../../auto-reply/reply/commands-models.js";

export const DISCORD_MODEL_PICKER_CUSTOM_ID_KEY = "mdlpk";
export const DISCORD_CUSTOM_ID_MAX_CHARS = 100;

// Discord component limits.
export const DISCORD_COMPONENT_MAX_ROWS = 5;
export const DISCORD_COMPONENT_MAX_BUTTONS_PER_ROW = 5;
export const DISCORD_COMPONENT_MAX_SELECT_OPTIONS = 25;

// Reserve one row for navigation/utility buttons when rendering providers.
export const DISCORD_MODEL_PICKER_PROVIDER_PAGE_SIZE =
  DISCORD_COMPONENT_MAX_BUTTONS_PER_ROW * (DISCORD_COMPONENT_MAX_ROWS - 1);
export const DISCORD_MODEL_PICKER_MODEL_PAGE_SIZE = DISCORD_COMPONENT_MAX_SELECT_OPTIONS;

const COMMAND_CONTEXTS = ["model", "models"] as const;
const PICKER_ACTIONS = ["open", "provider", "model", "nav", "back", "reset"] as const;
const PICKER_VIEWS = ["providers", "models"] as const;

export type DiscordModelPickerCommandContext = (typeof COMMAND_CONTEXTS)[number];
export type DiscordModelPickerAction = (typeof PICKER_ACTIONS)[number];
export type DiscordModelPickerView = (typeof PICKER_VIEWS)[number];

export type DiscordModelPickerState = {
  command: DiscordModelPickerCommandContext;
  action: DiscordModelPickerAction;
  view: DiscordModelPickerView;
  userId: string;
  provider?: string;
  page: number;
};

export type DiscordModelPickerProviderItem = {
  id: string;
  count: number;
};

export type DiscordModelPickerPage<T> = {
  items: T[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  hasPrev: boolean;
  hasNext: boolean;
};

export type DiscordModelPickerModelPage = DiscordModelPickerPage<string> & {
  provider: string;
};

export type DiscordModelPickerLayout = "v2" | "classic";

type DiscordModelPickerButtonOptions = {
  label: string;
  customId: string;
  style?: ButtonStyle;
  disabled?: boolean;
};

type DiscordModelPickerCurrentModelRef = {
  provider: string;
  model: string;
};

type DiscordModelPickerRow = Row<Button> | Row<StringSelectMenu>;

type DiscordModelPickerRenderShellParams = {
  layout: DiscordModelPickerLayout;
  title: string;
  detailLines: string[];
  rows: DiscordModelPickerRow[];
  footer: string;
};

export type DiscordModelPickerRenderedView = {
  layout: DiscordModelPickerLayout;
  content?: string;
  components: TopLevelComponents[];
};

export type DiscordModelPickerProviderViewParams = {
  command: DiscordModelPickerCommandContext;
  userId: string;
  data: ModelsProviderData;
  page?: number;
  currentModel?: string;
  layout?: DiscordModelPickerLayout;
};

export type DiscordModelPickerModelViewParams = {
  command: DiscordModelPickerCommandContext;
  userId: string;
  data: ModelsProviderData;
  provider: string;
  page?: number;
  providerPage?: number;
  currentModel?: string;
  layout?: DiscordModelPickerLayout;
};

function encodeCustomIdValue(value: string): string {
  return encodeURIComponent(value);
}

function decodeCustomIdValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isValidCommandContext(value: string): value is DiscordModelPickerCommandContext {
  return (COMMAND_CONTEXTS as readonly string[]).includes(value);
}

function isValidPickerAction(value: string): value is DiscordModelPickerAction {
  return (PICKER_ACTIONS as readonly string[]).includes(value);
}

function isValidPickerView(value: string): value is DiscordModelPickerView {
  return (PICKER_VIEWS as readonly string[]).includes(value);
}

function normalizePage(value: number | undefined): number {
  const numeric = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.max(1, Math.floor(numeric));
}

function parseRawPage(value: unknown): number {
  if (typeof value === "number") {
    return normalizePage(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return normalizePage(parsed);
    }
  }
  return 1;
}

function coerceString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function clampPageSize(rawPageSize: number | undefined, max: number, fallback: number): number {
  if (!Number.isFinite(rawPageSize)) {
    return fallback;
  }
  return Math.min(max, Math.max(1, Math.floor(rawPageSize ?? fallback)));
}

function paginateItems<T>(params: {
  items: T[];
  page: number;
  pageSize: number;
}): DiscordModelPickerPage<T> {
  const totalItems = params.items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / params.pageSize));
  const page = Math.max(1, Math.min(params.page, totalPages));
  const startIndex = (page - 1) * params.pageSize;
  const endIndexExclusive = Math.min(totalItems, startIndex + params.pageSize);

  return {
    items: params.items.slice(startIndex, endIndexExclusive),
    page,
    pageSize: params.pageSize,
    totalPages,
    totalItems,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}

function parseCurrentModelRef(raw?: string): DiscordModelPickerCurrentModelRef | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) {
    return null;
  }
  const provider = normalizeProviderId(trimmed.slice(0, slashIndex));
  const model = trimmed.slice(slashIndex + 1);
  if (!provider || !model) {
    return null;
  }
  return { provider, model };
}

function formatCurrentModelLine(currentModel?: string): string {
  const parsed = parseCurrentModelRef(currentModel);
  if (!parsed) {
    return "Current model: default";
  }
  return `Current model: ${parsed.provider}/${parsed.model}`;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) {
    return [items];
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function createModelPickerButton(params: DiscordModelPickerButtonOptions): Button {
  class DiscordModelPickerButton extends Button {
    label = params.label;
    customId = params.customId;
    style = params.style ?? ButtonStyle.Secondary;
    disabled = params.disabled ?? false;
  }
  return new DiscordModelPickerButton();
}

function createModelSelect(params: {
  customId: string;
  options: APISelectMenuOption[];
  placeholder?: string;
  disabled?: boolean;
}): StringSelectMenu {
  class DiscordModelPickerSelect extends StringSelectMenu {
    customId = params.customId;
    options = params.options;
    minValues = 1;
    maxValues = 1;
    placeholder = params.placeholder;
    disabled = params.disabled ?? false;
  }
  return new DiscordModelPickerSelect();
}

function buildRenderedShell(
  params: DiscordModelPickerRenderShellParams,
): DiscordModelPickerRenderedView {
  if (params.layout === "classic") {
    const lines = [params.title, ...params.detailLines, "", params.footer].filter(Boolean);
    return {
      layout: "classic",
      content: lines.join("\n"),
      components: params.rows,
    };
  }

  const containerComponents: Array<TextDisplay | Separator | DiscordModelPickerRow> = [
    new TextDisplay(`## ${params.title}`),
  ];
  if (params.detailLines.length > 0) {
    containerComponents.push(new TextDisplay(params.detailLines.join("\n")));
  }
  containerComponents.push(new Separator({ divider: true, spacing: "small" }));
  containerComponents.push(...params.rows);
  containerComponents.push(new Separator({ divider: false, spacing: "small" }));
  containerComponents.push(new TextDisplay(`-# ${params.footer}`));

  const container = new Container(containerComponents);
  return {
    layout: "v2",
    components: [container],
  };
}

function buildProviderRows(params: {
  command: DiscordModelPickerCommandContext;
  userId: string;
  page: DiscordModelPickerPage<DiscordModelPickerProviderItem>;
  currentProvider?: string;
}): Row<Button>[] {
  const rows = chunkArray(params.page.items, DISCORD_COMPONENT_MAX_BUTTONS_PER_ROW).map(
    (providers) =>
      new Row(
        providers.map((provider) => {
          const style =
            provider.id === params.currentProvider ? ButtonStyle.Primary : ButtonStyle.Secondary;
          return createModelPickerButton({
            label: provider.id,
            style,
            customId: buildDiscordModelPickerCustomId({
              command: params.command,
              action: "provider",
              view: "models",
              provider: provider.id,
              page: params.page.page,
              userId: params.userId,
            }),
          });
        }),
      ),
  );

  rows.push(
    new Row([
      createModelPickerButton({
        label: "◀ Prev",
        disabled: !params.page.hasPrev,
        customId: buildDiscordModelPickerCustomId({
          command: params.command,
          action: "nav",
          view: "providers",
          page: params.page.page - 1,
          userId: params.userId,
        }),
      }),
      createModelPickerButton({
        label: `Page ${params.page.page}/${params.page.totalPages}`,
        disabled: true,
        customId: buildDiscordModelPickerCustomId({
          command: params.command,
          action: "open",
          view: "providers",
          page: params.page.page,
          userId: params.userId,
        }),
      }),
      createModelPickerButton({
        label: "Next ▶",
        disabled: !params.page.hasNext,
        customId: buildDiscordModelPickerCustomId({
          command: params.command,
          action: "nav",
          view: "providers",
          page: params.page.page + 1,
          userId: params.userId,
        }),
      }),
    ]),
  );

  return rows;
}

function buildModelRows(params: {
  command: DiscordModelPickerCommandContext;
  userId: string;
  data: ModelsProviderData;
  providerPage: number;
  modelPage: DiscordModelPickerModelPage;
  currentModel?: string;
}): DiscordModelPickerRow[] {
  const parsedCurrentModel = parseCurrentModelRef(params.currentModel);
  const options: APISelectMenuOption[] = params.modelPage.items.map((model) => ({
    label: model,
    value: model,
    default: parsedCurrentModel
      ? parsedCurrentModel.provider === params.modelPage.provider &&
        parsedCurrentModel.model === model
      : false,
  }));

  const selectRow = new Row([
    createModelSelect({
      customId: buildDiscordModelPickerCustomId({
        command: params.command,
        action: "model",
        view: "models",
        provider: params.modelPage.provider,
        page: params.modelPage.page,
        userId: params.userId,
      }),
      options,
      placeholder: `Select ${params.modelPage.provider} model`,
    }),
  ]);

  const resolvedDefault = params.data.resolvedDefault;
  const shouldDisableReset =
    Boolean(parsedCurrentModel) &&
    parsedCurrentModel?.provider === resolvedDefault.provider &&
    parsedCurrentModel?.model === resolvedDefault.model;

  const navRow = new Row([
    createModelPickerButton({
      label: "Back",
      customId: buildDiscordModelPickerCustomId({
        command: params.command,
        action: "back",
        view: "providers",
        page: params.providerPage,
        userId: params.userId,
      }),
    }),
    createModelPickerButton({
      label: "◀ Prev",
      disabled: !params.modelPage.hasPrev,
      customId: buildDiscordModelPickerCustomId({
        command: params.command,
        action: "nav",
        view: "models",
        provider: params.modelPage.provider,
        page: params.modelPage.page - 1,
        userId: params.userId,
      }),
    }),
    createModelPickerButton({
      label: `Page ${params.modelPage.page}/${params.modelPage.totalPages}`,
      disabled: true,
      customId: buildDiscordModelPickerCustomId({
        command: params.command,
        action: "open",
        view: "models",
        provider: params.modelPage.provider,
        page: params.modelPage.page,
        userId: params.userId,
      }),
    }),
    createModelPickerButton({
      label: "Next ▶",
      disabled: !params.modelPage.hasNext,
      customId: buildDiscordModelPickerCustomId({
        command: params.command,
        action: "nav",
        view: "models",
        provider: params.modelPage.provider,
        page: params.modelPage.page + 1,
        userId: params.userId,
      }),
    }),
    createModelPickerButton({
      label: "Reset default",
      style: ButtonStyle.Secondary,
      disabled: shouldDisableReset,
      customId: buildDiscordModelPickerCustomId({
        command: params.command,
        action: "reset",
        view: "models",
        provider: params.modelPage.provider,
        page: 1,
        userId: params.userId,
      }),
    }),
  ]);

  return [selectRow, navRow];
}

/**
 * Source-of-truth data for Discord picker views. This intentionally reuses the
 * same provider/model resolver used by text and Telegram model commands.
 */
export async function loadDiscordModelPickerData(cfg: OpenClawConfig): Promise<ModelsProviderData> {
  return buildModelsProviderData(cfg);
}

export function buildDiscordModelPickerCustomId(params: {
  command: DiscordModelPickerCommandContext;
  action: DiscordModelPickerAction;
  view: DiscordModelPickerView;
  userId: string;
  provider?: string;
  page?: number;
}): string {
  const userId = params.userId.trim();
  if (!userId) {
    throw new Error("Discord model picker custom_id requires userId");
  }

  const page = normalizePage(params.page);
  const normalizedProvider = params.provider ? normalizeProviderId(params.provider) : undefined;

  const parts = [
    `${DISCORD_MODEL_PICKER_CUSTOM_ID_KEY}:cmd=${encodeCustomIdValue(params.command)}`,
    `act=${encodeCustomIdValue(params.action)}`,
    `view=${encodeCustomIdValue(params.view)}`,
    `u=${encodeCustomIdValue(userId)}`,
    `pg=${String(page)}`,
  ];
  if (normalizedProvider) {
    parts.push(`p=${encodeCustomIdValue(normalizedProvider)}`);
  }

  const customId = parts.join(";");
  if (customId.length > DISCORD_CUSTOM_ID_MAX_CHARS) {
    throw new Error(
      `Discord model picker custom_id exceeds ${DISCORD_CUSTOM_ID_MAX_CHARS} chars (${customId.length})`,
    );
  }
  return customId;
}

export function parseDiscordModelPickerCustomId(customId: string): DiscordModelPickerState | null {
  const trimmed = customId.trim();
  if (!trimmed.startsWith(`${DISCORD_MODEL_PICKER_CUSTOM_ID_KEY}:`)) {
    return null;
  }

  const rawParts = trimmed.split(";");
  const data: Record<string, string> = {};
  for (const part of rawParts) {
    const equalsIndex = part.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const rawKey = part.slice(0, equalsIndex);
    const rawValue = part.slice(equalsIndex + 1);
    const key = rawKey.includes(":") ? rawKey.split(":").slice(1).join(":") : rawKey;
    if (!key) {
      continue;
    }
    data[key] = rawValue;
  }

  return parseDiscordModelPickerData(data);
}

export function parseDiscordModelPickerData(data: ComponentData): DiscordModelPickerState | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const command = decodeCustomIdValue(coerceString(data.cmd));
  const action = decodeCustomIdValue(coerceString(data.act));
  const view = decodeCustomIdValue(coerceString(data.view));
  const userId = decodeCustomIdValue(coerceString(data.u));
  const providerRaw = decodeCustomIdValue(coerceString(data.p));
  const page = parseRawPage(data.pg);

  if (!isValidCommandContext(command) || !isValidPickerAction(action) || !isValidPickerView(view)) {
    return null;
  }

  const trimmedUserId = userId.trim();
  if (!trimmedUserId) {
    return null;
  }

  const provider = providerRaw ? normalizeProviderId(providerRaw) : undefined;

  return {
    command,
    action,
    view,
    userId: trimmedUserId,
    provider,
    page,
  };
}

export function buildDiscordModelPickerProviderItems(
  data: ModelsProviderData,
): DiscordModelPickerProviderItem[] {
  return data.providers.map((provider) => ({
    id: provider,
    count: data.byProvider.get(provider)?.size ?? 0,
  }));
}

export function getDiscordModelPickerProviderPage(params: {
  data: ModelsProviderData;
  page?: number;
  pageSize?: number;
}): DiscordModelPickerPage<DiscordModelPickerProviderItem> {
  const pageSize = clampPageSize(
    params.pageSize,
    DISCORD_MODEL_PICKER_PROVIDER_PAGE_SIZE,
    DISCORD_MODEL_PICKER_PROVIDER_PAGE_SIZE,
  );
  return paginateItems({
    items: buildDiscordModelPickerProviderItems(params.data),
    page: normalizePage(params.page),
    pageSize,
  });
}

export function getDiscordModelPickerModelPage(params: {
  data: ModelsProviderData;
  provider: string;
  page?: number;
  pageSize?: number;
}): DiscordModelPickerModelPage | null {
  const provider = normalizeProviderId(params.provider);
  const modelSet = params.data.byProvider.get(provider);
  if (!modelSet) {
    return null;
  }

  const pageSize = clampPageSize(
    params.pageSize,
    DISCORD_MODEL_PICKER_MODEL_PAGE_SIZE,
    DISCORD_MODEL_PICKER_MODEL_PAGE_SIZE,
  );
  const models = [...modelSet].toSorted();
  const page = paginateItems({
    items: models,
    page: normalizePage(params.page),
    pageSize,
  });

  return {
    ...page,
    provider,
  };
}

export function renderDiscordModelPickerProvidersView(
  params: DiscordModelPickerProviderViewParams,
): DiscordModelPickerRenderedView {
  const page = getDiscordModelPickerProviderPage({ data: params.data, page: params.page });
  const parsedCurrent = parseCurrentModelRef(params.currentModel);
  const rows = buildProviderRows({
    command: params.command,
    userId: params.userId,
    page,
    currentProvider: parsedCurrent?.provider,
  });

  const detailLines = [
    formatCurrentModelLine(params.currentModel),
    `Select a provider (${page.totalItems} available).`,
  ];
  return buildRenderedShell({
    layout: params.layout ?? "v2",
    title: "Model Picker",
    detailLines,
    rows,
    footer: `Providers page ${page.page}/${page.totalPages}`,
  });
}

export function renderDiscordModelPickerModelsView(
  params: DiscordModelPickerModelViewParams,
): DiscordModelPickerRenderedView {
  const providerPage = normalizePage(params.providerPage);
  const modelPage = getDiscordModelPickerModelPage({
    data: params.data,
    provider: params.provider,
    page: params.page,
  });

  if (!modelPage) {
    const rows: Row<Button>[] = [
      new Row([
        createModelPickerButton({
          label: "Back",
          customId: buildDiscordModelPickerCustomId({
            command: params.command,
            action: "back",
            view: "providers",
            page: providerPage,
            userId: params.userId,
          }),
        }),
      ]),
    ];

    return buildRenderedShell({
      layout: params.layout ?? "v2",
      title: "Model Picker",
      detailLines: [
        formatCurrentModelLine(params.currentModel),
        `Provider not found: ${normalizeProviderId(params.provider)}`,
      ],
      rows,
      footer: "Choose a different provider.",
    });
  }

  const rows = buildModelRows({
    command: params.command,
    userId: params.userId,
    data: params.data,
    providerPage,
    modelPage,
    currentModel: params.currentModel,
  });

  const defaultModel = `${params.data.resolvedDefault.provider}/${params.data.resolvedDefault.model}`;
  return buildRenderedShell({
    layout: params.layout ?? "v2",
    title: `Model Picker — ${modelPage.provider}`,
    detailLines: [formatCurrentModelLine(params.currentModel), `Default: ${defaultModel}`],
    rows,
    footer: `Models page ${modelPage.page}/${modelPage.totalPages} (${modelPage.totalItems} total)`,
  });
}

export function toDiscordModelPickerMessagePayload(
  view: DiscordModelPickerRenderedView,
): MessagePayloadObject {
  if (view.layout === "classic") {
    return {
      content: view.content,
      components: view.components,
    };
  }
  return {
    components: view.components,
  };
}
