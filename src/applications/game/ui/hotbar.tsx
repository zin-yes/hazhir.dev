import { cn } from "@/components/ui/utils";
import { BlockType, Texture } from "../blocks";

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
  // Simple mapping for now, can be improved
  switch (block) {
    case BlockType.DIRT:
      return Texture.DIRT;
    case BlockType.GRASS:
      return Texture.GRASS_SIDE;
    case BlockType.STONE:
      return Texture.STONE;
    case BlockType.LOG:
      return Texture.LOG_SIDE; // Assuming WOOD maps to LOG
    case BlockType.PLANKS:
      return Texture.PLANKS;
    case BlockType.LEAVES:
      return Texture.LEAVES;
    case BlockType.GLASS:
      return Texture.GLASS;
    case BlockType.SAND:
      return Texture.SAND;
    case BlockType.GRAVEL:
      return Texture.GRAVEL;
    case BlockType.COBBLESTONE:
      return Texture.COBBLESTONE;
    case BlockType.MARBLE:
      return Texture.MARBLE;
    case BlockType.ANEMONE_FLOWER:
      return Texture.ANEMONE_FLOWER;
    case BlockType.SAPLING:
      return Texture.SAPLING;
    case BlockType.BELLIS_FLOWER:
      return Texture.BELLIS_FLOWER;
    case BlockType.FORGETMENOTS_FLOWER:
      return Texture.FORGETMENOTS_FLOWER;
    default:
      return Texture.DIRT; // Fallback
  }
}
