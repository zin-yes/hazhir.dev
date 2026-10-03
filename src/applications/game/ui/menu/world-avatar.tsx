const AVATAR_COLUMNS = 12;
const AVATAR_ROWS = 8;

const SURFACE_TINTS = ["#6fbf3a", "#c9b458", "#8fae9c", "#e8e4ee", "#b5683c"];

function hashSeed(seed: number, salt: number): number {
  let value = Math.imul(seed ^ salt, 2654435761) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 2246822519) >>> 0;
  return (value ^ (value >>> 13)) >>> 0;
}

/** Tiny terrain silhouette derived from the seed, so every world looks distinct. */
export function WorldAvatar({ seed }: { seed: number }) {
  const surfaceTint = SURFACE_TINTS[hashSeed(seed, 1) % SURFACE_TINTS.length];
  const cells: { x: number; y: number; color: string }[] = [];
  let height = 3 + (hashSeed(seed, 2) % 3);

  for (let column = 0; column < AVATAR_COLUMNS; column++) {
    const step = (hashSeed(seed, 10 + column) % 3) - 1;
    height = Math.min(AVATAR_ROWS - 2, Math.max(2, height + step));
    const topRow = AVATAR_ROWS - height;
    for (let row = topRow; row < AVATAR_ROWS; row++) {
      const depth = row - topRow;
      const color =
        depth === 0 ? surfaceTint : depth < 3 ? "#7a5236" : "#6f6a80";
      cells.push({ x: column, y: row, color });
    }
  }

  return (
    <svg
      viewBox={`0 0 ${AVATAR_COLUMNS} ${AVATAR_ROWS}`}
      className="h-10 w-[3.75rem] shrink-0 bg-[#2a2155]"
      style={{ imageRendering: "pixelated" }}
      shapeRendering="crispEdges"
      aria-hidden
    >
      {cells.map(({ x, y, color }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} />
      ))}
    </svg>
  );
}
