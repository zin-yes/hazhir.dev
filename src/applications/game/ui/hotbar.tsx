import { cn } from "@/components/ui/utils";
import { BLOCK_ITEM_TEXTURES, BlockType } from "../blocks";

interface HotbarProps {
  selectedSlot: number;
  slots: BlockType[];
}

export function Hotbar({ selectedSlot, slots }: HotbarProps) {
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 p-2 bg-black/50 rounded-lg border border-white/20">
      {slots.map((block, index) => (
        <div
          key={index}
          className={cn(
            "w-12 h-12 border-2 flex items-center justify-center bg-black/40 transition-all",
            selectedSlot === index
              ? "border-white scale-110"
              : "border-white/20 opacity-70"
          )}
        >
          {block !== BlockType.AIR && (
            <div
              className="w-8 h-8 bg-cover bg-center"
              style={{
                backgroundImage: `url(/game/${getTextureForBlock(block)})`,
                imageRendering: "pixelated",
              }}
            />
          )}
          <span className="absolute bottom-0 right-1 text-xs text-white/80 font-mono">
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
