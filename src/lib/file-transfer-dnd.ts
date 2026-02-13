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
  count: number
) {
  if (typeof document === "undefined") return;
  const preview = document.createElement("div");
  preview.style.position = "fixed";
  preview.style.left = "-10000px";
  preview.style.top = "-10000px";
  preview.style.pointerEvents = "none";
  preview.style.zIndex = "2147483647";
  preview.style.padding = "8px 10px";
  preview.style.borderRadius = "10px";
  preview.style.background = "rgba(15, 23, 42, 0.92)";
  preview.style.color = "#e2e8f0";
  preview.style.border = "1px solid rgba(148, 163, 184, 0.45)";
  preview.style.boxShadow = "0 8px 28px rgba(2, 6, 23, 0.45)";
  preview.style.font = "500 12px/1.2 Inter, system-ui, -apple-system, Segoe UI, sans-serif";
  preview.style.whiteSpace = "nowrap";
  preview.style.maxWidth = "360px";
  preview.style.textOverflow = "ellipsis";
  preview.style.overflow = "hidden";
  preview.textContent = count > 1 ? `${count} items` : label;

  document.body.appendChild(preview);
  dataTransfer.setDragImage(preview, 160, 16);

  requestAnimationFrame(() => {
    preview.remove();
  });
}