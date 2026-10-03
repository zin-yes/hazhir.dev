// Cactus block: ribbed green sides with pale spine dots and a ringed top.

import { createRamp, rampColor } from "./color";
import { createPercentileNoise, TEXTURE_SIZE } from "./noise";
import { createRandom } from "./random";
import { Texture, type TextureDefinition } from "./texture";

const CACTUS_GREENS = createRamp("#1c5524", "#276c2e", "#348438", "#47a048");
const SPINE_COLOR = [244, 240, 206] as const;
const SPINE_SHADOW = [18, 58, 26] as const;

function paintCactusSide(): Texture {
  const random = createRandom("cactus_side");
  const streaks = createPercentileNoise(random, [{ cellWidth: 2, cellHeight: 8, weight: 1 }]);
  const ribLevels = [3, 2, 1, 0];
  const texture = new Texture().paint((x, y) => {
    const streakShift = streaks(x, y) > 0.8 ? 1 : streaks(x, y) < 0.15 ? -1 : 0;
    return rampColor(CACTUS_GREENS, ribLevels[x % 4] + (ribLevels[x % 4] === 0 ? 0 : streakShift));
  });
  for (let ribIndex = 0; ribIndex < 4; ribIndex++) {
    const spineColumn = ribIndex * 4 + 1;
    for (let spineRow = (ribIndex % 2) * 2 + 1; spineRow < TEXTURE_SIZE; spineRow += 4) {
      texture.set(spineColumn, spineRow, SPINE_COLOR);
      texture.set(spineColumn + 1, spineRow + 1, SPINE_SHADOW);
    }
  }
  return texture;
}

function paintCactusTop(): Texture {
  const random = createRandom("cactus_top");
  const texture = new Texture().paint((x, y) => {
    const edgeDistance = Math.min(x, y, TEXTURE_SIZE - 1 - x, TEXTURE_SIZE - 1 - y);
    if (edgeDistance === 0) return rampColor(CACTUS_GREENS, 0);
    if (edgeDistance === 1) return rampColor(CACTUS_GREENS, 1);
    const distance = Math.hypot(x - 7.5, y - 7.5);
    if (distance < 1.3) return [60, 100, 40];
    if (distance < 3.4 && distance > 2.3) return [152, 190, 92];
    if (distance < 4.4) return rampColor(CACTUS_GREENS, 3);
    return rampColor(CACTUS_GREENS, 2 + ((x + y) % 5 === 0 ? 1 : 0) - (random.chance(0.12) ? 1 : 0));
  });
  for (const [spineX, spineY] of [
    [3, 3], [12, 3], [3, 12], [12, 12], [7, 3], [8, 12], [3, 8], [12, 7], [5, 5], [10, 10],
  ]) {
    texture.set(spineX, spineY, SPINE_COLOR);
  }
  return texture;
}

export async function cactusTextures(): Promise<TextureDefinition[]> {
  return [
    { fileName: "cactus_top.png", draw: paintCactusTop },
    { fileName: "cactus_side.png", draw: paintCactusSide },
  ];
}
