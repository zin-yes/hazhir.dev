import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BLOCK_ITEM_TEXTURES, BlockType } from "../blocks";

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
              {blocks
                .filter(
                  (block) =>
                    block !== BlockType.STONE_SLAB_TOP &&
                    block !== BlockType.COBBLESTONE_SLAB_TOP &&
                    block !== BlockType.PLANKS_SLAB_TOP &&
                    block !== BlockType.WATER_FALLING &&
                    block !== BlockType.WATER_LEVEL_1 &&
                    block !== BlockType.WATER_LEVEL_2 &&
                    block !== BlockType.WATER_LEVEL_3 &&
                    block !== BlockType.WATER_LEVEL_4 &&
                    block !== BlockType.WATER_LEVEL_5 &&
                    block !== BlockType.WATER_LEVEL_6 &&
                    block !== BlockType.WATER_LEVEL_7
                )
                .map((block) => (
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

function getTextureForBlock(block: BlockType) {
  const textureInfo = BLOCK_ITEM_TEXTURES[block];
  return textureInfo;
}
