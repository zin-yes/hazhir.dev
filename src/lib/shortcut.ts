"use client";

// --- Generic block-based format types ---

export type ShortcutValue = string | boolean | string[];
export type ShortcutBlock = Record<string, ShortcutValue>;
export type ShortcutBlocks = Record<string, ShortcutBlock>;

// --- Typed shortcut definitions ---

export type ShortcutMeta = {
  display_name?: string;
  description?: string;
};

export type ShortcutIcon = {
  source?: string;
  url?: string;
};

export type ApplicationShortcutDefinition = {
  type: "application";
  application: { target: string; arguments: string[] };
  meta: ShortcutMeta;
  icon: ShortcutIcon;
  blocks: ShortcutBlocks;
};

export type LinkShortcutDefinition = {
  type: "link";
  link: { url: string; new_tab: boolean };
  meta: ShortcutMeta;
  icon: ShortcutIcon;
  blocks: ShortcutBlocks;
};

export type ShortcutDefinition =
  | ApplicationShortcutDefinition
  | LinkShortcutDefinition;

export type AppExecutableDefinition = {
  type: "application";
  appId: string;
  name?: string;
};

// --- Block parser ---

function parseValue(raw: string): ShortcutValue {
  let trimmed = raw.trim();

  // Strip trailing comma (allows JSON-like trailing commas)
  if (trimmed.endsWith(",")) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner
      .split(",")
      .map((item) => {
        const t = item.trim();
        if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
        return t;
      })
      .filter(Boolean);
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

export function parseShortcutBlocks(contents: string): ShortcutBlocks {
  const blocks: ShortcutBlocks = {};
  const lines = contents.split(/\r?\n/);

  let currentBlock: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("#")) continue;

    if (line === "}") {
      currentBlock = null;
      continue;
    }

    const blockMatch = line.match(/^([a-z_][a-z0-9_]*)\s*=\s*\{$/i);
    if (blockMatch) {
      currentBlock = blockMatch[1];
      if (!blocks[currentBlock]) blocks[currentBlock] = {};
      continue;
    }

    if (currentBlock) {
      const commentFree = stripInlineComment(line);
      const eqIndex = commentFree.indexOf("=");
      if (eqIndex === -1) continue;

      const key = commentFree.slice(0, eqIndex).trim();
      const rawValue = commentFree.slice(eqIndex + 1);

      if (key.length > 0) {
        blocks[currentBlock][key] = parseValue(rawValue);
      }
    }
  }

  return blocks;
}

function stripInlineComment(line: string): string {
  let inQuote = false;
  let inArray = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    if (line[i] === "[") inArray = true;
    if (line[i] === "]") inArray = false;
    if (line[i] === "#" && !inQuote && !inArray) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

// --- Helpers to extract typed data from blocks ---

function getString(
  block: ShortcutBlock | undefined,
  key: string,
): string | undefined {
  const val = block?.[key];
  return typeof val === "string" ? val : undefined;
}

function getBool(block: ShortcutBlock | undefined, key: string): boolean {
  return block?.[key] === true;
}

function getStringArray(
  block: ShortcutBlock | undefined,
  key: string,
): string[] {
  const val = block?.[key];
  if (Array.isArray(val)) return val;
  if (typeof val === "string" && val.length > 0) return [val];
  return [];
}

function extractMeta(blocks: ShortcutBlocks): ShortcutMeta {
  const meta = blocks.meta;
  return {
    display_name: getString(meta, "display_name"),
    description: getString(meta, "description"),
  };
}

function extractIcon(blocks: ShortcutBlocks): ShortcutIcon {
  const icon = blocks.icon;
  return {
    source: getString(icon, "source"),
    url: getString(icon, "url"),
  };
}

// --- Main parse function ---

export function parseShortcut(contents: string): ShortcutDefinition | null {
  const blocks = parseShortcutBlocks(contents);

  if (blocks.application) {
    const target = getString(blocks.application, "target");
    if (!target) return null;

    return {
      type: "application",
      application: {
        target,
        arguments: getStringArray(blocks.application, "arguments"),
      },
      meta: extractMeta(blocks),
      icon: extractIcon(blocks),
      blocks,
    };
  }

  if (blocks.link) {
    const url = getString(blocks.link, "url");
    if (!url) return null;

    return {
      type: "link",
      link: {
        url,
        new_tab: getBool(blocks.link, "new_tab"),
      },
      meta: extractMeta(blocks),
      icon: extractIcon(blocks),
      blocks,
    };
  }

  return null;
}

// --- .app format parser (unchanged) ---

function parseKeyValueText(contents: string): Record<string, string> {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .reduce<Record<string, string>>((accumulator, line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) return accumulator;
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (key.length === 0) return accumulator;
      accumulator[key] = value;
      return accumulator;
    }, {});
}

export function parseAppExecutable(
  contents: string,
): AppExecutableDefinition | null {
  const parsed = parseKeyValueText(contents);
  if (parsed.type !== "application") return null;
  if (!parsed.appId) return null;

  return {
    type: "application",
    appId: parsed.appId,
    name: parsed.name,
  };
}

// --- Serializer ---

function serializeValue(value: ShortcutValue): string {
  if (typeof value === "boolean") return value.toString();
  if (Array.isArray(value)) {
    return `[${value.map((item) => `"${item}"`).join(", ")}]`;
  }
  return `"${value}"`;
}

function serializeBlock(
  name: string,
  entries: Record<string, ShortcutValue>,
): string {
  const lines = Object.entries(entries)
    .filter(([, value]) => {
      if (typeof value === "string") return value.length > 0;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    })
    .map(([key, value]) => `  ${key}=${serializeValue(value)}`);

  if (lines.length === 0) return "";
  return `${name}={\n${lines.join("\n")}\n}`;
}

export function createShortcutContents(options: {
  application?: { target: string; arguments?: string[] };
  link?: { url: string; new_tab?: boolean };
  meta?: { display_name?: string; description?: string };
  icon?: { source?: string; url?: string };
}): string {
  const sections: string[] = ["# hazhir.shortcut v2"];

  if (options.application) {
    const block: Record<string, ShortcutValue> = {
      target: options.application.target,
    };
    if (options.application.arguments?.length) {
      block.arguments = options.application.arguments;
    }
    sections.push(serializeBlock("application", block));
  }

  if (options.link) {
    const block: Record<string, ShortcutValue> = {
      url: options.link.url,
    };
    if (options.link.new_tab !== undefined) {
      block.new_tab = options.link.new_tab;
    }
    sections.push(serializeBlock("link", block));
  }

  if (options.meta) {
    const block: Record<string, ShortcutValue> = {};
    if (options.meta.display_name) block.display_name = options.meta.display_name;
    if (options.meta.description) block.description = options.meta.description;
    const s = serializeBlock("meta", block);
    if (s) sections.push(s);
  }

  if (options.icon) {
    const block: Record<string, ShortcutValue> = {};
    if (options.icon.source) block.source = options.icon.source;
    if (options.icon.url) block.url = options.icon.url;
    const s = serializeBlock("icon", block);
    if (s) sections.push(s);
  }

  return sections.filter(Boolean).join("\n");
}

// --- Convenience helpers for icon resolution ---

export function getShortcutIconName(def: ShortcutDefinition): string | undefined {
  if (def.icon.source === "lucide") return def.icon.url;
  return undefined;
}

export function getShortcutIconUrl(def: ShortcutDefinition): string | undefined {
  if (def.icon.source === "url" || def.icon.source === "image") return def.icon.url;
  if (!def.icon.source && def.icon.url?.startsWith("/")) return def.icon.url;
  return undefined;
}

// --- .app format serializer (unchanged) ---

export function createAppExecutableContents(appId: string, name: string) {
  return [
    "# hazhir.app v1",
    "type=application",
    `appId=${appId}`,
    `name=${name}`,
  ].join("\n");
}
