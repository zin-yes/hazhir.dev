import { BLOCK_ITEM_TEXTURES, BlockType } from "../blocks";
import { profiler } from "../profiler";
import { PixelButton, PixelFrame } from "./pixel/pixel-ui";
import { profileUiHandler, uiEventProps } from "./ui-profiling";
import { useProfiledRender } from "./use-profiled-render";

interface InventoryProps {
  isOpen: boolean;
  onSelectBlock: (block: BlockType) => void;
  onClose?: () => void;
}

const HIDDEN_FROM_INVENTORY = new Set<BlockType>([
  BlockType.AIR,
  BlockType.STONE_SLAB_TOP,
  BlockType.COBBLESTONE_SLAB_TOP,
  BlockType.PLANKS_SLAB_TOP,
  BlockType.WATER_FALLING,
  BlockType.WATER_LEVEL_1,
  BlockType.WATER_LEVEL_2,
  BlockType.WATER_LEVEL_3,
  BlockType.WATER_LEVEL_4,
  BlockType.WATER_LEVEL_5,
  BlockType.WATER_LEVEL_6,
  BlockType.WATER_LEVEL_7,
]);

export function Inventory({ isOpen, onSelectBlock, onClose }: InventoryProps) {
  useProfiledRender("inventory");
  if (!isOpen) {
    profiler.addCounter("game.ui.inventory.closedRenders");
    return null;
  }

  const blockListToken = profiler.begin("main.ui.inventory.buildBlockList");
  const blocks = (Object.values(BlockType).filter(
    (value) => typeof value === "number",
  ) as BlockType[]).filter((block) => !HIDDEN_FROM_INVENTORY.has(block));
  profiler.end(blockListToken);
  profiler.addCounter("game.ui.inventory.blockTilesRendered", blocks.length);
  profiler.sampleGauge("game.ui.inventory.blockTiles", blocks.length);

  return (
    <div
      data-mobile-ui
      className="absolute inset-0 z-50 flex items-center justify-center bg-[#0a0812]/70 p-4"
      {...uiEventProps("inventory")}
    >
      <PixelFrame
        className="w-full max-w-2xl"
        innerClassName="flex max-h-[calc(100vh-4rem)] flex-col p-4 sm:p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[#b6f24a]">
            Blocks
          </h2>
          <PixelButton
            onClick={() => profileUiHandler("inventory", "close", () => onClose?.())}
          >
            Close
          </PixelButton>
        </div>
        <p className="mb-3 text-[0.65rem] text-[#6e6590]">
          Click a block to put it in your selected hotbar slot.
        </p>
        <div className="grid grow grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6">
          {blocks.map((block) => (
            <button
              key={block}
              onClick={() =>
                profileUiHandler("inventory", "selectBlock", () => onSelectBlock(block))
              }
              className="group flex flex-col items-center gap-2 border-4 border-[#2b2447] bg-[#0d0b14] p-2 hover:border-[#b6f24a]"
            >
              <div
                className="h-10 w-10 bg-cover bg-center sm:h-12 sm:w-12"
                style={{
                  backgroundImage: `url(/game/${BLOCK_ITEM_TEXTURES[block]})`,
                  imageRendering: "pixelated",
                }}
              />
              <span className="text-center text-[0.6rem] capitalize leading-tight text-[#9a91bd] group-hover:text-white">
                {BlockType[block].toLowerCase().replace(/_/g, " ")}
              </span>
            </button>
          ))}
        </div>
      </PixelFrame>
    </div>
  );
}
