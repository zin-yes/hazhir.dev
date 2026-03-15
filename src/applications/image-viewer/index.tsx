"use client";

import FileExplorerApplication from "@/applications/file-explorer";
import ApplicationEmptyState from "@/components/system/application-empty-state";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { IMAGE_EXTENSIONS } from "@/lib/image-files";
import { FileSearch } from "lucide-react";
import Image from "next/image";

import ImageInfoPanel from "./components/image-info-panel";
import ImageNavigationButtons from "./components/image-navigation-buttons";
import ImageViewerToolbar from "./components/image-viewer-toolbar";
import ZoomMinimap from "./components/zoom-minimap";
import { useImageViewerState } from "./logic/use-image-viewer-state";

type ImageViewerApplicationProps = {
  initialFilePath?: string;
};

export default function ImageViewerApplication({
  initialFilePath,
}: ImageViewerApplicationProps) {
  const state = useImageViewerState(initialFilePath);

  // If no file is selected, show the empty state with a file picker dialog
  if (!state.currentNode && !state.imageNodes.length) {
    return (
      <div className="h-full w-full bg-background">
        <ApplicationEmptyState
          icon={<FileSearch className="size-5" />}
          title="No file open"
          description="Open an image to start viewing."
          actionLabel="Open file"
          onAction={() => state.setIsPickerOpen(true)}
        />

        <Dialog open={state.isPickerOpen} onOpenChange={state.setIsPickerOpen}>
          <DialogContent className="h-[min(90vh,860px)] w-[min(99vw,1720px)] max-w-[min(99vw,1720px)] overflow-hidden p-0 sm:max-w-[min(99vw,1720px)]">
            <FileExplorerApplication
              initialPath={`${state.homePath}/Documents`}
              picker={{
                enabled: true,
                selectionMode: "file",
                allowedFileExtensions: [...IMAGE_EXTENSIONS],
                rootPath: state.homePath,
                onCancel: () => state.setIsPickerOpen(false),
                onPick: (node) => {
                  state.setIsPickerOpen(false);
                  state.setSelectedFilePath(node.path);
                },
              }}
            />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (!state.imageNodes.length) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        No images found in {state.imagesPath}
      </div>
    );
  }

  const zoomedCursorClass =
    state.zoomLevel > 1
      ? state.isPanning
        ? "cursor-grabbing"
        : "cursor-grab"
      : "";

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <ImageViewerToolbar
        currentImageName={state.currentNode?.name}
        currentIndex={state.currentIndex}
        totalImageCount={state.imageNodes.length}
        isInfoPanelVisible={state.isInfoPanelVisible}
        onZoomIn={() => state.applyZoomStep(0.25)}
        onZoomOut={() => state.applyZoomStep(-0.25)}
        onToggleInfoPanel={() =>
          state.setIsInfoPanelVisible((previous) => !previous)
        }
      />

      <div className="group relative min-h-0 flex-1 bg-muted/20">
        {/* Scrollable viewport for zoomed/panned image */}
        <div
          ref={state.viewportReference}
          className={`h-full overflow-auto ${zoomedCursorClass}`}
          onPointerDown={state.handleViewportPointerDown}
          onPointerMove={state.handleViewportPointerMove}
          onPointerUp={state.handleViewportPointerUp}
          onPointerCancel={state.handleViewportPointerCancel}
          onKeyDown={(event) => {
            if (event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
              event.preventDefault();
              state.navigateToPreviousImage();
            } else if (
              event.key === "ArrowRight" ||
              event.key.toLowerCase() === "d"
            ) {
              event.preventDefault();
              state.navigateToNextImage();
            }
          }}
          tabIndex={0}
        >
          <div
            className="relative transition-[width,height] duration-200 ease-out"
            style={{
              width: state.canvasSize.width,
              height: state.canvasSize.height,
            }}
          >
            <div
              ref={state.imageFrameReference}
              className="relative shrink-0 transition-[width,height,left,top] duration-200 ease-out"
              style={{
                width: state.renderedImageSize.width || 1,
                height: state.renderedImageSize.height || 1,
                left: state.imageFramePosition.left,
                top: state.imageFramePosition.top,
                position: "absolute",
              }}
            >
              {state.currentImageSource ? (
                <Image
                  src={state.currentImageSource}
                  alt={state.currentNode?.name ?? "Image"}
                  fill
                  sizes="(max-width: 1400px) 100vw, 1400px"
                  quality={82}
                  className={`object-contain select-none ${state.useSwipePresentation ? "opacity-0" : "opacity-100"}`}
                  draggable={false}
                  onLoadingComplete={(imageElement) => {
                    state.setNaturalImageSize({
                      width: imageElement.naturalWidth,
                      height: imageElement.naturalHeight,
                    });
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                  Unable to load image source.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Swipe carousel overlay (visible only at zoom=1) */}
        {state.currentImageSource && state.useSwipePresentation ? (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {/* Previous image slide */}
            <div
              className={`absolute inset-0 ${state.isSwipeAnimating ? "transition-transform duration-200 ease-out" : ""}`}
              style={{
                transform: `translate3d(${-state.swipeLaneWidth + state.swipeOffsetX}px,0,0)`,
              }}
            >
              <Image
                src={state.previousImageSource || state.currentImageSource}
                alt="Previous image"
                fill
                sizes="(max-width: 1400px) 100vw, 1400px"
                quality={72}
                className={`object-contain select-none ${state.showAdjacentSlides ? "opacity-100" : "opacity-0"}`}
                draggable={false}
              />
            </div>

            {/* Current image slide */}
            <div
              className={`absolute inset-0 ${state.isSwipeAnimating ? "transition-transform duration-200 ease-out" : ""}`}
              style={{
                transform: `translate3d(${state.swipeOffsetX}px,0,0)`,
              }}
            >
              <Image
                src={state.currentImageSource}
                alt={state.currentNode?.name ?? "Image"}
                fill
                sizes="(max-width: 1400px) 100vw, 1400px"
                quality={82}
                className="object-contain select-none"
                draggable={false}
              />
            </div>

            {/* Next image slide */}
            <div
              className={`absolute inset-0 ${state.isSwipeAnimating ? "transition-transform duration-200 ease-out" : ""}`}
              style={{
                transform: `translate3d(${state.swipeLaneWidth + state.swipeOffsetX}px,0,0)`,
              }}
            >
              <Image
                src={state.nextImageSource || state.currentImageSource}
                alt="Next image"
                fill
                sizes="(max-width: 1400px) 100vw, 1400px"
                quality={72}
                className={`object-contain select-none ${state.showAdjacentSlides ? "opacity-100" : "opacity-0"}`}
                draggable={false}
              />
            </div>
          </div>
        ) : null}

        {/* Previous / Next navigation buttons */}
        <ImageNavigationButtons
          onPrevious={state.navigateToPreviousImage}
          onNext={state.navigateToNextImage}
        />

        {/* Minimap overlay for zoomed view */}
        {state.shouldShowMinimap &&
        state.minimapSize &&
        state.minimapGeometry ? (
          <ZoomMinimap
            currentImageSource={state.currentImageSource}
            minimapWidth={state.minimapSize.width}
            minimapHeight={state.minimapSize.height}
            minimapGeometry={state.minimapGeometry}
            minimapReference={state.minimapReference}
            onPointerDown={state.handleMinimapPointerDown}
            onPointerMove={state.handleMinimapPointerMove}
            onPointerUpOrCancel={state.handleMinimapPointerUpOrCancel}
          />
        ) : null}

        {/* Image metadata info panel */}
        {state.isInfoPanelVisible ? (
          <ImageInfoPanel
            currentImageName={state.currentNode?.name}
            currentImagePath={state.currentNode?.path}
            isReadOnly={state.currentNode?.readOnly}
            fileSize={state.currentNode?.size}
            naturalImageSize={state.naturalImageSize}
            zoomLevel={state.zoomLevel}
            topOffset={state.infoPanelTopOffset}
          />
        ) : null}
      </div>
    </div>
  );
}
