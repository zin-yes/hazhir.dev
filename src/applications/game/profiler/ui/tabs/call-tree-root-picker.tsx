import type { CallTree } from "../../types";

export function callTreeLabel(callTree: CallTree): string {
  return `${callTree.root} (${callTree.thread})`;
}

export function CallTreeRootPicker({
  callTrees,
  selectedRoot,
  onChange,
}: {
  callTrees: CallTree[];
  selectedRoot: string;
  onChange: (root: string) => void;
}) {
  return (
    <select
      value={selectedRoot}
      onChange={(event) => onChange(event.target.value)}
      className="max-w-[260px] border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-zinc-100"
      aria-label="Call tree root"
    >
      {callTrees.map((callTree) => (
        <option key={callTree.root} value={callTree.root}>
          {callTreeLabel(callTree)}
        </option>
      ))}
    </select>
  );
}
