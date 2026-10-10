// Wind over the land, shared by plants (they bend, in the vertex shader) and leaves (their texture flutters and
// their brightness ripples, in the fragment shader). The wind blows the same way the waves travel, in gusts that
// sweep across the ground as broad bands, with a quick flutter laid over them that differs from plant to plant.
// The functions take the clock as an argument because vertex and fragment shaders declare skyFogTime differently.

/** Furthest a plant one block tall leans at the strongest gust, in blocks. */
export const MAXIMUM_PLANT_LEAN_BLOCKS = 0.17;
/** Furthest the leaf texture slides at the strongest gust, in texture widths. */
export const MAXIMUM_LEAF_FLUTTER_TEXTURE_WIDTHS = 0.06;

export const WIND_GLSL = `
/** Direction the wind blows, as an angle in the horizontal plane. The sea uses the same one. */
float windAngle(float time) {
  return 0.55 + 0.45 * sin(time * 0.009) + 0.25 * sin(time * 0.0037 + 1.7);
}

/** 0..1: how hard the wind blows at a spot. Gust fronts roll downwind, each a bit narrower and faster than the last. */
float windGustStrength(vec2 ground, vec2 direction, float time) {
  float along = dot(ground, direction);
  float across = dot(ground, vec2(-direction.y, direction.x));
  float front = 0.5 + 0.5 * sin(along * 0.11 - time * 0.9 + 1.4 * sin(across * 0.045 + time * 0.13));
  float ripple = 0.5 + 0.5 * sin(along * 0.37 - time * 1.9 + across * 0.21);
  return clamp(0.22 + 0.6 * front * front + 0.3 * front * ripple, 0.0, 1.0);
}

/**
 * How far the top of a one block tall plant at this spot is pushed sideways, in blocks. Along the wind by the gust,
 * plus a quicker back and forth that differs between neighbours so a meadow never moves as one.
 */
vec2 windPlantLean(vec3 worldPosition, float time) {
  float angle = windAngle(time);
  vec2 direction = vec2(cos(angle), sin(angle));
  vec2 acrossWind = vec2(-direction.y, direction.x);
  float gust = windGustStrength(worldPosition.xz, direction, time);
  float phase = worldPosition.x * 1.7 + worldPosition.z * 2.3;
  float flutter = 0.6 * sin(time * 2.3 + phase) + 0.4 * sin(time * 3.7 + phase * 1.9 + 1.3);
  float lean = ${MAXIMUM_PLANT_LEAN_BLOCKS.toFixed(2)} * (0.25 + 0.75 * gust);
  return direction * lean * (0.7 + 0.3 * flutter) + acrossWind * lean * 0.35 * flutter;
}

/**
 * What the wind does to a leaf at this spot, worked out together because both parts need the same gust. xy is the slide
 * of the leaf texture, in texture widths, so the holes between the leaves drift; z is a brightness multiplier that
 * rolls over a canopy with the gusts, so wind is visible even from far away.
 */
vec3 windLeaf(vec3 worldPosition, float time) {
  float angle = windAngle(time);
  float gust = windGustStrength(worldPosition.xz, vec2(cos(angle), sin(angle)), time);
  float phase = worldPosition.x * 2.1 + worldPosition.z * 1.7 + worldPosition.y * 2.9;
  vec2 wobble = vec2(sin(time * 1.9 + phase), sin(time * 1.5 + phase * 1.3 + 2.0));
  float sparkle = sin(time * 3.1 + worldPosition.x * 3.3 + worldPosition.y * 2.7 + worldPosition.z * 3.9);
  return vec3(
    wobble * ${MAXIMUM_LEAF_FLUTTER_TEXTURE_WIDTHS.toFixed(2)} * (0.3 + 0.7 * gust),
    1.0 + 0.1 * (gust - 0.4) + 0.04 * sparkle * gust
  );
}
`;
