import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BlockType, Texture } from "../blocks";

interface InventoryProps {
  isOpen: boolean;
  onSelectBlock: (block: BlockType) => void;
}

export function Inventory({ isOpen, onSelectBlock }: InventoryProps) {
  if (!isOpen) return null;

  const blocks = Object.values(BlockType).filter(
    (value) => typeof value === "number" && value !== BlockType.AIR
  ) as BlockType[];

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-50">
      <Card className="w-[600px] h-[500px] bg-zinc-900/90 border-zinc-700 text-zinc-100">
        <CardHeader>
          <CardTitle className="text-xl font-bold">Inventory</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px] pr-4">
            <div className="grid grid-cols-6 gap-4">
              {blocks.map((block) => (
                <button
                  key={block}
                  onClick={() => onSelectBlock(block)}
                  className="flex flex-col items-center gap-2 p-2 rounded-md hover:bg-white/10 transition-colors group"
                >
                  <div
                    className="w-12 h-12 bg-cover bg-center border border-white/10 group-hover:border-white/50 transition-all"
                    style={{
                      backgroundImage: `url(/game/${getTextureForBlock(
                        block
                      )})`,
                      imageRendering: "pixelated",
                    }}
                  />
                  <span className="text-xs text-zinc-400 group-hover:text-white capitalize">
                    {BlockType[block].toLowerCase().replace(/_/g, " ")}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function getTextureForBlock(block: BlockType): string {
  // Duplicate mapping for now, ideally shared
  switch (block) {
    case BlockType.DIRT:
      return Texture.DIRT;
    case BlockType.GRASS:
      return Texture.GRASS_SIDE;
    case BlockType.STONE:
      return Texture.STONE;
    case BlockType.LOG:
      return Texture.LOG_SIDE;
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
    case BlockType.HUMUS:
      return Texture.HUMUS;
    case BlockType.SILT:
      return Texture.SILT;
    case BlockType.CLAY:
      return Texture.CLAY;
    case BlockType.GRANITE:
      return Texture.GRANITE;
    case BlockType.CALCITE:
      return Texture.CALCITE;
    case BlockType.COMPACT_GRAVEL:
      return Texture.COMPACT_GRAVEL;
    case BlockType.PHYLLITE:
      return Texture.PHYLLITE;
    case BlockType.SHALE:
      return Texture.SHALE;
    case BlockType.MARBLE:
      return Texture.MARBLE;
    case BlockType.WATER:
      return Texture.WATER;
    case BlockType.DECORATIVE_GLASS:
      return Texture.DECORATIVE_GLASS;
    default:
      return Texture.DIRT;
  }
}
