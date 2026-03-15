"use client";

import FileExplorerApplication from "@/applications/file-explorer";
import ApplicationEmptyState from "@/components/system/application-empty-state";
import ScrollMoreButton from "@/components/system/scroll-more-button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useFileSystem, type FileSystemNode } from "@/hooks/use-file-system";
import { OS_LAUNCH_APPLICATION_EVENT } from "@/lib/application-launcher";
import { getHomePath } from "@/lib/system-user";
import { FileSearch } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import DocumentCanvas from "./components/document-canvas";
import { buildPrintableDocumentHtml } from "./lib/document-viewer-utils";

export default function DocumentViewerApplication({
  filePath,
  mode = "full",
}: {
  filePath?: string;
  mode?: "full" | "single";
}) {
  const fileSystem = useFileSystem();
  const documentsRootPath = `${getHomePath()}/Documents`;
  const containerReference = useRef<HTMLDivElement | null>(null);
  const singleScrollReference = useRef<HTMLDivElement | null>(null);
  const fullScrollReference = useRef<HTMLDivElement | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(
    filePath,
  );
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const documentFiles = useMemo(() => {
    return fileSystem.getChildren(documentsRootPath, true).filter((node) => {
      if (node.type !== "file") return false;
      const extension = node.name.split(".").pop()?.toLowerCase() ?? "";
      return ["document", "txt", "md", "pdf", "html", "htm"].includes(
        extension,
      );
    });
  }, [documentsRootPath, fileSystem]);

  useEffect(() => {
    if (filePath) {
      setSelectedPath(fileSystem.normalizePath(filePath));
      return;
    }
    setSelectedPath(undefined);
    // Intentionally only react to external filePath changes.
    // Local selections (via picker/sidebar) should not be reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  const selectedDocument = useMemo<FileSystemNode | undefined>(() => {
    if (selectedPath) {
      const node = fileSystem.getNode(selectedPath);
      if (node?.type === "file") return node;
    }
    return undefined;
  }, [fileSystem, selectedPath]);

  const selectedContents = useMemo(() => {
    if (!selectedDocument) return "";
    return fileSystem.getFileContents(selectedDocument.path) ?? "";
  }, [fileSystem, selectedDocument]);

  const downloadSelectedDocument = async () => {
    if (!selectedDocument || isGeneratingPdf) return;

    setIsGeneratingPdf(true);

    try {
      const printableHtml = buildPrintableDocumentHtml(
        selectedDocument.name,
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
    containerReference.current?.closest(
      ".applicationWindow",
    ) as HTMLDivElement | null;

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
    if (!selectedDocument?.path) return;

    window.dispatchEvent(
      new CustomEvent(OS_LAUNCH_APPLICATION_EVENT, {
        detail: {
          appId: "text-editor",
          args: [selectedDocument.path],
        },
      }),
    );
  };

  const emptyStateView = (
    <div className="h-full w-full bg-background">
      <ApplicationEmptyState
        icon={<FileSearch className="size-5" />}
        title="No file open"
        description="Open a document to start reading. This viewer accepts only .document files."
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
              allowedFileExtensions: ["document"],
              rootPath: getHomePath(),
              onCancel: () => setIsPickerOpen(false),
              onPick: (node) => {
                setIsPickerOpen(false);
                window.dispatchEvent(
                  new CustomEvent(OS_LAUNCH_APPLICATION_EVENT, {
                    detail: {
                      appId: "document-viewer",
                      args: [node.path, node.name],
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

  if (mode === "single") {
    if (!selectedDocument) {
      return emptyStateView;
    }

    return (
      <div
        ref={containerReference}
        className="relative flex h-full w-full flex-col bg-background text-foreground"
      >
        <div
          ref={singleScrollReference}
          className="relative flex-1 overflow-y-auto"
        >
          <div className="px-5 py-4">
            <DocumentCanvas
              fileName={selectedDocument.name}
              contents={selectedContents}
            />
          </div>
        </div>
        <ScrollMoreButton scrollElementRef={singleScrollReference} />
      </div>
    );
  }

  return (
    <div
      ref={containerReference}
      className="w-full h-full bg-background text-foreground flex flex-col"
    >
      {!selectedDocument ? (
        emptyStateView
      ) : (
        <div className="relative flex-1 bg-muted/30">
          <div ref={fullScrollReference} className="h-full overflow-y-auto">
            <div className="px-5 py-4 min-h-full">
              {selectedDocument ? (
                <DocumentCanvas
                  fileName={selectedDocument.name}
                  contents={selectedContents}
                />
              ) : (
                <div className="text-muted-foreground">
                  No document selected.
                </div>
              )}
            </div>
          </div>
          <ScrollMoreButton scrollElementRef={fullScrollReference} />
        </div>
      )}
    </div>
  );
}
