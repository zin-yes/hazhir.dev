"use client";

import { useFileSystem, type FileSystemNode } from "@/hooks/use-file-system";
import { OS_LAUNCH_APPLICATION_EVENT } from "@/lib/application-launcher";
import { getHomePath } from "@/lib/system-user";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const LIGHT_DOCUMENT_THEME = {
  background: "#ffffff",
  foreground: "#16171d",
  mutedForeground: "#747986",
  border: "#e6e8ee",
  muted: "#f4f5f8",
};

function isHtmlLikeDocument(fileName: string, contents: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "html" || ext === "htm") return true;
  if (ext === "document") {
    return /<\s*(html|body|main|section|article|div|h1|h2|h3|p|span|ul|ol|li)\b/i.test(
      contents,
    );
  }
  return false;
}

function scopeCssToDocumentViewer(css: string): string {
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (full, rawSelector, rawBody) => {
    const selector = String(rawSelector).trim();
    const body = String(rawBody);
    if (!selector || selector.startsWith("@")) return full;

    const scopedSelectors = selector
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const normalized = item
          .replace(/(^|\s)html(\s|$)/g, "$1.document-viewer-rendered$2")
          .replace(/(^|\s)body(\s|$)/g, "$1.document-viewer-rendered$2")
          .replace(/^:root$/, ".document-viewer-rendered");

        if (normalized.startsWith(".document-viewer-rendered")) {
          return normalized;
        }

        return `.document-viewer-rendered ${normalized}`;
      })
      .join(", ");

    return `${scopedSelectors} {${body}}`;
  });
}

function extractRenderableHtml(contents: string): string {
  if (typeof window === "undefined") return contents;

  try {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(contents, "text/html");
    const hasHtmlElement = /<\s*html[\s>]/i.test(contents);

    if (hasHtmlElement) {
      const bodyMarkup = documentNode.body?.innerHTML?.trim() || "";
      const scopedStyleMarkup = Array.from(
        documentNode.head?.querySelectorAll("style") ?? [],
      )
        .map((styleElement) =>
          scopeCssToDocumentViewer(styleElement.textContent ?? ""),
        )
        .filter(Boolean)
        .map((styleText) => `<style>${styleText}</style>`)
        .join("\n");

      return `${scopedStyleMarkup}\n${bodyMarkup}`.trim();
    }

    return contents;
  } catch {
    return contents;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildPrintableDocumentHtml(fileName: string, contents: string): string {
  const printBaseStyle = `
    @page {
      size: A4;
      margin: 0;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #16171d;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page-break {
      display: none !important;
      break-before: auto !important;
      page-break-before: auto !important;
    }
    .entry-header {
      display: flex !important;
      flex-direction: row !important;
      align-items: flex-start !important;
      justify-content: space-between !important;
      gap: 12px !important;
    }
    .entry-title {
      flex: 1 1 auto !important;
      min-width: 0 !important;
    }
    .entry-meta,
    .entry-links {
      flex: 0 0 auto !important;
      justify-content: flex-end !important;
      text-align: right !important;
    }
  `;

  if (isHtmlLikeDocument(fileName, contents)) {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(contents, "text/html");
    const hasHtmlElement = /<\s*html[\s>]/i.test(contents);

    if (hasHtmlElement) {
      const head = documentNode.head ?? documentNode.createElement("head");
      const style = documentNode.createElement("style");
      style.textContent = printBaseStyle;
      head.appendChild(style);
      return `<!doctype html>\n${documentNode.documentElement.outerHTML}`;
    }

    const safeMarkup = extractRenderableHtml(contents);
    return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>${printBaseStyle}</style>
  </head>
  <body>
    ${safeMarkup}
  </body>
</html>`;
  }

  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      ${printBaseStyle}
      pre {
        margin: 0;
        padding: 20px;
        font-size: 14px;
        line-height: 1.6;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        white-space: pre-wrap;
        word-break: break-word;
      }
    </style>
  </head>
  <body>
    <pre>${escapeHtml(contents)}</pre>
  </body>
</html>`;
}

function DocumentCanvas({
  fileName,
  contents,
}: {
  fileName: string;
  contents: string;
}) {
  const htmlMarkup = useMemo(() => extractRenderableHtml(contents), [contents]);

  if (!contents.trim()) {
    return <div className="text-muted-foreground">(empty document)</div>;
  }

  if (isHtmlLikeDocument(fileName, contents)) {
    return (
      <div className="w-full py-2">
        <div
          className="mx-auto w-full max-w-[794px] rounded-md shadow-xl overflow-hidden"
          style={{
            width: "100%",
            maxWidth: "794px",
            backgroundColor: LIGHT_DOCUMENT_THEME.background,
            color: LIGHT_DOCUMENT_THEME.foreground,
            border: `1px solid ${LIGHT_DOCUMENT_THEME.border}`,
          }}
        >
          <div
            className="document-viewer-rendered min-h-[320px] w-full"
            style={{
              colorScheme: "light",
              backgroundColor: LIGHT_DOCUMENT_THEME.background,
              color: LIGHT_DOCUMENT_THEME.foreground,
              userSelect: "text",
              ["--background" as string]: LIGHT_DOCUMENT_THEME.background,
              ["--foreground" as string]: LIGHT_DOCUMENT_THEME.foreground,
              ["--muted-foreground" as string]:
                LIGHT_DOCUMENT_THEME.mutedForeground,
              ["--border" as string]: LIGHT_DOCUMENT_THEME.border,
              ["--fg" as string]: LIGHT_DOCUMENT_THEME.foreground,
              ["--muted" as string]: LIGHT_DOCUMENT_THEME.mutedForeground,
              ["--line" as string]: LIGHT_DOCUMENT_THEME.border,
              ["--chip" as string]: LIGHT_DOCUMENT_THEME.muted,
            }}
            onClickCapture={(event) => {
              const target = event.target as HTMLElement | null;
              if (!target) return;
              const anchor = target.closest(
                "a[href]",
              ) as HTMLAnchorElement | null;
              if (!anchor) return;

              const rawHref = anchor.getAttribute("href") ?? "";
              if (!rawHref || rawHref.startsWith("#")) return;

              event.preventDefault();
              event.stopPropagation();

              const href = anchor.href || rawHref;
              window.open(href, "_blank", "noopener,noreferrer");
            }}
            dangerouslySetInnerHTML={{ __html: htmlMarkup }}
          />
        </div>
      </div>
    );
  }

  return (
    <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed font-sans">
      {contents}
    </pre>
  );
}

export default function DocumentViewerApplication({
  filePath,
  mode = "full",
}: {
  filePath?: string;
  mode?: "full" | "single";
}) {
  const fs = useFileSystem();
  const documentsRootPath = `${getHomePath()}/Documents`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const singleScrollRef = useRef<HTMLDivElement | null>(null);
  const fullScrollRef = useRef<HTMLDivElement | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(
    filePath,
  );
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [showSinglePageDownHint, setShowSinglePageDownHint] = useState(false);
  const [showFullPageDownHint, setShowFullPageDownHint] = useState(false);

  const documentFiles = useMemo(() => {
    return fs.getChildren(documentsRootPath, true).filter((node) => {
      if (node.type !== "file") return false;
      const ext = node.name.split(".").pop()?.toLowerCase() ?? "";
      return ["document", "txt", "md", "pdf", "html", "htm"].includes(ext);
    });
  }, [documentsRootPath, fs]);

  useEffect(() => {
    if (filePath) {
      setSelectedPath(fs.normalizePath(filePath));
    }
  }, [filePath, fs]);

  const selected = useMemo<FileSystemNode | undefined>(() => {
    if (selectedPath) {
      const node = fs.getNode(selectedPath);
      if (node?.type === "file") return node;
    }
    return documentFiles[0];
  }, [documentFiles, fs, selectedPath]);

  const selectedContents = useMemo(() => {
    if (!selected) return "";
    return fs.getFileContents(selected.path) ?? "";
  }, [fs, selected]);

  const downloadSelectedDocument = async () => {
    if (!selected || isGeneratingPdf) return;

    setIsGeneratingPdf(true);

    try {
      const printableHtml = buildPrintableDocumentHtml(
        selected.name,
        selectedContents,
      );

      const printFrame = document.createElement("iframe");
      printFrame.setAttribute("aria-hidden", "true");
      printFrame.style.position = "fixed";
      printFrame.style.left = "-10000px";
      printFrame.style.top = "0";
      printFrame.style.width = "1200px";
      printFrame.style.height = "1200px";
      printFrame.style.border = "0";
      printFrame.style.opacity = "0";
      printFrame.srcdoc = printableHtml;

      const cleanup = () => {
        if (printFrame.parentNode) {
          printFrame.parentNode.removeChild(printFrame);
        }
        setIsGeneratingPdf(false);
      };

      printFrame.onload = () => {
        const frameWindow = printFrame.contentWindow;
        if (!frameWindow) {
          cleanup();
          return;
        }

        const afterPrint = () => {
          frameWindow.removeEventListener("afterprint", afterPrint);
          cleanup();
        };

        frameWindow.addEventListener("afterprint", afterPrint);
        frameWindow.focus();
        frameWindow.print();

        window.setTimeout(cleanup, 15_000);
      };

      document.body.appendChild(printFrame);
    } catch (error) {
      console.error("Failed to generate PDF", error);
      setIsGeneratingPdf(false);
    }
  };

  const getWindowElement = () =>
    containerRef.current?.closest(".applicationWindow") as HTMLDivElement | null;

  const closeWindow = () => {
    const windowElement = getWindowElement();
    if (!windowElement) return;

    windowElement.style.opacity = "0";
    windowElement.style.transform = "scale(0)";
    window.setTimeout(() => {
      const parent = windowElement.parentElement;
      if (parent?.contains(windowElement)) {
        parent.removeChild(windowElement);
      }
    }, 600);
  };

  const openInTextEditor = () => {
    if (!selected?.path) return;

    window.dispatchEvent(
      new CustomEvent(OS_LAUNCH_APPLICATION_EVENT, {
        detail: {
          appId: "text-editor",
          args: [selected.path],
        },
      }),
    );
  };

  const updatePageDownHint = (
    element: HTMLDivElement | null,
    setVisible: (visible: boolean) => void,
  ) => {
    if (!element) {
      setVisible(false);
      return;
    }

    const hasOverflow = element.scrollHeight - element.clientHeight > 8;
    const isAtTop = element.scrollTop <= 2;
    setVisible(hasOverflow && isAtTop);
  };

  useEffect(() => {
    const element = singleScrollRef.current;
    if (!element || mode !== "single") return;

    const sync = () => updatePageDownHint(element, setShowSinglePageDownHint);
    sync();

    element.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(element);

    return () => {
      element.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      resizeObserver.disconnect();
    };
  }, [mode, selected?.path, selectedContents]);

  useEffect(() => {
    const element = fullScrollRef.current;
    if (!element || mode === "single") return;

    const sync = () => updatePageDownHint(element, setShowFullPageDownHint);
    sync();

    element.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(element);

    return () => {
      element.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      resizeObserver.disconnect();
    };
  }, [mode, selected?.path, selectedContents]);

  const pageDown = (element: HTMLDivElement | null) => {
    if (!element) return;

    element.scrollBy({
      top: Math.max(element.clientHeight - 48, 160),
      behavior: "smooth",
    });
  };

  const missingRequested = Boolean(filePath && !fs.getNode(filePath));

  if (!selected && documentFiles.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        No documents found in Documents.
      </div>
    );
  }

  if (mode === "single") {
    return (
      <div
        ref={containerRef}
        className="relative flex h-full w-full flex-col bg-background text-foreground"
      >
        <div ref={singleScrollRef} className="relative flex-1 overflow-y-auto">
          {selected ? (
            <div className="px-5 py-4">
              <DocumentCanvas
                fileName={selected.name}
                contents={selectedContents}
              />
            </div>
          ) : (
            <div className="px-5 py-4 text-muted-foreground">
              No document selected.
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => pageDown(singleScrollRef.current)}
          aria-label="Scroll down one page"
          title="Page down"
          className={cn(
            "absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border bg-background/90 p-2 shadow-md backdrop-blur transition-opacity duration-150 ease-out hover:bg-accent hover:text-accent-foreground",
            showSinglePageDownHint
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0",
          )}
        >
          <ChevronDown className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full bg-background text-foreground flex flex-col">
      <div className="flex flex-1 min-h-0">
        <aside className="w-64 border-r border-border/60 flex flex-col">
          <div className="px-4 py-3 text-sm font-semibold">Documents</div>
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            <ul>
              {documentFiles.map((doc) => {
                const isActive = doc.path === selected?.path;
                return (
                  <li key={doc.path}>
                    <button
                      type="button"
                      onClick={() => setSelectedPath(doc.path)}
                      className={cn(
                        "w-full text-left rounded-md px-3 py-2 transition-colors",
                        "hover:bg-accent hover:text-accent-foreground",
                        isActive && "bg-accent text-accent-foreground",
                      )}
                    >
                      <div className="text-sm font-medium">{doc.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {doc.path}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        <div className="relative flex-1 bg-muted/30">
          <div ref={fullScrollRef} className="h-full overflow-y-auto">
            {missingRequested ? (
              <div className="px-5 pt-2 text-xs text-destructive">
                Requested path "{filePath}" was not found. Showing the first
                available document instead.
              </div>
            ) : null}
            <div className="px-5 py-4 min-h-full">
              {selected ? (
                <DocumentCanvas
                  fileName={selected.name}
                  contents={selectedContents}
                />
              ) : (
                <div className="text-muted-foreground">No document selected.</div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => pageDown(fullScrollRef.current)}
            aria-label="Scroll down one page"
            title="Page down"
            className={cn(
              "absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border bg-background/90 p-2 shadow-md backdrop-blur transition-opacity duration-150 ease-out hover:bg-accent hover:text-accent-foreground",
              showFullPageDownHint
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0",
            )}
          >
            <ChevronDown className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
