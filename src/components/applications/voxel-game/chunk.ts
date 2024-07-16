const CHUNK_WIDTH = 16;
const CHUNK_HEIGHT = 256;
const CHUNK_LENGTH = 16;

function to1D(x: number, y: number, z: number) {
  return z * CHUNK_WIDTH * CHUNK_HEIGHT + y * CHUNK_WIDTH + x;
}

function to3D(index: number): { x: number; y: number; z: number } {
  const z = index / (CHUNK_WIDTH * CHUNK_HEIGHT);
  index -= z * CHUNK_WIDTH * CHUNK_HEIGHT;
  const y = index / CHUNK_WIDTH;
  const x = index % CHUNK_WIDTH;
  return { x, y, z };
}
