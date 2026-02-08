/**
 * JSON Data Loader
 * Loads and parses character and scene data from JSON files
 */

import type { Character, Scene, DialogSegment, SceneSprite } from '../types';
import charactersData from './characters.json';
import startSceneData from './scenes/start.json';
import cafeteriaLineSceneData from './scenes/cafeteria_line.json';
import cafeteriaTableSceneData from './scenes/cafeteria_table.json';
import flashbackKindergartenSceneData from './scenes/flashback_kindergarten.json';
import cafeteriaTableReturnSceneData from './scenes/cafeteria_table_return.json';
import flashbackSuburbanSceneData from './scenes/flashback_suburban.json';
import backOfSchoolSceneData from './scenes/back_of_school.json';
import creditsSceneData from './scenes/credits.json';
import friendlySceneData from './scenes/conversation_friendly.json';
import awkwardSceneData from './scenes/conversation_awkward.json';
import endingSceneData from './scenes/ending.json';

// Load characters from JSON
export const characters: Record<string, Character> = charactersData as Record<string, Character>;

// Parse scenes from JSON format
function parseScene(sceneData: any): Scene {
  const parsedSegments: Record<string, DialogSegment> = Object.entries(
    sceneData.dialogSegments || {}
  ).reduce((acc, [segmentId, segmentData]) => {
    const character = characters[(segmentData as any).characterId];

    // Sprite selection is handled at the scene level.
    let characterSprite = undefined;

    acc[segmentId] = {
      id: (segmentData as any).id,
      type: (segmentData as any).type,
      character: character,
      text: (segmentData as any).text || "",
      timing: (segmentData as any).timing,
      characterSprite: characterSprite,
      nextSegmentId: (segmentData as any).nextSegmentId,
      nextSceneId: (segmentData as any).nextSceneId,
      choices: (segmentData as any).choices,
      effects: (segmentData as any).effects,
    };

    return acc;
  }, {} as Record<string, DialogSegment>);

  const sprites: SceneSprite[] | undefined = sceneData.sprites;

  return {
    id: sceneData.id,
    name: sceneData.name,
    entrySegmentId: sceneData.entrySegmentId,
    background: sceneData.background,
    sprites: sprites,
    sceneType: sceneData.sceneType || "dialog",
    music: sceneData.music,
    dialogSegments: parsedSegments,
  };
}

const sceneDataList = [
  startSceneData,
  cafeteriaLineSceneData,
  cafeteriaTableSceneData,
  flashbackKindergartenSceneData,
  cafeteriaTableReturnSceneData,
  flashbackSuburbanSceneData,
  backOfSchoolSceneData,
  creditsSceneData,
  friendlySceneData,
  awkwardSceneData,
  endingSceneData,
];

// Load and parse all scenes
export const scenes: Record<string, Scene> = sceneDataList.reduce(
  (acc, sceneData) => {
    acc[sceneData.id] = parseScene(sceneData);
    return acc;
  },
  {} as Record<string, Scene>
);

export default { characters, scenes };
