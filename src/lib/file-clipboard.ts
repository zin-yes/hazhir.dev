export type FileClipboardMode = "copy" | "cut";

export type FileClipboardPayload = {
  paths: string[];
  mode: FileClipboardMode;
  updatedAt: number;
};

const FILE_CLIPBOARD_STORAGE_KEY = "file_clipboard_v1";
const FILE_CLIPBOARD_EVENT = "file-clipboard-change";

function safeReadStorage(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(FILE_CLIPBOARD_STORAGE_KEY);
}

export function getFileClipboard(): FileClipboardPayload | null {
  try {
    const raw = safeReadStorage();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FileClipboardPayload;
    if (!parsed || !Array.isArray(parsed.paths) || !parsed.mode) return null;
    return {
      mode: parsed.mode,
      paths: parsed.paths.filter((path) => typeof path === "string"),
      updatedAt:
        typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function setFileClipboard(payload: FileClipboardPayload | null): void {
  if (typeof window === "undefined") return;

  if (!payload || payload.paths.length === 0) {
    window.localStorage.removeItem(FILE_CLIPBOARD_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(FILE_CLIPBOARD_EVENT, { detail: null }));
    return;
  }

  const nextPayload: FileClipboardPayload = {
    mode: payload.mode,
    paths: payload.paths,
    updatedAt: payload.updatedAt ?? Date.now(),
  };

  window.localStorage.setItem(
    FILE_CLIPBOARD_STORAGE_KEY,
    JSON.stringify(nextPayload),
  );
  window.dispatchEvent(
    new CustomEvent(FILE_CLIPBOARD_EVENT, { detail: nextPayload }),
  );
}

export function subscribeToFileClipboard(
  listener: (clipboard: FileClipboardPayload | null) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const notify = () => {
    listener(getFileClipboard());
  };

  const onCustomEvent = () => notify();
  const onStorageEvent = () => notify();

  window.addEventListener(FILE_CLIPBOARD_EVENT, onCustomEvent as EventListener);
  window.addEventListener("storage", onStorageEvent);

  return () => {
    window.removeEventListener(
      FILE_CLIPBOARD_EVENT,
      onCustomEvent as EventListener,
    );
    window.removeEventListener("storage", onStorageEvent);
  };
}
