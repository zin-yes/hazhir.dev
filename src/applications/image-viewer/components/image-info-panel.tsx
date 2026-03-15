"use client";

import { memo } from "react";

interface ImageInfoPanelProps {
  currentImageName: string | undefined;
  currentImagePath: string | undefined;
  isReadOnly: boolean | undefined;
  fileSize: number | undefined;
  naturalImageSize: { width: number; height: number } | null;
  zoomLevel: number;
  topOffset: number;
}

/** Floating info panel showing image metadata */
const ImageInfoPanel = memo(function ImageInfoPanel({
  currentImageName,
  currentImagePath,
  isReadOnly,
  fileSize,
  naturalImageSize,
  zoomLevel,
  topOffset,
}: ImageInfoPanelProps) {
  return (
    <div
      className="absolute right-3 w-64 rounded-md border bg-card p-3 text-xs shadow-sm"
      style={{ top: topOffset }}
    >
      <p className="truncate font-medium">{currentImageName}</p>
      <p className="mt-1 text-muted-foreground">Path: {currentImagePath}</p>
      <p className="mt-1 text-muted-foreground">
        Read-only: {isReadOnly ? "Yes" : "No"}
      </p>
      <p className="mt-1 text-muted-foreground">Size: {fileSize ?? 0} B</p>
      <p className="mt-1 text-muted-foreground">
        Dimensions:{" "}
        {naturalImageSize
          ? `${naturalImageSize.width} × ${naturalImageSize.height}`
          : "Loading..."}
      </p>
      <p className="mt-1 text-muted-foreground">
        Zoom: {(zoomLevel * 100).toFixed(0)}%
      </p>
    </div>
  );
});

export default ImageInfoPanel;
