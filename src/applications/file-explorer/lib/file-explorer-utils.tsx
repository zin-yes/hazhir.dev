import { FileSystemNode } from "@/hooks/use-file-system";
import { isExecutableFile, isShortcutFile } from "@/lib/file-execution";
import { isImageFileName } from "@/lib/image-files";
import {
  getShortcutIconName,
  getShortcutIconUrl,
  parseShortcut,
} from "@/lib/shortcut";
import {
  BookOpen,
  BookText,
  Box,
  Calculator,
  Download,
  File,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileSymlink,
  FileText,
  FileVideo,
  Folder,
  FolderClosed,
  Gamepad2,
  Grid3X3,
  HardDrive,
  Home,
  Image,
  Music,
  Settings,
  TerminalSquare,
  User,
  Video,
} from "lucide-react";
import NextImage from "next/image";

/* ------------------------------------------------------------------ */
/*  File size formatting                                              */
/* ------------------------------------------------------------------ */

/**
 * Converts a byte count into a human-readable file size string.
 *
 * @param bytes     - The raw byte count to format.
 * @param useSiUnits - When true, uses SI units (kB, MB) with base-1000;
 *                     when false, uses binary units (KiB, MiB) with base-1024.
 * @param decimalPlaces - Number of decimal places in the formatted output.
 */
export function humanReadableFileSize(
  bytes: number,
  useSiUnits = false,
  decimalPlaces = 1,
): string {
  const threshold = useSiUnits ? 1000 : 1024;

  if (Math.abs(bytes) < threshold) {
    return bytes + " B";
  }

  const units = useSiUnits
    ? ["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
    : ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
  let unitIndex = -1;
  const roundingFactor = 10 ** decimalPlaces;

  do {
    bytes /= threshold;
    ++unitIndex;
  } while (
    Math.round(Math.abs(bytes) * roundingFactor) / roundingFactor >=
      threshold &&
    unitIndex < units.length - 1
  );

  return bytes.toFixed(decimalPlaces) + " " + units[unitIndex];
}

/** @deprecated Use `humanReadableFileSize` instead. Alias kept for backward compatibility. */
export const humanFileSize = humanReadableFileSize;

/* ------------------------------------------------------------------ */
/*  Date formatting                                                   */
/* ------------------------------------------------------------------ */

/**
 * Formats a Unix timestamp into a human-friendly relative date string.
 * Shows time for today, "Yesterday" if applicable, weekday name for
 * recent dates, and a short date for older entries.
 */
export function formatRelativeDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const differenceMilliseconds = now.getTime() - date.getTime();
  const differenceDays = Math.floor(
    differenceMilliseconds / (1000 * 60 * 60 * 24),
  );

  if (differenceDays === 0) {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } else if (differenceDays === 1) {
    return "Yesterday";
  } else if (differenceDays < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  } else {
    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  File icon resolution                                              */
/* ------------------------------------------------------------------ */

/**
 * Returns the appropriate icon JSX element for a given file system node,
 * considering directory type, shortcut files, executable files, image
 * thumbnails, and file extension.
 */
export function getFileIcon(
  node: FileSystemNode,
  iconSize: number = 18,
): React.ReactNode {
  /* ---- Directory icons ---- */
  if (node.type === "directory") {
    if (node.path === "/home" || node.name === "home") {
      return <Home size={iconSize} className="text-blue-400" />;
    }

    if (node.parentPath === "/home") {
      return <User size={iconSize} className="text-blue-400" />;
    }

    const directoryIconMap: Record<string, typeof Folder> = {
      Documents: FileText,
      applications: Grid3X3,
      Applications: Grid3X3,
      Downloads: Download,
      Pictures: Image,
      images: Image,
      Images: Image,
      Music: Music,
      Videos: Video,
      Desktop: HardDrive,
    };
    const DirectoryIconComponent = directoryIconMap[node.name] || Folder;
    return <DirectoryIconComponent size={iconSize} className="text-blue-400" />;
  }

  /* ---- Shortcut file icons ---- */
  if (isShortcutFile(node)) {
    const parsedShortcut = parseShortcut(node.contents ?? "");
    const shortcutIconUrl = parsedShortcut
      ? getShortcutIconUrl(parsedShortcut)
      : undefined;
    const shortcutIconName = parsedShortcut
      ? getShortcutIconName(parsedShortcut)
      : undefined;

    if (shortcutIconUrl) {
      const thumbnailDimension = Math.max(16, iconSize);
      return (
        <div
          className="overflow-hidden rounded-sm border border-border/70 bg-muted"
          style={{
            width: thumbnailDimension,
            height: thumbnailDimension,
          }}
        >
          <NextImage
            src={shortcutIconUrl}
            alt="icon"
            width={thumbnailDimension}
            height={thumbnailDimension}
            sizes={`${thumbnailDimension}px`}
            quality={45}
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>
      );
    }

    const shortcutIconByName: Record<string, ReturnType<typeof File>> = {
      TerminalSquare: (
        <TerminalSquare size={iconSize} className="text-cyan-400" />
      ),
      FolderClosed: <FolderClosed size={iconSize} className="text-cyan-400" />,
      Gamepad2: <Gamepad2 size={iconSize} className="text-cyan-400" />,
      Calculator: <Calculator size={iconSize} className="text-cyan-400" />,
      BookText: <BookText size={iconSize} className="text-cyan-400" />,
      BookOpen: <BookOpen size={iconSize} className="text-cyan-400" />,
      Box: <Box size={iconSize} className="text-cyan-400" />,
      Settings: <Settings size={iconSize} className="text-cyan-400" />,
      Image: <FileImage size={iconSize} className="text-cyan-400" />,
      Info: <FileText size={iconSize} className="text-cyan-400" />,
      FileSymlink: <FileSymlink size={iconSize} className="text-cyan-400" />,
    };

    if (shortcutIconName && shortcutIconByName[shortcutIconName]) {
      return shortcutIconByName[shortcutIconName];
    }

    return <File size={iconSize} className="text-cyan-400" />;
  }

  /* ---- Executable file icon ---- */
  if (isExecutableFile(node)) {
    return <TerminalSquare size={iconSize} className="text-orange-400" />;
  }

  /* ---- Image file thumbnail ---- */
  if (isImageFileName(node.name)) {
    const imageSource = node.contents?.trim() ?? "";
    if (imageSource) {
      const thumbnailDimension = Math.max(16, iconSize);
      return (
        <div
          className="overflow-hidden rounded-sm border border-border/70 bg-muted"
          style={{
            width: thumbnailDimension,
            height: thumbnailDimension,
          }}
        >
          <NextImage
            src={imageSource}
            alt={node.name}
            width={thumbnailDimension}
            height={thumbnailDimension}
            sizes={`${thumbnailDimension}px`}
            quality={45}
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>
      );
    }

    const thumbnailDimension = Math.max(16, iconSize);
    return (
      <div
        className="overflow-hidden rounded-sm border border-border/70 bg-muted"
        style={{
          width: thumbnailDimension,
          height: thumbnailDimension,
        }}
      />
    );
  }

  /* ---- Extension-based file icon ---- */
  const fileExtension = node.name.split(".").pop()?.toLowerCase();
  const extensionIconConfig: { icon: typeof File; color: string } = (() => {
    switch (fileExtension) {
      case "txt":
      case "md":
      case "document":
      case "doc":
      case "docx":
      case "pdf":
        return { icon: FileText, color: "text-gray-400" };
      case "js":
      case "ts":
      case "jsx":
      case "tsx":
      case "py":
      case "java":
      case "cpp":
      case "c":
      case "h":
      case "css":
      case "html":
      case "sh":
      case "bash":
        return { icon: FileCode, color: "text-green-400" };
      case "json":
      case "yaml":
      case "yml":
      case "xml":
      case "toml":
        return { icon: FileJson, color: "text-yellow-400" };
      case "mp3":
      case "wav":
      case "flac":
      case "ogg":
      case "m4a":
        return { icon: FileAudio, color: "text-purple-400" };
      case "mp4":
      case "mkv":
      case "avi":
      case "mov":
      case "webm":
        return { icon: FileVideo, color: "text-red-400" };
      default:
        return { icon: File, color: "text-gray-400" };
    }
  })();

  const ExtensionIconComponent = extensionIconConfig.icon;
  return (
    <ExtensionIconComponent
      size={iconSize}
      className={extensionIconConfig.color}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Display name resolution                                           */
/* ------------------------------------------------------------------ */

/**
 * Returns the user-visible display name for a file system node.
 * Shortcut files show their `display_name` metadata instead of the raw filename.
 */
export function getDisplayName(node: FileSystemNode): string {
  if (node.type === "file" && node.name.endsWith(".shortcut")) {
    const parsedShortcut = parseShortcut(node.contents ?? "");
    return parsedShortcut?.meta.display_name ?? node.name;
  }
  return node.name;
}

/* ------------------------------------------------------------------ */
/*  Editable file extension check                                     */
/* ------------------------------------------------------------------ */

/** File extensions that can be opened in the built-in text editor. */
const TEXT_EDITABLE_EXTENSIONS = new Set([
  "txt",
  "md",
  "document",
  "js",
  "ts",
  "jsx",
  "tsx",
  "json",
  "css",
  "html",
  "yml",
  "yaml",
  "xml",
  "toml",
  "shortcut",
  "app",
  "sh",
  "bash",
]);

/**
 * Checks whether a file node can be opened in the built-in text editor
 * based on its file extension.
 */
export function isTextEditableFile(node: FileSystemNode): boolean {
  if (node.type !== "file") return false;
  const extension = node.name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EDITABLE_EXTENSIONS.has(extension);
}
