"use client";

import { useFileSystem } from "@/hooks/use-file-system";
import UseOperatingSystem from "@/hooks/use-operating-system";
import type { Monaco } from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectLanguageFromFileName } from "./language-detection";

/**
 * Encapsulates all text editor state and business logic:
 * file loading, saving, external change detection,
 * Monaco theme configuration, and window-close behaviour.
 */
export function useTextEditorState(
  filePath: string | undefined,
  instanceIdentifier: string,
  onRequestClose?: () => void,
) {
  const fileSystem = useFileSystem();
  const operatingSystem = UseOperatingSystem();

  const [fileContents, setFileContents] = useState<string>("");
  const [savedFileContents, setSavedFileContents] = useState<string>("");
  const [currentFileName, setCurrentFileName] = useState<string>("");
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);

  const shellContainerReference = useRef<HTMLDivElement | null>(null);
  const monacoEditorInstanceReference = useRef<
    import("monaco-editor").editor.IStandaloneCodeEditor | null
  >(null);
  const monacoApiReference = useRef<Monaco | null>(null);
  const lastLoadedFilePathReference = useRef<string | null>(null);

  const hasUnsavedChanges = fileContents !== savedFileContents;

  const totalLineCount = fileContents.split("\n").length;
  const totalCharacterCount = fileContents.length;

  const detectedLanguage = useMemo(
    () => detectLanguageFromFileName(currentFileName, filePath),
    [currentFileName, filePath],
  );

  // Close the editor window with an animation
  const closeEditorWindow = useCallback(() => {
    const windowElement = shellContainerReference.current?.closest(
      ".applicationWindow",
    ) as HTMLDivElement | null;
    if (!windowElement) return;

    windowElement.style.opacity = "0";
    windowElement.style.transform = "scale(0)";

    if (onRequestClose) {
      window.setTimeout(() => {
        onRequestClose();
      }, 600);
      return;
    }

    window.setTimeout(() => {
      const parentElement = windowElement.parentElement;
      if (parentElement?.contains(windowElement)) {
        parentElement.removeChild(windowElement);
      }
    }, 600);
  }, [onRequestClose]);

  // Initialize file contents when filePath changes
  useEffect(() => {
    if (!filePath) {
      lastLoadedFilePathReference.current = null;
      setCurrentFileName("Text Editor");
      setFileContents("");
      setSavedFileContents("");
      operatingSystem.setApplicationWindowTitle(
        instanceIdentifier,
        "Text Editor",
      );
      return;
    }

    if (lastLoadedFilePathReference.current === filePath) {
      return;
    }
    lastLoadedFilePathReference.current = filePath;

    const fileNode = fileSystem.getNode(filePath);
    const loadedContents = fileSystem.getFileContents(filePath) || "";

    if (fileNode && fileNode.type === "file") {
      setFileContents(loadedContents);
      setSavedFileContents(loadedContents);
      setCurrentFileName(fileNode.name);
      operatingSystem.setApplicationWindowTitle(
        instanceIdentifier,
        `Text Editor - ${fileNode.name}`,
      );
    } else {
      // File might be new or path might just be a name
      const extractedName = filePath.split("/").pop() || "Untitled";
      setCurrentFileName(extractedName);
      setFileContents(loadedContents);
      setSavedFileContents(loadedContents);
    }
  }, [filePath, fileSystem, instanceIdentifier, operatingSystem]);

  // Update window title when modification state changes
  useEffect(() => {
    if (currentFileName) {
      const modifiedIndicator = hasUnsavedChanges ? " ●" : "";
      operatingSystem.setApplicationWindowTitle(
        instanceIdentifier,
        `Text Editor - ${currentFileName}${modifiedIndicator}`,
      );
    }
  }, [hasUnsavedChanges, currentFileName, instanceIdentifier, operatingSystem]);

  // Listen for external file changes (e.g. from another editor instance)
  useEffect(() => {
    if (!filePath) return;

    const handleExternalStorageChange = () => {
      const externalContents = fileSystem.getFileContents(filePath);
      if (externalContents !== undefined && !hasUnsavedChanges) {
        setFileContents(externalContents);
        setSavedFileContents(externalContents);
      }
    };

    window.addEventListener("storage", handleExternalStorageChange);
    return () =>
      window.removeEventListener("storage", handleExternalStorageChange);
  }, [filePath, fileSystem, hasUnsavedChanges]);

  // Handle editor content changes from Monaco
  const handleEditorContentChange = useCallback((updatedContent?: string) => {
    if (updatedContent === undefined) return;
    setFileContents(updatedContent);
  }, []);

  // Persist file contents to the virtual file system
  const saveCurrentFile = useCallback(() => {
    if (!filePath) return;
    if (fileSystem.updateFile(filePath, fileContents)) {
      setSavedFileContents(fileContents);
    }
  }, [filePath, fileContents, fileSystem]);

  // Register global Ctrl+S / Cmd+S keyboard shortcut
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        saveCurrentFile();
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [saveCurrentFile]);

  // Resolve editor background color for the custom theme
  const resolveEditorBackgroundColor = useCallback(() => "#09090b", []);

  // Apply the custom Monaco theme with the resolved background color
  const applyCustomMonacoTheme = useCallback(() => {
    if (!monacoApiReference.current) return;

    const backgroundColor = resolveEditorBackgroundColor();

    monacoApiReference.current.editor.defineTheme("app-editor", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": backgroundColor,
      },
    });
    monacoApiReference.current.editor.setTheme("app-editor");
  }, [resolveEditorBackgroundColor]);

  useEffect(() => {
    applyCustomMonacoTheme();
  }, [applyCustomMonacoTheme]);

  // Monaco editor mount handler — stores references and applies theme
  const handleEditorMount = useCallback(
    (
      editor: import("monaco-editor").editor.IStandaloneCodeEditor,
      monaco: Monaco,
    ) => {
      monacoEditorInstanceReference.current = editor;
      monacoApiReference.current = monaco;
      applyCustomMonacoTheme();
    },
    [applyCustomMonacoTheme],
  );

  return {
    fileContents,
    currentFileName,
    isFilePickerOpen,
    setIsFilePickerOpen,
    hasUnsavedChanges,
    totalLineCount,
    totalCharacterCount,
    detectedLanguage,
    shellContainerReference,
    closeEditorWindow,
    handleEditorContentChange,
    saveCurrentFile,
    handleEditorMount,
  };
}
