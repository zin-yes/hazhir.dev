// Vivid reef blocks: brain coral ridges (pink), tube coral openings (orange) and bubble coral domes (blue).

import { createRamp, rampByDistribution, rampColor, type Rgb } from "./color";
import { createCellField, createPercentileField, createPercentileNoise, TEXTURE_SIZE } from "./noise";
import { paintPercentileRamp, scatterPixels } from "./painters";
import { createRandom } from "./random";
import { Texture, type TextureDefinition } from "./texture";

function paintBrainCoral(): Texture {
  const random = createRandom("coral_pink");
  const ramp = createRamp("#8e2450", "#b83a6c", "#dc5a8c", "#f27eaa", "#ffadc8");
  const folds = createPercentileNoise(random, [
    { cellWidth: 8, weight: 1 },
    { cellWidth: 4, weight: 0.3 },
  ]);
  const ridges = createPercentileField((x, y) => 0.5 + 0.5 * Math.cos(folds(x, y) * Math.PI * 2 * 2.6));
  const texture = new Texture().paint((x, y) => {
    const ridgeHeight = ridges(x, y);
    const lowerRight = ridges(x + 1, y + 1);
    const lightFromTopLeft = ridgeHeight - lowerRight > 0.1 ? 0.12 : 0;
    return rampByDistribution(ramp, Math.min(0.99, ridgeHeight + lightFromTopLeft));
  });
  return texture;
}

function paintTubeCoral(): Texture {
  const random = createRandom("coral_orange");
  const ramp = createRamp("#a63e0c", "#cf5c16", "#ee7f26", "#ffa443", "#ffcd7e");
  const tubes = createCellField(random, 3, { jitter: 0.5 });
  const texture = new Texture().paint((x, y) => {
    const cell = tubes(x, y);
    if (cell.nearestDistance < 1.15) return [92, 34, 10];
    if (cell.nearestDistance < 2.2) {
      const rimLight = -(cell.offsetX + cell.offsetY) > 0 ? 4 : 3;
      return rampColor(ramp, rimLight);
    }
    if (cell.nearestDistance < 3.0) return rampColor(ramp, 2 + (-(cell.offsetX + cell.offsetY) > 0 ? 0 : -1));
    return rampColor(ramp, cell.secondNearestDistance - cell.nearestDistance < 0.7 ? 0 : 1);
  });
  scatterPixels(texture, random, 5, () => rampColor(ramp, 3));
  return texture;
}

function paintBubbleCoral(): Texture {
  const random = createRandom("coral_blue");
  const ramp = createRamp("#1b449a", "#2a5fc4", "#4380e2", "#6ca6f6", "#aacfff");
  const bubbles = createCellField(random, 4, { jitter: 0.55 });
  const grain = createPercentileNoise(random, [{ cellWidth: 2, weight: 1 }]);
  const domeField = createPercentileField((x, y) => {
    const cell = bubbles(x, y);
    const dome = 1 - cell.nearestDistance / 3.4;
    const lighting = -(cell.offsetX + cell.offsetY) / 4.5;
    return dome * 0.7 + lighting * 0.65 + grain(x, y) * 0.15;
  });
  const texture = paintPercentileRamp(new Texture(), ramp, domeField, [0.16, 0.22, 0.26, 0.24, 0.12]);
  texture.paint((x, y) => {
    const cell = bubbles(x, y);
    const existing = texture.get(x, y) as Rgb;
    return cell.secondNearestDistance - cell.nearestDistance < 0.5 ? rampColor(ramp, 0) : existing;
  });
  return texture;
}

export async function coralTextures(): Promise<TextureDefinition[]> {
  return [
    { fileName: "coral_pink.png", draw: paintBrainCoral },
    { fileName: "coral_orange.png", draw: paintTubeCoral },
    { fileName: "coral_blue.png", draw: paintBubbleCoral },
  ];
}
