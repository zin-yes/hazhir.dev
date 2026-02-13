"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useRef, useState } from "react";
import { scenes, characters } from "@/applications/visual-novel/data/loader";
import type { DialogSegment, DialogSegmentChoice } from "./types";

function getSpriteFallbackPosition(position?: string, index?: number) {
  const baseY = 120 + (index ?? 0) * 20;
  if (position === "left") return { x: 80, y: baseY };
  if (position === "right") return { x: 380, y: baseY };
  return { x: 240, y: baseY };
}

function getCharacterSpriteUrl(character?: { sprites?: Array<{ url: string }> }) {
  const url = character?.sprites?.[0]?.url;
  if (!url || url === "placeholder") return "";
  return url;
}

export default function VisualNovelApplication() {
  const [currentSceneId, setCurrentSceneId] = useState<string>("start");
  const [currentSegmentId, setCurrentSegmentId] = useState<string>("start_1");
  const [displayedText, setDisplayedText] = useState<string>("");
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [textHistory, setTextHistory] = useState<string[]>([]);
  const [autoPlay, setAutoPlay] = useState<boolean>(false);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [showTitleScreen, setShowTitleScreen] = useState<boolean>(true);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayedTextRef = useRef<string>("");
  const segmentBaseRef = useRef<string>("");
  const segmentFullRef = useRef<string>("");
  const stageRef = useRef<HTMLDivElement | null>(null);

  const currentScene = scenes[currentSceneId];
  const currentSegment = currentScene?.dialogSegments[currentSegmentId];
  const backgroundUrl =
    currentScene?.background?.url && currentScene.background.url !== "placeholder"
      ? currentScene.background.url
      : "";
  const isCutscene = currentScene?.sceneType === "cutscene";
  const isChapterStart = currentScene?.sceneType === "chapter_start";
  const isChapterEnd = currentScene?.sceneType === "chapter_end";
  const baseSpriteSize = { width: 160, height: 240 };

  // Debug: log when scene or dialogue changes
  useEffect(() => {
    console.log('VN Debug:', {
      sceneId: currentSceneId,
      segmentId: currentSegmentId,
      hasScene: !!currentScene,
      hasSegment: !!currentSegment,
      segmentText: currentSegment?.text,
    });
  }, [currentSceneId, currentSegmentId, currentScene, currentSegment]);

  useEffect(() => {
    if (!currentScene) return;
    const entryId = currentScene.entrySegmentId;
    setCurrentSegmentId(entryId);
    setDisplayedText("");
    setIsTyping(false);
  }, [currentSceneId, currentScene]);



  useEffect(() => {
    displayedTextRef.current = displayedText;
  }, [displayedText]);

  useEffect(() => {
    if (!currentSegment) return;

    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }

    const timing = currentSegment.timing || { mode: "instant", charDelayMs: 24 };
    const baseText =
      currentSegment.type === "append" ? displayedTextRef.current.trim() : "";
    const segmentText = currentSegment.text || "";

    segmentBaseRef.current = baseText;
    segmentFullRef.current = segmentText;

    if (timing.mode === "instant") {
      setIsTyping(false);
      setDisplayedText(baseText ? `${baseText} ${segmentText}` : segmentText);
      return;
    }

    setIsTyping(true);
    setDisplayedText(baseText);
    let index = 0;
    const step = () => {
      index += 1;
      const nextSlice = segmentText.slice(0, index);
      setDisplayedText(baseText ? `${baseText} ${nextSlice}` : nextSlice);

      if (index < segmentText.length) {
        typingTimerRef.current = setTimeout(step, timing.charDelayMs ?? 24);
      } else {
        setIsTyping(false);
      }
    };

    typingTimerRef.current = setTimeout(step, timing.charDelayMs ?? 24);
  }, [currentSegment]);

  const startGame = () => {
    setShowTitleScreen(false);
  };



  const handleNext = () => {
    if (!currentSegment) return;

    if (isTyping) {
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      setIsTyping(false);
      const base = segmentBaseRef.current;
      const full = segmentFullRef.current;
      setDisplayedText(base ? `${base} ${full}` : full);
      return;
    }

    if (!isCutscene && currentSegment.text) {
      setTextHistory((prev) => [...prev, `${currentSegment.character.name}: ${displayedText}`]);
    }

    if (currentSegment.nextSegmentId) {
      setCurrentSegmentId(currentSegment.nextSegmentId);
      return;
    }

    if (currentSegment.nextSceneId) {
      setCurrentSceneId(currentSegment.nextSceneId);
      return;
    }
  };

  const handleChoice = (choice: DialogSegmentChoice) => {
    // Add choice to history
    setTextHistory((prev) => [...prev, `> ${choice.text}`]);

    if (choice.nextSegmentId) {
      setCurrentSegmentId(choice.nextSegmentId);
      return;
    }

    if (choice.nextSceneId) {
      setCurrentSceneId(choice.nextSceneId);
    }
  };

  const handleSkip = () => {
    if (!currentScene || !currentSegment) return;

    const visited = new Set<string>();
    let cursor = currentSegment;

    while (cursor.nextSegmentId && !visited.has(cursor.nextSegmentId)) {
      visited.add(cursor.id);
      const next = currentScene.dialogSegments[cursor.nextSegmentId];
      if (!next) break;
      cursor = next;
    }

    if (cursor.id !== currentSegment.id) {
      setCurrentSegmentId(cursor.id);
    }
  };

  const handleRestart = () => {
    setCurrentSceneId('start');
    setCurrentSegmentId('start_1');
    setDisplayedText("");
    setIsTyping(false);
    setTextHistory([]);
    setAutoPlay(false);
    setShowTitleScreen(true);
  };

  const handleAuto = () => {
    setAutoPlay(!autoPlay);
  };

  // Safety check
  if (!currentScene) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-950">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-2">Error: Scene not found</p>
          <p className="text-slate-500 text-sm">Scene ID: {currentSceneId}</p>
          <Button onClick={handleRestart} className="mt-4">
            Restart
          </Button>
        </div>
      </div>
    );
  }

  if (!currentSegment) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-950">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-2">Error: Segment not found</p>
          <p className="text-slate-500 text-sm">
            Scene: {currentSceneId}, Segment: {currentSegmentId}
          </p>
          <Button onClick={handleRestart} className="mt-4">
            Restart
          </Button>
        </div>
      </div>
    );
  }

  // Title Screen
  if (showTitleScreen) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-amber-900/40 via-slate-900 to-slate-950 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(251,191,36,0.1),transparent_70%)]" />
        <div className="text-center z-10 space-y-8">
          <h1 className="text-6xl font-bold text-amber-100 mb-4 drop-shadow-lg">
            A Chance Encounter
          </h1>
          <p className="text-xl text-slate-300 mb-8">
            A short visual novel experience
          </p>
          <div className="space-y-4">
            <Button
              onClick={startGame}
              size="lg"
              className="bg-amber-700 hover:bg-amber-600 text-white text-lg px-8 py-6"
            >
              Start Story
            </Button>
            <div className="text-sm text-slate-500 mt-4">
              <p>☕ Make choices that matter</p>
              <p>📖 Two different endings</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isChapterStart) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.2),transparent_55%),radial-gradient(circle_at_bottom,rgba(56,189,248,0.1),transparent_60%)] bg-slate-950">
        <div className="text-center space-y-6 px-6">
          <p className="text-xs uppercase tracking-[0.35em] text-amber-200/70">
            Chapter Start
          </p>
          <h1 className="text-5xl font-semibold text-amber-100">
            {currentScene?.name || "New Chapter"}
          </h1>
          <p className="text-lg text-slate-300 max-w-xl mx-auto">
            {currentSegment?.text || ""}
          </p>
          <Button onClick={handleNext} size="lg" className="bg-amber-600 hover:bg-amber-500">
            Begin
          </Button>
        </div>
      </div>
    );
  }

  if (isChapterEnd) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.12),transparent_60%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(2,6,23,0.95))]">
        <div className="text-center space-y-6 px-6">
          <p className="text-xs uppercase tracking-[0.35em] text-slate-400">
            Chapter End
          </p>
          <h1 className="text-4xl font-semibold text-slate-100">
            {currentScene?.name || "Chapter Complete"}
          </h1>
          <p className="text-base text-slate-400 max-w-xl mx-auto">
            {currentSegment?.text || ""}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button onClick={handleNext} variant="secondary">
              Continue
            </Button>
            <Button onClick={handleRestart} variant="ghost">
              Restart
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      className="h-full w-full bg-black relative overflow-hidden"
      onClick={() => {
        if (isCutscene && !currentSegment?.choices?.length) {
          handleNext();
        }
      }}
    >
      {/* Background */}
      <div className="absolute inset-0 z-0">
        <div className="w-full h-full bg-gradient-to-br from-amber-900/40 via-slate-900 to-slate-950" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(251,191,36,0.1),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(139,92,246,0.05),transparent_50%)]" />
        {backgroundUrl && (
          <img
            src={backgroundUrl}
            alt=""
            className="absolute left-1/2 top-0 w-full h-auto -translate-x-1/2 opacity-40"
          />
        )}
      </div>

      {/* Character Sprite Area */}
      <div className="absolute inset-0 z-10">
        {currentScene.sprites && currentScene.sprites.length > 0 && (
          <div className="relative h-full w-full">
            {currentScene.sprites.map((sprite, index) => {
              const character = characters[sprite.characterId];
              const fallback = getSpriteFallbackPosition(sprite.position, index);
              const x = sprite.x ?? fallback.x;
              const y = sprite.y ?? fallback.y;
              const alignX = sprite.alignX ?? "left";
              const alignY = sprite.alignY ?? "bottom";
              const spriteWidth = sprite.width ?? baseSpriteSize.width;
              const spriteHeight = sprite.height ?? baseSpriteSize.height;
              const isNarrator = sprite.characterId === "narrator";
              if (isNarrator) return null;
              const spriteUrl = getCharacterSpriteUrl(character);
              if (!spriteUrl) return null;

              return (
                <div
                  key={`${sprite.characterId}-${index}`}
                  className="absolute bg-contain bg-top bg-no-repeat"
                  style={{
                    ...(alignX === "left" ? { left: x } : { right: x }),
                    ...(alignY === "bottom" ? { bottom: y } : { top: y }),
                    width: spriteWidth,
                    height: spriteHeight,
                    backgroundImage: `url(${spriteUrl})`,
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-20 p-6">
        <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-700/50 rounded-lg p-6 shadow-2xl">
          {currentSegment && (
            <div className="mb-3">
              {currentSegment.character.id === "narrator" ? (
                <div className="inline-block bg-slate-800/60 px-4 py-1.5 rounded-md border-l-2 border-slate-600">
                  <span className="text-slate-400 font-medium italic text-sm">
                    {currentSegment.character.name}
                  </span>
                </div>
              ) : (
                <div
                  className="inline-block px-4 py-1.5 rounded-md"
                  style={{
                    backgroundColor: currentSegment.character.color
                      ? `${currentSegment.character.color}30`
                      : "rgba(51, 65, 85, 0.8)",
                    borderLeft: `3px solid ${currentSegment.character.color || "#64748b"}`,
                  }}
                >
                  <span
                    className="font-medium"
                    style={{
                      color: currentSegment.character.color || "#e2e8f0",
                    }}
                  >
                    {currentSegment.character.name}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="min-h-[120px] mb-4">
            <p className="text-slate-100 text-xl leading-relaxed">
              {displayedText || "(no text)"}
            </p>
          </div>

          {currentSegment?.choices && currentSegment.choices.length > 0 && (
            <div className="flex flex-col gap-2 mt-4">
              {currentSegment.choices.map((choice: DialogSegmentChoice, index: number) => (
                <Button
                  key={index}
                  onClick={() => handleChoice(choice)}
                  variant="outline"
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
                onClick={() => setShowHistory(!showHistory)}
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-slate-200"
              >
                {showHistory ? "Hide" : "History"}
              </Button>
              <Button
                onClick={handleSkip}
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-slate-200"
              >
                Skip
              </Button>
              <Button
                onClick={handleAuto}
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-slate-200"
              >
                {autoPlay ? "Stop Auto" : "Auto"}
              </Button>
              <Button
                onClick={handleRestart}
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-slate-200"
              >
                Restart
              </Button>
            </div>

            <Button
              onClick={handleNext}
              disabled={!currentSegment || currentSegment.type === "choice"}
              className="bg-slate-700 hover:bg-slate-600"
            >
              Next →
            </Button>
          </div>
        </div>
      </div>

      {/* History Panel */}
      {showHistory && (
        <div className="absolute inset-0 z-40 bg-black/90 backdrop-blur-sm">
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <h2 className="text-lg font-semibold text-slate-200">Text History</h2>
              <Button
                onClick={() => setShowHistory(false)}
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-slate-200"
              >
                Close
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-3">
                {textHistory.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-8">
                    No history yet. Start reading to see your progress!
                  </p>
                ) : (
                  textHistory.map((text, index) => (
                    <p key={index} className="text-sm text-slate-300 leading-relaxed">
                      {text}
                    </p>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}

      {/* Scene Info Badge */}
      <div className="absolute top-4 left-4 z-30">
        <div className="bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-md border border-slate-700/50">
          <span className="text-xs text-slate-400">
            {currentScene?.name || 'Unknown Scene'}
          </span>
        </div>
      </div>
    </div>
  );
}
