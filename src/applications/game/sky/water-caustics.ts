// Caustics: the web of bright lines sunlight draws on whatever lies under the water, as the waves focus it. Shared by
// the water seen from above (it lights the bottom behind the surface) and the underwater view. Needs
// WATER_SURFACE_GLSL (waterCellRandom) and the sky lighting uniforms before it.
//
// The pattern is the edge network of a drifting cellular layer, kept faint so it tints the bottom rather than covers it. It is looked up where the
// sunlight crossed the surface, not where it landed, so the lines slide as the sun moves. Walls are dimmer and read the
// pattern on a slant so it never stretches into vertical streaks.

const DEPTH_FADE_PER_BLOCK = 0.07;
/** The sun is never treated as lower than this, or its light would smear to infinity over the bottom. */
const MINIMUM_LIGHT_HEIGHT = 0.65;
/** How far the bright lines lift and the ground between them dips, as a share of the colour, at full sun in shallow water. */
const LINE_BRIGHTENING = 0.28;
const GROUND_DIMMING = 0.04;

export const WATER_CAUSTICS_GLSL = `
/** Distance gap between the nearest and second nearest drifting cell centre: zero along cell edges. */
float causticEdgeGap(vec2 point, float time) {
  ivec2 cell = ivec2(floor(point));
  vec2 local = point - vec2(cell);
  float nearest = 8.0;
  float secondNearest = 8.0;
  for (int offsetY = -1; offsetY <= 1; offsetY++) {
    for (int offsetX = -1; offsetX <= 1; offsetX++) {
      vec2 offset = vec2(float(offsetX), float(offsetY));
      vec2 random = waterCellRandom(cell + ivec2(offsetX, offsetY));
      vec2 center = 0.5 + 0.42 * sin(time * (0.7 + random.yx) + 6.2831853 * random);
      float separation = length(offset + center - local);
      if (separation < nearest) {
        secondNearest = nearest;
        nearest = separation;
      } else if (separation < secondNearest) {
        secondNearest = separation;
      }
    }
  }
  return secondNearest - nearest;
}

/** 0..1 brightness of the focused light at a point on the water surface plane. */
float causticPattern(vec2 point, float time) {
  float gap = causticEdgeGap(point * 0.55, time * 0.9);
  return pow(1.0 - clamp(gap * 2.2, 0.0, 1.0), 3.0);
}

/** How strongly sun (or moon) light reaches the bottom through the water: 0 at night or in cloud, 1 in full sun. */
float causticSunStrength() {
  return clamp(dot(skyDirectColor, vec3(0.3333)), 0.0, 1.0);
}

/**
 * Multiplier on the colour of a surface under the water. position is the surface point, floorNormal faces the viewer,
 * waterTopY is the height of the water above it. Averages a little above one, with bright lines on a darker ground.
 */
float waterCausticLight(vec3 position, vec3 floorNormal, float waterTopY, float sunStrength) {
  float depthBelow = max(waterTopY - position.y, 0.0);
  float lightHeight = max(skyLightDirection.y, ${MINIMUM_LIGHT_HEIGHT.toFixed(1)});
  float upward = smoothstep(0.3, 0.9, floorNormal.y);
  vec2 slidAlongLight = skyLightDirection.xz / lightHeight * depthBelow;
  vec2 slantedAcrossWall = vec2(0.83, 0.57) * position.y;
  vec2 crossing = position.xz + mix(slantedAcrossWall, slidAlongLight, upward);
  float amount = sunStrength * mix(0.2, 1.0, upward) * exp(-depthBelow * ${DEPTH_FADE_PER_BLOCK});
  return 1.0 + amount * (causticPattern(crossing, skyFogTime) * ${LINE_BRIGHTENING.toFixed(2)} - ${GROUND_DIMMING.toFixed(2)});
}
`;
