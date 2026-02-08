# Visual Novel Scene Data Guide

This guide explains the data format used by the visual novel runtime and editor. All data lives under `src/applications/visual-novel/data`.

## Folder Structure

```
visual-novel/data/
  characters.json
  scenes/
    start.json
    conversation_friendly.json
    ...
```

## Characters

File: `characters.json`

Shape:

```
{
  "narrator": {
    "id": "narrator",
    "name": "Narrator",
    "color": "#94a3b8",
    "sprites": [
      {
        "id": "narrator_sprite_1",
        "url": "placeholder",
        "position": "center"
      }
    ]
  },
  "alex": {
    "id": "alex",
    "name": "Alex",
    "color": "#f59e0b",
    "sprites": [
      {
        "id": "alex_sprite_1",
        "url": "/images/characters/alex.png",
        "position": "left"
      }
    ]
  }
}
```

Rules:

- Keys must match `id` for each character.
- `color` is used for dialog name styling.
- `sprites` is optional. The runtime uses the first sprite URL if present.
- Use `"placeholder"` for empty sprite URLs.

## Scenes

Each scene is a single JSON file in `data/scenes/`.
The filename should match the scene `id`.

### Scene Schema

```
{
  "id": "start",
  "name": "Chapter One",
  "sceneType": "dialog",
  "entrySegmentId": "start_1",
  "background": {
    "id": "bg_cafe",
    "name": "Cafe",
    "url": "/images/backgrounds/cafe.jpg"
  },
  "sprites": [
    {
      "characterId": "alex",
      "position": "left",
      "x": 80,
      "y": 120
    }
  ],
  "dialogSegments": {
    "start_1": {
      "id": "start_1",
      "type": "replace",
      "characterId": "alex",
      "text": "You made it.",
      "timing": { "mode": "typewriter", "charDelayMs": 24, "lineDelayMs": 400 },
      "nextSegmentId": "start_2"
    },
    "start_2": {
      "id": "start_2",
      "type": "choice",
      "characterId": "alex",
      "text": "Do you want coffee?",
      "choices": [
        {
          "id": "start_2_choice_1",
          "text": "Yes, please",
          "nextSegmentId": "start_3"
        },
        {
          "id": "start_2_choice_2",
          "text": "No, thanks",
          "nextSceneId": "conversation_awkward"
        }
      ]
    },
    "start_3": {
      "id": "start_3",
      "type": "append",
      "characterId": "alex",
      "text": "Great choice.",
      "nextSceneId": "conversation_friendly"
    }
  },
  "editor": {
    "positions": {
      "start_1": { "x": 120, "y": 120 },
      "start_2": { "x": 420, "y": 120 }
    }
  }
}
```

### Scene Fields

- `id` (string, required): Unique scene id. Also the file name.
- `name` (string, required): Display name.
- `sceneType` (string, required): One of `dialog`, `cutscene`, `chapter_start`, `chapter_end`.
- `entrySegmentId` (string, required): The first segment to play in this scene.
- `background` (object, optional): Background metadata.
  - `id` (string)
  - `name` (string)
  - `url` (string). Use `"placeholder"` if none.
- `sprites` (array, optional): Per-scene placed sprites.
- `dialogSegments` (object, required): A dictionary of segments keyed by id.
- `editor` (object, optional): Editor-only metadata (node positions).

### Scene Sprite Fields

```
{
  "characterId": "alex",
  "position": "left",
  "x": 80,
  "y": 120
}
```

- `characterId` (string, required): Must exist in `characters.json`.
- `position` (string, optional): `left`, `center`, or `right` fallback.
- `x`, `y` (number, optional): Absolute position in the scene canvas.

## Dialog Segments

Each segment represents a node in the scene graph.

### Segment Fields

```
{
  "id": "start_1",
  "type": "replace",
  "characterId": "alex",
  "text": "Hello.",
  "timing": { "mode": "typewriter", "charDelayMs": 24, "lineDelayMs": 400 },
  "nextSegmentId": "start_2",
  "nextSceneId": "conversation_friendly",
  "choices": []
}
```

- `id` (string, required): Unique within the scene.
- `type` (string, required): `replace`, `append`, or `choice`.
- `characterId` (string, required): Must exist in `characters.json`.
- `text` (string, required): Dialog text (can be empty).
- `timing` (object, optional): Typewriter behavior.
- `nextSegmentId` (string, optional): Link to another segment in the same scene.
- `nextSceneId` (string, optional): Jump to a different scene.
- `choices` (array, optional): Only used when `type` is `choice`.

### Segment Types

- `replace`: Replaces current text with `text`.
- `append`: Appends `text` to the existing dialog line.
- `choice`: Shows `choices` and waits for user selection.

### Timing

```
"timing": {
  "mode": "instant",
  "charDelayMs": 24,
  "lineDelayMs": 400
}
```

- `mode`: `instant` or `typewriter`.
- `charDelayMs`: Delay per character in milliseconds.
- `lineDelayMs`: Reserved for multi-line pauses.

## Choices

```
{
  "id": "start_2_choice_1",
  "text": "Yes",
  "nextSegmentId": "start_3"
}
```

- `id` (string, required)
- `text` (string, required)
- `nextSegmentId` or `nextSceneId` (one of these required)

## Scene Types and Behavior

- `dialog`: Normal scene with dialog box, choices, and characters.
- `cutscene`: No choices are required, but the dialog box still renders.
- `chapter_start`: Dedicated layout at the beginning of a chapter.
- `chapter_end`: Dedicated layout at the end of a chapter.

## Linking Scenes

Use `nextSceneId` on a segment or choice to jump to a different scene file.
When a new scene loads, playback starts from that scene's `entrySegmentId`.

## Editor Metadata

`editor.positions` stores node positions for the graph UI.
This data is ignored by the runtime and safe to edit.

## Validation Tips

- Ensure every `entrySegmentId` exists in `dialogSegments`.
- If a segment uses `nextSegmentId`, that target must exist.
- If a segment or choice uses `nextSceneId`, that scene file must exist.
- Avoid circular loops unless intentional.
- Keep ids alphanumeric plus `-` or `_`.

## Quick Checklist

- [ ] Create or update `characters.json`.
- [ ] Create a new scene file in `data/scenes/`.
- [ ] Fill `dialogSegments` and set `entrySegmentId`.
- [ ] Link segments via `nextSegmentId`.
- [ ] Link scenes via `nextSceneId`.
- [ ] Place sprites with `sprites` or leave empty.
- [ ] Save and reload in the editor.
