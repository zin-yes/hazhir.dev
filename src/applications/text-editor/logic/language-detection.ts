/**
 * Maps file extensions to Monaco editor language identifiers.
 * Used to determine syntax highlighting for the active file.
 */

const FILE_EXTENSION_TO_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  css: "css",
  html: "html",
  htm: "html",
  document: "html",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  sh: "shell",
  bash: "shell",
  sql: "sql",
  xml: "xml",
  toml: "toml",
};

/**
 * Determines the Monaco editor language from a filename or file path.
 * Falls back to "plaintext" if the extension is not recognized.
 */
export function detectLanguageFromFileName(
  fileName: string | undefined,
  filePath: string | undefined,
): string {
  const resolvedName = fileName || filePath?.split("/").pop() || "";
  const fileExtension = resolvedName.split(".").pop()?.toLowerCase();

  if (!fileExtension) {
    return "plaintext";
  }

  return FILE_EXTENSION_TO_LANGUAGE_MAP[fileExtension] ?? "plaintext";
}
