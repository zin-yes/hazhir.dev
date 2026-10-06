import { BLOCK_ITEM_TEXTURES, BlockType } from "../blocks";
import { profiler } from "../profiler";
import { profileUiHandler, uiEventProps } from "./ui-profiling";
import { useProfiledRender } from "./use-profiled-render";

interface HotbarProps {
  selectedSlot: number;
  slots: BlockType[];
  onSelectSlot?: (index: number) => void;
  /** The sphere brush radius while the brush is on (B), otherwise undefined. */
  brushRadius?: number;
}

export function Hotbar({ selectedSlot, slots, onSelectSlot, brushRadius }: HotbarProps) {
  useProfiledRender("hotbar");
  profiler.addCounter("game.ui.hotbar.slotsRendered", slots.length);
  return (
    <div
      className="absolute bottom-4 left-1/2 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 gap-1 border-4 border-[#0d0b14] bg-[#171327]/90 p-1 sm:gap-1.5 sm:p-1.5"
      {...uiEventProps("hotbar")}
    >
      {brushRadius !== undefined && (
        <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap border-4 border-[#0d0b14] bg-[#171327]/90 px-2 py-1 text-[10px] text-[#b6f24a] sm:text-xs">
          BRUSH R{brushRadius} <span className="text-[#6e6590]">[ ] radius / LMB erase / RMB paint</span>
        </div>
      )}
      {slots.map((block, index) => {
        const isSelected = selectedSlot === index;
        return (
          <div
            key={index}
            data-mobile-ui
            onClick={() =>
              profileUiHandler("hotbar", "selectSlot", () => onSelectSlot?.(index))
            }
            className={`relative flex h-9 w-9 shrink-0 items-center justify-center border-4 sm:h-12 sm:w-12 ${
              isSelected
                ? "-translate-y-1 border-[#b6f24a] bg-[#2b2447]"
                : "border-[#3a3358] bg-[#0d0b14]/70"
            }`}
          >
            {block !== BlockType.AIR && (
              <div
                className="h-5 w-5 bg-cover bg-center sm:h-7 sm:w-7"
                style={{
                  backgroundImage: `url(/game/${BLOCK_ITEM_TEXTURES[block]})`,
                  imageRendering: "pixelated",
                }}
              />
            )}
            <span
              className={`absolute -bottom-1 right-0 text-[9px] sm:text-[10px] ${
                isSelected ? "text-[#b6f24a]" : "text-[#6e6590]"
              }`}
            >
              {index + 1}
            </span>
          </div>
        );
      })}
    </div>
  );
}
