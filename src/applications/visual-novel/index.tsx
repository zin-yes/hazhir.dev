"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useState } from "react";
import { scenes } from "@/applications/visual-novel/data/loader";
import type { DialogSegment, DialogSegmentChoice } from "./types";

export default function VisualNovelApplication() {
  const [currentSceneId, setCurrentSceneId] = useState<string>("start");
  const [currentSegmentId, setCurrentSegmentId] = useState<string>("start_1");
  const [dialogueText, setDialogueText] = useState<string>("");
  const [textHistory, setTextHistory] = useState<string[]>([]);
  const [autoPlay, setAutoPlay] = useState<boolean>(false);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [showTitleScreen, setShowTitleScreen] = useState<boolean>(true);

  const currentScene = scenes[currentSceneId];
  const currentSegment = currentScene?.dialogSegments[currentSegmentId];

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
    setDialogueText("");
  }, [currentSceneId, currentScene]);

  useEffect(() => {
    if (!currentSegment) return;
    setDialogueText((prev) => {
      if (currentSegment.type === "append") {
        if (!prev) return currentSegment.text;
        return `${prev} ${currentSegment.text}`;
      }

      return currentSegment.text;
    });
  }, [currentSegment]);

  const startGame = () => {
    setShowTitleScreen(false);
  };



  const handleNext = () => {
    if (!currentSegment) return;

    // Add current text to history
    setTextHistory((prev) => [
      ...prev,
      `${currentSegment.character.name}: ${dialogueText}`,
    ]);

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
    setDialogueText("");
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

  return (
    <div className="h-full w-full flex flex-col bg-black relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 z-0">
        {/* Cafe background gradient */}
        <div className="w-full h-full bg-gradient-to-br from-amber-900/40 via-slate-900 to-slate-950" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(251,191,36,0.1),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(139,92,246,0.05),transparent_50%)]" />
      </div>

      {/* Character Sprite Area */}
      <div className="flex-1 relative z-10 flex items-end justify-center pb-32">
        <div className="flex gap-8 items-end">
          {/* Character sprite placeholder with color based on character */}
          {currentSegment?.characterSprite && currentSegment.character.id !== 'narrator' && (
            <div 
              className="w-64 h-96 rounded-lg border-2 flex flex-col items-center justify-end p-6 transition-all duration-300"
              style={{
                backgroundColor: currentSegment.character.color 
                  ? `${currentSegment.character.color}15`
                  : 'rgba(51, 65, 85, 0.3)',
                borderColor: currentSegment.character.color || 'rgba(51, 65, 85, 0.5)',
              }}
            >
              <div className="text-6xl mb-4">
                {currentSegment.characterSprite.emotion === 'happy' && '😊'}
                {currentSegment.characterSprite.emotion === 'sad' && '😢'}
                {currentSegment.characterSprite.emotion === 'surprised' && '😮'}
                {currentSegment.characterSprite.emotion === 'neutral' && '😐'}
              </div>
              <span className="text-slate-400 text-sm font-medium">
                {currentSegment.character.name}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Dialogue Box */}
      <div className="relative z-20 p-6">
        <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-700/50 rounded-lg p-6 shadow-2xl">
          {/* Character Name */}
          {currentSegment && (
            <div className="mb-3">
              {currentSegment.character.id === 'narrator' ? (
                // Narrator gets a simple style
                <div className="inline-block bg-slate-800/60 px-4 py-1.5 rounded-md border-l-2 border-slate-600">
                  <span className="text-slate-400 font-medium italic text-sm">
                    {currentSegment.character.name}
                  </span>
                </div>
              ) : (
                // Other characters get colored name boxes
                <div 
                  className="inline-block px-4 py-1.5 rounded-md"
                  style={{
                    backgroundColor: currentSegment.character.color
                      ? `${currentSegment.character.color}30`
                      : 'rgba(51, 65, 85, 0.8)',
                    borderLeft: `3px solid ${currentSegment.character.color || '#64748b'}`,
                  }}
                >
                  <span 
                    className="font-medium"
                    style={{
                      color: currentSegment.character.color || '#e2e8f0',
                    }}
                  >
                    {currentSegment.character.name}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Dialogue Text */}
          <div className="min-h-[120px] mb-4">
            <p className="text-slate-100 text-xl leading-relaxed">
              {dialogueText || "No dialogue available"}
            </p>
          </div>

          {/* Choices */}
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

          {/* Controls */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-700/50">
            <div className="flex gap-2">
              <Button
                onClick={() => setShowHistory(!showHistory)}
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-slate-200"
              >
                {showHistory ? 'Hide' : 'History'}
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
