# Visual Novel Application

A visual novel engine built as part of the desktop operating system.

## Structure

```
visual-novel/ 
├── index.tsx              # Main application component
├── types.ts               # TypeScript type definitions
├── README.md              # This file
├── components/            # UI components (to be created)
│   ├── DialogueBox.tsx
│   ├── CharacterSprite.tsx
│   ├── ChoiceButton.tsx
│   ├── HistoryPanel.tsx
│   └── SaveLoadMenu.tsx
├── hooks/                 # Custom React hooks (to be created)
│   ├── useGameState.ts
│   ├── useTextAnimation.ts
│   └── useSaveLoad.ts
├── utils/                 # Utility functions (to be created)
│   ├── textEffects.ts
│   └── saveSystem.ts
└── data/                  # Game content (JSON-based)
    ├── characters.json    # Character definitions
    ├── scenes.json        # Scene and dialogue content
    └── loader.ts          # JSON data loader
- [ ] Character sprite display with emotions
- [ ] Background images and transitions
- [ ] Branching dialogue choices
- [ ] Save/Load system
- [ ] Text history/backlog
- [ ] Auto-play mode
- [ ] Skip functionality
- [ ] Settings menu

### Advanced Features
- [ ] Character affection system
- [ ] Multiple endings
- [ ] CG gallery
- [ ] Music and sound effects
- [ ] Voice acting support
- [ ] Achievements system
- [ ] Route completion tracking
- [ ] Screen shake/flash effects
- [ ] Character animations (fade in/out, movement)
- [ ] Variable system for story flags

## Data Format

All story content is stored in JSON format for easy editing.

### Scene Definition (scenes.json)
```json
{
  "scene_id": {
    "id": "scene_id",
    "name": "Scene Name",
    "music": "theme.mp3",
    "lines": [
      {
        "id": "line_1",
        "characterId": "character_id",
        "text": "Dialogue text goes here.",
        "spriteEmotion": "happy",
        "nextLine": "line_2"
      },
      {
        "id": "line_2",
        "characterId": "character_id",
        "text": "Text with choices.",
        "spriteEmotion": "neutral",
        "choices": [
          {
            "id": "choice_1",
            "text": "Choice text",
            "nextScene": "next_scene_id"
          }
        ]
      }
    ]
  }
}
```

### Character Definition (characters.json)
```json
{
  "character_id": {
    "id": "character_id",
    "name": "Character Name",
    "color": "#ff69b4",
    "sprites": [
      {
        "id": "sprite_id",
        "emotion": "happy",
        "url": "/sprites/character_happy.png",
        "position": "center"
      }
    ]
  }
}
```

## Usage

The visual novel application can be opened from the desktop. 

### Editing Story Content

All story content is stored in JSON files under `data/`:

1. **Edit Characters**: Modify `data/characters.json` to add/edit characters
2. **Edit Scenes**: Modify `data/scenes.json` to add/edit story scenes
3. The `data/loader.ts` file automatically loads and parses the JSON

### JSON Structure Notes

- Each dialogue line references a character by `characterId` (not the full character object)
- Sprite emotions are specified as strings (`"happy"`, `"sad"`, etc.)
- The loader automatically resolves character references and sprite lookups
- Choices can navigate to different scenes using `nextScene`
- Lines can chain together using `nextLine`

## Dependencies

Uses existing UI components from the design system:
- `Button` for choices and controls
- `ScrollArea` for text history
- Dialog components for menus
