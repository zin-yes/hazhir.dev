import { KeyCap } from "./menu-primitives";

const CONTROL_BINDINGS: { action: string; keys: string[] }[] = [
  { action: "Move", keys: ["W", "A", "S", "D"] },
  { action: "Jump / fly up", keys: ["SPACE"] },
  { action: "Look around", keys: ["MOUSE"] },
  { action: "Break block", keys: ["LEFT CLICK"] },
  { action: "Place block", keys: ["RIGHT CLICK"] },
  { action: "Pick hotbar slot", keys: ["1-9", "SCROLL"] },
  { action: "Inventory", keys: ["E"] },
  { action: "Pause menu", keys: ["ESC"] },
  { action: "Debug info", keys: ["F3"] },
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
