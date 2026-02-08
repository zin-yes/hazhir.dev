"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const API_URL = "/api/visual-novel";
const SCENE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

type DialogSegmentType = "replace" | "append" | "choice";
type SceneType = "dialog" | "cutscene" | "chapter_start" | "chapter_end";
type DialogSegmentTiming = {
  mode: "instant" | "typewriter";
  charDelayMs?: number;
  lineDelayMs?: number;
};


type CharacterSpriteJson = {
  id: string;
  url: string;
  position?: "left" | "center" | "right";
};

type CharacterJson = {
  id: string;
  name: string;
  color?: string;
  sprites?: CharacterSpriteJson[];
};

type DialogChoiceJson = {
  id: string;
  text: string;
  nextSegmentId?: string;
  nextSceneId?: string;
};

type DialogSegmentJson = {
  id: string;
  type: DialogSegmentType;
  characterId: string;
  text: string;
  timing?: DialogSegmentTiming;
  choices?: DialogChoiceJson[];
  nextSegmentId?: string;
  nextSceneId?: string;
};

type SceneSpriteJson = {
  characterId: string;
  position?: "left" | "center" | "right";
  x?: number;
  y?: number;
};

type SceneJson = {
  id: string;
  name: string;
  sceneType: SceneType;
  entrySegmentId: string;
  background?: {
    id: string;
    name: string;
    url: string;
  };
  sprites?: SceneSpriteJson[];
  dialogSegments: Record<string, DialogSegmentJson>;
  editor?: {
    positions?: Record<string, { x: number; y: number }>;
  };
};

type SceneFile = {
  id: string;
  fileName: string;
  data: SceneJson;
};

type EditorResponse = {
  characters: Record<string, CharacterJson>;
  scenes: SceneFile[];
};

const EMPTY_SCENE_TEMPLATE = (sceneId: string): SceneJson => ({
  id: sceneId,
  name: "New Scene",
  sceneType: "dialog",
  background: {
    id: "bg_placeholder",
    name: "Placeholder",
    url: "placeholder",
  },
  entrySegmentId: `${sceneId}_1`,
  dialogSegments: {
    [`${sceneId}_1`]: {
      id: `${sceneId}_1`,
      type: "replace",
      characterId: "narrator",
      text: "New dialog segment.",
      timing: { mode: "instant", charDelayMs: 24, lineDelayMs: 400 },
      nextSegmentId: "",
    },
  },
  editor: {
    positions: {
      [`${sceneId}_1`]: { x: 120, y: 120 },
    },
  },
});

function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getDefaultPosition(index: number) {
  return {
    x: 120 + (index % 3) * 260,
    y: 120 + Math.floor(index / 3) * 160,
  };
}

function getInitials(value?: string) {
  if (!value) return "?";
  const trimmed = value.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("");
}

function getSpriteFallbackPosition(position?: string, index?: number) {
  const baseY = 80 + (index ?? 0) * 12;
  if (position === "left") return { x: 80, y: baseY };
  if (position === "right") return { x: 440, y: baseY };
  return { x: 260, y: baseY };
}

function getCharacterSpriteUrl(character?: { sprites?: Array<{ url: string }> }) {
  const url = character?.sprites?.[0]?.url;
  if (!url || url === "placeholder") return "";
  return url;
}

export default function VisualNovelEditorPage() {
  const [characters, setCharacters] = useState<Record<string, CharacterJson>>({});
  const [scenes, setScenes] = useState<SceneFile[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string>("");
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>("");
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>("");
  const [sceneDraft, setSceneDraft] = useState<SceneJson | null>(null);
  const [status, setStatus] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [newSceneId, setNewSceneId] = useState<string>("");
  const [newCharacterId, setNewCharacterId] = useState<string>("");
  const [newSegmentId, setNewSegmentId] = useState<string>("");
  const [newSpriteCharacterId, setNewSpriteCharacterId] = useState<string>("");
  const [validationError, setValidationError] = useState<string>("");
  const [previewSegmentId, setPreviewSegmentId] = useState<string>("");
  const [previewText, setPreviewText] = useState<string>("");
  const [previewIsTyping, setPreviewIsTyping] = useState<boolean>(false);
  const [previewHistory, setPreviewHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [viewTab, setViewTab] = useState<"graph" | "preview">("graph");
  const [showLeftPanel, setShowLeftPanel] = useState<boolean>(true);
  const [showRightPanel, setShowRightPanel] = useState<boolean>(true);
  const [graphPan, setGraphPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const graphRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const panDragRef = useRef<{
    originX: number;
    originY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const spriteDragRef = useRef<{
    index: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const graphPanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const clipboardRef = useRef<{
    segment: DialogSegmentJson;
    position: { x: number; y: number };
  } | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTextRef = useRef<string>("");

  const selectedScene = useMemo(
    () => scenes.find((scene) => scene.id === selectedSceneId),
    [scenes, selectedSceneId]
  );

  const segmentList = useMemo(() => {
    const segments = sceneDraft?.dialogSegments || {};
    return Object.values(segments);
  }, [sceneDraft]);

  const selectedSegment = useMemo(() => {
    if (!sceneDraft || !selectedSegmentId) return null;
    return sceneDraft.dialogSegments[selectedSegmentId] ?? null;
  }, [sceneDraft, selectedSegmentId]);

  const selectedCharacter = useMemo(() => {
    if (!selectedCharacterId) return null;
    return characters[selectedCharacterId] ?? null;
  }, [characters, selectedCharacterId]);

  const previewSegment = useMemo(() => {
    if (!sceneDraft || !previewSegmentId) return null;
    return sceneDraft.dialogSegments[previewSegmentId] ?? null;
  }, [sceneDraft, previewSegmentId]);

  const previewSceneType = sceneDraft?.sceneType ?? "dialog";
  const previewBackgroundUrl =
    sceneDraft?.background?.url && sceneDraft.background.url !== "placeholder"
      ? sceneDraft.background.url
      : "";

  const getUniqueSegmentId = (baseId: string, segments: Record<string, DialogSegmentJson>) => {
    let index = 1;
    let candidate = `${baseId}_copy`;
    while (segments[candidate]) {
      index += 1;
      candidate = `${baseId}_copy_${index}`;
    }
    return candidate;
  };


  const loadData = async () => {
    setIsLoading(true);
    setStatus("");
    try {
      const response = await fetch(API_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to load editor data.");
      }
      const payload = (await response.json()) as EditorResponse;
      setCharacters(payload.characters || {});
      setScenes(payload.scenes || []);

      const initialSceneId = payload.scenes?.[0]?.id ?? "";
      setSelectedSceneId((prev) => prev || initialSceneId);
    } catch (error) {
      setStatus((error as Error).message || "Failed to load data.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!selectedScene) {
      setSceneDraft(null);
      setSelectedSegmentId("");
      setPreviewSegmentId("");
      setPreviewText("");
      return;
    }
    const draft = cloneDeep(selectedScene.data);
    const positions = draft.editor?.positions ?? {};
    const segmentIds = Object.keys(draft.dialogSegments || {});

    segmentIds.forEach((id, index) => {
      if (!positions[id]) {
        positions[id] = getDefaultPosition(index);
      }
    });

    draft.editor = { positions };
    setSceneDraft(draft);
    setSelectedSegmentId(draft.entrySegmentId || segmentIds[0] || "");
    setPreviewSegmentId(draft.entrySegmentId || segmentIds[0] || "");
    setPreviewText("");
    setPreviewHistory([]);
    setGraphPan({ x: 0, y: 0 });
  }, [selectedScene]);

  useEffect(() => {
    previewTextRef.current = previewText;
  }, [previewText]);

  useEffect(() => {
    graphPanRef.current = graphPan;
  }, [graphPan]);

  useEffect(() => {
    if (!previewSegment) return;
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    const timing = previewSegment.timing || { mode: "instant", charDelayMs: 24 };
    const baseText =
      previewSegment.type === "append" ? previewTextRef.current.trim() : "";
    const targetText = previewSegment.text || "";

    if (timing.mode === "instant") {
      setPreviewIsTyping(false);
      setPreviewText(baseText ? `${baseText} ${targetText}` : targetText);
      return;
    }

    setPreviewIsTyping(true);
    let index = 0;
    const step = () => {
      index += 1;
      const nextSlice = targetText.slice(0, index);
      setPreviewText(baseText ? `${baseText} ${nextSlice}` : nextSlice);

      if (index < targetText.length) {
        previewTimerRef.current = setTimeout(step, timing.charDelayMs ?? 24);
      } else {
        setPreviewIsTyping(false);
      }
    };

    previewTimerRef.current = setTimeout(step, timing.charDelayMs ?? 24);
  }, [previewSegment]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      if (viewTab !== "graph") return;
      const isModifier = event.ctrlKey || event.metaKey;
      if (!isModifier) return;

      if (event.key.toLowerCase() === "c") {
        if (!sceneDraft || !selectedSegmentId) return;
        const segment = sceneDraft.dialogSegments[selectedSegmentId];
        if (!segment) return;
        const position = sceneDraft.editor?.positions?.[selectedSegmentId] || { x: 120, y: 120 };
        clipboardRef.current = { segment: cloneDeep(segment), position };
        event.preventDefault();
      }

      if (event.key.toLowerCase() === "v") {
        if (!sceneDraft || !clipboardRef.current) return;
        const { segment, position } = clipboardRef.current;
        const nextId = getUniqueSegmentId(segment.id, sceneDraft.dialogSegments);
        const nextSegment: DialogSegmentJson = {
          ...cloneDeep(segment),
          id: nextId,
          nextSegmentId: "",
          nextSceneId: "",
          choices: segment.choices
            ? segment.choices.map((choice, index) => ({
                ...choice,
                id: `${nextId}_choice_${index + 1}`,
                nextSegmentId: "",
                nextSceneId: "",
              }))
            : undefined,
        };

        setSceneDraft((prev) => {
          if (!prev) return prev;
          const positions = { ...(prev.editor?.positions || {}) };
          positions[nextId] = { x: position.x + 24, y: position.y + 24 };
          return {
            ...prev,
            dialogSegments: { ...prev.dialogSegments, [nextId]: nextSegment },
            editor: { positions },
          };
        });
        setSelectedSegmentId(nextId);
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sceneDraft, selectedSegmentId, viewTab]);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!dragRef.current || !sceneDraft || !graphRef.current) return;
      const { id, offsetX, offsetY } = dragRef.current;
      const containerRect = graphRef.current.getBoundingClientRect();
      const pan = graphPanRef.current;
      setSceneDraft((prev) => {
        if (!prev) return prev;
        const next = cloneDeep(prev);
        if (!next.editor) next.editor = { positions: {} };
        if (!next.editor.positions) next.editor.positions = {};
        next.editor.positions[id] = {
          x: event.clientX - containerRect.left - offsetX - pan.x,
          y: event.clientY - containerRect.top - offsetY - pan.y,
        };
        return next;
      });
    };

    const handleUp = () => {
      dragRef.current = null;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [sceneDraft]);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!panDragRef.current) return;
      const { originX, originY, startX, startY } = panDragRef.current;
      setGraphPan({
        x: originX + (event.clientX - startX),
        y: originY + (event.clientY - startY),
      });
    };

    const handleUp = () => {
      panDragRef.current = null;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!spriteDragRef.current || !sceneDraft || !previewRef.current) return;
      const { index, offsetX, offsetY } = spriteDragRef.current;
      const containerRect = previewRef.current.getBoundingClientRect();

      setSceneDraft((prev) => {
        if (!prev || !prev.sprites) return prev;
        const next = cloneDeep(prev);
        if (!next.sprites) return next;
        next.sprites = next.sprites.map((sprite, spriteIndex) =>
          spriteIndex === index
            ? {
                ...sprite,
                x: event.clientX - containerRect.left - offsetX,
                y: event.clientY - containerRect.top - offsetY,
              }
            : sprite
        );
        return next;
      });
    };

    const handleUp = () => {
      spriteDragRef.current = null;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [sceneDraft]);

  const saveCharacters = async () => {
    setStatus("Saving characters...");
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "saveCharacters", characters }),
    });

    if (!response.ok) {
      setStatus("Failed to save characters.");
      return;
    }

    setStatus("Characters saved.");
  };

  const saveScene = async () => {
    if (!sceneDraft) return;
    setStatus("Saving scene...");
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "saveScene", scene: sceneDraft }),
    });

    if (!response.ok) {
      setStatus("Failed to save scene.");
      return;
    }

    setStatus("Scene saved.");
    await loadData();
  };

  const createScene = async () => {
    if (!newSceneId || !SCENE_ID_PATTERN.test(newSceneId)) {
      setStatus("Provide a valid scene id.");
      return;
    }

    const template = EMPTY_SCENE_TEMPLATE(newSceneId);
    setStatus("Creating scene...");
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createScene", scene: template }),
    });

    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      setStatus(result?.error || "Failed to create scene.");
      return;
    }

    setStatus("Scene created.");
    setNewSceneId("");
    await loadData();
    setSelectedSceneId(template.id);
  };

  const deleteScene = async () => {
    if (!selectedSceneId) return;
    const shouldDelete = window.confirm(
      `Delete scene \"${selectedSceneId}\"? This cannot be undone.`
    );
    if (!shouldDelete) return;

    setStatus("Deleting scene...");
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deleteScene", sceneId: selectedSceneId }),
    });

    if (!response.ok) {
      setStatus("Failed to delete scene.");
      return;
    }

    setStatus("Scene deleted.");
    await loadData();
  };

  const duplicateScene = async () => {
    if (!sceneDraft) return;
    if (!newSceneId || !SCENE_ID_PATTERN.test(newSceneId)) {
      setStatus("Provide a valid scene id to duplicate.");
      return;
    }

    const duplicated = cloneDeep(sceneDraft);
    duplicated.id = newSceneId;
    duplicated.name = `${sceneDraft.name} Copy`;

    setStatus("Duplicating scene...");
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createScene", scene: duplicated }),
    });

    if (!response.ok) {
      const result = (await response.json()) as { error?: string };
      setStatus(result?.error || "Failed to duplicate scene.");
      return;
    }

    setStatus("Scene duplicated.");
    setNewSceneId("");
    await loadData();
    setSelectedSceneId(duplicated.id);
  };

  const updateSceneDraft = (partial: Partial<SceneJson>) => {
    setSceneDraft((prev) => (prev ? { ...prev, ...partial } : prev));
  };

  const updateSegment = (id: string, partial: Partial<DialogSegmentJson>) => {
    setSceneDraft((prev) => {
      if (!prev) return prev;
      const segments = { ...prev.dialogSegments };
      const existing = segments[id];
      if (!existing) return prev;
      segments[id] = { ...existing, ...partial };
      return { ...prev, dialogSegments: segments };
    });
  };

  const updateCharacter = (id: string, partial: Partial<CharacterJson>) => {
    setCharacters((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...partial },
    }));
  };

  const addSegment = () => {
    if (!sceneDraft) return;
    const base = newSegmentId || `${sceneDraft.id}_${segmentList.length + 1}`;
    if (!SCENE_ID_PATTERN.test(base)) {
      setValidationError("Segment id must be alphanumeric, dash, or underscore.");
      return;
    }
    if (sceneDraft.dialogSegments[base]) {
      setValidationError("Segment id already exists.");
      return;
    }

    setValidationError("");
    const nextSegment: DialogSegmentJson = {
      id: base,
      type: "replace",
      characterId: "narrator",
      text: "New dialog segment.",
      timing: { mode: "instant", charDelayMs: 24, lineDelayMs: 400 },
      nextSegmentId: "",
    };

    setSceneDraft((prev) => {
      if (!prev) return prev;
      const positions = { ...(prev.editor?.positions || {}) };
      positions[base] = getDefaultPosition(segmentList.length);
      return {
        ...prev,
        dialogSegments: { ...prev.dialogSegments, [base]: nextSegment },
        editor: { positions },
      };
    });
    setSelectedSegmentId(base);
    setNewSegmentId("");
  };

  const deleteSegment = (segmentId: string) => {
    if (!sceneDraft) return;
    const shouldDelete = window.confirm(
      `Delete segment \"${segmentId}\"? This cannot be undone.`
    );
    if (!shouldDelete) return;

    setSceneDraft((prev) => {
      if (!prev) return prev;
      const next = cloneDeep(prev);
      delete next.dialogSegments[segmentId];
      if (next.editor?.positions) {
        delete next.editor.positions[segmentId];
      }

      Object.values(next.dialogSegments).forEach((segment) => {
        if (segment.nextSegmentId === segmentId) {
          segment.nextSegmentId = "";
        }
        if (segment.choices) {
          segment.choices = segment.choices.map((choice) =>
            choice.nextSegmentId === segmentId
              ? { ...choice, nextSegmentId: "" }
              : choice
          );
        }
      });

      if (next.entrySegmentId === segmentId) {
        next.entrySegmentId = Object.keys(next.dialogSegments)[0] || "";
      }

      return next;
    });
    setSelectedSegmentId("");
  };

  const addChoice = () => {
    if (!selectedSegment) return;
    const choices = selectedSegment.choices ? [...selectedSegment.choices] : [];
    const id = `${selectedSegment.id}_choice_${choices.length + 1}`;
    choices.push({ id, text: "New choice", nextSceneId: "" });
    updateSegment(selectedSegment.id, { choices });
  };

  const removeChoice = (choiceId: string) => {
    if (!selectedSegment) return;
    const choices = (selectedSegment.choices || []).filter(
      (choice) => choice.id !== choiceId
    );
    updateSegment(selectedSegment.id, { choices });
  };

  const addCharacter = () => {
    if (!newCharacterId || !SCENE_ID_PATTERN.test(newCharacterId)) {
      setStatus("Provide a valid character id.");
      return;
    }

    if (characters[newCharacterId]) {
      setStatus("Character id already exists.");
      return;
    }

    setCharacters((prev) => ({
      ...prev,
      [newCharacterId]: {
        id: newCharacterId,
        name: "New Character",
        color: "#94a3b8",
        sprites: [],
      },
    }));
    setSelectedCharacterId(newCharacterId);
    setNewCharacterId("");
  };

  const removeCharacter = (characterId: string) => {
    const shouldDelete = window.confirm(
      `Delete character \"${characterId}\"? This cannot be undone.`
    );
    if (!shouldDelete) return;

    setCharacters((prev) => {
      const next = { ...prev };
      delete next[characterId];
      return next;
    });

    if (selectedCharacterId === characterId) {
      setSelectedCharacterId("");
    }
  };

  const addCharacterSprite = () => {
    if (!selectedCharacter) return;
    const sprites = selectedCharacter.sprites ? [...selectedCharacter.sprites] : [];
    const id = `${selectedCharacter.id}_sprite_${sprites.length + 1}`;
    sprites.push({ id, url: "placeholder", position: "center" });
    updateCharacter(selectedCharacter.id, { sprites });
  };

  const updateCharacterSprite = (
    characterId: string,
    spriteId: string,
    partial: Partial<CharacterSpriteJson>
  ) => {
    const character = characters[characterId];
    if (!character?.sprites) return;
    const sprites = character.sprites.map((sprite) =>
      sprite.id === spriteId ? { ...sprite, ...partial } : sprite
    );
    updateCharacter(characterId, { sprites });
  };

  const removeCharacterSprite = (characterId: string, spriteId: string) => {
    const character = characters[characterId];
    if (!character?.sprites) return;
    const sprites = character.sprites.filter((sprite) => sprite.id !== spriteId);
    updateCharacter(characterId, { sprites });
  };

  const addSceneSprite = () => {
    if (!sceneDraft) return;
    const characterId =
      newSpriteCharacterId || Object.keys(characters)[0] || "narrator";
    const nextSprite: SceneSpriteJson = {
      characterId,
      position: "center",
      x: 120,
      y: 120,
    };
    setSceneDraft((prev) => {
      if (!prev) return prev;
      const sprites = prev.sprites ? [...prev.sprites, nextSprite] : [nextSprite];
      return { ...prev, sprites };
    });
    setNewSpriteCharacterId("");
  };

  const updateSceneSprite = (
    index: number,
    partial: Partial<SceneSpriteJson>
  ) => {
    setSceneDraft((prev) => {
      if (!prev || !prev.sprites) return prev;
      const sprites = prev.sprites.map((sprite, spriteIndex) =>
        spriteIndex === index ? { ...sprite, ...partial } : sprite
      );
      return { ...prev, sprites };
    });
  };

  const removeSceneSprite = (index: number) => {
    setSceneDraft((prev) => {
      if (!prev || !prev.sprites) return prev;
      const sprites = prev.sprites.filter((_, spriteIndex) => spriteIndex !== index);
      return { ...prev, sprites };
    });
  };

  const restartPreview = () => {
    if (!sceneDraft) return;
    setPreviewSegmentId(sceneDraft.entrySegmentId);
    setPreviewText("");
    setPreviewHistory([]);
  };

  const advancePreview = () => {
    if (!previewSegment) return;
    if (previewIsTyping) {
      setPreviewIsTyping(false);
      setPreviewText((prev) => {
        const base = previewSegment.type === "append" ? prev.trim() : "";
        const target = previewSegment.text || "";
        return base ? `${base} ${target}` : target;
      });
      return;
    }
    if (previewSegment.nextSegmentId) {
      setPreviewHistory((prev) => [...prev, previewSegment.id]);
      setPreviewSegmentId(previewSegment.nextSegmentId);
      return;
    }
    if (previewSegment.nextSceneId) {
      setPreviewHistory([]);
      setSelectedSceneId(previewSegment.nextSceneId);
    }
  };

  const choosePreview = (choice: DialogChoiceJson) => {
    if (choice.nextSegmentId) {
      setPreviewHistory((prev) => [...prev, previewSegment.id]);
      setPreviewSegmentId(choice.nextSegmentId);
      return;
    }
    if (choice.nextSceneId) {
      setPreviewHistory([]);
      setSelectedSceneId(choice.nextSceneId);
    }
  };

  const backPreview = () => {
    setPreviewHistory((prev) => {
      if (!prev.length) return prev;
      const nextHistory = prev.slice(0, -1);
      const targetId = prev[prev.length - 1];
      setPreviewSegmentId(targetId);
      setPreviewText("");
      return nextHistory;
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center">
        Loading editor...
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(253,230,138,0.08),transparent_40%),radial-gradient(circle_at_bottom,rgba(56,189,248,0.08),transparent_45%)] bg-slate-950 text-slate-100">
      <div className="absolute inset-0">
        <div className="absolute top-0 left-0 right-0 z-20 h-16 px-5 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-lg font-semibold">Visual Novel Editor</h1>
              <p className="text-xs text-slate-400">
                Drag nodes, edit details, and preview live.
              </p>
            </div>
            <div className="flex rounded-md border border-slate-800 bg-slate-950/70 p-1">
              <Button
                size="sm"
                variant={viewTab === "graph" ? "default" : "ghost"}
                onClick={() => setViewTab("graph")}
              >
                Scene Graph
              </Button>
              <Button
                size="sm"
                variant={viewTab === "preview" ? "default" : "ghost"}
                onClick={() => setViewTab("preview")}
              >
                Preview
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={showLeftPanel ? "secondary" : "ghost"}
              onClick={() => setShowLeftPanel((prev) => !prev)}
            >
              Scenes
            </Button>
            <Button
              size="sm"
              variant={showRightPanel ? "secondary" : "ghost"}
              onClick={() => setShowRightPanel((prev) => !prev)}
            >
              Inspector
            </Button>
            <Button onClick={loadData} variant="outline" size="sm" disabled={isLoading}>
              Reload
            </Button>
            <Button onClick={saveScene} size="sm" disabled={!sceneDraft}>
              Save Scene
            </Button>
            <Button onClick={saveCharacters} variant="outline" size="sm">
              Save Characters
            </Button>
          </div>
        </div>

        <div className="absolute inset-0 pt-16 z-10">
          <div className="h-full flex flex-col">
            <div className="px-4 pt-3 pb-2 text-xs text-slate-400">{status}</div>
            <div className="flex-1 flex min-h-0">
          {showLeftPanel && (
            <aside className="w-[260px] border-r border-slate-800 bg-slate-950/70 p-4 overflow-y-auto min-h-0">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Scenes
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowLeftPanel(false)}
              >
                Collapse
              </Button>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {scenes.map((scene) => (
                <Button
                  key={scene.id}
                  variant={scene.id === selectedSceneId ? "default" : "ghost"}
                  className="justify-start"
                  onClick={() => setSelectedSceneId(scene.id)}
                >
                  {scene.id}
                </Button>
              ))}
              {!scenes.length && (
                <div className="text-sm text-slate-500">No scenes found.</div>
              )}
            </div>

            <div className="mt-6 space-y-3">
              <Input
                placeholder="new_scene_id"
                value={newSceneId}
                onChange={(event) => setNewSceneId(event.target.value)}
              />
              <div className="flex flex-col gap-2">
                <Button onClick={createScene} variant="secondary">
                  Create Scene
                </Button>
                <Button onClick={duplicateScene} variant="outline">
                  Duplicate Scene
                </Button>
                <Button onClick={deleteScene} variant="destructive">
                  Delete Scene
                </Button>
              </div>
            </div>
          </aside>
          )}

          <section className="flex-1 border-x border-slate-800 bg-slate-950/40 relative overflow-hidden flex flex-col min-h-0 h-full">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div>
                <div className="text-sm text-slate-400">Scene Graph</div>
                <div className="text-lg font-semibold">
                  {sceneDraft?.name || "No Scene Selected"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="new_segment_id"
                  value={newSegmentId}
                  onChange={(event) => setNewSegmentId(event.target.value)}
                  className="w-44"
                />
                <Button onClick={addSegment} variant="secondary" disabled={!sceneDraft}>
                  Add Segment
                </Button>
              </div>
            </div>

            {validationError && (
              <div className="px-4 py-2 text-sm text-red-400 border-b border-slate-800">
                {validationError}
              </div>
            )}
            {viewTab === "graph" ? (
              <div
                ref={graphRef}
                className="relative flex-1 min-h-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.08)_1px,transparent_1px)] bg-[size:32px_32px]"
                onMouseDown={(event) => {
                  if (event.button !== 1) return;
                  const target = event.target as HTMLElement | null;
                  if (target?.closest("[data-graph-node]")) return;
                  panDragRef.current = {
                    originX: graphPanRef.current.x,
                    originY: graphPanRef.current.y,
                    startX: event.clientX,
                    startY: event.clientY,
                  };
                  event.preventDefault();
                }}
              >
                <div
                  className="absolute inset-0"
                  style={{ transform: `translate(${graphPan.x}px, ${graphPan.y}px)` }}
                >
                  {sceneDraft && (
                    <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
                      {Object.values(sceneDraft.dialogSegments).map((segment) => {
                        const positions = sceneDraft.editor?.positions || {};
                        const from = positions[segment.id];
                        if (!from) return null;

                        const edges: Array<{ id: string; to: string }> = [];
                        if (segment.nextSegmentId) {
                          edges.push({ id: `${segment.id}-next`, to: segment.nextSegmentId });
                        }
                        (segment.choices || []).forEach((choice) => {
                          if (choice.nextSegmentId) {
                            edges.push({ id: `${segment.id}-${choice.id}`, to: choice.nextSegmentId });
                          }
                        });

                        return edges.map((edge) => {
                          const target = positions[edge.to];
                          if (!target) return null;
                          const x1 = from.x + 110;
                          const y1 = from.y + 40;
                          const x2 = target.x + 110;
                          const y2 = target.y + 40;
                          return (
                            <line
                              key={edge.id}
                              x1={x1}
                              y1={y1}
                              x2={x2}
                              y2={y2}
                              stroke="rgba(148,163,184,0.6)"
                              strokeWidth={2}
                              markerEnd="url(#arrow)"
                            />
                          );
                        });
                      })}
                      <defs>
                        <marker
                          id="arrow"
                          viewBox="0 0 10 10"
                          refX="6"
                          refY="5"
                          markerWidth="6"
                          markerHeight="6"
                          orient="auto-start-reverse"
                        >
                          <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148,163,184,0.7)" />
                        </marker>
                      </defs>
                    </svg>
                  )}

                  {sceneDraft &&
                    Object.values(sceneDraft.dialogSegments).map((segment) => {
                      const positions = sceneDraft.editor?.positions || {};
                      const position = positions[segment.id] || { x: 120, y: 120 };
                      const isSelected = segment.id === selectedSegmentId;
                      return (
                        <div
                          key={segment.id}
                          data-graph-node
                          className={`absolute w-[220px] rounded-lg border px-3 py-2 shadow-sm cursor-move transition-all ${
                            isSelected
                              ? "border-amber-400 bg-amber-400/10"
                              : "border-slate-700 bg-slate-900/80"
                          }`}
                          style={{ left: position.x, top: position.y }}
                          onMouseDown={(event) => {
                            if (!graphRef.current) return;
                            const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
                            dragRef.current = {
                              id: segment.id,
                              offsetX: event.clientX - rect.left,
                              offsetY: event.clientY - rect.top,
                            };
                            setSelectedSegmentId(segment.id);
                          }}
                          onClick={() => setSelectedSegmentId(segment.id)}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs uppercase tracking-wide text-slate-400">
                              {segment.type}
                            </span>
                            <span className="text-xs text-slate-500">{segment.id}</span>
                          </div>
                          <div className="mt-2 text-sm font-semibold">
                            {segment.characterId}
                          </div>
                          <div className="mt-1 text-xs text-slate-300 line-clamp-3">
                            {segment.text || "(no text)"}
                          </div>
                          {(segment.nextSceneId || segment.choices?.some((c) => c.nextSceneId)) && (
                            <div className="mt-2 text-[11px] text-slate-400">
                              Scene link: {segment.nextSceneId || "via choices"}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            ) : (
              <div className="relative flex flex-col flex-1 min-h-0">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Preview
                    </div>
                    <div className="text-sm text-slate-400">
                      Scene: {sceneDraft?.id || "-"} · Segment: {previewSegmentId || "-"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={backPreview}
                      disabled={!previewHistory.length}
                    >
                      Back
                    </Button>
                    <Button size="sm" variant="secondary" onClick={restartPreview}>
                      Restart
                    </Button>
                    <Button size="sm" onClick={advancePreview}>
                      {previewIsTyping ? "Finish" : "Next"}
                    </Button>
                  </div>
                </div>
                <div
                  ref={previewRef}
                  className="relative flex-1 min-h-0 rounded-b-lg border border-slate-800 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-amber-900/40 via-slate-900 to-slate-950" />
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(251,191,36,0.1),transparent_50%)]" />
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(139,92,246,0.05),transparent_50%)]" />
                  {previewBackgroundUrl && (
                    <div
                      className="absolute inset-0 bg-cover bg-center opacity-40"
                      style={{ backgroundImage: `url(${previewBackgroundUrl})` }}
                    />
                  )}

                  {(sceneDraft?.sprites || []).map((sprite, index) => {
                    const character = characters[sprite.characterId];
                    const fallback = getSpriteFallbackPosition(sprite.position, index);
                    const x = sprite.x ?? fallback.x;
                    const y = sprite.y ?? fallback.y;
                    const spriteUrl = getCharacterSpriteUrl(character);
                    if (!spriteUrl) return null;

                    return (
                      <div
                        key={`${sprite.characterId}-${index}`}
                        className="absolute w-28 h-40 rounded-lg border-2 border-amber-400/60 bg-contain bg-top bg-no-repeat cursor-grab"
                        style={{ left: x, top: y, backgroundImage: `url(${spriteUrl})` }}
                        onMouseDown={(event) => {
                          if (!previewRef.current) return;
                          const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
                          spriteDragRef.current = {
                            index,
                            offsetX: event.clientX - rect.left,
                            offsetY: event.clientY - rect.top,
                          };
                        }}
                      />
                    );
                  })}

                  {previewSceneType === "chapter_start" && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center px-6">
                        <p className="text-xs uppercase tracking-[0.35em] text-amber-200/70">
                          Chapter Start
                        </p>
                        <div className="mt-3 text-3xl font-semibold text-amber-100">
                          {sceneDraft?.name || "New Chapter"}
                        </div>
                        <div className="mt-3 text-sm text-slate-300">
                          {previewSegment?.text || ""}
                        </div>
                      </div>
                    </div>
                  )}
                  {previewSceneType === "chapter_end" && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center px-6">
                        <p className="text-xs uppercase tracking-[0.35em] text-slate-400">
                          Chapter End
                        </p>
                        <div className="mt-3 text-2xl font-semibold text-slate-100">
                          {sceneDraft?.name || "Chapter Complete"}
                        </div>
                        <div className="mt-3 text-sm text-slate-400">
                          {previewSegment?.text || ""}
                        </div>
                      </div>
                    </div>
                  )}
                  {previewSceneType !== "chapter_start" &&
                    previewSceneType !== "chapter_end" && (
                      <div className="absolute left-4 right-4 bottom-4 max-h-[40%] overflow-y-auto bg-slate-900/95 backdrop-blur-sm border border-slate-700/50 rounded-lg p-6 shadow-2xl">
                        {previewSegment && (
                          <div className="mb-3">
                            {previewSegment.characterId === "narrator" ? (
                              <div className="inline-block bg-slate-800/60 px-4 py-1.5 rounded-md border-l-2 border-slate-600">
                                <span className="text-slate-400 font-medium italic text-sm">
                                  {characters[previewSegment.characterId]?.name ||
                                    previewSegment.characterId}
                                </span>
                              </div>
                            ) : (
                              <div
                                className="inline-block px-4 py-1.5 rounded-md"
                                style={{
                                  backgroundColor:
                                    characters[previewSegment.characterId]?.color
                                      ? `${characters[previewSegment.characterId]?.color}30`
                                      : "rgba(51, 65, 85, 0.8)",
                                  borderLeft: `3px solid ${
                                    characters[previewSegment.characterId]?.color || "#64748b"
                                  }`,
                                }}
                              >
                                <span
                                  className="font-medium"
                                  style={{
                                    color:
                                      characters[previewSegment.characterId]?.color ||
                                      "#e2e8f0",
                                  }}
                                >
                                  {characters[previewSegment.characterId]?.name ||
                                    previewSegment.characterId}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="min-h-[120px] mb-4">
                          <p className="text-slate-100 text-xl leading-relaxed">
                            {previewText || "(no text)"}
                          </p>
                        </div>
                        {previewSegment?.type === "choice" && (
                          <div className="flex flex-col gap-2 mt-4">
                            {(previewSegment.choices || []).map((choice) => (
                              <Button
                                key={choice.id}
                                size="sm"
                                variant="outline"
                                onClick={() => choosePreview(choice)}
                                className="justify-start text-left h-auto py-3 px-4 bg-slate-800/50 hover:bg-slate-700/50 border-slate-600"
                              >
                                {choice.text}
                              </Button>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-700/50">
                          <div className="flex gap-2">
                            <Button
                              onClick={() => setShowHistory((prev) => !prev)}
                              variant="ghost"
                              size="sm"
                              className="text-slate-400 hover:text-slate-200"
                            >
                              {showHistory ? "Hide" : "History"}
                            </Button>
                            <Button
                              onClick={() => {}}
                              variant="ghost"
                              size="sm"
                              className="text-slate-400 hover:text-slate-200"
                            >
                              Skip
                            </Button>
                            <Button
                              onClick={() => {}}
                              variant="ghost"
                              size="sm"
                              className="text-slate-400 hover:text-slate-200"
                            >
                              Auto
                            </Button>
                            <Button
                              onClick={restartPreview}
                              variant="ghost"
                              size="sm"
                              className="text-slate-400 hover:text-slate-200"
                            >
                              Restart
                            </Button>
                          </div>
                          <Button
                            onClick={advancePreview}
                            disabled={!previewSegment || previewSegment.type === "choice"}
                            className="bg-slate-700 hover:bg-slate-600"
                          >
                            Next →
                          </Button>
                        </div>
                      </div>
                    )}
                </div>
              </div>
            )}
          </section>

          {showRightPanel && (
            <aside className="w-[340px] flex flex-col gap-4 overflow-y-auto border-l border-slate-800 bg-slate-950/60 p-4 min-h-0">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Inspector
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowRightPanel(false)}
                >
                  Collapse
                </Button>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Scene
                </div>
                {sceneDraft ? (
                  <div className="mt-3 space-y-3">
                    <Input
                      value={sceneDraft.name}
                      onChange={(event) => updateSceneDraft({ name: event.target.value })}
                      placeholder="Scene name"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={sceneDraft.id}
                        onChange={(event) => updateSceneDraft({ id: event.target.value })}
                        placeholder="Scene ID"
                      />
                      <select
                        className="h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
                        value={sceneDraft.sceneType}
                        onChange={(event) =>
                          updateSceneDraft({ sceneType: event.target.value as SceneType })
                        }
                      >
                        <option value="dialog">dialog</option>
                        <option value="cutscene">cutscene</option>
                        <option value="chapter_start">chapter_start</option>
                        <option value="chapter_end">chapter_end</option>
                      </select>
                    </div>
                    <Input
                      value={sceneDraft.entrySegmentId}
                      onChange={(event) =>
                        updateSceneDraft({ entrySegmentId: event.target.value })
                      }
                      placeholder="Entry segment id"
                    />
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-wide text-slate-500">
                        Background
                      </div>
                      <Input
                        value={sceneDraft.background?.id || ""}
                        onChange={(event) =>
                          updateSceneDraft({
                            background: {
                              id: event.target.value,
                              name: sceneDraft.background?.name || "",
                              url: sceneDraft.background?.url || "",
                            },
                          })
                        }
                        placeholder="Background ID"
                      />
                      <Input
                        value={sceneDraft.background?.name || ""}
                        onChange={(event) =>
                          updateSceneDraft({
                            background: {
                              id: sceneDraft.background?.id || "",
                              name: event.target.value,
                              url: sceneDraft.background?.url || "",
                            },
                          })
                        }
                        placeholder="Background name"
                      />
                      <Input
                        value={sceneDraft.background?.url || ""}
                        onChange={(event) =>
                          updateSceneDraft({
                            background: {
                              id: sceneDraft.background?.id || "",
                              name: sceneDraft.background?.name || "",
                              url: event.target.value,
                            },
                          })
                        }
                        placeholder="Background URL"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs uppercase tracking-wide text-slate-500">
                          Scene Sprites
                        </span>
                        <Button onClick={addSceneSprite} size="sm" variant="secondary">
                          Add Sprite
                        </Button>
                      </div>
                      <Input
                        value={newSpriteCharacterId}
                        onChange={(event) => setNewSpriteCharacterId(event.target.value)}
                        placeholder="Character id for new sprite"
                      />
                      <div className="space-y-3">
                        {(sceneDraft.sprites || []).map((sprite, index) => (
                          <div key={`${sprite.characterId}-${index}`} className="rounded-md border border-slate-800 p-2">
                            <Input
                              value={sprite.characterId}
                              onChange={(event) =>
                                updateSceneSprite(index, { characterId: event.target.value })
                              }
                              placeholder="Character ID"
                            />
                            <div className="mt-2">
                              <select
                                className="h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
                                value={sprite.position || "center"}
                                onChange={(event) =>
                                  updateSceneSprite(index, {
                                    position: event.target.value as "left" | "center" | "right",
                                  })
                                }
                              >
                                <option value="left">left</option>
                                <option value="center">center</option>
                                <option value="right">right</option>
                              </select>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <Input
                                value={sprite.x?.toString() || ""}
                                onChange={(event) =>
                                  updateSceneSprite(index, {
                                    x: Number(event.target.value) || 0,
                                  })
                                }
                                placeholder="X"
                              />
                              <Input
                                value={sprite.y?.toString() || ""}
                                onChange={(event) =>
                                  updateSceneSprite(index, {
                                    y: Number(event.target.value) || 0,
                                  })
                                }
                                placeholder="Y"
                              />
                            </div>
                            <Button
                              onClick={() => removeSceneSprite(index)}
                              variant="ghost"
                              size="sm"
                              className="mt-2 text-red-400 hover:text-red-300"
                            >
                              Remove Sprite
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-slate-500">
                    Select a scene to edit.
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Segment
                </div>
                {selectedSegment ? (
                  <div className="mt-3 space-y-3">
                    <Input
                      value={selectedSegment.id}
                      onChange={(event) =>
                        updateSegment(selectedSegment.id, { id: event.target.value })
                      }
                      placeholder="Segment ID"
                    />
                    <select
                      className="h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
                      value={selectedSegment.type}
                      onChange={(event) =>
                        updateSegment(selectedSegment.id, {
                          type: event.target.value as DialogSegmentType,
                        })
                      }
                    >
                      <option value="replace">replace</option>
                      <option value="append">append</option>
                      <option value="choice">choice</option>
                    </select>
                    <Input
                      value={selectedSegment.characterId}
                      onChange={(event) =>
                        updateSegment(selectedSegment.id, {
                          characterId: event.target.value,
                        })
                      }
                      placeholder="Character ID"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        className="h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
                        value={selectedSegment.timing?.mode || "instant"}
                        onChange={(event) =>
                          updateSegment(selectedSegment.id, {
                            timing: {
                              ...selectedSegment.timing,
                              mode: event.target.value as "instant" | "typewriter",
                            },
                          })
                        }
                      >
                        <option value="instant">instant</option>
                        <option value="typewriter">typewriter</option>
                      </select>
                      <Input
                        value={
                          selectedSegment.timing?.charDelayMs?.toString() || ""
                        }
                        onChange={(event) =>
                          updateSegment(selectedSegment.id, {
                            timing: {
                              ...selectedSegment.timing,
                              mode: selectedSegment.timing?.mode ?? "instant",
                              charDelayMs: Number(event.target.value) || 0,
                            },
                          })
                        }
                        placeholder="char delay ms"
                      />
                    </div>
                    <Input
                      value={
                        selectedSegment.timing?.lineDelayMs?.toString() || ""
                      }
                      onChange={(event) =>
                        updateSegment(selectedSegment.id, {
                          timing: {
                            ...selectedSegment.timing,
                            mode: selectedSegment.timing?.mode ?? "instant",
                            lineDelayMs: Number(event.target.value) || 0,
                          },
                        })
                      }
                      placeholder="line delay ms"
                    />
                    <Textarea
                      value={selectedSegment.text}
                      onChange={(event) =>
                        updateSegment(selectedSegment.id, { text: event.target.value })
                      }
                      className="min-h-[140px] bg-slate-950/80"
                      placeholder="Dialog text"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={selectedSegment.nextSegmentId || ""}
                        onChange={(event) =>
                          updateSegment(selectedSegment.id, {
                            nextSegmentId: event.target.value,
                          })
                        }
                        placeholder="Next segment"
                      />
                      <Input
                        value={selectedSegment.nextSceneId || ""}
                        onChange={(event) =>
                          updateSegment(selectedSegment.id, {
                            nextSceneId: event.target.value,
                          })
                        }
                        placeholder="Next scene"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-slate-500">
                        Choices
                      </span>
                      <Button onClick={addChoice} variant="secondary" size="sm">
                        Add Choice
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {(selectedSegment.choices || []).map((choice) => (
                        <div
                          key={choice.id}
                          className="rounded-md border border-slate-800 p-2"
                        >
                          <Input
                            value={choice.text}
                            onChange={(event) => {
                              const choices = (selectedSegment.choices || []).map((item) =>
                                item.id === choice.id
                                  ? { ...item, text: event.target.value }
                                  : item
                              );
                              updateSegment(selectedSegment.id, { choices });
                            }}
                            placeholder="Choice text"
                          />
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <Input
                              value={choice.nextSegmentId || ""}
                              onChange={(event) => {
                                const choices = (selectedSegment.choices || []).map((item) =>
                                  item.id === choice.id
                                    ? { ...item, nextSegmentId: event.target.value }
                                    : item
                                );
                                updateSegment(selectedSegment.id, { choices });
                              }}
                              placeholder="Next segment"
                            />
                            <Input
                              value={choice.nextSceneId || ""}
                              onChange={(event) => {
                                const choices = (selectedSegment.choices || []).map((item) =>
                                  item.id === choice.id
                                    ? { ...item, nextSceneId: event.target.value }
                                    : item
                                );
                                updateSegment(selectedSegment.id, { choices });
                              }}
                              placeholder="Next scene"
                            />
                          </div>
                          <Button
                            onClick={() => removeChoice(choice.id)}
                            variant="ghost"
                            size="sm"
                            className="mt-2 text-red-400 hover:text-red-300"
                          >
                            Remove Choice
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button
                      onClick={() => deleteSegment(selectedSegment.id)}
                      variant="destructive"
                      size="sm"
                    >
                      Delete Segment
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-slate-500">
                    Select a segment to edit.
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Characters
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.keys(characters).map((id) => (
                    <Button
                      key={id}
                      size="sm"
                      variant={id === selectedCharacterId ? "default" : "ghost"}
                      onClick={() => setSelectedCharacterId(id)}
                    >
                      {id}
                    </Button>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <Input
                    placeholder="new_character_id"
                    value={newCharacterId}
                    onChange={(event) => setNewCharacterId(event.target.value)}
                  />
                  <Button onClick={addCharacter} variant="secondary">
                    Add
                  </Button>
                </div>
                {selectedCharacter ? (
                  <div className="mt-4 space-y-3">
                    <Input
                      value={selectedCharacter.name}
                      onChange={(event) =>
                        updateCharacter(selectedCharacter.id, { name: event.target.value })
                      }
                      placeholder="Character name"
                    />
                    <Input
                      value={selectedCharacter.color || ""}
                      onChange={(event) =>
                        updateCharacter(selectedCharacter.id, { color: event.target.value })
                      }
                      placeholder="Color (hex)"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wide text-slate-500">
                        Sprites
                      </span>
                      <Button onClick={addCharacterSprite} size="sm" variant="secondary">
                        Add Sprite
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {(selectedCharacter.sprites || []).map((sprite) => (
                        <div key={sprite.id} className="rounded-md border border-slate-800 p-2">
                          <Input
                            value={sprite.url}
                            onChange={(event) =>
                              updateCharacterSprite(selectedCharacter.id, sprite.id, {
                                url: event.target.value,
                              })
                            }
                            placeholder="Sprite URL"
                            className="mt-2"
                          />
                          <select
                            className="mt-2 h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
                            value={sprite.position || "center"}
                            onChange={(event) =>
                              updateCharacterSprite(selectedCharacter.id, sprite.id, {
                                position: event.target.value as "left" | "center" | "right",
                              })
                            }
                          >
                            <option value="left">left</option>
                            <option value="center">center</option>
                            <option value="right">right</option>
                          </select>
                          <Button
                            onClick={() => removeCharacterSprite(selectedCharacter.id, sprite.id)}
                            variant="ghost"
                            size="sm"
                            className="mt-2 text-red-400 hover:text-red-300"
                          >
                            Remove Sprite
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button
                      onClick={() => removeCharacter(selectedCharacter.id)}
                      variant="destructive"
                      size="sm"
                    >
                      Delete Character
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-slate-500">Select a character.</div>
                )}
              </div>
            </aside>
          )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
