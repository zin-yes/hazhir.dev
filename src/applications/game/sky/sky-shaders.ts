// The sky dome: a smooth dithered gradient, stars, a round sun with limb darkening and a rayed corona, a round moon
// with phases, maria and craters, and horizon fog. Clouds are not part of the dome (the cloud pass draws them after the
// world so terrain and clouds occlude each other); they are only traced here when the depth copy the pass needs is
// unavailable.

import { CLOUD_GLSL } from "./cloud-glsl";

export const SKY_VERTEX_SHADER = `
varying vec3 vDirection;

void main() {
  vDirection = position;
  mat4 rotationOnlyView = mat4(mat3(viewMatrix));
  gl_Position = (projectionMatrix * rotationOnlyView * vec4(position, 1.0)).xyww;
}
`;

export const SKY_FRAGMENT_SHADER = `
varying vec3 vDirection;

${CLOUD_GLSL}

uniform mat3 starRotation;
uniform vec3 glowColor;
uniform float glowStrength;
uniform float starVisibility;
uniform float moonPhaseAngle;
uniform float cloudsInDome;

const float SUN_RADIUS = 0.055;
const float MOON_RADIUS = 0.05;
const float STAR_GRID = 180.0;
const float STAR_DENSITY = 0.004;

vec3 skyGradient(vec3 direction) {
  float elevation = clamp(direction.y, -1.0, 1.0);
  vec3 color = mix(horizonColor, zenithColor, pow(max(elevation, 0.0), 0.5));
  return mix(color, horizonColor * 0.5, smoothstep(0.0, -0.5, elevation));
}

// Position of a direction on the plane facing a celestial body (the body is at the origin); false behind the viewer.
bool bodyPlane(vec3 direction, vec3 center, out vec2 plane) {
  plane = vec2(0.0);
  float facing = dot(direction, center);
  if (facing <= 0.0) return false;
  vec3 right = normalize(cross(vec3(0.0, 0.0, 1.0), center));
  vec3 up = cross(center, right);
  plane = vec2(dot(direction, right), dot(direction, up)) / facing;
  return true;
}

vec3 starField(vec3 direction) {
  vec3 rotated = starRotation * direction;
  vec3 magnitude = abs(rotated);
  float major = max(magnitude.x, max(magnitude.y, magnitude.z));
  vec2 faceUv;
  float faceId;
  if (magnitude.x == major) {
    faceUv = rotated.yz / major;
    faceId = rotated.x > 0.0 ? 0.0 : 1.0;
  } else if (magnitude.y == major) {
    faceUv = rotated.xz / major;
    faceId = rotated.y > 0.0 ? 2.0 : 3.0;
  } else {
    faceUv = rotated.xy / major;
    faceId = rotated.z > 0.0 ? 4.0 : 5.0;
  }
  float cellHash = hash13(vec3(floor(faceUv * STAR_GRID), faceId));
  float isStar = step(1.0 - STAR_DENSITY, cellHash);
  float brightness = 0.35 + 0.65 * fract(cellHash * 91.7);
  float twinkle = 0.8 + 0.2 * sin(elapsedSeconds * (1.0 + 2.0 * fract(cellHash * 13.1)) + cellHash * 80.0);
  vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), fract(cellHash * 7.3));
  return tint * isStar * brightness * twinkle;
}

vec3 paintSun(vec3 color, vec3 direction) {
  vec2 plane;
  if (!bodyPlane(direction, sunDirection, plane)) return color;
  float radius = length(plane);
  float angle = atan(plane.y, plane.x);
  float unitRadius = radius / SUN_RADIUS;

  float halo = exp(-pow(unitRadius / 2.4, 1.4)) * 0.85;
  float rays = pow(max(sin(angle * 9.0 + elapsedSeconds * 0.04) * 0.5 + 0.5, 0.0), 5.0) * exp(-unitRadius / 4.5) * 0.45;
  color += glowColor * (halo + rays) * (0.55 + 0.45 * glowStrength);

  float disc = 1.0 - smoothstep(0.93, 1.0, unitRadius);
  vec3 discColor = mix(vec3(2.5, 2.35, 1.85), vec3(2.0, 1.45, 0.65), smoothstep(0.35, 1.0, unitRadius));
  return mix(color, discColor, disc);
}

vec3 paintMoon(vec3 color, vec3 direction) {
  vec2 plane;
  if (!bodyPlane(direction, moonDirection, plane)) return color;
  float unitRadius = length(plane) / MOON_RADIUS;
  vec3 phaseLight = vec3(sin(moonPhaseAngle), 0.0, cos(moonPhaseAngle));
  float illuminated = 0.5 + 0.5 * cos(moonPhaseAngle);

  float halo = exp(-unitRadius * unitRadius * 0.12) * 0.16 * illuminated;
  color += vec3(0.45, 0.55, 0.85) * halo;

  if (unitRadius >= 1.0) return color;
  vec3 normal = vec3(plane / MOON_RADIUS, sqrt(max(1.0 - unitRadius * unitRadius, 0.0)));
  float lit = smoothstep(-0.04, 0.08, dot(normal, phaseLight));
  float terrain = 0.6 * valueNoise(normal * 2.4 + 5.0) + 0.4 * valueNoise(normal * 6.5 + 11.0);
  float maria = smoothstep(0.46, 0.62, terrain);
  float craters = smoothstep(0.80, 0.9, valueNoise(normal * 15.0 + 3.0));
  vec3 albedo = mix(vec3(0.86, 0.88, 0.94), vec3(0.46, 0.5, 0.6), maria * 0.85) * (1.0 - craters * 0.22);
  float limb = 0.7 + 0.3 * normal.z;
  vec3 moonColor = albedo * limb * lit * 1.15 + vec3(0.02, 0.03, 0.06) * (1.0 - lit);
  return mix(color, moonColor, 1.0 - smoothstep(0.95, 1.0, unitRadius));
}

void main() {
  vec3 direction = normalize(vDirection);
  vec3 color = skyGradient(direction);

  color += starField(direction) * starVisibility * smoothstep(0.02, 0.3, direction.y);

  float glowAlignment = max(dot(direction, sunDirection), 0.0);
  color = mix(color, glowColor, clamp(pow(glowAlignment, 6.0) * glowStrength * 0.8, 0.0, 1.0));

  color = paintMoon(color, direction);
  color = paintSun(color, direction);

  float horizonFog = fogStrength * (1.0 - smoothstep(0.0, 0.2 + 0.45 * fogStrength, direction.y));
  color = mix(color, fogColor, clamp(horizonFog * 1.15 + fogStrength * 0.3, 0.0, 1.0));

  if (cloudsInDome > 0.5) {
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    vec4 clouds = traceClouds(viewerPosition, direction, CLOUD_MAX_DISTANCE, jitter);
    vec3 cloudLight = mix(clouds.rgb, fogColor * (1.0 - clouds.w), fogStrength * 0.45);
    color = color * clouds.w + cloudLight;
    color = mix(color, mistColor, cloudMist);
  }

  float screenNoise = fract(sin(dot(gl_FragCoord.xy, vec2(78.233, 12.9898))) * 43758.5453);
  color += (screenNoise - 0.5) / 255.0;

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;
