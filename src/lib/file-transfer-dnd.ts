export const FILE_DRAG_MIME = "application/x-hazhir-file-paths";
export const FILE_PATH_DROP_EVENT = "hazhir-file-path-drop";

export type FileDragPayload = {
  paths: string[];
};

export function hasFileDragType(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes(FILE_DRAG_MIME);
}

export function serializeFileDragPayload(paths: string[]): string {
  return JSON.stringify({ paths } satisfies FileDragPayload);
}

export function readFileDragPayload(
  dataTransfer: DataTransfer | null | undefined
): FileDragPayload | null {
  if (!hasFileDragType(dataTransfer)) return null;
  const raw = dataTransfer?.getData(FILE_DRAG_MIME);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as FileDragPayload;
    if (!Array.isArray(parsed.paths) || parsed.paths.length === 0) return null;
    return {
      paths: parsed.paths.filter((item): item is string => typeof item === "string"),
    };
  } catch {
    return null;
  }
}

export function readDroppedPathsFromDataTransfer(
  dataTransfer: DataTransfer | null | undefined
): string[] {
  if (!dataTransfer) return [];

  const payload = readFileDragPayload(dataTransfer);
  if (payload?.paths?.length) {
    return payload.paths;
  }

  const plain = dataTransfer.getData("text/plain")?.trim();
  if (plain) {
    return plain
      .split(/\r?\n+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  const uriList = dataTransfer.getData("text/uri-list")?.trim();
  if (!uriList) return [];

  return uriList
    .split(/\r?\n+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith("#"));
}

export function setFileDragPreview(
  dataTransfer: DataTransfer,
  label: string,
  count: number,
  kind: "file" | "directory" = "file",
  sourceElement?: HTMLElement | null
) {
  if (typeof document === "undefined") return;

  const sourceIcon = sourceElement?.querySelector(
    "[data-file-icon='true']"
  ) as HTMLElement | null;

  const preview = document.createElement("div");
  preview.style.position = "fixed";
  preview.style.left = "-10000px";
  preview.style.top = "-10000px";
  preview.style.pointerEvents = "none";
  preview.style.zIndex = "2147483647";
  preview.style.width = "96px";
  preview.style.position = "relative";
  preview.style.overflow = "hidden";
  preview.style.boxSizing = "border-box";
  preview.style.borderRadius = "16px";
  preview.style.padding = "12px 8px 10px 8px";
  preview.style.background = "rgba(255,255,255,0.16)";
  preview.style.border = "1px solid rgba(255,255,255,0.34)";
  preview.style.boxShadow = "0 10px 28px rgba(2, 6, 23, 0.35)";
  preview.style.backdropFilter = "blur(8px)";
  preview.style.color = "white";
  preview.style.font = "500 12px/1.2 Inter, system-ui, -apple-system, Segoe UI, sans-serif";
  preview.style.textAlign = "center";

  const icon = document.createElement("div");
  if (sourceIcon) {
    const iconClone = sourceIcon.cloneNode(true) as HTMLElement;
    iconClone.style.width = "30px";
    iconClone.style.height = "30px";
    iconClone.style.display = "flex";
    iconClone.style.alignItems = "center";
    iconClone.style.justifyContent = "center";
    iconClone.style.pointerEvents = "none";

    const svg = iconClone.querySelector("svg") as SVGElement | null;
    if (svg) {
      svg.setAttribute("width", "30");
      svg.setAttribute("height", "30");
    }

    icon.appendChild(iconClone);
  } else {
    icon.textContent = kind === "directory" ? "📁" : "📄";
    icon.style.fontSize = "30px";
  }
  icon.style.lineHeight = "1";
  icon.style.height = "32px";
  icon.style.display = "flex";
  icon.style.alignItems = "center";
  icon.style.justifyContent = "center";
  preview.appendChild(icon);

  const title = document.createElement("div");
  title.style.marginTop = "8px";
  title.style.lineHeight = "16px";
  title.style.maxHeight = "32px";
  title.style.overflow = "hidden";
  title.style.wordBreak = "break-word";
  title.textContent = count > 1 ? `${count} items` : label;
  preview.appendChild(title);

  if (count > 1) {
    const badge = document.createElement("div");
    badge.textContent = String(count);
    badge.style.position = "absolute";
    badge.style.right = "4px";
    badge.style.top = "4px";
    badge.style.minWidth = "22px";
    badge.style.height = "22px";
    badge.style.padding = "0 6px";
    badge.style.borderRadius = "999px";
    badge.style.background = "rgba(99,102,241,0.95)";
    badge.style.border = "1px solid rgba(255,255,255,0.75)";
    badge.style.display = "flex";
    badge.style.alignItems = "center";
    badge.style.justifyContent = "center";
    badge.style.fontSize = "11px";
    badge.style.fontWeight = "700";
    badge.style.color = "white";
    preview.appendChild(badge);
  }

  document.body.appendChild(preview);
  dataTransfer.setDragImage(preview, 52, 70);

  requestAnimationFrame(() => {
    preview.remove();
  });
}