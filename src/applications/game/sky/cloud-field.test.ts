import { describe, expect, test } from "bun:test";
import { CloudCarves } from "./cloud-carves";
import { carveFactor, cloudDensityAt, verticalProfile, type CloudFieldInputs } from "./cloud-field";
import { CLOUD_NOISE_SIZE, generateCloudNoise, sampleCloudNoise } from "./cloud-noise";
import { CLOUD_BASE_Y, CLOUD_THICKNESS } from "./sky-constants";

const noise = generateCloudNoise();

const inputsWith = (overrides: Partial<CloudFieldInputs> = {}): CloudFieldInputs => ({
  noise,
  elapsedSeconds: 90,
  weatherShift: 0,
  humidityAt: () => 0.7,
  carves: [],
  ...overrides,
});

const middleOfDeck = CLOUD_BASE_Y + CLOUD_THICKNESS * 0.3;

/** Share of a wide sample of positions in the deck that hold cloud. */
function cloudShare(inputs: CloudFieldInputs, worldY = middleOfDeck): number {
  let dense = 0;
  let total = 0;
  for (let x = -4000; x < 4000; x += 80) {
    for (let z = -4000; z < 4000; z += 80) {
      total++;
      if (cloudDensityAt(x, worldY, z, inputs) > 0.05) dense++;
    }
  }
  return dense / total;
}

describe("cloud noise", () => {
  test("is tileable: sampling one tile further lands on the same value", () => {
    for (const channel of [0, 1]) {
      const here = sampleCloudNoise(noise, 0.31, 0.62, 0.17, channel);
      expect(sampleCloudNoise(noise, 1.31, 0.62, 0.17, channel)).toBeCloseTo(here, 10);
      expect(sampleCloudNoise(noise, 0.31, -0.38, 1.17, channel)).toBeCloseTo(here, 10);
    }
  });

  test("uses the whole value range and varies smoothly between neighbouring samples", () => {
    const values: number[] = [];
    let largestJump = 0;
    for (let line = 0; line < 12; line++) {
      let previous = sampleCloudNoise(noise, 0, (line * 0.37) % 1, (line * 0.61) % 1, 0);
      for (let step = 1; step <= 400; step++) {
        const value = sampleCloudNoise(noise, step / 400, (line * 0.37) % 1, (line * 0.61) % 1, 0);
        values.push(value);
        largestJump = Math.max(largestJump, Math.abs(value - previous));
        previous = value;
      }
    }
    expect(Math.min(...values)).toBeLessThan(0.25);
    expect(Math.max(...values)).toBeGreaterThan(0.75);
    expect(largestJump).toBeLessThan(0.06);
  });

  test("the texture size matches the size the generator fills", () => {
    expect(generateCloudNoise().length).toBe(CLOUD_NOISE_SIZE ** 3 * 2);
  });
});

describe("cloud density", () => {
  test("there is no cloud outside the deck and the profile is flat-floored and tops out inside", () => {
    expect(cloudDensityAt(0, CLOUD_BASE_Y - 5, 0, inputsWith({ humidityAt: () => 1, weatherShift: 0.22 }))).toBe(0);
    expect(cloudDensityAt(0, CLOUD_BASE_Y + CLOUD_THICKNESS + 5, 0, inputsWith({ humidityAt: () => 1, weatherShift: 0.22 }))).toBe(0);
    expect(verticalProfile(0)).toBe(0);
    expect(verticalProfile(1)).toBe(0);
    expect(verticalProfile(0.3)).toBeGreaterThan(verticalProfile(0.9));
  });

  test("humid air holds far more cloud than dry air", () => {
    const dry = cloudShare(inputsWith({ humidityAt: () => 0.05 }));
    const humid = cloudShare(inputsWith({ humidityAt: () => 0.9 }));
    expect(humid).toBeGreaterThan(dry + 0.25);
    expect(humid).toBeLessThan(1);
  });

  test("a pressure front thickens the deck", () => {
    const calm = cloudShare(inputsWith({ weatherShift: -0.2, humidityAt: () => 0.4 }));
    const stormy = cloudShare(inputsWith({ weatherShift: 0.2, humidityAt: () => 0.4 }));
    expect(stormy).toBeGreaterThan(calm + 0.2);
  });

  test("the cloud is one connected mass: dense positions have dense neighbours, not isolated cells", () => {
    const inputs = inputsWith({ humidityAt: () => 0.6 });
    let denseSamples = 0;
    let denseWithDenseNeighbour = 0;
    for (let x = -3000; x < 3000; x += 60) {
      for (let z = -3000; z < 3000; z += 60) {
        if (cloudDensityAt(x, middleOfDeck, z, inputs) < 0.3) continue;
        denseSamples++;
        const neighbours = [
          cloudDensityAt(x + 30, middleOfDeck, z, inputs),
          cloudDensityAt(x - 30, middleOfDeck, z, inputs),
          cloudDensityAt(x, middleOfDeck, z + 30, inputs),
          cloudDensityAt(x, middleOfDeck, z - 30, inputs),
        ];
        if (neighbours.some((neighbour) => neighbour > 0.15)) denseWithDenseNeighbour++;
      }
    }
    expect(denseSamples).toBeGreaterThan(50);
    expect(denseWithDenseNeighbour / denseSamples).toBeGreaterThan(0.9);
  });

  test("clouds drift downwind: the pattern at the wind's displacement matches far better than elsewhere", () => {
    const earlier = inputsWith({ elapsedSeconds: 0, humidityAt: () => 0.6 });
    const later = inputsWith({ elapsedSeconds: 100, humidityAt: () => 0.6 });
    const agreement = (shiftX: number, shiftZ: number) => {
      let close = 0;
      let compared = 0;
      for (let x = -2000; x < 2000; x += 50) {
        for (const z of [-300, 0, 300]) {
          compared++;
          if (Math.abs(cloudDensityAt(x, middleOfDeck, z, earlier) - cloudDensityAt(x + shiftX, middleOfDeck, z + shiftZ, later)) < 0.15) close++;
        }
      }
      return close / compared;
    };
    expect(agreement(320, 110)).toBeGreaterThan(agreement(-320, -110) + 0.1);
  });
});

describe("carved holes", () => {
  test("a carve empties the cloud at its centre and leaves far cloud alone, then closes again", () => {
    const base = inputsWith({ humidityAt: () => 0.9, weatherShift: 0.2 });
    let denseSpot: { x: number; z: number } | null = null;
    for (let x = -2000; x < 2000 && !denseSpot; x += 40) {
      if (cloudDensityAt(x, middleOfDeck, 0, base) > 0.8) denseSpot = { x, z: 0 };
    }
    expect(denseSpot).not.toBeNull();
    const spot = denseSpot!;
    const carves = new CloudCarves();
    carves.carve(spot.x, middleOfDeck, spot.z);
    const carved = { ...base, carves: carves.list() };
    expect(cloudDensityAt(spot.x, middleOfDeck, spot.z, carved)).toBe(0);
    expect(cloudDensityAt(spot.x, middleOfDeck, spot.z, base)).toBeGreaterThan(0.8);
    expect(carveFactor(spot.x + 500, middleOfDeck, spot.z, carves.list())).toBe(1);
    carves.advance(31);
    expect(cloudDensityAt(spot.x, middleOfDeck, spot.z, { ...base, carves: carves.list() })).toBeGreaterThan(0.8);
  });

  test("carves are rate limited by spacing and capped, dropping the oldest", () => {
    const carves = new CloudCarves();
    carves.carve(0, 0, 0);
    carves.carve(1, 0, 0);
    expect(carves.list()).toHaveLength(1);
    for (let index = 1; index <= 40; index++) carves.carve(index * 100, 0, 0);
    expect(carves.list().length).toBe(12);
    expect(carves.list()[0]!.x).toBeGreaterThan(2000);
  });
});
