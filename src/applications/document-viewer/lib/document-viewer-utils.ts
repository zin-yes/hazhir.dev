/**
 * Utility functions for the document viewer application.
 * Handles HTML processing, CSS scoping, and print-ready document generation.
 */

/** Light theme color palette used for rendering document content */
export const LIGHT_DOCUMENT_THEME = {
  background: "#ffffff",
  foreground: "#16171d",
  mutedForeground: "#747986",
  border: "#e6e8ee",
  muted: "#f4f5f8",
} as const;

/** Determines whether a file should be rendered as rich HTML content */
export function isHtmlLikeDocument(
  fileName: string,
  contents: string,
): boolean {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "html" || extension === "htm") return true;
  if (extension === "document") {
    return /<\s*(html|body|main|section|article|div|h1|h2|h3|p|span|ul|ol|li)\b/i.test(
      contents,
    );
  }
  return false;
}

/**
 * Rewrites CSS selectors to be scoped under `.document-viewer-rendered`,
 * preventing document styles from leaking into the host application.
 */
export function scopeCssToDocumentViewer(css: string): string {
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

/**
 * Extracts renderable HTML from raw document content.
 * If the content contains a full <html> structure, the body and scoped styles are extracted.
 */
export function extractRenderableHtml(contents: string): string {
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

/** Escapes special HTML characters to prevent injection when rendering plain text */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Builds a full HTML document suitable for printing/PDF export.
 * Applies A4 page sizing and appropriate styling based on content type.
 */
export function buildPrintableDocumentHtml(
  fileName: string,
  contents: string,
): string {
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
