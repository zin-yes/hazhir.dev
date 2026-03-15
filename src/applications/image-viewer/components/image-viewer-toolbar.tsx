"use client";

import { Button } from "@/components/ui/button";
import { Info, ZoomIn, ZoomOut } from "lucide-react";
import { memo } from "react";

interface ImageViewerToolbarProps {
  currentImageName: string | undefined;
  currentIndex: number;
  totalImageCount: number;
  isInfoPanelVisible: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleInfoPanel: () => void;
}

/** Top toolbar showing current image name, zoom controls, and info toggle */
const ImageViewerToolbar = memo(function ImageViewerToolbar({
  currentImageName,
  currentIndex,
  totalImageCount,
  isInfoPanelVisible,
  onZoomIn,
  onZoomOut,
  onToggleInfoPanel,
}: ImageViewerToolbarProps) {
  return (
    <div className="flex items-center justify-between border-b px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{currentImageName}</p>
        <p className="text-xs text-muted-foreground">
          {currentIndex + 1} of {totalImageCount}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          onClick={onZoomOut}
          aria-label="Zoom out"
        >
          <ZoomOut className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={onZoomIn}
          aria-label="Zoom in"
        >
          <ZoomIn className="size-4" />
        </Button>
        <Button
          size="icon"
          variant={isInfoPanelVisible ? "secondary" : "ghost"}
          onClick={onToggleInfoPanel}
          aria-label="Image info"
        >
          <Info className="size-4" />
        </Button>
      </div>
    </div>
  );
});

export default ImageViewerToolbar;
