// Transparent crossed-sheet plants (alpha strictly 0 or 255, no outlines, rooted bottom-center) plus mushrooms and the lily pad.

import { createRamp, type Ramp, type Rgb } from "./color";
import { TEXTURE_SIZE } from "./noise";
import { drawFlatLine } from "./painters";
import { createRandom, type Random } from "./random";
import { Texture, type TextureDefinition } from "./texture";

const GROUND_ROW = TEXTURE_SIZE - 1;
const PLANT_GREENS = createRamp("#2c5c20", "#3f7c2a", "#5f9f3a");
const FRESH_GREENS = createRamp("#3a7228", "#4f9232", "#72b648");

function newPlantTexture(): Texture {
  return new Texture(false);
}

function drawCurvedBlade(
  texture: Texture,
  baseX: number,
  height: number,
  lean: number,
  colors: Ramp,
  thickBase = false
): void {
  for (let step = 0; step < height; step++) {
    const progress = step / (height - 1);
    const bladeX = baseX + lean * progress * progress;
    const bladeY = GROUND_ROW - step;
    const color = progress < 0.35 ? colors[0] : progress < 0.75 ? colors[1] : colors[2];
    texture.set(bladeX, bladeY, color);
    if (thickBase && step < height * 0.4) texture.set(bladeX + 1, bladeY, colors[0]);
  }
}

function paintFern(): Texture {
  const texture = newPlantTexture();
  const fronds = [
    { direction: -1, height: 8, spread: 7 },
    { direction: 1, height: 9, spread: 7 },
    { direction: -1, height: 13, spread: 3 },
    { direction: 1, height: 12, spread: 3 },
  ];
  fronds.forEach((frond, frondIndex) => {
    const sampleCount = frond.height + 4;
    for (let sample = 0; sample <= sampleCount; sample++) {
      const progress = sample / sampleCount;
      const spineX = 7.5 + frond.direction * frond.spread * progress * progress;
      const spineY = GROUND_ROW - frond.height * Math.sin((progress * Math.PI) / 2) * 0.95;
      const shade = frondIndex < 2 ? PLANT_GREENS[0] : PLANT_GREENS[1];
      texture.set(spineX, spineY, shade);
      if (sample > 3 && sample % 2 === 1 && progress < 0.92) {
        const leafletLength = progress > 0.7 ? 1 : 2;
        for (let reach = 1; reach <= leafletLength; reach++) {
          texture.set(spineX - reach, spineY + (reach > 1 ? 0 : -1) * 0, PLANT_GREENS[2]);
          texture.set(spineX + reach, spineY + 1, PLANT_GREENS[1]);
        }
      }
    }
  });
  return texture;
}

function growBranch(
  texture: Texture,
  random: Random,
  startX: number,
  startY: number,
  directionX: number,
  directionY: number,
  length: number,
  depth: number,
  colors: Ramp
): void {
  let cursorX = startX;
  let cursorY = startY;
  for (let step = 0; step < length; step++) {
    texture.set(cursorX, cursorY, colors[depth === 0 ? 0 : step % 2 === 0 ? 1 : 2]);
    if (random.chance(0.4)) cursorX += directionX;
    cursorY += directionY;
    if (depth < 2 && step > 1 && step < length - 1 && random.chance(0.28)) {
      growBranch(texture, random, cursorX, cursorY, -directionX || 1, directionY, Math.max(2, length - step - 1), depth + 1, colors);
    }
  }
}

function paintDeadBush(): Texture {
  const random = createRandom("dead_bush");
  const texture = newPlantTexture();
  const colors = createRamp("#4a3420", "#6d4f2e", "#8f6c40");
  for (const [baseX, directionX, length] of [
    [7, -1, 9],
    [8, 1, 9],
    [8, 0, 11],
    [6, -1, 6],
    [10, 1, 6],
  ] as const) {
    growBranch(texture, random, baseX, GROUND_ROW, directionX, -1, length, 0, colors);
  }
  texture.set(7, GROUND_ROW, colors[0]);
  texture.set(8, GROUND_ROW, colors[0]);
  return texture;
}

function paintSavannaGrass(): Texture {
  const texture = newPlantTexture();
  const colors = createRamp("#9a8230", "#c4a63e", "#e6cb62");
  for (const [baseX, height, lean] of [
    [3, 8, -2],
    [5, 12, -2],
    [6, 9, 1],
    [7, 14, -1],
    [8, 11, 2],
    [9, 13, 2],
    [10, 8, 3],
    [11, 10, 2],
    [12, 6, 3],
  ] as const) {
    drawCurvedBlade(texture, baseX, height, lean, colors, true);
  }
  return texture;
}

function paintReeds(): Texture {
  const texture = newPlantTexture();
  const stalkColors = createRamp("#3f7a2a", "#5a9a38", "#78b84e");
  const headColors = createRamp("#4a2e1c", "#6b4528", "#8c6038");
  for (const [stalkX, stalkHeight, lean] of [
    [4, 13, -1],
    [8, 15, 0],
    [11, 12, 1],
  ] as const) {
    drawCurvedBlade(texture, stalkX, stalkHeight, lean, stalkColors);
    const headTopY = GROUND_ROW - stalkHeight + 2;
    const headX = stalkX + lean;
    for (let headRow = 0; headRow < 3; headRow++) {
      texture.set(headX, headTopY + headRow, headColors[headRow % 2 === 0 ? 1 : 0]);
      texture.set(headX + 1, headTopY + headRow, headColors[headRow === 0 ? 2 : 1]);
    }
    texture.set(headX, headTopY - 1, stalkColors[2]);
    texture.set(headX, headTopY - 2, stalkColors[2]);
  }
  drawCurvedBlade(texture, 6, 7, -2, stalkColors);
  drawCurvedBlade(texture, 9, 6, 3, stalkColors);
  drawCurvedBlade(texture, 13, 5, 2, stalkColors);
  return texture;
}

function paintLavender(): Texture {
  const texture = newPlantTexture();
  const stemColors = createRamp("#3b6a2c", "#4c8236", "#6a9e48");
  const bloomColors = createRamp("#5a3892", "#7e54bc", "#a688de");
  for (const [stemX, stemHeight, lean] of [
    [4, 11, -1],
    [6, 14, 0],
    [9, 13, 1],
    [11, 10, 1],
  ] as const) {
    drawCurvedBlade(texture, stemX, stemHeight, lean, stemColors);
    const topX = stemX + lean;
    const topY = GROUND_ROW - stemHeight + 1;
    for (let spikeRow = 0; spikeRow < 5; spikeRow++) {
      const spikeY = topY + spikeRow;
      const isTip = spikeRow === 0;
      texture.set(topX, spikeY, bloomColors[(spikeRow + stemX) % 3]);
      if (!isTip) texture.set(topX + (spikeRow % 2 === 0 ? 1 : -1), spikeY, bloomColors[(spikeRow + 1) % 3]);
    }
  }
  for (const [leafX, leafY] of [[5, 15], [8, 15], [10, 15], [7, 14], [9, 14]]) texture.set(leafX, leafY, stemColors[0]);
  return texture;
}

function paintDandelion(): Texture {
  const texture = newPlantTexture();
  drawCurvedBlade(texture, 8, 9, 0, FRESH_GREENS);
  for (const [leafX, leafY, shade] of [[6, 15, 1], [5, 14, 2], [10, 15, 1], [11, 14, 2], [7, 13, 0], [9, 12, 0]] as const) {
    texture.set(leafX, leafY, FRESH_GREENS[shade]);
  }
  const petals = createRamp("#d9a50a", "#fbd21c", "#ffee6a");
  for (const [petalX, petalY, shade] of [
    [7, 4, 1], [8, 4, 2], [9, 4, 1],
    [6, 5, 1], [7, 5, 2], [8, 5, 0], [9, 5, 1], [10, 5, 0],
    [7, 6, 0], [8, 6, 1], [9, 6, 0],
    [8, 3, 1],
  ] as const) {
    texture.set(petalX, petalY, petals[shade]);
  }
  return texture;
}

function paintPoppy(): Texture {
  const texture = newPlantTexture();
  drawCurvedBlade(texture, 8, 9, 0, FRESH_GREENS);
  for (const [leafX, leafY, shade] of [[9, 12, 1], [10, 11, 2], [6, 14, 1], [5, 13, 0]] as const) {
    texture.set(leafX, leafY, FRESH_GREENS[shade]);
  }
  const petals = createRamp("#9c0f1a", "#d11f2a", "#f24a3e");
  for (const [petalX, petalY, shade] of [
    [7, 3, 2], [8, 3, 1], [9, 3, 1],
    [6, 4, 2], [7, 4, 1], [9, 4, 1], [10, 4, 0],
    [6, 5, 1], [7, 5, 1], [8, 5, 1], [9, 5, 0], [10, 5, 0],
    [7, 6, 0], [8, 6, 0], [9, 6, 0],
  ] as const) {
    texture.set(petalX, petalY, petals[shade]);
  }
  texture.set(8, 4, [34, 18, 20]);
  texture.set(8, 6, [34, 18, 20]);
  return texture;
}

function paintHeather(): Texture {
  const random = createRandom("heather");
  const texture = newPlantTexture();
  const bloomColors = createRamp("#76386f", "#a24c88", "#c768a8", "#e38cc6");
  const stalkColors = createRamp("#33602a", "#487a35");
  for (let columnX = 2; columnX <= 13; columnX++) {
    const normalized = (columnX - 7.5) / 6.2;
    const moundHeight = Math.round(9 * Math.sqrt(Math.max(0, 1 - normalized * normalized)) - (random.chance(0.3) ? 1 : 0));
    for (let rise = 0; rise < moundHeight; rise++) {
      const rowY = GROUND_ROW - rise;
      const isStalk = rise < 2 || random.chance(0.14);
      texture.set(columnX, rowY, isStalk ? random.pick(stalkColors) : bloomColors[Math.min(3, Math.floor(rise / 2) + (random.chance(0.4) ? 1 : 0))]);
    }
  }
  return texture;
}

function paintAgave(): Texture {
  const texture = newPlantTexture();
  const leafColors = createRamp("#2b5f58", "#3b7f72", "#52a08e", "#86c8b2");
  const leaves = [
    { angle: -78, length: 7 },
    { angle: 78, length: 7 },
    { angle: -52, length: 10 },
    { angle: 52, length: 10 },
    { angle: -26, length: 13 },
    { angle: 26, length: 13 },
    { angle: 0, length: 15 },
  ];
  for (const leaf of leaves) {
    const radians = (leaf.angle * Math.PI) / 180;
    const sampleCount = leaf.length * 2;
    for (let sample = 0; sample <= sampleCount; sample++) {
      const progress = sample / sampleCount;
      const centerX = 7.5 + Math.sin(radians) * leaf.length * progress;
      const centerY = GROUND_ROW - Math.cos(radians) * leaf.length * progress * 0.95;
      const halfWidth = (1 - progress) * 1.7 + 0.2;
      for (let offset = -Math.ceil(halfWidth); offset <= Math.ceil(halfWidth); offset++) {
        if (Math.abs(offset) > halfWidth) continue;
        const shade = offset < 0 ? 2 : offset > 0 ? 0 : 1;
        const isRim = Math.abs(offset) > halfWidth - 0.9 && offset < 0 && progress > 0.2;
        texture.set(centerX + offset, centerY, isRim ? leafColors[3] : leafColors[shade]);
      }
    }
  }
  return texture;
}

function paintFromArt(artRows: readonly string[], palette: Record<string, Rgb>): Texture {
  const texture = newPlantTexture();
  artRows.forEach((artRow, rowY) => {
    [...artRow].forEach((symbol, columnX) => {
      if (palette[symbol]) texture.set(columnX, rowY, palette[symbol]);
    });
  });
  return texture;
}

function paintBrownMushroom(): Texture {
  return paintFromArt(
    [
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "....hhhhh.......",
      "...hmmmmmd......",
      "..hmmmmsmmd.....",
      "..dmmmmmmmdd....",
      "...dddddddd.hhh.",
      "......ssc..hmmmd",
      "......ssc..ddddd",
      "......ssc....sc.",
      "......ssc....sc.",
    ],
    {
      h: [176, 124, 82],
      m: [138, 92, 58],
      s: [214, 198, 170],
      d: [92, 58, 36],
      c: [160, 142, 116],
    }
  );
}

function paintRedMushroom(): Texture {
  return paintFromArt(
    [
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "....hhhhh.......",
      "...hrwrrrrd.....",
      "..hrrrrwrrrd....",
      "..rrwrrrrrwdd...",
      "..dddddddddd.hh.",
      ".......ssc..hwrd",
      ".......ssc..dddd",
      ".......ssc....sc",
      ".......ssc....sc",
      ".......ssc....sc",
    ],
    {
      h: [240, 96, 84],
      r: [206, 40, 44],
      w: [246, 240, 224],
      d: [140, 24, 36],
      s: [226, 214, 190],
      c: [170, 154, 128],
    }
  );
}

function paintLilyPad(): Texture {
  const texture = newPlantTexture();
  const padColors = createRamp("#1f6428", "#2b8332", "#3fa043", "#62bd5c");
  const notchDirection = (-35 * Math.PI) / 180;
  const notchHalfAngle = 0.42;
  for (let rowY = 0; rowY < TEXTURE_SIZE; rowY++) {
    for (let columnX = 0; columnX < TEXTURE_SIZE; columnX++) {
      const offsetX = columnX - 7.5;
      const offsetY = rowY - 7.5;
      const distance = Math.hypot(offsetX, offsetY);
      if (distance > 6.1) continue;
      const angleToNotch = Math.atan2(offsetY, offsetX) - notchDirection;
      const wrappedAngle = Math.atan2(Math.sin(angleToNotch), Math.cos(angleToNotch));
      if (Math.abs(wrappedAngle) < notchHalfAngle && distance > 0.8) continue;
      const lighting = -(offsetX + offsetY) / 12;
      let level = lighting > 0.15 ? 2 : lighting > -0.2 ? 1 : 1;
      if (distance > 5.0) level = lighting > 0 ? 1 : 0;
      const rayAngle = Math.atan2(offsetY, offsetX);
      const nearestVeinOffset = Math.abs(((rayAngle + Math.PI / 8) % (Math.PI / 4)) - Math.PI / 8);
      if (distance > 1.5 && distance < 4.8 && nearestVeinOffset < 0.2) level -= 1;
      texture.set(columnX, rowY, padColors[Math.max(0, level)]);
    }
  }
  for (const [spotX, spotY] of [[5, 5], [6, 4], [9, 10]]) {
    if (texture.get(spotX, spotY)) texture.set(spotX, spotY, padColors[3]);
  }
  drawFlatLine(texture, 7, 7, 8, 8, padColors[0]);
  return texture;
}

export async function plantTextures(): Promise<TextureDefinition[]> {
  return [
    { fileName: "fern.png", draw: paintFern },
    { fileName: "dead_bush.png", draw: paintDeadBush },
    { fileName: "savanna_grass.png", draw: paintSavannaGrass },
    { fileName: "reeds.png", draw: paintReeds },
    { fileName: "lavender.png", draw: paintLavender },
    { fileName: "dandelion.png", draw: paintDandelion },
    { fileName: "poppy.png", draw: paintPoppy },
    { fileName: "heather.png", draw: paintHeather },
    { fileName: "agave.png", draw: paintAgave },
    { fileName: "brown_mushroom.png", draw: paintBrownMushroom },
    { fileName: "red_mushroom.png", draw: paintRedMushroom },
    { fileName: "lily_pad.png", draw: paintLilyPad },
  ];
}
