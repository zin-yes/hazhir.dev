import * as THREE from "three";
import type { HumidityUniforms } from "./climate/humidity-map";
import { MAX_CLOUD_CARVES } from "./cloud-carves";
import { SKY_FRAGMENT_SHADER, SKY_VERTEX_SHADER } from "./sky-shaders";
import type { SkyState } from "./sky-state";

export interface SkyDomeInputs {
  state: SkyState;
  viewerPosition: THREE.Vector3;
  elapsedSeconds: number;
  weatherShift: number;
  /** 0 clear .. 1 densest fog. */
  fogStrength: number;
  /** 0..1: how deep inside a cloud the viewer is. */
  cloudMist: number;
}

/** A unit cube drawn at the far plane around the camera; the shader turns each pixel's direction into sky. */
export class SkyDome extends THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial> {
  constructor(humidityTexture: THREE.Texture, humidityUniforms: HumidityUniforms) {
    super(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.ShaderMaterial({
        name: "sky-dome",
        uniforms: {
          viewerPosition: { value: new THREE.Vector3() },
          elapsedSeconds: { value: 0 },
          sunDirection: { value: new THREE.Vector3(0, 1, 0) },
          moonDirection: { value: new THREE.Vector3(0, -1, 0) },
          starRotation: { value: new THREE.Matrix3() },
          zenithColor: { value: new THREE.Vector3() },
          horizonColor: { value: new THREE.Vector3() },
          glowColor: { value: new THREE.Vector3() },
          glowStrength: { value: 0 },
          sunLightColor: { value: new THREE.Vector3() },
          starVisibility: { value: 0 },
          moonPhaseAngle: { value: 0 },
          weatherShift: { value: 0 },
          fogColor: { value: new THREE.Vector3() },
          fogStrength: { value: 0 },
          mistColor: { value: new THREE.Vector3() },
          cloudMist: { value: 0 },
          cloudCarves: { value: Array.from({ length: MAX_CLOUD_CARVES }, () => new THREE.Vector4()) },
          humidityTexture: { value: humidityTexture },
          ...humidityUniforms,
        },
        vertexShader: SKY_VERTEX_SHADER,
        fragmentShader: SKY_FRAGMENT_SHADER,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.name = "sky";
    this.frustumCulled = false;
  }

  get carveUniform(): THREE.Vector4[] {
    return this.material.uniforms.cloudCarves!.value;
  }

  apply({ state, viewerPosition, elapsedSeconds, weatherShift, fogStrength, cloudMist }: SkyDomeInputs): void {
    const uniforms = this.material.uniforms;
    uniforms.viewerPosition!.value.copy(viewerPosition);
    uniforms.elapsedSeconds!.value = elapsedSeconds;
    uniforms.sunDirection!.value.set(...state.sunDirection);
    uniforms.moonDirection!.value.set(...state.moonDirection);
    uniforms.starRotation!.value.setFromMatrix4(
      new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...state.orbitAxis), -state.orbitAngle),
    );
    uniforms.zenithColor!.value.set(...state.zenithColor);
    uniforms.horizonColor!.value.set(...state.horizonColor);
    uniforms.glowColor!.value.set(...state.glowColor);
    uniforms.glowStrength!.value = state.glowStrength;
    uniforms.sunLightColor!.value.set(...state.sunLightColor);
    uniforms.starVisibility!.value = state.starVisibility;
    uniforms.moonPhaseAngle!.value = state.moonPhaseAngle;
    uniforms.weatherShift!.value = weatherShift;
    uniforms.fogColor!.value.set(...state.fogColor);
    uniforms.fogStrength!.value = fogStrength;
    uniforms.mistColor!.value.set(...state.mistColor);
    uniforms.cloudMist!.value = cloudMist;
  }
}
