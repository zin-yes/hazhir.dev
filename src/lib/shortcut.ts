"use client";

type ShortcutMetadata = {
  name?: string;
  icon?: string;
  iconDisplayText?: string;
};

export type ApplicationShortcutDefinition = ShortcutMetadata & {
  type: "application";
  target: string;
  args: string[];
};

export type LinkShortcutDefinition = ShortcutMetadata & {
  type: "link";
  url: string;
};

export type ShortcutDefinition =
  | ApplicationShortcutDefinition
  | LinkShortcutDefinition;

export type AppExecutableDefinition = {
  type: "application";
  appId: string;
  name?: string;
};

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

export function parseShortcut(contents: string): ShortcutDefinition | null {
  const parsed = parseKeyValueText(contents);
  if (parsed.type === "application") {
    if (!parsed.target) return null;

    return {
      type: "application",
      target: parsed.target,
      args: parsed.args
        ? parsed.args
            .split(/\s+/)
            .map((item) => item.trim())
            .filter(Boolean)
        : [],
      name: parsed.name,
      icon: parsed.icon,
      iconDisplayText: parsed.iconDisplayText,
    };
  }

  if (parsed.type === "link") {
    if (!parsed.url) return null;
    return {
      type: "link",
      url: parsed.url,
      name: parsed.name,
      icon: parsed.icon,
      iconDisplayText: parsed.iconDisplayText,
    };
  }

  return null;
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

export function createShortcutContents(
  targetPath: string,
  options?: {
    args?: string[];
    name?: string;
    icon?: string;
    iconDisplayText?: string;
  },
) {
  const args = options?.args ?? [];
  return [
    "# hazhir.shortcut v1",
    "type=application",
    `target=${targetPath}`,
    options?.name ? `name=${options.name}` : "",
    options?.icon ? `icon=${options.icon}` : "",
    options?.iconDisplayText
      ? `iconDisplayText=${options.iconDisplayText}`
      : "",
    `args=${args.join(" ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function createLinkShortcutContents(
  url: string,
  options?: {
    name?: string;
    icon?: string;
    iconDisplayText?: string;
  },
) {
  return [
    "# hazhir.shortcut v1",
    "type=link",
    `url=${url}`,
    options?.name ? `name=${options.name}` : "",
    options?.icon ? `icon=${options.icon}` : "",
    options?.iconDisplayText
      ? `iconDisplayText=${options.iconDisplayText}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function createAppExecutableContents(appId: string, name: string) {
  return [
    "# hazhir.app v1",
    "type=application",
    `appId=${appId}`,
    `name=${name}`,
  ].join("\n");
}
