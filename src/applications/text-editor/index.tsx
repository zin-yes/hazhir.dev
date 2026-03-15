"use client";

import FileExplorerApplication from "@/applications/file-explorer";
import ApplicationEmptyState from "@/components/system/application-empty-state";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { OS_LAUNCH_APPLICATION_EVENT } from "@/lib/application-launcher";
import { getHomePath } from "@/lib/system-user";
import MonacoEditor from "@monaco-editor/react";
import { FileSearch } from "lucide-react";

import EditorStatusBar from "./components/editor-status-bar";
import EditorToolbar from "./components/editor-toolbar";
import { useTextEditorState } from "./logic/use-text-editor-state";

interface TextEditorApplicationProps {
  filePath?: string;
  identifier: string;
  onRequestClose?: () => void;
}

export default function TextEditorApplication({
  filePath,
  identifier,
  onRequestClose,
}: TextEditorApplicationProps) {
  const editor = useTextEditorState(filePath, identifier, onRequestClose);
  const homePath = getHomePath();

  // Show file picker when no file is open
  if (!filePath) {
    return (
      <div
        ref={editor.shellContainerReference}
        className="h-full w-full bg-background"
      >
        <ApplicationEmptyState
          icon={<FileSearch className="size-5" />}
          title="No file open"
          description="Open a file to start editing."
          actionLabel="Open file"
          onAction={() => editor.setIsFilePickerOpen(true)}
        />

        <Dialog
          open={editor.isFilePickerOpen}
          onOpenChange={editor.setIsFilePickerOpen}
        >
          <DialogContent className="h-[min(90vh,860px)] w-[min(99vw,1720px)] max-w-[min(99vw,1720px)] overflow-hidden p-0 sm:max-w-[min(99vw,1720px)]">
            <FileExplorerApplication
              initialPath={`${homePath}/Documents`}
              picker={{
                enabled: true,
                selectionMode: "file",
                rootPath: homePath,
                onCancel: () => editor.setIsFilePickerOpen(false),
                onPick: (node) => {
                  editor.setIsFilePickerOpen(false);
                  window.dispatchEvent(
                    new CustomEvent(OS_LAUNCH_APPLICATION_EVENT, {
                      detail: {
                        appId: "text-editor",
                        args: [node.path],
                      },
                    }),
                  );
                  editor.closeEditorWindow();
                },
              }}
            />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <EditorToolbar
        fileName={editor.currentFileName}
        hasUnsavedChanges={editor.hasUnsavedChanges}
        onSave={editor.saveCurrentFile}
      />

      {/* Monaco code editor area */}
      <div className="flex flex-1 overflow-hidden">
        <MonacoEditor
          value={editor.fileContents}
          onChange={editor.handleEditorContentChange}
          theme="app-editor"
          language={editor.detectedLanguage}
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
          onMount={editor.handleEditorMount}
        />
      </div>

      <EditorStatusBar
        totalLineCount={editor.totalLineCount}
        totalCharacterCount={editor.totalCharacterCount}
      />
    </div>
  );
}
