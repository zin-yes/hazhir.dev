"use client";

import Image from "next/image";
import { memo } from "react";

interface ZoomMinimapProps {
  currentImageSource: string;
  minimapWidth: number;
  minimapHeight: number;
  minimapGeometry: {
    left: number;
    top: number;
    width: number;
    height: number;
    clipPath: string;
  };
  minimapReference: React.RefObject<HTMLDivElement | null>;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUpOrCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
}

/** Minimap overlay that appears when zoomed in, showing visible viewport region */
const ZoomMinimap = memo(function ZoomMinimap({
  currentImageSource,
  minimapWidth,
  minimapHeight,
  minimapGeometry,
  minimapReference,
  onPointerDown,
  onPointerMove,
  onPointerUpOrCancel,
}: ZoomMinimapProps) {
  return (
    <div className="absolute right-3 top-3 rounded-md border bg-card/95 p-2 shadow-sm">
      <div
        ref={minimapReference}
        className="relative overflow-hidden rounded-sm border"
        style={{ width: minimapWidth, height: minimapHeight }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUpOrCancel}
        onPointerCancel={onPointerUpOrCancel}
      >
        <Image
          src={currentImageSource}
          alt="Zoom preview"
          fill
          sizes="180px"
          quality={40}
          className="object-fill grayscale brightness-50 blur-[1.5px]"
        />
        <Image
          src={currentImageSource}
          alt="Viewport preview"
          fill
          sizes="180px"
          quality={50}
          className="object-fill"
          style={{ clipPath: minimapGeometry.clipPath }}
        />
        <div
          className="absolute cursor-move rounded-[4px] border-2 border-primary"
          style={{
            left: minimapGeometry.left,
            top: minimapGeometry.top,
            width: minimapGeometry.width,
            height: minimapGeometry.height,
          }}
        />
      </div>
    </div>
  );
});

export default ZoomMinimap;
