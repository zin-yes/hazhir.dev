import { useState } from "react";
import {
  REAL_RENDER_DISTANCE_MAXIMUM_CHUNKS,
  REAL_RENDER_DISTANCE_MINIMUM_CHUNKS,
} from "../../world/render-settings";

/** The far terrain choices: 0 is off, the rest double. */
const FAR_TERRAIN_STEPS = [0, 32, 64, 128, 256, 512];

export interface VideoSettingsValues {
  renderDistanceChunks: number;
  farTerrainChunks: number;
}

interface VideoSettingsProps {
  initialValues: VideoSettingsValues;
  onChange: (values: Partial<VideoSettingsValues>) => void;
}

function nearestFarTerrainStep(chunks: number): number {
  let bestStep = 0;
  FAR_TERRAIN_STEPS.forEach((value, step) => {
    if (Math.abs(value - chunks) < Math.abs(FAR_TERRAIN_STEPS[bestStep] - chunks)) bestStep = step;
  });
  return bestStep;
}

const SLIDER_CLASS = "w-full cursor-pointer accent-[#b6f24a]";

export function VideoSettings({ initialValues, onChange }: VideoSettingsProps) {
  const [renderDistance, setRenderDistance] = useState(initialValues.renderDistanceChunks);
  const [farTerrainStep, setFarTerrainStep] = useState(nearestFarTerrainStep(initialValues.farTerrainChunks));
  const farTerrainChunks = FAR_TERRAIN_STEPS[farTerrainStep];

  return (
    <div className="flex flex-col gap-5 text-sm text-[#d8d2f0]">
      <label className="flex flex-col gap-2">
        <span className="flex justify-between">
          <span>Render distance</span>
          <span className="text-[#b6f24a]">{renderDistance} chunks</span>
        </span>
        <input
          type="range"
          className={SLIDER_CLASS}
          min={REAL_RENDER_DISTANCE_MINIMUM_CHUNKS}
          max={REAL_RENDER_DISTANCE_MAXIMUM_CHUNKS}
          step={1}
          value={renderDistance}
          onChange={(event) => {
            const chunks = Number(event.target.value);
            setRenderDistance(chunks);
            onChange({ renderDistanceChunks: chunks });
          }}
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="flex justify-between">
          <span>Far terrain</span>
          <span className="text-[#b6f24a]">{farTerrainChunks === 0 ? "Off" : `${farTerrainChunks} chunks`}</span>
        </span>
        <input
          type="range"
          className={SLIDER_CLASS}
          min={0}
          max={FAR_TERRAIN_STEPS.length - 1}
          step={1}
          value={farTerrainStep}
          onChange={(event) => {
            const step = Number(event.target.value);
            setFarTerrainStep(step);
            onChange({ farTerrainChunks: FAR_TERRAIN_STEPS[step] });
          }}
        />
      </label>
      <p className="text-center text-[0.65rem] leading-relaxed text-[#6e6590]">
        Applies right away and is remembered on this device. Far terrain is a light, blocky view of the land past your
        render distance.
      </p>
    </div>
  );
}
