"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const API_URL = "/api/visual-novel";
const EMPTY_SCENE_TEMPLATE = (sceneId: string) => ({
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
      nextSegmentId: "",
    },
  },
});

type SceneFile = {
  id: string;
  fileName: string;
  data: Record<string, unknown>;
};

type EditorResponse = {
  characters: Record<string, unknown>;
  scenes: SceneFile[];
};

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function parseJson(text: string) {
  try {
    return { value: JSON.parse(text), error: "" };
  } catch (error) {
    return {
      value: null,
      error: (error as Error).message || "Invalid JSON.",
    };
  }
}

export default function VisualNovelEditorPage() {
  const [charactersText, setCharactersText] = useState<string>("");
  const [charactersError, setCharactersError] = useState<string>("");
  const [scenes, setScenes] = useState<SceneFile[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState<string>("");
  const [sceneText, setSceneText] = useState<string>("");
  const [sceneError, setSceneError] = useState<string>("");
  const [newSceneId, setNewSceneId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const selectedScene = useMemo(
    () => scenes.find((scene) => scene.id === selectedSceneId),
    [scenes, selectedSceneId]
  );

  const loadData = async () => {
    setIsLoading(true);
    setStatus("");
    try {
      const response = await fetch(API_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to load editor data.");
      }
      const payload = (await response.json()) as EditorResponse;
      setCharactersText(formatJson(payload.characters));
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
      setSceneText("");
      return;
    }
    setSceneText(formatJson(selectedScene.data));
    setSceneError("");
  }, [selectedScene]);

  const saveCharacters = async () => {
    const parsed = parseJson(charactersText);
    if (parsed.error) {
      setCharactersError(parsed.error);
      return;
    }

    setCharactersError("");
    setStatus("Saving characters...");
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "saveCharacters", characters: parsed.value }),
    });

    if (!response.ok) {
      setStatus("Failed to save characters.");
      return;
    }

    setStatus("Characters saved.");
  };

  const saveScene = async () => {
    const parsed = parseJson(sceneText);
    if (parsed.error) {
      setSceneError(parsed.error);
      return;
    }

    const sceneValue = parsed.value as { id?: string };
    if (!sceneValue?.id) {
      setSceneError("Scene must include an id field.");
      return;
    }

    setSceneError("");
    setStatus("Saving scene...");
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "saveScene", scene: sceneValue }),
    });

    if (!response.ok) {
      setStatus("Failed to save scene.");
      return;
    }

    setStatus("Scene saved.");
    await loadData();
    setSelectedSceneId(sceneValue.id);
  };

  const createScene = async () => {
    if (!newSceneId) {
      setStatus("Provide a scene id to create.");
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
    if (!selectedScene) return;
    if (!newSceneId) {
      setStatus("Provide a scene id to duplicate.");
      return;
    }

    const parsed = parseJson(sceneText);
    if (parsed.error) {
      setSceneError(parsed.error);
      return;
    }

    const duplicated = {
      ...(parsed.value as Record<string, unknown>),
      id: newSceneId,
    };

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
    setSelectedSceneId(duplicated.id as string);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-slate-100">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-col gap-2 mb-8">
          <h1 className="text-3xl font-semibold">Visual Novel Editor</h1>
          <p className="text-slate-400">
            Edit characters, scenes, and dialog segments. Changes save directly to the
            data folder.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Button onClick={loadData} variant="secondary" disabled={isLoading}>
            Reload Data
          </Button>
          <div className="text-sm text-slate-400">{status}</div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          <aside className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
            <div className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
              Scenes
            </div>
            <div className="flex flex-col gap-2">
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
              {scenes.length === 0 && (
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

          <section className="flex flex-col gap-6">
            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-lg font-semibold">Characters</h2>
                  <p className="text-sm text-slate-500">
                    Edit character definitions stored in data/characters.json
                  </p>
                </div>
                <Button onClick={saveCharacters}>Save Characters</Button>
              </div>
              <Textarea
                value={charactersText}
                onChange={(event) => setCharactersText(event.target.value)}
                className="min-h-[320px] font-mono text-sm bg-slate-950/80"
              />
              {charactersError && (
                <p className="text-sm text-red-400 mt-2">{charactersError}</p>
              )}
            </div>

            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-lg font-semibold">Scene Editor</h2>
                  <p className="text-sm text-slate-500">
                    Edit dialog segments, scene metadata, and links.
                  </p>
                </div>
                <Button onClick={saveScene} disabled={!selectedSceneId}>
                  Save Scene
                </Button>
              </div>
              <Textarea
                value={sceneText}
                onChange={(event) => setSceneText(event.target.value)}
                className="min-h-[420px] font-mono text-sm bg-slate-950/80"
              />
              {sceneError && <p className="text-sm text-red-400 mt-2">{sceneError}</p>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
