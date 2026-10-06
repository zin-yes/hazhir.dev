// Decodes density function JSON into a DensityNode tree, the way DensityFunctions' codecs do: bare numbers are
// constants, strings are registry references, and every HOLDER_HELPER_CODEC field is wrapped in a HolderNode.
// Registry entries are compiled once and shared, so the result is a DAG.

import type { JsonObject, JsonValue } from "../registry/datapack-loader";
import { ConstantSpline, type CubicSpline, MultipointSpline } from "./cubic-spline";
import { type DensityNode, NoiseHolder } from "./density-function";
import { ClampNode, ConstantNode, createMapped, type MappedType, RangeChoiceNode, YClampedGradientNode } from "./nodes/arithmetic-nodes";
import {
  EndIslandsNode,
  NoiseNode,
  OldBlendedNoiseNode,
  type RarityValueMapper,
  ShiftedNoiseNode,
  ShiftNode,
  type ShiftType,
  WeirdScaledSamplerNode,
} from "./nodes/noise-nodes";
import { createTwoArgument, type TwoArgumentType } from "./nodes/two-argument-nodes";
import {
  BeardifierNode,
  BlendConstantNode,
  BlendDensityNode,
  HolderNode,
  MARKER_TYPES,
  MarkerNode,
  type MarkerType,
  SplineNode,
} from "./nodes/structural-nodes";

const TWO_ARGUMENT_TYPES: readonly TwoArgumentType[] = ["add", "mul", "min", "max"];
const MAPPED_TYPES: readonly MappedType[] = ["abs", "square", "cube", "half_negative", "quarter_negative", "squeeze"];
const SHIFT_TYPES: readonly ShiftType[] = ["shift_a", "shift_b", "shift"];

/** ResourceLocation parsing: a missing namespace means "minecraft". */
export function normalizeResourceId(id: string): string {
  return id.includes(":") ? id : `minecraft:${id}`;
}

export class DensityFunctionCompiler {
  private readonly compiledById = new Map<string, DensityNode>();
  private readonly compilingIds = new Set<string>();

  constructor(private readonly densityFunctionsById: Record<string, JsonValue>) {}

  /** Registry entries compiled so far (each is shared by every reference to it). */
  get compiledReferenceCount(): number {
    return this.compiledById.size;
  }

  /** The value of a registry entry (Holder.Reference#value). */
  resolveReference(rawId: string): DensityNode {
    const id = normalizeResourceId(rawId);
    const cached = this.compiledById.get(id);
    if (cached !== undefined) return cached;
    const json = this.densityFunctionsById[id];
    if (json === undefined) throw new Error(`Unknown density function reference "${id}"`);
    if (this.compilingIds.has(id)) throw new Error(`Density function reference cycle through "${id}"`);
    this.compilingIds.add(id);
    const compiled = this.compileDirect(json, id);
    this.compilingIds.delete(id);
    this.compiledById.set(id, compiled);
    return compiled;
  }

  /** DensityFunction.CODEC: a Holder whose value is either a reference or an inline (direct) function. */
  compileHolderValue(json: JsonValue, path = "<root>"): DensityNode {
    return typeof json === "string" ? this.resolveReference(json) : this.compileDirect(json, path);
  }

  /** DensityFunction.HOLDER_HELPER_CODEC: the holder wrapped as a HolderHolder density function. */
  compileHolderHelper(json: JsonValue, path = "<root>"): HolderNode {
    return new HolderNode(this.compileHolderValue(json, path));
  }

  /** DensityFunctions.DIRECT_CODEC: a number (constant) or a typed object. */
  compileDirect(json: JsonValue, path: string): DensityNode {
    if (typeof json === "number") return new ConstantNode(json);
    if (typeof json === "string") return this.compileHolderHelper(json, path);
    if (json === null || typeof json !== "object" || Array.isArray(json)) {
      throw new Error(`Invalid density function at ${path}: ${JSON.stringify(json)}`);
    }
    const type = normalizeResourceId(String(json.type ?? ""));
    const shortType = type.startsWith("minecraft:") ? type.slice("minecraft:".length) : type;
    const field = (name: string): JsonValue => {
      const value = json[name];
      if (value === undefined) throw new Error(`Density function ${type} at ${path} is missing "${name}"`);
      return value;
    };
    const holderField = (name: string) => this.compileHolderHelper(field(name), `${path}.${name}`);
    const numberField = (name: string) => readNumber(field(name), `${path}.${name}`);

    if ((TWO_ARGUMENT_TYPES as readonly string[]).includes(shortType)) {
      return createTwoArgument(shortType as TwoArgumentType, holderField("argument1"), holderField("argument2"));
    }
    if ((MAPPED_TYPES as readonly string[]).includes(shortType)) {
      return createMapped(shortType as MappedType, holderField("argument"));
    }
    if ((MARKER_TYPES as readonly string[]).includes(shortType)) {
      return new MarkerNode(shortType as MarkerType, holderField("argument"));
    }
    if ((SHIFT_TYPES as readonly string[]).includes(shortType)) {
      return new ShiftNode(shortType as ShiftType, this.noiseHolder(field("argument"), `${path}.argument`));
    }
    switch (shortType) {
      case "constant":
        return new ConstantNode(numberField("argument"));
      case "clamp":
        return new ClampNode(this.compileDirect(field("input"), `${path}.input`), numberField("min"), numberField("max"));
      case "range_choice":
        return new RangeChoiceNode(
          holderField("input"),
          numberField("min_inclusive"),
          numberField("max_exclusive"),
          holderField("when_in_range"),
          holderField("when_out_of_range"),
        );
      case "y_clamped_gradient":
        return new YClampedGradientNode(numberField("from_y"), numberField("to_y"), numberField("from_value"), numberField("to_value"));
      case "noise":
        return new NoiseNode(this.noiseHolder(field("noise"), `${path}.noise`), numberField("xz_scale"), numberField("y_scale"));
      case "shifted_noise":
        return new ShiftedNoiseNode(
          holderField("shift_x"),
          holderField("shift_y"),
          holderField("shift_z"),
          numberField("xz_scale"),
          numberField("y_scale"),
          this.noiseHolder(field("noise"), `${path}.noise`),
        );
      case "weird_scaled_sampler": {
        const mapper = String(field("rarity_value_mapper"));
        if (mapper !== "type_1" && mapper !== "type_2") throw new Error(`Unknown rarity_value_mapper "${mapper}" at ${path}`);
        return new WeirdScaledSamplerNode(holderField("input"), this.noiseHolder(field("noise"), `${path}.noise`), mapper as RarityValueMapper);
      }
      case "spline":
        return new SplineNode(this.compileSpline(field("spline"), `${path}.spline`));
      case "old_blended_noise":
        return new OldBlendedNoiseNode(
          {
            xzScale: numberField("xz_scale"),
            yScale: numberField("y_scale"),
            xzFactor: numberField("xz_factor"),
            yFactor: numberField("y_factor"),
            smearScaleMultiplier: numberField("smear_scale_multiplier"),
          },
          null,
        );
      case "blend_alpha":
      case "blend_offset":
        return new BlendConstantNode(shortType);
      case "blend_density":
        return new BlendDensityNode(holderField("argument"));
      case "beardifier":
        return new BeardifierNode(false);
      case "end_islands":
        return new EndIslandsNode();
      default:
        throw new Error(`Unsupported density function type "${type}" at ${path}`);
    }
  }

  /** CubicSpline.codec: a float constant or {coordinate, points: [{location, value, derivative}]}. */
  compileSpline(json: JsonValue, path: string): CubicSpline {
    if (typeof json === "number") return new ConstantSpline(json);
    if (json === null || typeof json !== "object" || Array.isArray(json)) throw new Error(`Invalid spline at ${path}`);
    const coordinate = this.compileHolderValue((json as JsonObject).coordinate, `${path}.coordinate`);
    const points = (json as JsonObject).points;
    if (!Array.isArray(points) || points.length === 0) throw new Error(`Spline at ${path} needs a non-empty "points" list`);
    const locations = new Float32Array(points.length);
    const derivatives = new Float32Array(points.length);
    const values: CubicSpline[] = [];
    points.forEach((point, index) => {
      const pointObject = point as JsonObject;
      locations[index] = readNumber(pointObject.location, `${path}.points[${index}].location`);
      derivatives[index] = readNumber(pointObject.derivative, `${path}.points[${index}].derivative`);
      values.push(this.compileSpline(pointObject.value, `${path}.points[${index}].value`));
    });
    return MultipointSpline.create(coordinate, locations, values, derivatives);
  }

  private noiseHolder(json: JsonValue, path: string): NoiseHolder {
    if (typeof json !== "string") throw new Error(`Inline noise parameters at ${path} are not supported (RandomState requires a registry key)`);
    return new NoiseHolder(normalizeResourceId(json), null);
  }
}

function readNumber(value: JsonValue | undefined, path: string): number {
  if (typeof value !== "number") throw new Error(`Expected a number at ${path}, got ${JSON.stringify(value)}`);
  return value;
}
