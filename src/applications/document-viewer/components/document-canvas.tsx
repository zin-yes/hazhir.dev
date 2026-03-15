"use client";

import { useMemo } from "react";
import {
  LIGHT_DOCUMENT_THEME,
  extractRenderableHtml,
  isHtmlLikeDocument,
} from "../lib/document-viewer-utils";

/**
 * Renders document content either as rich HTML (for .html/.htm/.document files)
 * or as plain preformatted text. HTML documents are rendered inside a light-themed
 * A4-width container with scoped styles.
 */
export default function DocumentCanvas({
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
