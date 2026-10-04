# density

Density functions for the Terralith worldgen port: JSON in, a seeded `NoiseRouter` and `Climate.Sampler` out,
bit-identical to Minecraft 1.20.6.

- `createNoiseRouter({ registries, noiseSettingsId, seed })`: compiles the `noise_router` of a `noise_settings` entry
  and wires it like `RandomState` (noises via `NoiseRegistry`, `old_blended_noise` seeded from
  `fromHashOf("minecraft:terrain")`). Markers and holders stay in the tree for `engine/terrain`'s `NoiseChunk`.
- `createClimateSampler(router)`: `Climate.Sampler` with markers and holders stripped; `sample(quartX, quartY, quartZ)`
  returns a `TargetPoint` quantized with `(long)(value * 10000.0F)`.
- `DensityFunctionCompiler`: the `DensityFunctions` codecs (numbers are constants, strings are registry references,
  `HOLDER_HELPER_CODEC` fields become `HolderNode`). `wireNoiseRouter` / `NoiseWiringVisitor` take injected noise
  sources; `createSeededNoiseSources` builds the real ones.

Every node implements `compute`, `fillArray` (bulk evaluation through a `ContextProvider`), `mapAll` (bottom-up rewrite
by a visitor, memoized by structural equality like Java's `HashMap` over records) and exact `minValue`/`maxValue`,
because MIN/MAX short-circuits and spline bounds depend on Java's (sometimes loose) bounds.

Mirrors `DensityFunction`, `DensityFunctions` (Ap2, MulOrAdd, Mapped, Clamp, RangeChoice, YClampedGradient, Noise,
ShiftedNoise, ShiftA/B, Shift, WeirdScaledSampler, Spline, Marker, HolderHolder, BlendAlpha/Offset/Density,
BeardifierMarker), `CubicSpline` (float math), `NoiseRouterData.QuantizedSpaghettiRarity`, `RandomState` wiring and
`Climate.Sampler`. `end_islands` is stubbed to 0.

Tests compare against `fixtures/density-reference-vectors.json.gz`, recorded from the real server classes by
`fixtures/DensityReference.java`; they need the scratch datapacks (`WORLDGEN_SCRATCH`) and skip without them.

Fast evaluation of plain (marker-transparent) trees, same doubles as `compute`:
- `column-memoization.ts`: `createColumnMemoizedDensity(root)` wraps every maximal y-independent subtree in a
  last-column cache and every cache_once subtree in a last-point cache (`BlockYDependence` is the conservative
  analysis).
- `density-codegen.ts`: `compileDensityFunction(root)` generates one JavaScript function of (x, y, z) with the same
  operations, order and short circuits as the nodes' `compute`; unknown nodes are called through `compute`.
  `density-codegen.test.ts` compares it with the interpreted router functions bit for bit.
