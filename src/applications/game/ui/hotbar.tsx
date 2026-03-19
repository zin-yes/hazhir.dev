import { cn } from "@/components/ui/utils";
import { BLOCK_ITEM_TEXTURES, BlockType } from "../blocks";

interface HotbarProps {
  selectedSlot: number;
  slots: BlockType[];
  onSelectSlot?: (index: number) => void;
}

export function Hotbar({ selectedSlot, slots, onSelectSlot }: HotbarProps) {
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1 sm:gap-2 p-1.5 sm:p-2 bg-black/50 rounded-lg border border-white/20 max-w-[calc(100vw-1rem)]">
      {slots.map((block, index) => (
        <div
          key={index}
          data-mobile-ui
          onClick={() => onSelectSlot?.(index)}
          className={cn(
            "w-8 h-8 sm:w-12 sm:h-12 shrink-0 border-2 flex items-center justify-center bg-black/40 transition-all",
            selectedSlot === index
              ? "border-white scale-110"
              : "border-white/20 opacity-70"
          )}
        >
          {block !== BlockType.AIR && (
            <div
              className="w-6 h-6 sm:w-8 sm:h-8 bg-cover bg-center"
              style={{
                backgroundImage: `url(/game/${getTextureForBlock(block)})`,
                imageRendering: "pixelated",
              }}
            />
          )}
          <span className="absolute bottom-0 right-0.5 text-[10px] sm:text-xs text-white/80 font-mono">
            {index + 1}
          </span>
        </div>
      ))}
    </div>
  );
}

function getTextureForBlock(block: BlockType): string {
  const textureInfo = BLOCK_ITEM_TEXTURES[block];
  return textureInfo;
}
