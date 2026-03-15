"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { memo } from "react";

interface ImageNavigationButtonsProps {
  onPrevious: () => void;
  onNext: () => void;
}

/** Previous/next navigation arrows overlaid on the image viewport */
const ImageNavigationButtons = memo(function ImageNavigationButtons({
  onPrevious,
  onNext,
}: ImageNavigationButtonsProps) {
  return (
    <>
      <div className="pointer-events-none absolute inset-y-0 left-2 flex items-center">
        <Button
          size="icon"
          variant="secondary"
          onClick={onPrevious}
          aria-label="Previous image"
          className="pointer-events-auto h-9 w-9 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
        >
          <ChevronLeft className="size-4" />
        </Button>
      </div>

      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
        <Button
          size="icon"
          variant="secondary"
          onClick={onNext}
          aria-label="Next image"
          className="pointer-events-auto h-9 w-9 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </>
  );
});

export default ImageNavigationButtons;
