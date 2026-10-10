// The shape of the water surface: slope and whitecaps at a world position, shared by the water seen from above
// (chunks and far terrain) and by the underwater view, which looks at the same waves from below. Needs FOG_GLSL
// (skyFogTime) and WIND_GLSL (windAngle) before it.
//
// The surface is built the way a real sea looks. Five swells travel at the speed their wavelength implies, with
// sharp crests and flat troughs, spread around a slowly turning wind and strengthened or weakened from patch to
// patch. On top, five octaves of gradient noise, each turned to its own angle and patchy in strength, are dragged along the wind and
// across it as two layers that never line up, which is the fine, restless chop that gives water its grain. Gusts decide where the chop is rough and
// where the water lies glassy, and the roughest crests turn to whitecaps. Each octave fades out before it gets
// finer than a pixel so distant water never shimmers.

const SWELL_COUNT = 5;
const RIPPLE_OCTAVES = 5;
/** Share of a swell's natural speed; blocks are metres, and real swell speed looks frantic at game scale. */
const SWELL_SPEED_SCALE = 0.45;
/** Rough size of one screen pixel at one block of distance, in blocks. */
const PIXEL_FOOTPRINT_PER_BLOCK = 0.0016;

export const WATER_SURFACE_GLSL = `
const int SWELL_COUNT = ${SWELL_COUNT};
const int RIPPLE_OCTAVES = ${RIPPLE_OCTAVES};

/** Two uniform random numbers in 0..1 for an integer cell. */
vec2 waterCellRandom(ivec2 cell) {
  uint hashed = uint(cell.x) * 374761393u + uint(cell.y) * 668265263u;
  hashed = (hashed ^ (hashed >> 13u)) * 1274126177u;
  hashed ^= hashed >> 16u;
  return vec2(float(hashed & 65535u), float(hashed >> 16u)) * (1.0 / 65536.0);
}

vec2 waterGradientAt(ivec2 corner) {
  float angle = waterCellRandom(corner).x * 6.2831853;
  return vec2(cos(angle), sin(angle));
}

/** Smooth gradient noise: x is the value (about -0.7..0.7), yz its slope across the plane. */
vec3 waterGradientNoise(vec2 point) {
  ivec2 cell = ivec2(floor(point));
  vec2 local = point - vec2(cell);
  vec2 eased = local * local * local * (local * (local * 6.0 - 15.0) + 10.0);
  vec2 easedSlope = 30.0 * local * local * (local * (local - 2.0) + 1.0);
  vec2 gradientA = waterGradientAt(cell);
  vec2 gradientB = waterGradientAt(cell + ivec2(1, 0));
  vec2 gradientC = waterGradientAt(cell + ivec2(0, 1));
  vec2 gradientD = waterGradientAt(cell + ivec2(1, 1));
  float valueA = dot(gradientA, local);
  float valueB = dot(gradientB, local - vec2(1.0, 0.0));
  float valueC = dot(gradientC, local - vec2(0.0, 1.0));
  float valueD = dot(gradientD, local - vec2(1.0, 1.0));
  float alongX = valueB - valueA;
  float alongY = valueC - valueA;
  float mixedTerm = valueA - valueB - valueC + valueD;
  float value = valueA + eased.x * alongX + eased.y * alongY + eased.x * eased.y * mixedTerm;
  vec2 slope = gradientA + eased.x * (gradientB - gradientA) + eased.y * (gradientC - gradientA)
    + eased.x * eased.y * (gradientA - gradientB - gradientC + gradientD)
    + easedSlope * (eased.yx * mixedTerm + vec2(alongX, alongY));
  return vec3(value, slope);
}

/** Fades a wave out once its crests get closer together than about three pixels. */
float waterWaveFade(float distanceToCamera, float cyclesPerBlock) {
  return 1.0 - smoothstep(0.12, 0.35, distanceToCamera * ${PIXEL_FOOTPRINT_PER_BLOCK} * cyclesPerBlock);
}

struct WaterSurface {
  vec3 normal;
  /** 0..1: how much of this spot is breaking white water. */
  float whitecaps;
};

WaterSurface waterSurface(vec2 worldPlane, float distanceToCamera) {
  const float swellAngles[SWELL_COUNT] = float[SWELL_COUNT](-0.85, -0.42, 0.05, 0.47, 0.93);
  const float swellWavenumbers[SWELL_COUNT] = float[SWELL_COUNT](0.21, 0.37, 0.66, 1.12, 1.9);
  const float swellAmplitudes[SWELL_COUNT] = float[SWELL_COUNT](0.55, 0.33, 0.2, 0.11, 0.06);
  const mat2 rippleRotation = mat2(0.6216, 0.7833, -0.7833, 0.6216);

  float time = skyFogTime;
  float windAngle = windAngle(time);
  vec2 windDirection = vec2(cos(windAngle), sin(windAngle));
  vec2 acrossWind = vec2(-windDirection.y, windDirection.x);

  vec2 position = worldPlane + 9.0 * vec2(
    waterGradientNoise(worldPlane * 0.04 + vec2(time * 0.015, 0.0)).x,
    waterGradientNoise(worldPlane * 0.04 + vec2(31.7, -time * 0.012)).x
  );
  float seaState = clamp(0.5 + 0.9 * waterGradientNoise(position * 0.013 + windDirection * time * 0.02).x, 0.0, 1.0);
  float roughness = mix(0.45, 1.7, smoothstep(0.15, 0.85, seaState));

  vec2 slope = vec2(0.0);
  float crest = 0.0;
  for (int swell = 0; swell < SWELL_COUNT; swell++) {
    float index = float(swell);
    float wavenumber = swellWavenumbers[swell];
    float angle = windAngle + swellAngles[swell] + 0.2 * sin(time * 0.02 + index * 1.9);
    vec2 direction = vec2(cos(angle), sin(angle));
    vec3 phaseWarp = waterGradientNoise(position * 0.07 + index * 3.1 + vec2(time * 0.01, 0.0));
    float phase = wavenumber * dot(direction, position) + 2.4 * phaseWarp.x - sqrt(9.81 * wavenumber) * ${SWELL_SPEED_SCALE.toFixed(2)} * time + index * 2.39;
    vec2 phaseGradient = wavenumber * direction + 2.4 * 0.07 * phaseWarp.yz;
    float peak = exp(sin(phase) - 1.0);
    float patchiness = 0.45 + 1.1 * (0.5 + waterGradientNoise(position * (0.035 + 0.011 * index) + index * 13.7).x);
    float strength = patchiness * (swell < 2 ? 1.0 : roughness) * waterWaveFade(distanceToCamera, wavenumber / 6.2831853);
    slope += phaseGradient * (swellAmplitudes[swell] * peak * cos(phase)) * strength;
    crest += swellAmplitudes[swell] * peak * strength;
  }

  for (int octave = 0; octave < RIPPLE_OCTAVES; octave++) {
    float frequency = 0.9 * pow(2.13, float(octave));
    float fade = waterWaveFade(distanceToCamera, frequency);
    if (fade < 0.002) break;
    float turn = 0.7 * float(octave) + 0.3;
    mat2 octaveRotation = mat2(cos(turn), sin(turn), -sin(turn), cos(turn));
    float patchStrength = 0.55 + 0.9 * (0.5 + waterGradientNoise(position * 0.17 + float(octave) * 7.3 + vec2(time * 0.03, 0.0)).x);
    float height = 0.05 * pow(0.52, float(octave)) * (octave == 0 ? 1.0 : roughness) * patchStrength;
    vec2 turned = octaveRotation * position;
    vec2 dragged = turned - (octaveRotation * windDirection) * time * (0.5 + 0.12 * float(octave));
    vec2 crossDragged = rippleRotation * turned + (octaveRotation * acrossWind) * time * 0.35;
    vec3 layerOne = waterGradientNoise(dragged * frequency + float(octave) * 17.31);
    vec3 layerTwo = waterGradientNoise(crossDragged * frequency * 1.17 + float(octave) * 29.7 + 5.3);
    vec2 layerTwoSlope = vec2(
      rippleRotation[0][0] * layerTwo.y + rippleRotation[0][1] * layerTwo.z,
      rippleRotation[1][0] * layerTwo.y + rippleRotation[1][1] * layerTwo.z
    );
    vec2 turnedSlope = (layerOne.yz + layerTwoSlope) * (height * frequency * fade);
    slope += vec2(
      octaveRotation[0][0] * turnedSlope.x + octaveRotation[0][1] * turnedSlope.y,
      octaveRotation[1][0] * turnedSlope.x + octaveRotation[1][1] * turnedSlope.y
    );
  }

  float foamPatch = waterGradientNoise(position * 0.35 + windDirection * time * 0.15).x;
  float foamGrain = waterGradientNoise(position * 2.3 + windDirection * time * 0.6).x
    + 0.6 * waterGradientNoise(position * 6.1 - windDirection * time * 0.9 + 3.7).x
    + 0.4 * waterGradientNoise(position * 15.7 + acrossWind * time * 0.7 + 8.9).x;
  float whitecaps = smoothstep(0.55 - 0.35 * foamPatch, 1.0 - 0.35 * foamPatch, crest) * smoothstep(0.9, 1.5, roughness)
    * smoothstep(-0.1, 0.35, foamGrain + 0.5 * foamPatch) * (1.0 - smoothstep(60.0, 140.0, distanceToCamera));

  WaterSurface surface;
  surface.normal = normalize(vec3(-slope.x, 1.0, -slope.y));
  surface.whitecaps = whitecaps;
  return surface;
}
`;
