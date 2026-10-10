// Screen space god rays, part of the final composite (see bloom-pass.ts). From every pixel the shader marches towards
// the sun on screen and adds up how much of the way is lit: in the open that is sky showing between trees, hills and
// clouds' gaps; under water it is the part of the view that leaves through the surface, with the light wavering as the
// waves bend it. Occluders cast shafts that fan out from the sun. The march needs the world depth, so it shares the
// underwater view's depth texture and unprojection (see underwater-view.ts). Shafts are soft, so they are marched at a
// quarter of the screen size into their own target and the final composite just adds that picture.

import * as THREE from "three";
import { skyLightingUniforms } from "../sky/sky-lighting";
import { UNDERWATER_VIEW_GLSL } from "./underwater-view";

const SUN_DISTANCE_BLOCKS = 1000;
/** Beyond this far outside the screen (in half screens) the sun no longer throws rays. */
const SUN_FADE_START = 1.0;
const SUN_FADE_END = 2.2;
/** The shafts are drawn this many times smaller than the screen in each direction. */
export const GOD_RAY_RESOLUTION_DIVISOR = 4;
const SAMPLE_COUNT = 24;
/** Each step keeps this share of the last one's weight, so near samples count most and rays fade towards the sun. */
const SAMPLE_DECAY = 0.94;
const SHARE_OF_PATH_MARCHED = 0.9;

export const godRayUniforms = {
  godRaySunUv: { value: new THREE.Vector2(0.5, 0.5) },
  /** 0 when the effect is off, the sun is behind the camera or too far off screen; up to 1. */
  godRayAmount: { value: 0 },
};

const sunPoint = new THREE.Vector3();
const sunInView = new THREE.Vector3();

/** Aims the rays at this frame's sun. Returns whether they are on. */
export function updateGodRays(camera: THREE.PerspectiveCamera, isEnabled: boolean): boolean {
  godRayUniforms.godRayAmount.value = 0;
  if (!isEnabled) return false;
  camera.updateMatrixWorld();
  sunPoint.copy(camera.position).addScaledVector(skyLightingUniforms.skyLightDirection.value, SUN_DISTANCE_BLOCKS);
  sunInView.copy(sunPoint).applyMatrix4(camera.matrixWorldInverse);
  if (sunInView.z >= 0) return false;
  sunPoint.project(camera);
  const offScreen = Math.max(Math.abs(sunPoint.x), Math.abs(sunPoint.y));
  const amount = 1 - THREE.MathUtils.smoothstep(offScreen, SUN_FADE_START, SUN_FADE_END);
  if (amount <= 0) return false;
  godRayUniforms.godRaySunUv.value.set(sunPoint.x * 0.5 + 0.5, sunPoint.y * 0.5 + 0.5);
  godRayUniforms.godRayAmount.value = amount;
  return true;
}

const SAMPLE_WEIGHT_TOTAL = (1 - Math.pow(SAMPLE_DECAY, SAMPLE_COUNT)) / (1 - SAMPLE_DECAY);

/** Needs UNDERWATER_VIEW_GLSL (the depth texture, unprojection, surface height and noise) before it. */
export const GOD_RAYS_GLSL = `
uniform vec2 godRaySunUv;
uniform float godRayAmount;

float godRayInterleavedNoise(vec2 pixel) {
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

/** 0..1: how much sunlight comes through the view at this spot of the screen. */
float godRayLight(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  float depth = textureLod(underwaterDepth, uv, 0.0).r;
  if (underwaterActive < 0.5) return depth > 0.99999 ? 1.0 : 0.0;
  vec3 origin = underwaterUnproject(uv, 0.0);
  vec3 direction = underwaterRayDirection(uv, origin);
  vec3 hit = origin + direction * underwaterHitDistance(uv, origin, depth);
  if (hit.y <= underwaterSurfaceY) return 0.0;
  vec2 crossing = (origin + direction * ((underwaterSurfaceY - origin.y) / max(direction.y, 0.05))).xz;
  return clamp(0.15 + 1.6 * (0.5 + waterGradientNoise(crossing * 0.8 + vec2(skyFogTime * 0.25, 0.0)).x), 0.0, 1.4);
}

/** Display colour of the shafts to add to the picture. */
vec3 godRays(vec2 uv) {
  vec2 toSun = godRaySunUv - uv;
  vec2 march = toSun * (${SHARE_OF_PATH_MARCHED.toFixed(2)} / ${SAMPLE_COUNT}.0);
  vec2 point = uv + march * godRayInterleavedNoise(gl_FragCoord.xy);
  float lit = 0.0;
  float weight = 1.0;
  for (int sampleIndex = 0; sampleIndex < ${SAMPLE_COUNT}; sampleIndex++) {
    lit += godRayLight(point) * weight;
    weight *= ${SAMPLE_DECAY};
    point += march;
  }
  lit /= ${SAMPLE_WEIGHT_TOTAL.toFixed(3)};
  float closeToSun = exp(-length(toSun * vec2(underwaterAspect, 1.0)) * 0.8);
  float ownLight = godRayLight(uv);
  float visible = lit * closeToSun * mix(1.0, 0.25, min(ownLight, 1.0));
  vec3 airColor = vec3(1.0, 0.92, 0.78) * 0.5;
  vec3 waterColor = vec3(0.35, 0.8, 1.0) * 0.75;
  vec3 tint = mix(airColor, waterColor, underwaterActive);
  return tint * visible * causticSunStrength() * godRayAmount;
}
`;

/** The whole fragment shader of the god ray pass; it writes the shafts as display colour to add over the picture. */
export const GOD_RAYS_FRAGMENT_SHADER = `
in vec2 vUv;
${UNDERWATER_VIEW_GLSL}
${GOD_RAYS_GLSL}

void main() {
  gl_FragColor = vec4(godRays(vUv), 1.0);
}
`;
