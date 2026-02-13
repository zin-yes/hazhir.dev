"use client";

import FileExplorerApplication from "@/applications/file-explorer";
import ApplicationEmptyState from "@/components/system/application-empty-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useFileSystem } from "@/hooks/use-file-system";
import UseOperatingSystem from "@/hooks/use-operating-system";
import { OS_LAUNCH_APPLICATION_EVENT } from "@/lib/application-launcher";
import { getHomePath } from "@/lib/system-user";
import MonacoEditor, { type Monaco } from "@monaco-editor/react";
import { FileSearch, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface TextEditorProps {
  filePath?: string;
  identifier: string;
}

export default function TextEditorApplication({
  filePath,
  identifier,
}: TextEditorProps) {
  const fs = useFileSystem();
  const operatingSystem = UseOperatingSystem();

  const [contents, setContents] = useState<string>("");
  const [originalContents, setOriginalContents] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [editorTheme] = useState<"vs-dark">("vs-dark");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const editorRef = useRef<
    import("monaco-editor").editor.IStandaloneCodeEditor | null
  >(null);
  const monacoRef = useRef<Monaco | null>(null);
  const lastLoadedPathRef = useRef<string | null>(null);

  const isModified = contents !== originalContents;

  const closeWindow = useCallback(() => {
    const windowElement = shellRef.current?.closest(
      ".applicationWindow",
    ) as HTMLDivElement | null;
    if (!windowElement) return;

    windowElement.style.opacity = "0";
    windowElement.style.transform = "scale(0)";
    window.setTimeout(() => {
      const parent = windowElement.parentElement;
      if (parent?.contains(windowElement)) {
        parent.removeChild(windowElement);
      }
    }, 600);
  }, []);

  // Initialize file contents
  useEffect(() => {
    if (!filePath) {
      lastLoadedPathRef.current = null;
      setFileName("Text Editor");
      setContents("");
      setOriginalContents("");
      operatingSystem.setApplicationWindowTitle(identifier, "Text Editor");
      return;
    }

    if (lastLoadedPathRef.current === filePath) {
      return;
    }
    lastLoadedPathRef.current = filePath;

    const node = fs.getNode(filePath);
    const fileContents = fs.getFileContents(filePath) || "";

    if (node && node.type === "file") {
      setContents(fileContents);
      setOriginalContents(fileContents);
      setFileName(node.name);

      operatingSystem.setApplicationWindowTitle(
        identifier,
        `Text Editor - ${node.name}`,
      );
    } else {
      // File might be new or path might just be a name
      const name = filePath.split("/").pop() || "Untitled";
      setFileName(name);
      setContents(fileContents);
      setOriginalContents(fileContents);
    }
  }, [filePath, fs, identifier, operatingSystem]);

  // Update title when modified state changes
  useEffect(() => {
    if (fileName) {
      operatingSystem.setApplicationWindowTitle(
        identifier,
        `Text Editor - ${fileName}${isModified ? " ●" : ""}`,
      );
    }
  }, [isModified, fileName, identifier, operatingSystem]);

  // Listen for external file changes
  useEffect(() => {
    if (!filePath) return;

    const handleStorageChange = () => {
      const fileContents = fs.getFileContents(filePath);
      if (fileContents !== undefined) {
        // Only update if we haven't modified locally
        if (!isModified) {
          setContents(fileContents);
          setOriginalContents(fileContents);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [filePath, fs, isModified]);

  const handleContentChange = useCallback((newContent?: string) => {
    if (newContent === undefined) {
      return;
    }
    setContents(newContent);
  }, []);

  const saveFile = useCallback(() => {
    if (!filePath) return;
    if (fs.updateFile(filePath, contents)) {
      setOriginalContents(contents);
    }
  }, [filePath, contents, fs]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "s") {
          e.preventDefault();
          saveFile();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveFile]);

  const resolveEditorBackground = useCallback(() => "#09090b", []);

  const applyMonacoTheme = useCallback(() => {
    if (!monacoRef.current) return;

    const background = resolveEditorBackground();

    monacoRef.current.editor.defineTheme("app-editor", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": background,
      },
    });
    monacoRef.current.editor.setTheme("app-editor");
  }, [editorTheme, resolveEditorBackground]);

  useEffect(() => {
    applyMonacoTheme();
  }, [applyMonacoTheme]);

  const lineCount = contents.split("\n").length;
  const language = useMemo(() => {
    const name = fileName || filePath?.split("/").pop() || "";
    const ext = name.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "ts":
      case "tsx":
        return "typescript";
      case "js":
      case "jsx":
        return "javascript";
      case "json":
        return "json";
      case "css":
        return "css";
      case "html":
      case "htm":
      case "document":
        return "html";
      case "md":
      case "markdown":
        return "markdown";
      case "yml":
      case "yaml":
        return "yaml";
      case "py":
        return "python";
      case "sh":
      case "bash":
        return "shell";
      case "sql":
        return "sql";
      case "xml":
        return "xml";
      case "toml":
        return "toml";
      default:
        return "plaintext";
    }
  }, [fileName, filePath]);

  if (!filePath) {
    return (
      <div ref={shellRef} className="h-full w-full bg-background">
        <ApplicationEmptyState
          icon={<FileSearch className="size-5" />}
          title="No file open"
          description="Open a file to start editing."
          actionLabel="Open file"
          onAction={() => setIsPickerOpen(true)}
        />

        <Dialog open={isPickerOpen} onOpenChange={setIsPickerOpen}>
          <DialogContent className="w-[min(99vw,1720px)] max-w-[min(99vw,1720px)] sm:max-w-[min(99vw,1720px)] h-[min(90vh,860px)] p-0 overflow-hidden">
            <FileExplorerApplication
              initialPath={`${getHomePath()}/Documents`}
              picker={{
                enabled: true,
                selectionMode: "file",
                rootPath: getHomePath(),
                onCancel: () => setIsPickerOpen(false),
                onPick: (node) => {
                  setIsPickerOpen(false);
                  window.dispatchEvent(
                    new CustomEvent(OS_LAUNCH_APPLICATION_EVENT, {
                      detail: {
                        appId: "text-editor",
                        args: [node.path],
                      },
                    }),
                  );
                  closeWindow();
                },
              }}
            />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-background flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="text-sm text-foreground font-medium">
          {fileName}
          {isModified && (
            <span className="text-orange-500 text-xs ml-2">(unsaved)</span>
          )}
        </div>
        <Button onClick={saveFile} disabled={!isModified} size="sm">
          <Save className="w-4 h-4 mr-2" />
          Save
        </Button>
      </div>

      {/* Editor Area */}
      <div className="flex-1 flex overflow-hidden">
        <MonacoEditor
          value={contents}
          onChange={handleContentChange}
          theme="app-editor"
          language={language}
          options={{
            minimap: { enabled: false },
            lineNumbers: "on",
            wordWrap: "on",
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            tabSize: 4,
            renderLineHighlight: "all",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 12, bottom: 12 },
          }}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            monacoRef.current = monaco;
            applyMonacoTheme();
          }}
        />
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-3 py-1 border-t bg-muted/30 text-xs text-muted-foreground">
        <span>Lines: {lineCount}</span>
        <span>Characters: {contents.length}</span>
      </div>
    </div>
  );
}
