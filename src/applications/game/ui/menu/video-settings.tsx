import {
  REAL_RENDER_DISTANCE_MAXIMUM_CHUNKS,
  REAL_RENDER_DISTANCE_MINIMUM_CHUNKS,
  VERTICAL_RENDER_DISTANCE_MAXIMUM_CHUNKS,
  VERTICAL_RENDER_DISTANCE_MINIMUM_CHUNKS,
  type RenderSettings,
} from "../../world/render-settings";
import {
  FIELD_OF_VIEW_MAXIMUM_DEGREES,
  FIELD_OF_VIEW_MINIMUM_DEGREES,
  type GameSettings,
  type ShadowQuality,
} from "../../settings/game-settings";
import { ChoiceSetting, SettingsHeading, SettingsHint, SliderSetting } from "./setting-rows";

/** The far terrain choices: 0 is off, the rest double. */
const FAR_TERRAIN_STEPS = [0, 32, 64, 128, 256, 512];

const VOLUME_SHAPE_CHOICES: readonly { value: RenderSettings["shape"]; label: string }[] = [
  { value: "cylinder", label: "Full height" },
  { value: "ellipsoid", label: "Rounded" },
];

const SHADOW_QUALITY_CHOICES: readonly { value: ShadowQuality; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
];

const BLOOM_CHOICES: readonly { value: "off" | "on"; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
];

const WATER_REFLECTIONS_CHOICES: readonly { value: "off" | "on"; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
];

export interface VideoSettingsValues {
  renderDistanceChunks: number;
  farTerrainChunks: number;
  verticalUpChunks: number;
  verticalDownChunks: number;
  volumeShape: RenderSettings["shape"];
}

interface VideoSettingsProps {
  values: VideoSettingsValues;
  onChange: (values: Partial<VideoSettingsValues>) => void;
  fieldOfViewDegrees: GameSettings["fieldOfViewDegrees"];
  onFieldOfViewChange: (degrees: number) => void;
  shadowQuality: GameSettings["shadowQuality"];
  onShadowQualityChange: (shadowQuality: ShadowQuality) => void;
  bloomEnabled: GameSettings["bloomEnabled"];
  onBloomEnabledChange: (bloomEnabled: boolean) => void;
  waterReflections: GameSettings["waterReflections"];
  onWaterReflectionsChange: (waterReflections: boolean) => void;
}

function nearestFarTerrainStep(chunks: number): number {
  let bestStep = 0;
  FAR_TERRAIN_STEPS.forEach((value, step) => {
    if (Math.abs(value - chunks) < Math.abs(FAR_TERRAIN_STEPS[bestStep] - chunks)) bestStep = step;
  });
  return bestStep;
}

export function VideoSettings({
  values,
  onChange,
  fieldOfViewDegrees,
  onFieldOfViewChange,
  shadowQuality,
  onShadowQualityChange,
  bloomEnabled,
  onBloomEnabledChange,
  waterReflections,
  onWaterReflectionsChange,
}: VideoSettingsProps) {
  const farTerrainStep = nearestFarTerrainStep(values.farTerrainChunks);
  const farTerrainChunks = FAR_TERRAIN_STEPS[farTerrainStep];

  return (
    <div className="flex flex-col gap-5">
      <SliderSetting
        label="Field of view"
        valueText={`${fieldOfViewDegrees}°`}
        min={FIELD_OF_VIEW_MINIMUM_DEGREES}
        max={FIELD_OF_VIEW_MAXIMUM_DEGREES}
        step={1}
        value={fieldOfViewDegrees}
        onChange={onFieldOfViewChange}
      />
      <ChoiceSetting label="Shadows" choices={SHADOW_QUALITY_CHOICES} value={shadowQuality} onChange={onShadowQualityChange} />
      <ChoiceSetting
        label="Bloom"
        choices={BLOOM_CHOICES}
        value={bloomEnabled ? "on" : "off"}
        onChange={(choice) => onBloomEnabledChange(choice === "on")}
      />
      <ChoiceSetting
        label="Water reflections"
        choices={WATER_REFLECTIONS_CHOICES}
        value={waterReflections ? "on" : "off"}
        onChange={(choice) => onWaterReflectionsChange(choice === "on")}
      />

      <SettingsHeading>Chunks</SettingsHeading>
      <SliderSetting
        label="Render distance"
        valueText={`${values.renderDistanceChunks} chunks`}
        min={REAL_RENDER_DISTANCE_MINIMUM_CHUNKS}
        max={REAL_RENDER_DISTANCE_MAXIMUM_CHUNKS}
        step={1}
        value={values.renderDistanceChunks}
        onChange={(chunks) => onChange({ renderDistanceChunks: chunks })}
      />
      <SliderSetting
        label="Height above you"
        valueText={`${values.verticalUpChunks} chunks`}
        min={VERTICAL_RENDER_DISTANCE_MINIMUM_CHUNKS}
        max={VERTICAL_RENDER_DISTANCE_MAXIMUM_CHUNKS}
        step={1}
        value={values.verticalUpChunks}
        onChange={(chunks) => onChange({ verticalUpChunks: chunks })}
      />
      <SliderSetting
        label="Depth below you"
        valueText={`${values.verticalDownChunks} chunks`}
        min={VERTICAL_RENDER_DISTANCE_MINIMUM_CHUNKS}
        max={VERTICAL_RENDER_DISTANCE_MAXIMUM_CHUNKS}
        step={1}
        value={values.verticalDownChunks}
        onChange={(chunks) => onChange({ verticalDownChunks: chunks })}
      />
      <ChoiceSetting
        label="Chunk shape"
        choices={VOLUME_SHAPE_CHOICES}
        value={values.volumeShape}
        onChange={(shape) => onChange({ volumeShape: shape })}
      />

      <SettingsHeading>Far terrain</SettingsHeading>
      <SliderSetting
        label="Distance"
        valueText={farTerrainChunks === 0 ? "Off" : `${farTerrainChunks} chunks`}
        min={0}
        max={FAR_TERRAIN_STEPS.length - 1}
        step={1}
        value={farTerrainStep}
        onChange={(step) => onChange({ farTerrainChunks: FAR_TERRAIN_STEPS[step] })}
      />
      <SettingsHint>
        Applies right away and is remembered on this device. Full height keeps every chunk column loaded up and down;
        rounded trims the far corners. Far terrain is a light, blocky view of the land past your render distance.
      </SettingsHint>
    </div>
  );
}
