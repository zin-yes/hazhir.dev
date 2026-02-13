import { useFileSystem } from "@/hooks/use-file-system";
import { getHomePath } from "@/lib/system-user";
import { getCwd } from "./cd";

export type PathCompletionOptions = {
  includeFiles: boolean;
  includeDirs: boolean;
  includeHidden: boolean;
  appendDirSlash: boolean;
  includeDotDirs?: boolean;
};

export function getPathCompletions(
  currentToken: string,
  options: PathCompletionOptions
): string[] {
  const fs = useFileSystem();
  const token = currentToken ?? "";

  const expanded = token.replace(/^~(?=\/|$)/, getHomePath());
  const lastSlashIndex = expanded.lastIndexOf("/");
  const baseExpanded = lastSlashIndex >= 0 ? expanded.slice(0, lastSlashIndex + 1) : "";
  const baseDisplay = lastSlashIndex >= 0 ? token.slice(0, lastSlashIndex + 1) : "";
  const prefix = lastSlashIndex >= 0 ? expanded.slice(lastSlashIndex + 1) : expanded;

  const dirPath = expanded.startsWith("/")
    ? fs.normalizePath(baseExpanded || "/")
    : fs.normalizePath(`${getCwd()}/${baseExpanded}`);

  if (!fs.exists(dirPath) || !fs.isDirectory(dirPath)) return [];

  const items = fs.getChildren(dirPath, true).filter((item) => {
    if (!options.includeHidden && item.isHidden) return false;
    if (!options.includeFiles && item.type === "file") return false;
    if (!options.includeDirs && item.type === "directory") return false;
    return true;
  });

  const results = items.map((item) => {
    const suffix = item.type === "directory" && options.appendDirSlash ? "/" : "";
    return `${baseDisplay}${item.name}${suffix}`;
  });

  const dotDirs: string[] = [];
  if (options.includeDotDirs) {
    if ("./".startsWith(token)) dotDirs.push("./");
    if ("../".startsWith(token)) dotDirs.push("../");
  }

  return [...dotDirs, ...results].filter((value) => value.startsWith(token) || prefix === "");
}
