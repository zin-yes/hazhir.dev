import { KeyCap } from "./menu-primitives";

const CONTROL_BINDINGS: { action: string; keys: string[] }[] = [
  { action: "Move", keys: ["W", "A", "S", "D"] },
  { action: "Move (alternate)", keys: ["ARROWS"] },
  { action: "Look around", keys: ["MOUSE"] },
  { action: "Jump / swim up / fly up", keys: ["SPACE"] },
  { action: "Sneak / swim down / fly down", keys: ["SHIFT"] },
  { action: "Toggle flying", keys: ["V"] },
  { action: "Break block", keys: ["LEFT CLICK"] },
  { action: "Place block", keys: ["RIGHT CLICK"] },
  { action: "Pick hotbar slot", keys: ["1-9"] },
  { action: "Cycle hotbar", keys: ["SCROLL"] },
  { action: "Inventory", keys: ["E"] },
  { action: "Debug info", keys: ["F3"] },
  { action: "Pause menu", keys: ["ESC"] },
];

export function ControlsList() {
  return (
    <ul className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
      {CONTROL_BINDINGS.map(({ action, keys }) => (
        <li key={action} className="flex items-center justify-between gap-3">
          <span className="text-neutral-300">{action}</span>
          <span className="flex flex-wrap justify-end gap-1">
            {keys.map((key) => (
              <KeyCap key={key}>{key}</KeyCap>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}
