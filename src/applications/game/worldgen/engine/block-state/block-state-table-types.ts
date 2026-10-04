// Shapes of block-state-table.generated.ts (see generate-block-state-table.node.ts for the encoding).

export type GeneratedSurvivalBaseSet = "none" | "all" | "notAir" | "solid" | "motion" | "sturdyUp" | "sturdyDown" | "sturdySide";

export interface GeneratedSurvivalSet {
  base: GeneratedSurvivalBaseSet;
  plus?: string[];
  minus?: string[];
}

export interface GeneratedSurvivalRule {
  /** 1 when the block survives with only air around it. */
  a: number;
  /** Survival set index for the block below / above / north (the only non-air neighbor). */
  b?: number;
  u?: number;
  n?: number;
  /** Below set when water is beside the below block (sugar cane). */
  w?: number;
  /** Below set in darkness (mushrooms); worldgen chunks are unlit, so this one applies during features. */
  k?: number;
}

export type GeneratedBlockEntry =
  | [defaultProperties: string, flags: string, sturdyFaces: string]
  | [defaultProperties: string, flags: string, sturdyFaces: string, variants: Record<string, string>]
  | [
      defaultProperties: string,
      flags: string,
      sturdyFaces: string,
      variants: Record<string, string>,
      survival: Record<string, GeneratedSurvivalRule>,
    ];
