/**
 * Visual Novel Application Types
 * This file contains all type definitions for the visual novel engine
 */

export interface Character {
  id: string;
  name: string;
  color?: string; // For name display color
  sprites?: CharacterSprite[];
}

export interface CharacterSprite {
  id: string;
  url: string;
  position?: "left" | "center" | "right";
}

export interface Background {
  id: string;
  name: string;
  url: string;
  music?: string;
}

export type DialogSegmentType = "replace" | "append" | "choice";

export interface DialogSegmentChoice {
  id: string;
  text: string;
  nextSegmentId?: string;
  nextSceneId?: string;
  condition?: () => boolean; // Optional condition for showing choice
  affectionChange?: Record<string, number>; // Character affection changes
}

export interface DialogSegmentTiming {
  mode: "instant" | "typewriter";
  charDelayMs?: number;
  lineDelayMs?: number;
}

export interface DialogSegment {
  id: string;
  type: DialogSegmentType;
  character: Character;
  text: string;
  timing?: DialogSegmentTiming;
  characterSprite?: CharacterSprite;
  voiceOver?: string; // Audio file path
  choices?: DialogSegmentChoice[];
  nextSegmentId?: string;
  nextSceneId?: string;
  effects?: DialogueEffect[];
}

export interface DialogueEffect {
  type: "shake" | "fade" | "flash" | "zoom";
  duration?: number;
  intensity?: number;
}

export type SceneType = "dialog" | "cutscene" | "chapter_start" | "chapter_end";

export interface SceneSprite {
  characterId: string;
  position?: "left" | "center" | "right";
  x?: number;
  y?: number;
}

export interface Scene {
  id: string;
  name: string;
  entrySegmentId: string;
  dialogSegments: Record<string, DialogSegment>;
  background?: Background;
  sprites?: SceneSprite[];
  sceneType: SceneType;
  music?: string;
}

export interface SaveData {
  timestamp: number;
  currentScene: string;
  currentLine: number;
  variables: Record<string, any>;
  affection: Record<string, number>;
  unlockedCGs: string[];
  completedRoutes: string[];
}

export interface GameState {
  currentScene: string;
  currentLineIndex: number;
  textHistory: HistoryEntry[];
  variables: Record<string, any>;
  affection: Record<string, number>;
  unlockedCGs: string[];
  completedRoutes: string[];
}

export interface HistoryEntry {
  character: string;
  text: string;
  timestamp: number;
}

export interface VNSettings {
  textSpeed: number;
  autoPlaySpeed: number;
  musicVolume: number;
  sfxVolume: number;
  voiceVolume: number;
  skipUnread: boolean;
  skipAfterChoices: boolean;
}
