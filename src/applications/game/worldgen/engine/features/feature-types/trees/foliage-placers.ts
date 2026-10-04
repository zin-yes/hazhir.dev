// Mirrors the eleven foliage placer types (blob, spruce, pine, acacia, bush, fancy, jungle, mega_pine, dark_oak,
// random_spread, cherry) and the foliage_placer codec.

import type { RandomSource } from "../../../random";
import type { FeatureParser } from "../../feature/feature-parser";
import { asObject, type JsonValue, requireNumber, typeOf } from "../../providers/json-fields";
import type { IntProvider } from "../../providers/value-providers";
import { type FoliagePlacementContext, FoliagePlacer, tryPlaceLeaf } from "./foliage-placer";
import { mthFloor } from "./java-math";
import type { FoliageAttachment } from "./tree-placement";

const fround = Math.fround;

class BlobFoliagePlacer extends FoliagePlacer {
  constructor(radius: IntProvider, offset: IntProvider, protected readonly height: number) {
    super(radius, offset);
  }

  protected createFoliageWithOffset(context: FoliagePlacementContext, _trunkHeight: number, attachment: FoliageAttachment, foliageHeight: number, foliageRadius: number, offset: number): void {
    for (let localY = offset; localY >= offset - foliageHeight; localY--) {
      const range = Math.max(foliageRadius + attachment.radiusOffset - 1 - Math.trunc(localY / 2), 0);
      this.placeLeavesRow(context, attachment.pos, range, localY, attachment.doubleTrunk);
    }
  }

  foliageHeight(): number {
    return this.height;
  }

  protected shouldSkipLocation(random: RandomSource, localX: number, localY: number, localZ: number, range: number): boolean {
    return localX === range && localZ === range && (random.nextIntBounded(2) === 0 || localY === 0);
  }
}

class BushFoliagePlacer extends BlobFoliagePlacer {
  protected override createFoliageWithOffset(context: FoliagePlacementContext, _trunkHeight: number, attachment: FoliageAttachment, foliageHeight: number, foliageRadius: number, offset: number): void {
    for (let localY = offset; localY >= offset - foliageHeight; localY--) {
      const range = foliageRadius + attachment.radiusOffset - 1 - localY;
      this.placeLeavesRow(context, attachment.pos, range, localY, attachment.doubleTrunk);
    }
  }

  protected override shouldSkipLocation(random: RandomSource, localX: number, _localY: number, localZ: number, range: number): boolean {
    return localX === range && localZ === range && random.nextIntBounded(2) === 0;
  }
}

class FancyFoliagePlacer extends BlobFoliagePlacer {
  protected override createFoliageWithOffset(context: FoliagePlacementContext, _trunkHeight: number, attachment: FoliageAttachment, foliageHeight: number, foliageRadius: number, offset: number): void {
    for (let localY = offset; localY >= offset - foliageHeight; localY--) {
      const range = foliageRadius + (localY === offset || localY === offset - foliageHeight ? 0 : 1);
      this.placeLeavesRow(context, attachment.pos, range, localY, attachment.doubleTrunk);
    }
  }

  protected override shouldSkipLocation(_random: RandomSource, localX: number, _localY: number, localZ: number, range: number): boolean {
    const shiftedX = fround(localX + fround(0.5));
    const shiftedZ = fround(localZ + fround(0.5));
    return fround(fround(shiftedX * shiftedX) + fround(shiftedZ * shiftedZ)) > fround(range * range);
  }
}

class SpruceFoliagePlacer extends FoliagePlacer {
  constructor(radius: IntProvider, offset: IntProvider, private readonly trunkHeight: IntProvider) {
    super(radius, offset);
  }

  protected createFoliageWithOffset(context: FoliagePlacementContext, _trunkHeight: number, attachment: FoliageAttachment, foliageHeight: number, foliageRadius: number, offset: number): void {
    let currentRadius = context.random.nextIntBounded(2);
    let radiusLimit = 1;
    let restartRadius = 0;
    for (let localY = offset; localY >= -foliageHeight; localY--) {
      this.placeLeavesRow(context, attachment.pos, currentRadius, localY, attachment.doubleTrunk);
      if (currentRadius >= radiusLimit) {
        currentRadius = restartRadius;
        restartRadius = 1;
        radiusLimit = Math.min(radiusLimit + 1, foliageRadius + attachment.radiusOffset);
      } else {
        currentRadius++;
      }
    }
  }

  foliageHeight(random: RandomSource, treeHeight: number): number {
    return Math.max(4, treeHeight - this.trunkHeight.sample(random));
  }

  protected shouldSkipLocation(_random: RandomSource, localX: number, _localY: number, localZ: number, range: number): boolean {
    return localX === range && localZ === range && range > 0;
  }
}

class PineFoliagePlacer extends FoliagePlacer {
  constructor(radius: IntProvider, offset: IntProvider, private readonly height: IntProvider) {
    super(radius, offset);
  }

  protected createFoliageWithOffset(context: FoliagePlacementContext, _trunkHeight: number, attachment: FoliageAttachment, foliageHeight: number, foliageRadius: number, offset: number): void {
    let currentRadius = 0;
    for (let localY = offset; localY >= offset - foliageHeight; localY--) {
      this.placeLeavesRow(context, attachment.pos, currentRadius, localY, attachment.doubleTrunk);
      if (currentRadius >= 1 && localY === offset - foliageHeight + 1) currentRadius--;
      else if (currentRadius < foliageRadius + attachment.radiusOffset) currentRadius++;
    }
  }

  override foliageRadius(random: RandomSource, trunkHeightMinusFoliageHeight: number): number {
    return super.foliageRadius(random, trunkHeightMinusFoliageHeight) + random.nextIntBounded(Math.max(trunkHeightMinusFoliageHeight + 1, 1));
  }

  foliageHeight(random: RandomSource): number {
    return this.height.sample(random);
  }

  protected shouldSkipLocation(_random: RandomSource, localX: number, _localY: number, localZ: number, range: number): boolean {
    return localX === range && localZ === range && range > 0;
  }
}

class AcaciaFoliagePlacer extends FoliagePlacer {
  protected createFoliageWithOffset(context: FoliagePlacementContext, _trunkHeight: number, attachment: FoliageAttachment, foliageHeight: number, foliageRadius: number, offset: number): void {
    const doubleTrunk = attachment.doubleTrunk;
    const center = attachment.pos.above(offset);
    this.placeLeavesRow(context, center, foliageRadius + attachment.radiusOffset, -1 - foliageHeight, doubleTrunk);
    this.placeLeavesRow(context, center, foliageRadius - 1, -foliageHeight, doubleTrunk);
    this.placeLeavesRow(context, center, foliageRadius + attachment.radiusOffset - 1, 0, doubleTrunk);
  }

  foliageHeight(): number {
    return 0;
  }

  protected shouldSkipLocation(_random: RandomSource, localX: number, localY: number, localZ: number, range: number): boolean {
    if (localY === 0) return (localX > 1 || localZ > 1) && localX !== 0 && localZ !== 0;
    return localX === range && localZ === range && range > 0;
  }
}

class JungleFoliagePlacer extends FoliagePlacer {
  constructor(radius: IntProvider, offset: IntProvider, private readonly height: number) {
    super(radius, offset);
  }

  protected createFoliageWithOffset(context: FoliagePlacementContext, _trunkHeight: number, attachment: FoliageAttachment, foliageHeight: number, foliageRadius: number, offset: number): void {
    const layerCount = attachment.doubleTrunk ? foliageHeight : 1 + context.random.nextIntBounded(2);
    for (let localY = offset; localY >= offset - layerCount; localY--) {
      const range = foliageRadius + attachment.radiusOffset + 1 - localY;
      this.placeLeavesRow(context, attachment.pos, range, localY, attachment.doubleTrunk);
    }
  }

  foliageHeight(): number {
    return this.height;
  }

  protected shouldSkipLocation(_random: RandomSource, localX: number, _localY: number, localZ: number, range: number): boolean {
    if (localX + localZ >= 7) return true;
    return localX * localX + localZ * localZ > range * range;
  }
}

class MegaPineFoliagePlacer extends FoliagePlacer {
  constructor(radius: IntProvider, offset: IntProvider, private readonly crownHeight: IntProvider) {
    super(radius, offset);
  }

  protected createFoliageWithOffset(context: FoliagePlacementContext, _trunkHeight: number, attachment: FoliageAttachment, foliageHeight: number, foliageRadius: number, offset: number): void {
    const center = attachment.pos;
    let previousRadius = 0;
    for (let y = center.y - foliageHeight + offset; y <= center.y + offset; y++) {
      const heightBelowTop = center.y - y;
      const radius = foliageRadius + attachment.radiusOffset + mthFloor(fround(fround(fround(heightBelowTop) / fround(foliageHeight)) * fround(3.5)));
      const range = heightBelowTop > 0 && radius === previousRadius && (y & 1) === 0 ? radius + 1 : radius;
      this.placeLeavesRow(context, { x: center.x, y, z: center.z }, range, 0, attachment.doubleTrunk);
      previousRadius = radius;
    }
  }

  foliageHeight(random: RandomSource): number {
    return this.crownHeight.sample(random);
  }

  protected shouldSkipLocation(_random: RandomSource, localX: number, _localY: number, localZ: number, range: number): boolean {
    if (localX + localZ >= 7) return true;
    return localX * localX + localZ * localZ > range * range;
  }
}

class DarkOakFoliagePlacer extends FoliagePlacer {
  protected createFoliageWithOffset(context: FoliagePlacementContext, _trunkHeight: number, attachment: FoliageAttachment, _foliageHeight: number, foliageRadius: number, offset: number): void {
    const center = attachment.pos.above(offset);
    const doubleTrunk = attachment.doubleTrunk;
    if (doubleTrunk) {
      this.placeLeavesRow(context, center, foliageRadius + 2, -1, doubleTrunk);
      this.placeLeavesRow(context, center, foliageRadius + 3, 0, doubleTrunk);
      this.placeLeavesRow(context, center, foliageRadius + 2, 1, doubleTrunk);
      if (context.random.nextBoolean()) this.placeLeavesRow(context, center, foliageRadius, 2, doubleTrunk);
    } else {
      this.placeLeavesRow(context, center, foliageRadius + 2, -1, doubleTrunk);
      this.placeLeavesRow(context, center, foliageRadius + 1, 0, doubleTrunk);
    }
  }

  foliageHeight(): number {
    return 4;
  }

  protected override shouldSkipLocationSigned(random: RandomSource, localX: number, localY: number, localZ: number, range: number, doubleTrunk: boolean): boolean {
    if (localY === 0 && doubleTrunk && (localX === -range || localX >= range) && (localZ === -range || localZ >= range)) return true;
    return super.shouldSkipLocationSigned(random, localX, localY, localZ, range, doubleTrunk);
  }

  protected shouldSkipLocation(_random: RandomSource, localX: number, localY: number, localZ: number, range: number, doubleTrunk: boolean): boolean {
    if (localY === -1 && !doubleTrunk) return localX === range && localZ === range;
    if (localY === 1) return localX + localZ > range * 2 - 2;
    return false;
  }
}

class RandomSpreadFoliagePlacer extends FoliagePlacer {
  constructor(
    radius: IntProvider,
    offset: IntProvider,
    private readonly foliageHeightProvider: IntProvider,
    private readonly leafPlacementAttempts: number,
  ) {
    super(radius, offset);
  }

  protected createFoliageWithOffset(context: FoliagePlacementContext, _trunkHeight: number, attachment: FoliageAttachment, foliageHeight: number, foliageRadius: number): void {
    const { random } = context;
    const center = attachment.pos;
    for (let attempt = 0; attempt < this.leafPlacementAttempts; attempt++) {
      const offsetX = random.nextIntBounded(foliageRadius) - random.nextIntBounded(foliageRadius);
      const offsetY = random.nextIntBounded(foliageHeight) - random.nextIntBounded(foliageHeight);
      const offsetZ = random.nextIntBounded(foliageRadius) - random.nextIntBounded(foliageRadius);
      tryPlaceLeaf(context, center.x + offsetX, center.y + offsetY, center.z + offsetZ);
    }
  }

  foliageHeight(random: RandomSource): number {
    return this.foliageHeightProvider.sample(random);
  }

  protected shouldSkipLocation(): boolean {
    return false;
  }
}

class CherryFoliagePlacer extends FoliagePlacer {
  constructor(
    radius: IntProvider,
    offset: IntProvider,
    private readonly height: IntProvider,
    private readonly wideBottomLayerHoleChance: number,
    private readonly cornerHoleChance: number,
    private readonly hangingLeavesChance: number,
    private readonly hangingLeavesExtensionChance: number,
  ) {
    super(radius, offset);
  }

  protected createFoliageWithOffset(context: FoliagePlacementContext, _trunkHeight: number, attachment: FoliageAttachment, foliageHeight: number, foliageRadius: number, offset: number): void {
    const doubleTrunk = attachment.doubleTrunk;
    const center = attachment.pos.above(offset);
    const range = foliageRadius + attachment.radiusOffset - 1;
    this.placeLeavesRow(context, center, range - 2, foliageHeight - 3, doubleTrunk);
    this.placeLeavesRow(context, center, range - 1, foliageHeight - 4, doubleTrunk);
    for (let localY = foliageHeight - 5; localY >= 0; localY--) this.placeLeavesRow(context, center, range, localY, doubleTrunk);
    this.placeLeavesRowWithHangingLeavesBelow(context, center, range, -1, doubleTrunk, this.hangingLeavesChance, this.hangingLeavesExtensionChance);
    this.placeLeavesRowWithHangingLeavesBelow(context, center, range - 1, -2, doubleTrunk, this.hangingLeavesChance, this.hangingLeavesExtensionChance);
  }

  foliageHeight(random: RandomSource): number {
    return this.height.sample(random);
  }

  protected shouldSkipLocation(random: RandomSource, localX: number, localY: number, localZ: number, range: number): boolean {
    if (localY === -1 && (localX === range || localZ === range) && random.nextFloat() < this.wideBottomLayerHoleChance) return true;
    const atCorner = localX === range && localZ === range;
    const wide = range > 2;
    if (wide) return atCorner || (localX + localZ > range * 2 - 2 && random.nextFloat() < this.cornerHoleChance);
    return atCorner && random.nextFloat() < this.cornerHoleChance;
  }
}

export function parseFoliagePlacer(json: JsonValue | undefined, parser: FeatureParser): FoliagePlacer {
  const object = asObject(json, "foliage_placer");
  const type = typeOf(object, "foliage_placer");
  const radius = parser.intProvider(object.radius, `${type}.radius`);
  const offset = parser.intProvider(object.offset, `${type}.offset`);
  switch (type) {
    case "minecraft:blob_foliage_placer":
      return new BlobFoliagePlacer(radius, offset, requireNumber(object, "height", type));
    case "minecraft:bush_foliage_placer":
      return new BushFoliagePlacer(radius, offset, requireNumber(object, "height", type));
    case "minecraft:fancy_foliage_placer":
      return new FancyFoliagePlacer(radius, offset, requireNumber(object, "height", type));
    case "minecraft:spruce_foliage_placer":
      return new SpruceFoliagePlacer(radius, offset, parser.intProvider(object.trunk_height, `${type}.trunk_height`));
    case "minecraft:pine_foliage_placer":
      return new PineFoliagePlacer(radius, offset, parser.intProvider(object.height, `${type}.height`));
    case "minecraft:acacia_foliage_placer":
      return new AcaciaFoliagePlacer(radius, offset);
    case "minecraft:jungle_foliage_placer":
      return new JungleFoliagePlacer(radius, offset, requireNumber(object, "height", type));
    case "minecraft:mega_pine_foliage_placer":
      return new MegaPineFoliagePlacer(radius, offset, parser.intProvider(object.crown_height, `${type}.crown_height`));
    case "minecraft:dark_oak_foliage_placer":
      return new DarkOakFoliagePlacer(radius, offset);
    case "minecraft:random_spread_foliage_placer":
      return new RandomSpreadFoliagePlacer(radius, offset, parser.intProvider(object.foliage_height, `${type}.foliage_height`), requireNumber(object, "leaf_placement_attempts", type));
    case "minecraft:cherry_foliage_placer":
      return new CherryFoliagePlacer(
        radius,
        offset,
        parser.intProvider(object.height, `${type}.height`),
        fround(requireNumber(object, "wide_bottom_layer_hole_chance", type)),
        fround(requireNumber(object, "corner_hole_chance", type)),
        fround(requireNumber(object, "hanging_leaves_chance", type)),
        fround(requireNumber(object, "hanging_leaves_extension_chance", type)),
      );
    default:
      throw new Error(`Unknown foliage placer type ${type}`);
  }
}
