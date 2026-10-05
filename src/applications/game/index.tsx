"use client";

import {
  Profiler as ReactProfiler,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ProfilerOnRenderCallback,
} from "react";
import { toast } from "sonner";

import { HumidityMap } from "./sky/climate/humidity-map";
import { SkyController } from "./sky/sky-controller";
import { skyLightingUniforms } from "./sky/sky-lighting";
import { buildTextureFlagUniforms } from "./sky/texture-flags";
import { shadowUniforms } from "./shadows/shadow-glsl";
import { ShadowPass } from "./shadows/shadow-pass";
import { BloomPass } from "./post/bloom-pass";

import {
  CHUNK_HEIGHT,
  CHUNK_LENGTH,
  CHUNK_WIDTH,
  TEXTURE_SIZE,
} from "./config";
import { WorkerPool } from "./worker-pool";

import * as THREE from "three";

import {
  BlockType,
  NON_COLLIDABLE_BLOCKS,
  TRANSPARENT_BLOCKS,
  Texture,
  getBlockLightLevel,
  getBoundingBox,
  isReplaceable,
  isWater,
} from "@/applications/game/blocks";
import { BlockHighlighter } from "./block-highlighter";
import { HOTBAR_SIZE, normalizeHotbar } from "./constants";
import { NetworkManager } from "./network/NetworkManager";
import { RemotePlayer } from "./network/RemotePlayer";
import { PhysicsEngine } from "./physics-engine";
import {
  LoadTracker,
  type LoadSnapshot,
  type LoadStageStatus,
} from "./load-progress";
import { PlayerControls } from "./player-controls";
import {
  createChunkSurfaceGeometry,
  createPlantInstanceGeometry,
  plantTemplateVertexCount,
  releaseChunkGeometry,
} from "./chunk-geometry";
import {
  EDGE_EXPANSION_PER_DEPTH,
  FRAGMENT_SHADER,
  PLANT_VERTEX_SHADER,
  VERTEX_SHADER,
} from "./shaders/chunk";
import { TickableBlockIndex, pickTickedBlocks } from "./random-tick";
import { trackLightPhaseInProfiler } from "./light-engine";
import { LightEditTrace, classifyLightEdit } from "./profiler/light-trace";
import {
  BlockEditBatch,
  sphereEdits,
  type BlockEdit,
  type BlockPosition,
  type BrushMode,
} from "./edits/block-edit-batch";
import { ChunkPipeline, type PipelineEditResult } from "./world/chunk-pipeline";
import type { ChunkRecord } from "./world/chunk-record";
import { createWorkerBackends } from "./world/worker-backends";
import {
  BORDER_RING_CHUNKS,
  DEFAULT_RENDER_SETTINGS,
  UNLOAD_HYSTERESIS_CHUNKS,
  normalizeRenderSettings,
  type RenderSettings,
} from "./world/render-settings";
import { packColumnKey } from "./world/chunk-key";
import { useGameSettings } from "./settings/use-game-settings";
import { browserStorage, loadStoredRenderSettings, storeRenderSettings } from "./world/render-settings-storage";
import { installVoxelWorldApi, summarizeEdit, type WorldEditSummary } from "./world/world-api";
import { castVoxelRay } from "./voxel-ray";
import { BrushPreview } from "./brush/brush-preview";
import {
  BRUSH_DEFAULT_RADIUS,
  BRUSH_REACH_BLOCKS,
  brushCenterFor,
  brushModeFor,
  clampBrushRadius,
  hasDragMovedEnough,
  steppedBrushRadius,
  type BrushAction,
  type BrushModifiers,
  type BrushSettings,
} from "./brush/sphere-brush";
import {
  recordEditsOutsideLoadedChunks,
  recordSavedEdits,
  wakeWaterAroundChanges,
  type SavedEditTarget,
} from "./edits/edit-side-effects";
import { decodeBlockRuns, encodeBlockRuns } from "./network/block-batch-codec";
import { splitBatchByChunk } from "./edits/edit-slicing";
import { GameLodBridge } from "./lod/game-lod-bridge";
import type { ChunkMeshResult } from "./workers/mesh-types";
import { MobileControls } from "./ui/mobile-controls";
import UILayer, { type GamePhase } from "./ui/index";
import {
  type StoredWorld,
  createWorldRecord,
  deleteWorldRecord,
  generateRandomSeed,
  hashTextToSeed,
  listWorldRecords,
  saveWorldRecord,
} from "./worlds/world-store";
import {
  calculateOffset,
  getSpawnPointFromSeed,
  getSurfaceHeightFromSeed,
} from "./utils";
import { updateWater } from "./water-physics";
import {
  estimateTransferBytes,
  profiler,
  type BenchmarkOptions,
} from "./profiler";
import { DIMENSIONS } from "./profiler/dimensions";
import {
  runBenchmark,
  type BenchmarkBridge,
  type CameraPose,
} from "./profiler/benchmark";
import {
  calibrateStructuredClone,
  installBrowserObservers,
} from "./profiler/browser-observers";
import { saveBenchmarkResult } from "./profiler/export-report";
import { mountProfilerOverlay } from "./profiler/mount-overlay";
import {
  createProfiledRender,
  type ProfiledRender,
} from "./profiler/profiled-render";
import { sampleSceneMemory } from "./profiler/scene-memory-sampler";

const FLYING_SPEED = 10;
const STREAMING_INTERVAL_MS = 100;
const AVAILABLE_CORES = typeof navigator === "undefined" ? 6 : navigator.hardwareConcurrency || 6;
/** Terrain generation is the slowest stage by far (light and mesh pools sit near 1% busy), so it gets most cores. */
const GENERATION_WORKER_COUNT = Math.min(8, Math.max(2, AVAILABLE_CORES - 3));
/** Lighting a column takes about 2 ms; one worker keeps up with every generation worker. */
const LIGHTING_WORKER_COUNT = 1;
/** Two, so an edit's rebuilds are not stuck behind a streaming mesh. */
const MESH_WORKER_COUNT = 2;
const LOD_WORKER_COUNT = 2;
const RANDOM_TICKS_PER_CHUNK = 100;
/** Random ticks (grass, saplings) only run this many chunks around the player, like a simulation distance. */
const RANDOM_TICK_RADIUS_CHUNKS = 4;
// Chunks whose centers are farther than this from the camera draw plants as flat sheets.
const PLANT_VOXEL_DETAIL_DISTANCE = 72;
const PLANT_DETAIL_UPDATE_INTERVAL_MS = 250;
/** A held chunk is shown anyway after this long, so a neighbor that never meshes cannot hide it for good. */
const HELD_CHUNK_TIMEOUT_MS = 1500;
/** Main-thread time per frame for brush pieces (one piece always runs). */
const BRUSH_FRAME_BUDGET_MS = 8;
/**
 * Chunks whose centers are farther than this draw no plants: a plant there is a few pixels tall, and each plant type
 * of each chunk costs a draw call (about a third of all draws at a 12 chunk render distance).
 */
const PLANT_DRAW_DISTANCE = 160;

interface PlantDetailMeshes {
  chunkName: string;
  center: THREE.Vector3;
  voxel: THREE.Mesh[];
  billboard: THREE.Mesh[];
}
const AUTOSAVE_INTERVAL_MILLISECONDS = 30000;
const JOIN_TIMEOUT_MILLISECONDS = 15000;
const BENCHMARK_LOAD_TIMEOUT_MILLISECONDS = 180000;
const DEFAULT_HOTBAR_BLOCKS = [
  BlockType.DIRT,
  BlockType.GRASS,
  BlockType.STONE,
  BlockType.LOG,
  BlockType.PLANKS,
  BlockType.LEAVES,
  BlockType.GLASS,
  BlockType.GLOWSTONE,
  BlockType.COBBLESTONE,
];

// TODO: Sakura biome
// TODO: Jungle biome
// import Stats from "stats.js";

const reportReactCommitToProfiler: ProfilerOnRenderCallback = (
  _id,
  _phase,
  actualDuration,
) => {
  if (profiler.enabled) {
    profiler.recordMainThreadTimer("main.react.commit.game", actualDuration);
  }
};

export default function Game() {
  const gameBodyStartedAtMs = profiler.enabled ? profiler.now() : 0;
  profiler.addCounter("game.reactRenders");
  const initialized = useRef(false);
  const profiledRenderRef = useRef<ProfiledRender | null>(null);
  const isBenchmarkWorldRef = useRef(false);
  const benchmarkFrameCallbacksRef = useRef(
    new Set<(deltaSeconds: number) => void>(),
  );
  const textureArrayBytesRef = useRef(0);
  const raycastStepsRef = useRef(0);
  const getBlockCallsRef = useRef(0);

  // const stats = new Stats();
  // stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
  // document.body.appendChild(stats.dom);
  const containerRef = useRef<HTMLDivElement>(null);

  const skyControllerRef = useRef<SkyController | null>(null);
  const shadowPassRef = useRef<ShadowPass | null>(null);
  const bloomPassRef = useRef<BloomPass | null>(null);
  const seedRef = useRef(Math.floor(Math.random() * 100000000));
  const networkManager = useRef(new NetworkManager());
  const remotePlayers = useRef<Map<string, RemotePlayer>>(new Map());
  const [peerId, setPeerId] = useState<string>("");
  const [connectedToHost, setConnectedToHost] = useState(false);
  const [connectedPlayerCount, setConnectedPlayerCount] = useState(0);
  const connectedToHostRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pipelineRef = useRef<ChunkPipeline | null>(null);
  const lodBridgeRef = useRef<GameLodBridge | null>(null);
  const initialRenderSettings = useMemo(
    () => normalizeRenderSettings({ ...DEFAULT_RENDER_SETTINGS, ...loadStoredRenderSettings(browserStorage()) }),
    [],
  );
  const renderSettingsRef = useRef<RenderSettings>(initialRenderSettings);
  const modifiedChunks = useRef<Map<string, Map<number, number>>>(new Map());
  /** Highest chunk y holding a saved edit, per column key, so tall builds are never skipped as sky. */
  const editedColumnTopsRef = useRef<Map<number, number>>(new Map());
  const pendingWaterUpdates = useRef<Set<string>>(new Set());
  const generationWorkerPool = useMemo(
    () =>
      new WorkerPool(
        () =>
          new Worker(new URL("./workers/unified-worker.ts", import.meta.url), {
            name: "generation",
          }),
        GENERATION_WORKER_COUNT,
        "generation",
      ),
    [],
  );
  const lightingWorkerPool = useMemo(
    () =>
      new WorkerPool(
        () =>
          new Worker(new URL("./workers/unified-worker.ts", import.meta.url), {
            name: "lighting",
          }),
        LIGHTING_WORKER_COUNT,
        "lighting",
      ),
    [],
  );
  const meshWorkerPool = useMemo(
    () =>
      new WorkerPool(
        () =>
          new Worker(new URL("./workers/unified-worker.ts", import.meta.url), {
            name: "mesh",
          }),
        MESH_WORKER_COUNT,
        "mesh",
      ),
    [],
  );
  const textureArrayWorkerPool = useMemo(
    () =>
      new WorkerPool(
        () =>
          new Worker(new URL("./workers/unified-worker.ts", import.meta.url), {
            name: "texture-array",
          }),
        1,
        "texture-array",
      ),
    [],
  );

  const renderer = useMemo(
    () =>
      new THREE.WebGLRenderer({
        // antialias: true,
        alpha: true,
        // logarithmicDepthBuffer: true,
      }),
    [],
  );

  const scene = useMemo(() => {
    const gameScene = new THREE.Scene();
    // The scene root never moves; with auto update on, its own matrix update would force every child to recompute.
    gameScene.matrixAutoUpdate = false;
    return gameScene;
  }, []);

  const { settings: gameSettings, settingsRef: gameSettingsRef, updateSettings: updateGameSettings } = useGameSettings();

  const camera = useMemo(
    () =>
      new THREE.PerspectiveCamera(
        gameSettingsRef.current.fieldOfViewDegrees,
        window.innerWidth / window.innerHeight,
        0.1,
        10000,
      ),
    [],
  );

  const resizeObserver = useMemo(
    () =>
      new ResizeObserver(() => {
        const resizeToken = profiler.begin("main.frame.resize");
        if (containerRef.current) {
          const width = containerRef.current.clientWidth || 1;
          const height = containerRef.current.clientHeight || 1;

          if (camera) {
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
          }
          renderer.setSize(width, height);
        }
        profiler.end(resizeToken);
      }),
    [containerRef, camera, renderer],
  );

  useEffect(() => {
    camera.fov = gameSettings.fieldOfViewDegrees;
    camera.updateProjectionMatrix();
  }, [camera, gameSettings.fieldOfViewDegrees]);

  const [selectedSlot, setSelectedSlot] = useState(0);
  const selectedSlotRef = useRef(0);
  const [hotbarSlots, setHotbarSlots] = useState<BlockType[]>(
    normalizeHotbar(DEFAULT_HOTBAR_BLOCKS),
  );
  const hotbarSlotsRef = useRef(hotbarSlots);
  const [isInventoryOpen, setIsInventoryOpen] = useState(false);
  const isInventoryOpenRef = useRef(false);
  const brushRef = useRef<BrushSettings>({ enabled: false, radius: BRUSH_DEFAULT_RADIUS });
  const brushStrokeRef = useRef<{
    action: BrushAction;
    modifiers: BrushModifiers;
    lastCenter: BlockPosition | null;
  } | null>(null);
  const brushPreviewRef = useRef<BrushPreview | null>(null);
  const lastBrushEditRef = useRef<WorldEditSummary | null>(null);
  const pendingBrushStrokesRef = useRef<
    Array<{
      pieces: BlockEditBatch[];
      startedAtMs: number;
      meshesApplied: Promise<void>[];
      blocksChanged: number;
      relightMilliseconds: number;
      chunksRebuilt: Set<string>;
    }>
  >([]);
  const [brushHud, setBrushHud] = useState<BrushSettings>({ enabled: false, radius: BRUSH_DEFAULT_RADIUS });
  const [isDebugVisible, setIsDebugVisible] = useState(false);
  const isDebugVisibleRef = useRef(false);
  const [isMobile, setIsMobile] = useState(false);
  const [phase, setPhaseState] = useState<GamePhase>("title");
  const phaseRef = useRef<GamePhase>("title");
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStageLabel, setLoadStageLabel] = useState("Starting threads");
  const [loadStages, setLoadStages] = useState<LoadStageStatus[]>([]);
  const loadProgressRef = useRef(0);
  const loadTracker = useMemo(() => {
    const MIN_LOAD_UI_UPDATE_INTERVAL_MS = 50;
    let lastUiUpdateAtMs = 0;
    let pendingSnapshot: LoadSnapshot | null = null;
    let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

    const applySnapshot = ({ progress, label, stages }: LoadSnapshot) => {
      lastUiUpdateAtMs = performance.now();
      setLoadStages(stages);
      loadProgressRef.current = progress;
      setLoadProgress(progress);
      setLoadStageLabel(label);
      if (progress >= 1) {
        setTimeout(() => {
          if (phaseRef.current === "loading") setPhase("paused");
        }, 150);
      }
    };

    return new LoadTracker((snapshot) => {
      loadProgressRef.current = snapshot.progress;
      const msSinceLastUpdate = performance.now() - lastUiUpdateAtMs;
      if (snapshot.progress >= 1 || msSinceLastUpdate >= MIN_LOAD_UI_UPDATE_INTERVAL_MS) {
        if (pendingTimeout) clearTimeout(pendingTimeout);
        pendingTimeout = null;
        pendingSnapshot = null;
        applySnapshot(snapshot);
        return;
      }
      pendingSnapshot = snapshot;
      if (pendingTimeout) return;
      pendingTimeout = setTimeout(() => {
        pendingTimeout = null;
        if (pendingSnapshot) applySnapshot(pendingSnapshot);
        pendingSnapshot = null;
      }, MIN_LOAD_UI_UPDATE_INTERVAL_MS - msSinceLastUpdate);
    });
  }, []);
  const [worlds, setWorlds] = useState<StoredWorld[]>([]);
  const [isLoadingWorlds, setIsLoadingWorlds] = useState(true);
  const [activeWorldName, setActiveWorldName] = useState("");
  const activeWorldRef = useRef<StoredWorld | null>(null);
  const texturesReadyRef = useRef(false);
  const worldWaitingForTexturesRef = useRef<StoredWorld | null>(null);

  function setPhase(nextPhase: GamePhase) {
    phaseRef.current = nextPhase;
    setPhaseState(nextPhase);
  }

  function isSimulationActive() {
    return (
      phaseRef.current === "playing" ||
      !!networkManager.current.myPeerId ||
      connectedToHostRef.current
    );
  }
  const [debugInfo, setDebugInfo] = useState({
    fps: 0,
    playerPosition: { x: 0, y: 0, z: 0 },
    currentChunk: { x: 0, y: 0, z: 0 },
    loadedChunks: 0,
    blockAtCursor: null as { type: number; light: number } | null,
    lookingAt: null as { x: number; y: number; z: number } | null,
    seed: 0,
  });
  const fpsFrames = useRef<number[]>([]);

  const playerControlsRef = useRef<PlayerControls | null>(null);

  useEffect(() => {
    playerControlsRef.current?.setLookSensitivity(gameSettings.lookSensitivity);
  }, [gameSettings.lookSensitivity]);

  useEffect(() => {
    isDebugVisibleRef.current = isDebugVisible;
  }, [isDebugVisible]);

  useEffect(() => {
    selectedSlotRef.current = selectedSlot;
  }, [selectedSlot]);

  useEffect(() => {
    hotbarSlotsRef.current = hotbarSlots;
  }, [hotbarSlots]);

  useEffect(() => {
    isInventoryOpenRef.current = isInventoryOpen;
  }, [isInventoryOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const keyDownToken = profiler.begin(
        "main.input.keyDown",
        DIMENSIONS.simulationSystem,
        "input.keyDown",
      );
      try {
        handleKeyDown(event);
      } finally {
        profiler.end(keyDownToken);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "F3") {
        event.preventDefault();
        setIsDebugVisible((prev) => !prev);
        return;
      }

      if (event.code === "KeyE" && phaseRef.current === "playing") {
        if (isInventoryOpen) {
          isInventoryOpenRef.current = false;
          setIsInventoryOpen(false);
          playerControlsRef.current?.controls.lock();
        } else {
          isInventoryOpenRef.current = true;
          setIsInventoryOpen(true);
          playerControlsRef.current?.controls.unlock();
        }
      }

      if (event.code === "KeyB" && phaseRef.current === "playing" && !isInventoryOpen) {
        setBrush({ enabled: !brushRef.current.enabled });
        return;
      }
      if (brushRef.current.enabled && (event.code === "BracketLeft" || event.code === "BracketRight")) {
        setBrush({ radius: steppedBrushRadius(brushRef.current.radius, event.code === "BracketRight" ? 1 : -1) });
        return;
      }

      if (!isInventoryOpen && playerControlsRef.current?.controls.isLocked) {
        const keyNum = parseInt(event.key);
        if (!Number.isNaN(keyNum) && keyNum >= 1 && keyNum <= HOTBAR_SIZE) {
          setSelectedSlot(keyNum - 1);
        }
      }
    };

    const onWheel = (event: WheelEvent) => {
      profiler.addCounter("game.input.wheel");
      if (brushRef.current.enabled && event.shiftKey) {
        // Shift turns a vertical wheel into a horizontal one on macOS.
        const wheelDelta = event.deltaY || event.deltaX;
        if (wheelDelta !== 0) setBrush({ radius: steppedBrushRadius(brushRef.current.radius, wheelDelta < 0 ? 1 : -1) });
        return;
      }
      if (!isInventoryOpen && playerControlsRef.current?.controls.isLocked) {
        const direction = Math.sign(event.deltaY);
        setSelectedSlot((prev) => {
          let next = prev + direction;
          if (next < 0) next = HOTBAR_SIZE - 1;
          if (next > HOTBAR_SIZE - 1) next = 0;
          return next;
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", onWheel);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel);
    };
  }, [isInventoryOpen]);

  let textureArray: THREE.DataArrayTexture;
  const materialsRef = useRef<{
    opaque?: THREE.ShaderMaterial;
    transparent?: THREE.ShaderMaterial;
    plants?: THREE.ShaderMaterial;
  }>({});
  const chunkMeshesRef = useRef(new Map<string, THREE.Mesh[]>());
  const plantDetailRef = useRef(new Map<string, PlantDetailMeshes>());
  /** Meshed chunks kept hidden until their drawn neighbors are meshed too, with the time they were first held. */
  const heldChunksRef = useRef(new Map<string, { record: ChunkRecord; heldSinceMs: number }>());
  const pendingLightEditsRef = useRef(0);
  const lightIdleResolversRef = useRef<Array<() => void>>([]);
  const tickableBlocksRef = useRef(new TickableBlockIndex());
  const cameraForward = useMemo(() => new THREE.Vector3(), []);

  function chunkNameOf(chunkX: number, chunkY: number, chunkZ: number) {
    return `${chunkX},${chunkY},${chunkZ}`;
  }

  function highestEditedChunkY(chunkX: number, chunkZ: number) {
    return editedColumnTopsRef.current.get(packColumnKey(chunkX, chunkZ));
  }

  function rebuildEditedColumnTops() {
    editedColumnTopsRef.current.clear();
    modifiedChunks.current.forEach((_edits, chunkName) => {
      const [chunkX, chunkY, chunkZ] = chunkName.split(",").map(Number);
      noteEditedChunk(chunkX, chunkY, chunkZ);
    });
  }

  function noteEditedChunk(chunkX: number, chunkY: number, chunkZ: number) {
    const columnKey = packColumnKey(chunkX, chunkZ);
    const highest = editedColumnTopsRef.current.get(columnKey);
    if (highest === undefined || chunkY > highest) {
      editedColumnTopsRef.current.set(columnKey, chunkY);
    }
  }

  /** Where saved edits go: the per-chunk maps that are saved and applied to chunks that load later. */
  const savedEditTarget: SavedEditTarget = {
    editsOfChunk(chunkX, chunkY, chunkZ) {
      const chunkName = chunkNameOf(chunkX, chunkY, chunkZ);
      let edits = modifiedChunks.current.get(chunkName);
      if (!edits) {
        edits = new Map();
        modifiedChunks.current.set(chunkName, edits);
      }
      noteEditedChunk(chunkX, chunkY, chunkZ);
      return edits;
    },
  };

  /** Turns the sphere brush on or off and sets its radius (1..64); the HUD follows. */
  function setBrush(settings: Partial<BrushSettings>): BrushSettings {
    const next: BrushSettings = {
      enabled: settings.enabled ?? brushRef.current.enabled,
      radius: clampBrushRadius(settings.radius ?? brushRef.current.radius),
    };
    brushRef.current = next;
    if (!next.enabled) {
      brushStrokeRef.current = null;
      brushPreviewRef.current?.hide();
    }
    setBrushHud(next);
    return { ...next };
  }

  function streamChunksAroundCamera() {
    const pipeline = pipelineRef.current;
    if (!pipeline) return;
    const streamingToken = profiler.begin("main.interval.chunkStreaming");
    pipeline.update(camera.position, camera.getWorldDirection(cameraForward));
    profiler.end(streamingToken);
  }

  function startWorldGeneration(currentSeed: number) {
    if (intervalRef.current) clearInterval(intervalRef.current);
    pipelineRef.current?.dispose();
    loadTracker.resetWorldStages();
    lodBridgeRef.current?.startWorld(currentSeed, renderSettingsRef.current.lodRenderDistanceChunks);
    skyControllerRef.current?.setWorldSeed(currentSeed);

    pipelineRef.current = new ChunkPipeline({
      renderSettings: renderSettingsRef.current,
      ...createWorkerBackends(
        {
          generation: generationWorkerPool,
          generationWorkerCount: GENERATION_WORKER_COUNT,
          lighting: lightingWorkerPool,
          lightingWorkerCount: LIGHTING_WORKER_COUNT,
          meshing: meshWorkerPool,
          meshWorkerCount: MESH_WORKER_COUNT,
        },
        currentSeed,
      ),
      events: {
        onChunkGenerated: (record) => lodBridgeRef.current?.onChunkGenerated(record),
        onMeshReady: (record, mesh) => {
          const chunkName = chunkNameOf(record.chunkX, record.chunkY, record.chunkZ);
          if (mesh) addChunkMesh(mesh, chunkName, record.chunkX, record.chunkY, record.chunkZ);
          else pruneChunkMesh(chunkName);
          refreshChunkAndNeighborVisibility(record);
          lodBridgeRef.current?.onChunkMeshed(record);
        },
        onChunkUnloaded: (record) => {
          profiler.addCounter("game.chunks.pruned");
          pruneChunkMesh(chunkNameOf(record.chunkX, record.chunkY, record.chunkZ));
          refreshChunkAndNeighborVisibility(record);
          lodBridgeRef.current?.onChunkUnloaded(record);
        },
        savedEditsFor: (chunkX, chunkY, chunkZ) =>
          modifiedChunks.current.get(chunkNameOf(chunkX, chunkY, chunkZ)),
        highestEditedChunkY,
        onStartAreaProgress: ({ generated, lit, meshed }) => {
          loadTracker.report("terrain", generated);
          loadTracker.report("lighting", lit);
          loadTracker.report("light-spread", lit);
          loadTracker.report("meshing", meshed);
        },
        onStartAreaReady: () => loadTracker.finish(),
      },
    });

    streamChunksAroundCamera();
    intervalRef.current = setInterval(streamChunksAroundCamera, STREAMING_INTERVAL_MS);
  }

  /** Changes how far real chunks (next streaming tick) and the far terrain (next frame) are drawn. */
  function applyRenderSettings(settings: Partial<RenderSettings>) {
    renderSettingsRef.current = normalizeRenderSettings({ ...renderSettingsRef.current, ...settings });
    pipelineRef.current?.setRenderSettings(renderSettingsRef.current);
    lodBridgeRef.current?.setRenderDistance(renderSettingsRef.current.lodRenderDistanceChunks, pipelineRef.current);
    return renderSettingsRef.current;
  }

  async function loadTextureArray() {
    const loader = new THREE.ImageLoader();

    const canvas = document.createElement("canvas");
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;
    const context = canvas.getContext("2d", {
      colorSpace: THREE.SRGBColorSpace,
      alpha: true,
      willReadFrequently: true,
    });
    if (context) {
      const textureData: Uint8ClampedArray[] = [];

      const texturesToLoad: string[] = Object.values(Texture);

      for (let i = 0; i < texturesToLoad.length; i++) {
        const image = await loader.loadAsync("game/" + texturesToLoad[i]);
        context.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
        context.drawImage(image, 0, 0);
        const imageData = context.getImageData(
          0,
          0,
          TEXTURE_SIZE,
          TEXTURE_SIZE,
        );

        textureData.push(new Uint8ClampedArray(imageData.data.buffer));
      }

      let length = 0;
      textureData.forEach((item) => {
        length += item.length;
      });

      let mergedTextureData = new Uint8ClampedArray(length);
      let offset = 0;
      textureData.forEach((item) => {
        mergedTextureData.set(item, offset);
        offset += item.length;
      });
      canvas.remove();
      return { data: mergedTextureData, length: textureData.length };
    }
    return null;
  }

  useEffect(() => {
    if (!initialized.current && containerRef.current) {
      initialized.current = true;

      resizeObserver.observe(containerRef.current);

      const indicatorMesh = new BlockHighlighter();
      scene.add(indicatorMesh);
      brushPreviewRef.current = new BrushPreview();
      scene.add(brushPreviewRef.current);

      const skyController = new SkyController(
        renderer,
        new HumidityMap((method, params) => generationWorkerPool.exec(method, params), seedRef.current),
        seedRef.current,
      );
      skyControllerRef.current = skyController;
      shadowPassRef.current = new ShadowPass(renderer);
      bloomPassRef.current = new BloomPass(renderer);
      const sky = skyController.dome;
      scene.add(sky);
      lodBridgeRef.current = new GameLodBridge({
        createWorker: () => new Worker(new URL("./lod/worker/lod-worker.ts", import.meta.url), { name: "lod" }),
        workerCount: LOD_WORKER_COUNT,
        background: sky,
        onFarTerrainDrawn: (farTerrainCamera) => skyController.cloudPass.captureFarTerrainDepth(farTerrainCamera),
      });
      renderer.autoClear = false;

      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      containerRef.current.appendChild(renderer.domElement);

      profiledRenderRef.current = createProfiledRender(renderer, scene, camera);
      const unmountProfilerOverlay = mountProfilerOverlay({
        runBenchmark: (options?: BenchmarkOptions) =>
          runBenchmark(createBenchmarkBridge(), options),
      });
      const uninstallBrowserObservers = installBrowserObservers(profiler);
      const uninstallVoxelWorldApi = installVoxelWorldApi({
        applyBlockBatch: (edits) => {
          const startedAtMs = performance.now();
          return summarizeEdit(applyBlockEditBatch(edits), startedAtMs);
        },
        applySphere: (center, radius, block, mode) => {
          const startedAtMs = performance.now();
          return summarizeEdit(applySphere(center, radius, block, mode), startedAtMs);
        },
        getRenderSettings: () => ({ ...renderSettingsRef.current }),
        setRenderSettings: applyRenderSettings,
        stats: () => pipelineRef.current?.stats() ?? null,
        lodStats: () => lodBridgeRef.current?.stats() ?? null,
        setBrush,
        getBrush: () => ({ ...brushRef.current, lastEdit: lastBrushEditRef.current }),
        getBlock: (x, y, z) => getBlock(x, y, z),
        setCamera: (position, yaw, pitch) => {
          camera.position.set(position.x, position.y, position.z);
          camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
          playerControlsRef.current?.resetMotion();
        },
        getCamera: () => {
          const orientation = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
          return {
            position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
            yaw: orientation.y,
            pitch: orientation.x,
          };
        },
        setTimeOfDay: (timeOfDay) => skyController.setTimeOfDay(timeOfDay),
        setPlaying: (playing, flying = true) => {
          playerControlsRef.current?.resetMotion();
          playerControlsRef.current?.setFlying(flying);
          setPhase(playing ? "playing" : "paused");
        },
      });
      let hasCalibratedStructuredClone = false;
      const calibrateStructuredCloneOnce = () => {
        if (hasCalibratedStructuredClone || !profiler.enabled) return;
        hasCalibratedStructuredClone = true;
        void calibrateStructuredClone(profiler);
      };
      const stopCalibrationListener = profiler.onEnabledChange(
        calibrateStructuredCloneOnce,
      );
      calibrateStructuredCloneOnce();
      profiler.setSessionInfo({
        game: {
          chunkWidth: CHUNK_WIDTH,
          chunkHeight: CHUNK_HEIGHT,
          chunkLength: CHUNK_LENGTH,
          voxelsPerChunk: CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH,
          renderDistanceChunksX: renderSettingsRef.current.horizontalRadius * 2 + 1,
          renderDistanceChunksY:
            renderSettingsRef.current.verticalUp + renderSettingsRef.current.verticalDown + 1,
          renderDistanceChunksZ: renderSettingsRef.current.horizontalRadius * 2 + 1,
          chunkPruningDistance:
            renderSettingsRef.current.horizontalRadius + BORDER_RING_CHUNKS + UNLOAD_HYSTERESIS_CHUNKS,
          generationWorkers: GENERATION_WORKER_COUNT,
          lightingWorkers: LIGHTING_WORKER_COUNT,
          meshWorkers: MESH_WORKER_COUNT,
          textureCount: Object.values(Texture).length,
        },
      });
      const removeSceneMemorySampler = profiler.addSampler(() =>
        sampleSceneMemory({
          getScene: () => scene,
          getChunkDataByteLengths: () => {
            const byteLengths: number[] = [];
            pipelineRef.current?.forEachChunk((record) => {
              if (record.ownsBlocks && record.blocks) byteLengths.push(record.blocks.byteLength);
            });
            return byteLengths;
          },
          getLightDataByteLengths: () => {
            const byteLengths: number[] = [];
            pipelineRef.current?.forEachChunk((record) => {
              if (record.ownsLight && record.light) byteLengths.push(record.light.byteLength);
            });
            return byteLengths;
          },
          getModifiedChunks: () => modifiedChunks.current,
          getTextureArrayBytes: () => textureArrayBytesRef.current,
        }),
      );

      const physics = new PhysicsEngine(getBlock);
      playerControlsRef.current = new PlayerControls(
        camera,
        containerRef.current,
        physics,
      );

      playerControlsRef.current.setLookSensitivity(gameSettingsRef.current.lookSensitivity);

      const isMobileDevice = window.matchMedia(
        "(pointer: coarse) and (hover: none)",
      ).matches;
      if (isMobileDevice) {
        setIsMobile(true);
        playerControlsRef.current.isMobile = true;
      }

      playerControlsRef.current.controls.addEventListener("lock", () => {
        if (phaseRef.current === "paused") setPhase("playing");
      });

      playerControlsRef.current.controls.addEventListener("unlock", () => {
        const isOpeningInventory = isInventoryOpenRef.current;
        if (phaseRef.current === "playing" && !isOpeningInventory) {
          setPhase("paused");
          saveActiveWorld();
        }
      });

      const bootWorkerPools = [
        generationWorkerPool,
        lightingWorkerPool,
        meshWorkerPool,
        textureArrayWorkerPool,
      ];
      const totalBootWorkers =
        GENERATION_WORKER_COUNT + LIGHTING_WORKER_COUNT + MESH_WORKER_COUNT + 1;
      let bootWorkersReady = 0;
      bootWorkerPools.forEach((pool) =>
        pool.warmUp(() => {
          bootWorkersReady++;
          loadTracker.report("threads", bootWorkersReady / totalBootWorkers);
        }),
      );

      let textureSetupToken = 0;
      textureArrayWorkerPool
        .exec("loadTextureArray", [window.location.origin], (fraction) =>
          loadTracker.report("textures", fraction * 0.9),
        )
        .then((result) => {
          if (result) {
            textureSetupToken = profiler.begin("main.texture.createArrayTexture");
            profiler.recordBytes("bytes.texture.arrayToGpu", result.data.byteLength);
            textureArrayBytesRef.current = result.data.byteLength;
            textureArray = new THREE.DataArrayTexture(
              result.data,
              TEXTURE_SIZE,
              TEXTURE_SIZE,
              result.length,
            );
            textureArray.format = THREE.RGBAFormat;
            textureArray.colorSpace = THREE.SRGBColorSpace;
            textureArray.minFilter = THREE.LinearMipMapNearestFilter;
            textureArray.magFilter = THREE.NearestFilter;
            textureArray.generateMipmaps = true;
            textureArray.needsUpdate = true;

            const waterTextureIndex = Object.values(Texture).indexOf(
              Texture.WATER,
            );

            const textureFlagUniforms = buildTextureFlagUniforms(Object.keys(Texture));
            shadowPassRef.current?.setBlockTextures(textureArray);

            materialsRef.current.opaque = new THREE.ShaderMaterial({
              uniforms: {
                Texture: {
                  value: textureArray,
                },
                waterTextureIndex: {
                  value: waterTextureIndex,
                },
                edgeExpansion: {
                  value: EDGE_EXPANSION_PER_DEPTH,
                },
                ...textureFlagUniforms,
                ...skyLightingUniforms,
                ...shadowUniforms,
              },
              vertexShader: VERTEX_SHADER,
              fragmentShader: FRAGMENT_SHADER,
              blending: THREE.NormalBlending,
              blendSrcAlpha: THREE.OneFactor,
              transparent: false,
              depthWrite: true,
            });

            materialsRef.current.transparent = new THREE.ShaderMaterial({
              uniforms: {
                Texture: {
                  value: textureArray,
                },
                waterTextureIndex: {
                  value: waterTextureIndex,
                },
                edgeExpansion: {
                  value: 0,
                },
                ...textureFlagUniforms,
                ...skyLightingUniforms,
                ...shadowUniforms,
              },
              vertexShader: VERTEX_SHADER,
              fragmentShader: FRAGMENT_SHADER,
              blending: THREE.NormalBlending,
              blendSrcAlpha: THREE.OneFactor,
              transparent: true,
              depthWrite: false,
            });

            materialsRef.current.plants = new THREE.ShaderMaterial({
              uniforms: {
                Texture: {
                  value: textureArray,
                },
                waterTextureIndex: {
                  value: waterTextureIndex,
                },
                ...textureFlagUniforms,
                ...skyLightingUniforms,
                ...shadowUniforms,
              },
              defines: { IS_PLANT_MATERIAL: "" },
              vertexShader: PLANT_VERTEX_SHADER,
              fragmentShader: FRAGMENT_SHADER,
              blending: THREE.NormalBlending,
              blendSrcAlpha: THREE.OneFactor,
              transparent: false,
              depthWrite: true,
            });

            profiler.end(textureSetupToken);
            textureSetupToken = 0;
            loadTracker.report("textures", 1);
            texturesReadyRef.current = true;
            const worldWaitingForTextures = worldWaitingForTexturesRef.current;
            worldWaitingForTexturesRef.current = null;
            if (worldWaitingForTextures) enterWorld(worldWaitingForTextures);
          }

          renderer.setAnimationLoop(render);

          if (new URLSearchParams(window.location.search).has("benchmark")) {
            void runBenchmarkAndSave();
          }
        })
        .catch((error) => {
          profiler.end(textureSetupToken);
          console.error(error);
        })
        .then(() => {
          textureArrayWorkerPool.terminate();
        });

      {
        const spawnPoint = getSpawnPointFromSeed(seedRef.current);
        camera.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
      }
      //camera.position.y = 3;

      const onKeyUp = function (event: KeyboardEvent) {
        profiler.addCounter("game.input.keyUp");
        switch (event.code) {
          case "Escape":
            if (isInventoryOpenRef.current) {
              isInventoryOpenRef.current = false;
              setIsInventoryOpen(false);
              setPhase("paused");
              saveActiveWorld();
            }
            break;
        }
      };

      const onContextMenu = (event: MouseEvent) => {
        event.preventDefault();
      };

      const onMouseDown = (event: MouseEvent) => {
        if (brushRef.current.enabled && phaseRef.current === "playing" && (event.button === 0 || event.button === 2)) {
          brushStrokeRef.current = {
            action: event.button === 0 ? "erase" : "paint",
            modifiers: { replaceOnly: event.ctrlKey, airOnly: event.altKey },
            lastCenter: null,
          };
          return;
        }
        if (!playerControlsRef.current?.controls.isLocked) return;
        const mouseDownToken = profiler.begin(
          "main.input.mouseDown",
          DIMENSIONS.simulationSystem,
          event.button === 0 ? "input.mouseBreak" : "input.mousePlace",
        );
        try {
          if (event.button === 0) {
            breakBlock();
          } else if (event.button === 2) {
            const blockType = hotbarSlotsRef.current[selectedSlotRef.current];
            if (blockType) {
              placeBlock(blockType);
            }
          }
        } finally {
          profiler.end(mouseDownToken);
        }
      };

      const onMouseUp = () => {
        brushStrokeRef.current = null;
      };

      const container = containerRef.current;
      container.addEventListener("contextmenu", onContextMenu);
      container.addEventListener("mousedown", onMouseDown);
      window.addEventListener("mouseup", onMouseUp);

      // document.addEventListener("keydown", onKeyDown);
      document.addEventListener("keyup", onKeyUp);

      const nm = networkManager.current;

      nm.onPlayerJoin = (id) => {
        console.log("Player joined:", id);
        setConnectedPlayerCount(nm.connectedPeerCount);
        // Send handshake
        nm.send(
          {
            type: "HANDSHAKE",
            seed: seedRef.current,
            initialPosition: { x: 0, y: 100, z: 0 },
          },
          id,
        );

        const buildWorldStateToken = profiler.begin("main.network.buildWorldState");
        let editCount = 0;
        modifiedChunks.current.forEach((modifications) => (editCount += modifications.size));
        const editXs = new Int32Array(editCount);
        const editYs = new Int32Array(editCount);
        const editZs = new Int32Array(editCount);
        const editBlocks = new Uint8Array(editCount);
        let editPosition = 0;
        modifiedChunks.current.forEach((modifications, chunkName) => {
          const [chunkX, chunkY, chunkZ] = chunkName.split(",").map(Number);
          modifications.forEach((blockType, index) => {
            editXs[editPosition] = chunkX * CHUNK_WIDTH + Math.floor(index / (CHUNK_HEIGHT * CHUNK_LENGTH));
            editYs[editPosition] = chunkY * CHUNK_HEIGHT + (Math.floor(index / CHUNK_LENGTH) % CHUNK_HEIGHT);
            editZs[editPosition] = chunkZ * CHUNK_LENGTH + (index % CHUNK_LENGTH);
            editBlocks[editPosition] = blockType;
            editPosition++;
          });
        });
        profiler.end(buildWorldStateToken);
        profiler.addCounter("game.network.worldStateBlocksSent", editCount);
        if (editCount > 0) {
          nm.send({ type: "BLOCK_BATCH", runs: encodeBlockRuns(editCount, editXs, editYs, editZs, editBlocks, 2) }, id);
        }

        const rp = new RemotePlayer(id, scene, new THREE.Vector3(0, 100, 0));
        remotePlayers.current.set(id, rp);
      };

      nm.onConnectedToHost = (hostId) => {
        console.log("Connected to host:", hostId);
        setConnectedToHost(true);
        connectedToHostRef.current = true;
      };

      nm.onPlayerLeave = (id) => {
        setConnectedPlayerCount(nm.connectedPeerCount);
        const rp = remotePlayers.current.get(id);
        if (rp) {
          rp.dispose(scene);
          remotePlayers.current.delete(id);
        }
      };

      nm.onData = (data, senderId) => {
        const handlePacketToken = profiler.begin("main.network.handlePacket");
        if (data.type === "HANDSHAKE") {
          seedRef.current = data.seed;
          if (phaseRef.current === "loading" && !activeWorldRef.current) {
            const spawnPoint = getSpawnPointFromSeed(data.seed);
            camera.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
          }
          startWorldGeneration(data.seed);
        } else if (data.type === "PLAYER_UPDATE") {
          let rp = remotePlayers.current.get(data.id);
          if (!rp) {
            rp = new RemotePlayer(
              data.id,
              scene,
              new THREE.Vector3(
                data.position.x,
                data.position.y,
                data.position.z,
              ),
            );
            remotePlayers.current.set(data.id, rp);
          }
          rp.updatePosition(data.position, data.rotation);
        } else if (data.type === "BLOCK_UPDATE") {
          setBlock(data.x, data.y, data.z, data.blockType, false);
        } else if (data.type === "BLOCK_BATCH") {
          profiler.addCounter("game.network.blockBatches");
          applyBlockEditBatch(decodeBlockRuns(data.runs), false);
        } else if (data.type === "WORLD_STATE") {
          profiler.addCounter("game.network.worldStateBlocks", data.blocks.length);
          const applyWorldStateToken = profiler.begin(
            "main.network.applyWorldState",
          );
          applyBlockEditBatch(
            data.blocks.map(({ x, y, z, blockType }) => ({ x, y, z, block: blockType })),
            false,
          );
          profiler.end(applyWorldStateToken);
        }

        if (nm.isHost && data.type !== "HANDSHAKE") {
          nm.broadcast(data, senderId);
        }
        profiler.end(handlePacketToken);
      };

      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        pipelineRef.current?.dispose();
        pipelineRef.current = null;
        lodBridgeRef.current?.dispose();
        lodBridgeRef.current = null;
        skyControllerRef.current?.dispose();
        skyControllerRef.current = null;
        shadowPassRef.current?.dispose();
        shadowPassRef.current = null;
        bloomPassRef.current?.dispose();
        bloomPassRef.current = null;

        document.removeEventListener("keyup", onKeyUp);
        if (container) {
          container.removeEventListener("contextmenu", onContextMenu);
          container.removeEventListener("mousedown", onMouseDown);
        }
        window.removeEventListener("mouseup", onMouseUp);
        brushPreviewRef.current?.dispose();
        brushPreviewRef.current = null;

        nm.disconnect();

        profiledRenderRef.current?.dispose();
        profiledRenderRef.current = null;
        removeSceneMemorySampler();
        stopCalibrationListener();
        uninstallBrowserObservers();
        uninstallVoxelWorldApi();
        unmountProfilerOverlay();

        renderer.setAnimationLoop(null);
        renderer.dispose();

        scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            if (object.material instanceof THREE.Material) {
              object.material.dispose();
            } else if (Array.isArray(object.material)) {
              object.material.forEach((m) => m.dispose());
            }
          }
        });
        // The scene outlives a remount (React runs effects twice in development); a sky left behind would cover the LOD.
        scene.clear();

        if (playerControlsRef.current) {
          playerControlsRef.current.dispose();
        }

        resizeObserver.disconnect();

        generationWorkerPool.terminate();
        lightingWorkerPool.terminate();
        meshWorkerPool.terminate();
        textureArrayWorkerPool.terminate();

        initialized.current = false;
      };
    }
  }, [containerRef]);

  function flushRaycastSteps() {
    profiler.addCounter("game.raycast.steps", raycastStepsRef.current);
    raycastStepsRef.current = 0;
  }

  function updateIndicator() {
    const scopeToken = profiler.begin("main.frame.updateIndicator");
    try {
      updateIndicatorUnprofiled();
    } finally {
      flushRaycastSteps();
      profiler.end(scopeToken);
    }
  }

  const MAX_REACH_IN_BLOCKS = 5;
  const rayDirection = new THREE.Vector3();

  interface VoxelRayHit {
    x: number;
    y: number;
    z: number;
    normal: THREE.Vector3;
    point: THREE.Vector3;
  }

  function castCameraRay(reach: number = MAX_REACH_IN_BLOCKS): VoxelRayHit | null {
    camera.getWorldDirection(rayDirection);
    const hit = castVoxelRay(
      [camera.position.x, camera.position.y, camera.position.z],
      [rayDirection.x, rayDirection.y, rayDirection.z],
      (x, y, z) => {
        const block = getBlock(x, y, z);
        return block !== null && block !== BlockType.AIR;
      },
      reach,
      () => raycastStepsRef.current++,
    );
    if (!hit) return null;
    return {
      x: hit.cell[0],
      y: hit.cell[1],
      z: hit.cell[2],
      normal: new THREE.Vector3(...hit.faceNormal),
      point: new THREE.Vector3(...hit.point),
    };
  }

  function updateIndicatorUnprofiled() {
    if (playerControlsRef.current?.controls.isLocked || playerControlsRef.current?.isMobile) {
      const indicator = scene.getObjectByName("indicator") as THREE.LineSegments;
      const hit = castCameraRay();
      if (!hit) {
        indicator.visible = false;
        return;
      }
      const { scale, offset } = getBoundingBox(getBlock(hit.x, hit.y, hit.z) as BlockType);
      indicator.position.set(hit.x + offset[0], hit.y + offset[1], hit.z + offset[2]);
      indicator.scale.set(scale[0], scale[1], scale[2]);
      indicator.visible = true;
    }
  }

  function placeBlock(type: BlockType) {
    const scopeToken = profiler.begin("main.edit.placeBlock");
    try {
      placeBlockUnprofiled(type);
    } finally {
      flushRaycastSteps();
      profiler.end(scopeToken);
    }
  }

  function placeBlockUnprofiled(type: BlockType) {
    if (playerControlsRef.current?.controls.isLocked || playerControlsRef.current?.isMobile) {
      const hit = castCameraRay();
      if (!hit) return;
      const { x, y, z } = hit;
      const faceNormal = hit.normal;
      const hitBlock = getBlock(x, y, z);

      let newBlockX = x + faceNormal.x;
      let newBlockY = y + faceNormal.y;
      let newBlockZ = z + faceNormal.z;

      if (hitBlock && isReplaceable(hitBlock)) {
        newBlockX = x;
        newBlockY = y;
        newBlockZ = z;
      }

      if (
        getBlock(newBlockX, newBlockY, newBlockZ) !== BlockType.AIR &&
        !isReplaceable(getBlock(newBlockX, newBlockY, newBlockZ)!)
      )
        return;

      const blockBox = new THREE.Box3(
        new THREE.Vector3(
          newBlockX - 0.5,
          newBlockY - 0.5,
          newBlockZ - 0.5,
        ),
        new THREE.Vector3(
          newBlockX + 0.5,
          newBlockY + 0.5,
          newBlockZ + 0.5,
        ),
      );

      const playerBox = playerControlsRef.current!.getPlayerBox().clone();

      const blockBelow = getBlock(newBlockX, newBlockY - 1, newBlockZ);
      const isBlockBelowCollidable =
        blockBelow !== null && !NON_COLLIDABLE_BLOCKS.includes(blockBelow);

      if (!isBlockBelowCollidable) {
        // Shrink box for placement check to allow placing blocks while on edge
        playerBox.min.x += 0.2;
        playerBox.max.x -= 0.2;
        playerBox.min.z += 0.2;
        playerBox.max.z -= 0.2;
        playerBox.min.y += 0.1;
        playerBox.max.y -= 0.1;
      }

      if (blockBox.intersectsBox(playerBox)) return;

      // Handle slab stacking
      const targetBlock = getBlock(x, y, z);
      if (
        targetBlock === type &&
        (type === BlockType.PLANKS_SLAB ||
          type === BlockType.COBBLESTONE_SLAB ||
          type === BlockType.STONE_SLAB)
      ) {
        if (faceNormal.y === 1) {
          // Stacking on top of a slab -> Full block
          let fullBlockType = BlockType.PLANKS;
          if (type === BlockType.COBBLESTONE_SLAB)
            fullBlockType = BlockType.COBBLESTONE;
          if (type === BlockType.STONE_SLAB)
            fullBlockType = BlockType.STONE;

          setBlock(x, y, z, fullBlockType);
          updateIndicator();
          return;
        }
      }

      // Handle top slab placement
      if (
        type === BlockType.PLANKS_SLAB ||
        type === BlockType.COBBLESTONE_SLAB ||
        type === BlockType.STONE_SLAB
      ) {
        // Check if we are placing on the top half of a block
        const point = hit.point;
        // Calculate relative Y position within the block
        // The block center is at x, y, z. The block bounds are [y-0.5, y+0.5]
        // But wait, x,y,z are integers.
        // If we clicked on a face, we need to know which block we clicked.
        // intersections[0].point is in world coordinates.

        // If we clicked on the side of a block
        if (faceNormal.y === 0) {
          const relativeY = point.y - (y - 0.5);
          if (relativeY > 0.5) {
            if (type === BlockType.PLANKS_SLAB)
              type = BlockType.PLANKS_SLAB_TOP;
            if (type === BlockType.COBBLESTONE_SLAB)
              type = BlockType.COBBLESTONE_SLAB_TOP;
            if (type === BlockType.STONE_SLAB)
              type = BlockType.STONE_SLAB_TOP;
          }
        } else if (faceNormal.y === -1) {
          // Clicking on the bottom face of a block -> Top Slab
          if (type === BlockType.PLANKS_SLAB)
            type = BlockType.PLANKS_SLAB_TOP;
          if (type === BlockType.COBBLESTONE_SLAB)
            type = BlockType.COBBLESTONE_SLAB_TOP;
          if (type === BlockType.STONE_SLAB)
            type = BlockType.STONE_SLAB_TOP;
        }
      }

      // Handle stacking for top slabs (placing a bottom slab on a top slab)
      const targetBlockForTopSlab = getBlock(
        newBlockX,
        newBlockY,
        newBlockZ,
      );
      if (
        (targetBlockForTopSlab === BlockType.PLANKS_SLAB_TOP &&
          type === BlockType.PLANKS_SLAB) ||
        (targetBlockForTopSlab === BlockType.COBBLESTONE_SLAB_TOP &&
          type === BlockType.COBBLESTONE_SLAB) ||
        (targetBlockForTopSlab === BlockType.STONE_SLAB_TOP &&
          type === BlockType.STONE_SLAB)
      ) {
        let fullBlockType = BlockType.PLANKS;
        if (type === BlockType.COBBLESTONE_SLAB)
          fullBlockType = BlockType.COBBLESTONE;
        if (type === BlockType.STONE_SLAB) fullBlockType = BlockType.STONE;

        setBlock(newBlockX, newBlockY, newBlockZ, fullBlockType);
        updateIndicator();
        return;
      }

      setBlock(newBlockX, newBlockY, newBlockZ, type);

      updateIndicator();
    }
  }

  function breakBlock() {
    const scopeToken = profiler.begin("main.edit.breakBlock");
    try {
      breakBlockUnprofiled();
    } finally {
      flushRaycastSteps();
      profiler.end(scopeToken);
    }
  }

  function breakBlockUnprofiled() {
    if (playerControlsRef.current?.controls.isLocked || playerControlsRef.current?.isMobile) {
      const hit = castCameraRay();
      if (hit) setBlock(hit.x, hit.y, hit.z, BlockType.AIR);
    }
  }

  function recordChunkGeometryStats(
    chunkName: string,
    kind: "opaque" | "transparent" | "plants",
    stats: {
      vertexCount: number;
      bytesByAttribute: { [attribute: string]: number };
    },
  ) {
    if (!profiler.enabled) return;
    profiler.recordMesh(chunkName, {
      kind,
      vertexCount: stats.vertexCount,
      triangleCount: stats.vertexCount / 2,
      bytesByAttribute: stats.bytesByAttribute,
    });
    profiler.recordBytes(
      "bytes.geometry.toGpu",
      Object.values(stats.bytesByAttribute).reduce((sum, bytes) => sum + bytes, 0),
    );
  }

  function placeChunkMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.ShaderMaterial,
    name: string,
    renderOrder: number,
    chunkX: number,
    chunkY: number,
    chunkZ: number,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      chunkX * CHUNK_WIDTH - 0.5,
      chunkY * CHUNK_HEIGHT - 0.5,
      chunkZ * CHUNK_LENGTH - 0.5,
    );
    // Chunk meshes never move: compute the world matrix once and keep the per-frame scene update from visiting them.
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    mesh.updateMatrix();
    mesh.matrixWorld.copy(mesh.matrix);
    mesh.frustumCulled = true;
    mesh.name = name;
    mesh.renderOrder = renderOrder;
    profiler.addCounter("game.chunks.meshObjectsCreated");
    const sceneAddToken = profiler.begin("main.chunk.sceneAdd");
    scene.add(mesh);
    profiler.end(sceneAddToken);
    return mesh;
  }

  /** Shows a meshed chunk once the pipeline says its neighbors will not leave its buried faces exposed. */
  function refreshChunkVisibility(record: ChunkRecord) {
    const chunkName = chunkNameOf(record.chunkX, record.chunkY, record.chunkZ);
    const meshes = chunkMeshesRef.current.get(chunkName);
    const held = heldChunksRef.current;
    if (!meshes) {
      held.delete(chunkName);
      return;
    }
    const heldSinceMs = held.get(chunkName)?.heldSinceMs;
    const isReady =
      !pipelineRef.current ||
      pipelineRef.current.isReadyToShow(record) ||
      (heldSinceMs !== undefined && performance.now() - heldSinceMs > HELD_CHUNK_TIMEOUT_MS);
    if (isReady) held.delete(chunkName);
    else if (heldSinceMs === undefined) held.set(chunkName, { record, heldSinceMs: performance.now() });
    for (const mesh of meshes) mesh.visible = isReady;
    const plantDetail = plantDetailRef.current.get(chunkName);
    if (isReady && plantDetail) applyPlantDetail(plantDetail);
  }

  function refreshChunkAndNeighborVisibility(record: ChunkRecord) {
    refreshChunkVisibility(record);
    const neighbors = pipelineRef.current ? [...pipelineRef.current.faceNeighborsOf(record)] : [];
    for (const neighbor of neighbors) if (neighbor) refreshChunkVisibility(neighbor);
  }

  function applyPlantDetail(plantDetail: PlantDetailMeshes) {
    if (heldChunksRef.current.has(plantDetail.chunkName)) return;
    const distance = plantDetail.center.distanceTo(camera.position);
    const isNear = distance <= PLANT_VOXEL_DETAIL_DISTANCE;
    const isDrawn = distance <= PLANT_DRAW_DISTANCE;
    for (const mesh of plantDetail.voxel) mesh.visible = isNear;
    for (const mesh of plantDetail.billboard) mesh.visible = !isNear && isDrawn;
  }

  function updatePlantDetail() {
    const plantDetailToken = profiler.begin(
      "main.frame.plantDetail",
      DIMENSIONS.simulationSystem,
      "frame.plantDetail",
    );
    heldChunksRef.current.forEach(({ record }) => refreshChunkVisibility(record));
    plantDetailRef.current.forEach(applyPlantDetail);
    profiler.addCounter("game.plantDetail.chunksUpdated", plantDetailRef.current.size);
    profiler.end(plantDetailToken);
  }

  function addChunkMesh(
    meshResult: ChunkMeshResult,
    chunkName: string,
    chunkX: number,
    chunkY: number,
    chunkZ: number,
  ) {
    const { opaque, transparent, plants } = materialsRef.current;
    if (!opaque || !transparent || !plants) return;

    pruneChunkMesh(chunkName);
    const buildGeometryToken = profiler.begin("main.chunk.buildGeometry");
    const meshes: THREE.Mesh[] = [];

    const opaqueGeometry = createChunkSurfaceGeometry(meshResult.opaque);
    if (opaqueGeometry) {
      recordChunkGeometryStats(chunkName, "opaque", {
        vertexCount: meshResult.opaque.byteLength / 8,
        bytesByAttribute: { packedVertices: meshResult.opaque.byteLength },
      });
      const opaqueMesh = placeChunkMesh(opaqueGeometry, opaque, chunkName, 0, chunkX, chunkY, chunkZ);
      shadowPassRef.current?.addChunkCaster(chunkName, opaqueGeometry, opaqueMesh);
      meshes.push(opaqueMesh);
    }

    const transparentGeometry = createChunkSurfaceGeometry(meshResult.transparent);
    if (transparentGeometry) {
      recordChunkGeometryStats(chunkName, "transparent", {
        vertexCount: meshResult.transparent.byteLength / 8,
        bytesByAttribute: { packedVertices: meshResult.transparent.byteLength },
      });
      meshes.push(
        placeChunkMesh(
          transparentGeometry,
          transparent,
          chunkName + "_transparent",
          1,
          chunkX,
          chunkY,
          chunkZ,
        ),
      );
    }

    let plantVertexCount = 0;
    let plantInstanceBytes = 0;
    const plantDetail: PlantDetailMeshes = {
      chunkName,
      center: new THREE.Vector3(
        chunkX * CHUNK_WIDTH + CHUNK_WIDTH / 2 - 0.5,
        chunkY * CHUNK_HEIGHT + CHUNK_HEIGHT / 2 - 0.5,
        chunkZ * CHUNK_LENGTH + CHUNK_LENGTH / 2 - 0.5,
      ),
      voxel: [],
      billboard: [],
    };
    for (const batch of meshResult.plants) {
      for (const detail of ["voxel", "billboard"] as const) {
        const plantGeometry = createPlantInstanceGeometry(
          batch.blockType,
          batch.instances,
          detail,
        );
        if (!plantGeometry) continue;
        const plantMesh = placeChunkMesh(
          plantGeometry,
          plants,
          `${chunkName}_plant_${batch.blockType}_${detail}`,
          0,
          chunkX,
          chunkY,
          chunkZ,
        );
        plantDetail[detail].push(plantMesh);
        meshes.push(plantMesh);
      }
      plantVertexCount +=
        (batch.instances.byteLength / 4) * plantTemplateVertexCount(batch.blockType);
      plantInstanceBytes += batch.instances.byteLength;
    }
    plantDetailRef.current.set(chunkName, plantDetail);
    applyPlantDetail(plantDetail);
    profiler.addCounter("game.chunks.meshApplied");
    if (plantInstanceBytes > 0) {
      recordChunkGeometryStats(chunkName, "plants", {
        vertexCount: plantVertexCount,
        bytesByAttribute: { plantInstances: plantInstanceBytes },
      });
    }

    chunkMeshesRef.current.set(chunkName, meshes);
    profiler.end(buildGeometryToken);
  }

  function getBlock(x: number, y: number, z: number) {
    getBlockCallsRef.current++;
    return pipelineRef.current?.getBlock(x, y, z) ?? null;
  }

  function scheduleWaterUpdate(x: number, y: number, z: number) {
    profiler.addCounter("game.water.updatesScheduled");
    pendingWaterUpdates.current.add(`${x},${y},${z}`);
  }

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isSimulationActive()) return;
      if (pendingWaterUpdates.current.size === 0) return;

      const waterToken = profiler.begin("main.interval.water");
      const collectToken = profiler.begin("main.interval.water.collect");
      const updates = Array.from(pendingWaterUpdates.current);
      pendingWaterUpdates.current.clear();
      profiler.end(collectToken);
      profiler.addCounter("game.water.updatesProcessed", updates.length);

      updates.forEach((key) => {
        const [x, y, z] = key.split(",").map(Number);
        updateWater(x, y, z, getBlock, setBlock, scheduleWaterUpdate);
      });
      profiler.end(waterToken);
    }, 650);

    return () => clearInterval(interval);
  }, []);

  function setBlock(
    x: number,
    y: number,
    z: number,
    type: number,
    broadcast: boolean = true,
  ) {
    const scopeToken = profiler.begin(
      "main.edit.setBlock",
      DIMENSIONS.simulationSystem,
      "edit.setBlock",
    );
    try {
      applyBlockEditBatch([{ x, y, z, block: type }], broadcast);
    } finally {
      profiler.end(scopeToken);
    }
  }

  /**
   * Applies block edits as one batch: writes them, relights once, rebuilds the touched chunks ahead of streaming
   * work, saves them, wakes nearby water and tells peers. Edits in chunks that are not loaded are saved and show
   * up when the chunk loads.
   */
  function applyBlockEditBatch(
    edits: BlockEditBatch | ArrayLike<BlockEdit>,
    broadcast: boolean = true,
  ): PipelineEditResult | null {
    const batch = edits instanceof BlockEditBatch ? edits : BlockEditBatch.fromEdits(edits);
    profiler.addCounter("game.setBlock.calls", batch.length);
    const pipeline = pipelineRef.current;
    if (batch.replaceRule === "any") {
      recordEditsOutsideLoadedChunks(
        savedEditTarget,
        batch,
        (chunkX, chunkY, chunkZ) => !!pipeline?.store.get(chunkX, chunkY, chunkZ)?.blocks,
      );
    }
    if (!pipeline || batch.length === 0) return null;

    const firstOldBlock = pipeline.getBlock(batch.xs[0], batch.ys[0], batch.zs[0]) ?? BlockType.AIR;
    const firstNewBlock = batch.blocks[0];
    const trace = new LightEditTrace(
      profiler,
      classifyLightEdit(
        getBlockLightLevel(firstOldBlock),
        getBlockLightLevel(firstNewBlock),
        firstNewBlock === BlockType.AIR,
      ),
    );
    const editStartedAtMs = profiler.now();
    const edited: { result: PipelineEditResult | null } = { result: null };
    void trace.stage("relight", () => {
      const relightToken = profiler.begin("main.light.relight");
      try {
        edited.result = pipeline.applyBlockEdits(batch, {
          onPhase: profiler.enabled ? trackLightPhaseInProfiler : undefined,
        });
      } finally {
        profiler.end(relightToken);
      }
    });
    const result = edited.result as PipelineEditResult | null;
    if (!result) return null;

    pendingLightEditsRef.current++;
    trace.markRelit();
    const { stats } = result;
    trace.count("cellsRemoved", stats.cellsRemoved);
    trace.count("cellsLit", stats.cellsLit);
    trace.count("cellsVisited", stats.cellsVisited);
    trace.count("chunksRelit", result.chunksToRemesh.length);
    profiler.addCounter("game.light.cellsVisited", stats.cellsVisited);
    profiler.addCounter("game.light.cellsRemoved", stats.cellsRemoved);
    profiler.addCounter("game.light.cellsLit", stats.cellsLit);
    profiler.addCounter("game.light.chunksToRemesh", result.chunksToRemesh.length);
    void trace.stage("queueMeshes", () => {
      result.meshesApplied.forEach((meshApplied) => trace.trackMesh(meshApplied));
    });
    void trace.finish().finally(() => {
      profiler.recordTimer("chunk.pipeline.edit", profiler.now() - editStartedAtMs, "latency");
      pendingLightEditsRef.current--;
      if (pendingLightEditsRef.current === 0) {
        lightIdleResolversRef.current.splice(0).forEach((resolve) => resolve());
      }
    });

    lodBridgeRef.current?.onBlocksEdited(result, pipeline);
    applyEditSideEffects(result, broadcast);
    return result;
  }

  /** Every block of a sphere at once (modes: fill, erase, fillAirOnly, replaceNonAirOnly). */
  function applySphere(
    center: BlockPosition,
    radius: number,
    block: number,
    mode: BrushMode = "fill",
  ): PipelineEditResult | null {
    const sphereToken = profiler.begin("main.edit.sphere");
    try {
      return applyBlockEditBatch(sphereEdits(center, radius, block, mode));
    } finally {
      profiler.end(sphereToken);
    }
  }

  /** Saves every changed block, wakes the water next to it and sends the changes to peers. */
  function applyEditSideEffects(result: PipelineEditResult, broadcast: boolean) {
    const { changes } = result;
    const sideEffectsToken = profiler.begin("main.edit.sideEffects");
    recordSavedEdits(savedEditTarget, changes.count, changes.x, changes.y, changes.z, changes.newBlock);
    wakeWaterAroundChanges(
      changes,
      (chunkX, chunkY, chunkZ) => pipelineRef.current?.store.get(chunkX, chunkY, chunkZ)?.blocks,
      scheduleWaterUpdate,
    );
    profiler.end(sideEffectsToken);
    if (!broadcast || !networkManager.current.myPeerId || changes.count === 0) return;
    if (changes.count === 1) {
      networkManager.current.send({
        type: "BLOCK_UPDATE",
        x: changes.x[0],
        y: changes.y[0],
        z: changes.z[0],
        blockType: changes.newBlock[0],
      });
      return;
    }
    networkManager.current.send({
      type: "BLOCK_BATCH",
      runs: encodeBlockRuns(changes.count, changes.x, changes.y, changes.z, changes.newBlock, 1),
    });
  }

  let prevTime = performance.now();

  function pruneChunkMesh(chunkName: string) {
    const disposeToken = profiler.begin("main.chunk.dispose");
    profiler.removeMesh(chunkName);
    plantDetailRef.current.delete(chunkName);
    shadowPassRef.current?.removeChunkCaster(chunkName);
    const meshes = chunkMeshesRef.current.get(chunkName);
    if (meshes) {
      for (const mesh of meshes) {
        releaseChunkGeometry(mesh.geometry);
        mesh.removeFromParent();
      }
      profiler.addCounter("game.chunks.meshObjectsDisposed", meshes.length);
      chunkMeshesRef.current.delete(chunkName);
    }
    profiler.end(disposeToken);
  }

  function growTree(x: number, y: number, z: number, edits: BlockEdit[]) {
    const height = 4 + Math.floor(Math.random() * 3); // 4 to 6

    // Trunk
    for (let i = 0; i < height; i++) {
      edits.push({ x, y: y + i, z, block: BlockType.LOG });
    }

    // Leaves
    // Top (y+height)
    edits.push({ x, y: y + height, z, block: BlockType.LEAVES });
    edits.push({ x: x + 1, y: y + height, z, block: BlockType.LEAVES });
    edits.push({ x: x - 1, y: y + height, z, block: BlockType.LEAVES });
    edits.push({ x, y: y + height, z: z + 1, block: BlockType.LEAVES });
    edits.push({ x, y: y + height, z: z - 1, block: BlockType.LEAVES });

    // Layers 2 and 3 (y+height-1, y+height-2)
    for (const layerY of [y + height - 1, y + height - 2]) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2) {
            if (Math.random() > 0.5) continue;
          }
          if (dx === 0 && dz === 0) continue; // Trunk
          edits.push({ x: x + dx, y: layerY, z: z + dz, block: BlockType.LEAVES });
        }
      }
    }
  }

  function reactsToRandomTicks(block: number) {
    return block === BlockType.SAPLING || block === BlockType.GRASS;
  }

  /** Drawn chunks with mixed blocks near the player: uniform chunks hold no grass or saplings. */
  function collectRandomTickedChunks() {
    const tickedChunks: ChunkRecord[] = [];
    const playerChunkX = Math.floor(camera.position.x / CHUNK_WIDTH);
    const playerChunkZ = Math.floor(camera.position.z / CHUNK_LENGTH);
    pipelineRef.current?.forEachChunk((record) => {
      const isNearPlayer =
        Math.abs(record.chunkX - playerChunkX) <= RANDOM_TICK_RADIUS_CHUNKS &&
        Math.abs(record.chunkZ - playerChunkZ) <= RANDOM_TICK_RADIUS_CHUNKS;
      if (isNearPlayer && record.blocks && record.uniformBlock < 0 && record.appliedMeshVersion >= 0) {
        tickedChunks.push(record);
      }
    });
    return tickedChunks;
  }

  function tickChunks() {
    if (connectedToHostRef.current) return;
    const tickedChunks = collectRandomTickedChunks();
    if (profiler.enabled) {
      profiler.addCounter("game.randomTicks", tickedChunks.length * RANDOM_TICKS_PER_CHUNK);
    }
    // Every change of one tick goes in as one batch: one relight and one rebuild per touched chunk.
    const tickEdits: BlockEdit[] = [];
    tickedChunks.forEach((record) => {
      const chunk = record.blocks;
      if (!chunk) return;
      profiler.addCounter("game.randomTick.chunksVisited");
      const tickableIndices = tickableBlocksRef.current.indicesFor(
        chunk,
        record.editVersion,
        reactsToRandomTicks,
      );
      const tickedIndices = pickTickedBlocks(
        tickableIndices,
        chunk.length,
        RANDOM_TICKS_PER_CHUNK,
      );
      if (tickedIndices.length === 0) return;
      profiler.addCounter("game.randomTick.blocksTicked", tickedIndices.length);

      const { chunkX, chunkY, chunkZ } = record;
      for (const blockIndex of tickedIndices) {
        const z = blockIndex % CHUNK_HEIGHT;
        const y = Math.floor(blockIndex / CHUNK_HEIGHT) % CHUNK_HEIGHT;
        const x = Math.floor(blockIndex / (CHUNK_WIDTH * CHUNK_HEIGHT));
        const block = chunk[blockIndex];

        const globalX = chunkX * CHUNK_WIDTH + x;
        const globalY = chunkY * CHUNK_HEIGHT + y;
        const globalZ = chunkZ * CHUNK_LENGTH + z;

        if (block === BlockType.SAPLING) {
          profiler.recordBreakdown(
            DIMENSIONS.simulationSystem,
            "randomTick.sapling",
            { units: 1 },
          );
          // Tree growth
          if (Math.random() < 0.1) {
            const growTreeToken = profiler.begin(
              "main.interval.randomTick.growTree",
              DIMENSIONS.simulationSystem,
              "randomTick.growTree",
            );
            growTree(globalX, globalY, globalZ, tickEdits);
            profiler.end(growTreeToken);
          }
        } else if (block === BlockType.GRASS) {
          profiler.recordBreakdown(
            DIMENSIONS.simulationSystem,
            "randomTick.grass",
            { units: 1 },
          );
          // Grass death
          const blockAbove = getBlock(globalX, globalY + 1, globalZ);
          if (
            blockAbove !== BlockType.AIR &&
            blockAbove !== null &&
            !TRANSPARENT_BLOCKS.includes(blockAbove)
          ) {
            tickEdits.push({ x: globalX, y: globalY, z: globalZ, block: BlockType.DIRT });
          } else {
            // Grass spread
            // Try one random neighbor
            const dx = Math.floor(Math.random() * 3) - 1;
            const dy = Math.floor(Math.random() * 3) - 1;
            const dz = Math.floor(Math.random() * 3) - 1;

            if (dx === 0 && dy === 0 && dz === 0) continue;

            const targetX = globalX + dx;
            const targetY = globalY + dy;
            const targetZ = globalZ + dz;

            const targetBlock = getBlock(targetX, targetY, targetZ);
            const blockAboveTarget = getBlock(targetX, targetY + 1, targetZ);

            if (
              targetBlock === BlockType.DIRT &&
              (blockAboveTarget === BlockType.AIR ||
                (blockAboveTarget !== null &&
                  TRANSPARENT_BLOCKS.includes(blockAboveTarget)))
            ) {
              tickEdits.push({ x: targetX, y: targetY, z: targetZ, block: BlockType.GRASS });
            }
          }
        }
      }
    });
    if (tickEdits.length > 0) applyBlockEditBatch(tickEdits);
  }

  useEffect(() => {
    const tickInterval = setInterval(() => {
      if (!isSimulationActive()) return;
      const randomTickToken = profiler.begin("main.interval.randomTick");
      tickChunks();
      profiler.end(randomTickToken);
    }, 50); // 20 ticks per second

    return () => clearInterval(tickInterval);
  }, []);

  function refreshWorlds() {
    return listWorldRecords()
      .then(setWorlds)
      .catch((error) => {
        console.error("Failed to list worlds:", error);
        toast.error("Could not read saved worlds");
      })
      .finally(() => setIsLoadingWorlds(false));
  }

  useEffect(() => {
    refreshWorlds();
  }, []);

  function buildSnapshotOfActiveWorld(): StoredWorld | null {
    const activeWorld = activeWorldRef.current;
    if (!activeWorld || !playerControlsRef.current) return null;
    if (loadProgressRef.current < 1) return null;
    const playerObject = playerControlsRef.current.controls.object;
    return {
      ...activeWorld,
      seed: seedRef.current,
      lastPlayedAt: Date.now(),
      modifiedChunks: Array.from(modifiedChunks.current.entries()).map(
        ([chunkName, edits]) => [chunkName, Array.from(edits.entries())],
      ),
      position: {
        x: playerObject.position.x,
        y: playerObject.position.y,
        z: playerObject.position.z,
      },
      rotation: {
        x: playerObject.rotation.x,
        y: playerObject.rotation.y,
        z: playerObject.rotation.z,
      },
      hotbarSlots: normalizeHotbar(hotbarSlotsRef.current),
    };
  }

  async function saveActiveWorld(shouldAnnounce = false) {
    if (isBenchmarkWorldRef.current) return;
    const buildSnapshotToken = profiler.begin(
      "main.save.buildSnapshot",
      DIMENSIONS.simulationSystem,
      "save.buildSnapshot",
    );
    const snapshot = buildSnapshotOfActiveWorld();
    profiler.end(buildSnapshotToken);
    if (!snapshot) return;
    if (profiler.enabled) {
      profiler.addCounter("game.save.snapshots");
      profiler.addCounter("game.save.modifiedChunks", snapshot.modifiedChunks.length);
      profiler.addCounter(
        "game.save.editedBlocks",
        snapshot.modifiedChunks.reduce((total, [, edits]) => total + edits.length, 0),
      );
      profiler.recordBytes(
        "bytes.save.snapshot",
        estimateTransferBytes(snapshot.modifiedChunks),
      );
    }
    try {
      activeWorldRef.current = snapshot;
      const saveStartedAtMs = profiler.now();
      await saveWorldRecord(snapshot);
      profiler.recordTimer(
        "main.save.indexedDb",
        profiler.now() - saveStartedAtMs,
        "latency",
      );
      if (shouldAnnounce) toast.success("World saved");
    } catch (error) {
      console.error("Failed to save world:", error);
      toast.error("Failed to save world");
    }
  }

  function enterWorld(world: StoredWorld) {
    if (!texturesReadyRef.current) {
      worldWaitingForTexturesRef.current = world;
      setActiveWorldName(world.name);
      setPhase("loading");
      return;
    }

    activeWorldRef.current = world;
    seedRef.current = world.seed;
    const deserializeToken = profiler.begin(
      "main.load.deserializeModifiedChunks",
      DIMENSIONS.simulationSystem,
      "load.deserializeSave",
    );
    modifiedChunks.current = new Map(
      world.modifiedChunks.map(([chunkName, edits]) => [
        chunkName,
        new Map(edits),
      ]),
    );
    rebuildEditedColumnTops();
    profiler.end(deserializeToken);
    profiler.addCounter("game.load.modifiedChunksRestored", world.modifiedChunks.length);
    setHotbarSlots(normalizeHotbar(world.hotbarSlots ?? DEFAULT_HOTBAR_BLOCKS));
    setSelectedSlot(0);
    setActiveWorldName(world.name);

    const playerObject = playerControlsRef.current?.controls.object;
    if (playerObject) {
      if (world.position && world.rotation) {
        playerObject.position.set(
          world.position.x,
          world.position.y,
          world.position.z,
        );
        playerObject.rotation.set(
          world.rotation.x,
          world.rotation.y,
          world.rotation.z,
        );
      } else {
        const spawnPoint = getSpawnPointFromSeed(world.seed);
        playerObject.position.set(spawnPoint.x, spawnPoint.y, spawnPoint.z);
        playerObject.rotation.set(0, 0, 0);
      }
    }
    playerControlsRef.current?.resetMotion();

    setPhase("loading");
    startWorldGeneration(world.seed);
  }

  async function playWorld(worldId: string) {
    const world = worlds.find((candidate) => candidate.id === worldId);
    if (world) enterWorld(world);
  }

  async function createAndPlayWorld(name: string, seedText: string) {
    const trimmedSeedText = seedText.trim();
    const seed = !trimmedSeedText
      ? generateRandomSeed()
      : /^\d+$/.test(trimmedSeedText)
        ? Number(trimmedSeedText) % 1000000000
        : hashTextToSeed(trimmedSeedText);
    const world = createWorldRecord(name.trim() || "New World", seed);
    try {
      await saveWorldRecord(world);
    } catch (error) {
      console.error("Failed to create world:", error);
      toast.error("Failed to create world");
      return;
    }
    refreshWorlds();
    enterWorld(world);
  }

  async function renameWorld(worldId: string, name: string) {
    const world = worlds.find((candidate) => candidate.id === worldId);
    if (!world) return;
    await saveWorldRecord({ ...world, name });
    refreshWorlds();
  }

  async function deleteWorld(worldId: string) {
    await deleteWorldRecord(worldId);
    refreshWorlds();
  }

  async function exitToWorlds() {
    await saveActiveWorld();
    networkManager.current.disconnect();
    networkManager.current.myPeerId = "";
    connectedToHostRef.current = false;
    setConnectedToHost(false);
    setConnectedPlayerCount(0);
    setPeerId("");
    activeWorldRef.current = null;
    await refreshWorlds();
    setPhase("title");
  }

  function joinHostedWorld(hostId: string) {
    activeWorldRef.current = null;
    modifiedChunks.current = new Map();
    editedColumnTopsRef.current.clear();
    setHotbarSlots(normalizeHotbar(DEFAULT_HOTBAR_BLOCKS));
    setSelectedSlot(0);
    setActiveWorldName("Hosted world");
    loadTracker.resetWorldStages();
    setPhase("loading");

    const abandonJoin = (reason: string) => {
      networkManager.current.disconnect();
      networkManager.current.myPeerId = "";
      connectedToHostRef.current = false;
      setConnectedToHost(false);
      setConnectedPlayerCount(0);
      setPeerId("");
      setPhase("title");
      toast.error(reason);
    };
    const connectionTimeout = setTimeout(() => {
      if (phaseRef.current === "loading" && !connectedToHostRef.current) {
        abandonJoin("Could not reach that host");
      }
    }, JOIN_TIMEOUT_MILLISECONDS);

    networkManager.current.joinGame(hostId).catch(() => {
      clearTimeout(connectionTimeout);
      abandonJoin("Could not connect to that host");
    });
  }

  function resumePlaying() {
    if (isMobile) {
      setPhase("playing");
    } else {
      playerControlsRef.current?.controls.lock();
    }
  }

  function openPauseMenu() {
    setPhase("paused");
    saveActiveWorld();
  }

  useEffect(() => {
    const autosaveInterval = setInterval(() => {
      if (phaseRef.current === "playing") saveActiveWorld();
    }, AUTOSAVE_INTERVAL_MILLISECONDS);
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") saveActiveWorld();
    };
    document.addEventListener("visibilitychange", saveWhenHidden);
    window.addEventListener("pagehide", saveWhenHidden);
    return () => {
      clearInterval(autosaveInterval);
      document.removeEventListener("visibilitychange", saveWhenHidden);
      window.removeEventListener("pagehide", saveWhenHidden);
    };
  }, []);

  function waitForLightIdle(): Promise<void> {
    if (pendingLightEditsRef.current === 0) return Promise.resolve();
    return new Promise((resolve) => lightIdleResolversRef.current.push(resolve));
  }

  function createBenchmarkBridge(): BenchmarkBridge {
    const cameraPositionBeforeBenchmark = camera.position.clone();
    const cameraQuaternionBeforeBenchmark = camera.quaternion.clone();
    const frameCallbacks = benchmarkFrameCallbacksRef.current;

    return {
      enterBenchmarkWorld(seed) {
        void saveActiveWorld();
        isBenchmarkWorldRef.current = true;
        enterWorld(createWorldRecord("Benchmark", seed));
      },
      waitUntilWorldLoaded: () =>
        new Promise<void>((resolve, reject) => {
          const waitStartedAtMs = performance.now();
          const poll = setInterval(() => {
            if (loadProgressRef.current >= 1) {
              clearInterval(poll);
              resolve();
            } else if (
              performance.now() - waitStartedAtMs >
              BENCHMARK_LOAD_TIMEOUT_MILLISECONDS
            ) {
              clearInterval(poll);
              reject(new Error("Benchmark world did not finish loading"));
            }
          }, 50);
        }),
      setPlaying(playing) {
        playerControlsRef.current?.resetMotion();
        setPhase(playing ? "playing" : "paused");
      },
      setFlying: (flying) => playerControlsRef.current?.setFlying(flying),
      setCameraPose({ position, yaw, pitch }: CameraPose) {
        camera.position.set(position.x, position.y, position.z);
        camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
      },
      getCameraPosition: () => ({
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      }),
      editBlock: (x, y, z, blockType) => setBlock(x, y, z, blockType),
      editBlockAndSettle: (x, y, z, blockType) => {
        setBlock(x, y, z, blockType);
        return waitForLightIdle();
      },
      onFrame(callback) {
        frameCallbacks.add(callback);
        return () => frameCallbacks.delete(callback);
      },
      restore() {
        isBenchmarkWorldRef.current = false;
        activeWorldRef.current = null;
        frameCallbacks.clear();
        playerControlsRef.current?.setFlying(false);
        camera.position.copy(cameraPositionBeforeBenchmark);
        camera.quaternion.copy(cameraQuaternionBeforeBenchmark);
        setPhase("title");
      },
      getSurfaceHeight: (x, z) => getSurfaceHeightFromSeed(seedRef.current, x, z),
    };
  }

  async function runBenchmarkAndSave(options?: BenchmarkOptions) {
    const result = await runBenchmark(createBenchmarkBridge(), options);
    const savedPaths = await saveBenchmarkResult(result);
    console.info("[profiler] benchmark saved", savedPaths);
    return result;
  }

  /** Moves the brush preview and, while a button is held, paints or erases at most one sphere per frame. */
  function updateBrush() {
    const preview = brushPreviewRef.current;
    if (!brushRef.current.enabled || phaseRef.current !== "playing" || !preview) {
      preview?.hide();
      return;
    }
    const brushToken = profiler.begin("main.frame.brush");
    try {
      const stroke = brushStrokeRef.current;
      const action: BrushAction = stroke?.action ?? "erase";
      const hit = castCameraRay(BRUSH_REACH_BLOCKS);
      flushRaycastSteps();
      camera.getWorldDirection(rayDirection);
      const center = brushCenterFor(
        action,
        hit ? { cell: [hit.x, hit.y, hit.z], faceNormal: [hit.normal.x, hit.normal.y, hit.normal.z] } : null,
        camera.position,
        rayDirection,
      );
      const { radius } = brushRef.current;
      preview.show(center, radius, stroke?.action === "erase");
      if (!stroke || !hasDragMovedEnough(stroke.lastCenter, center, radius)) return;
      stroke.lastCenter = center;
      const block = hotbarSlotsRef.current[selectedSlotRef.current] ?? BlockType.STONE;
      applyBrushSphere(center, radius, block, brushModeFor(action, stroke.modifiers));
    } finally {
      profiler.end(brushToken);
    }
  }

  /**
   * Queues one brush sphere as a piece per chunk, nearest to the center first; `applyPendingBrushEdits` runs them
   * under a per-frame budget, so a big sphere never stalls a frame for its whole relight.
   */
  function applyBrushSphere(center: BlockPosition, radius: number, block: number, mode: BrushMode) {
    const pieces = splitBatchByChunk(sphereEdits(center, radius, block, mode), center);
    pendingBrushStrokesRef.current.push({
      pieces,
      startedAtMs: performance.now(),
      meshesApplied: [],
      blocksChanged: 0,
      relightMilliseconds: 0,
      chunksRebuilt: new Set(),
    });
  }

  function applyPendingBrushEdits() {
    const strokes = pendingBrushStrokesRef.current;
    if (strokes.length === 0) return;
    const frameStartedAtMs = performance.now();
    let appliedPieces = 0;
    while (strokes.length > 0 && (appliedPieces === 0 || performance.now() - frameStartedAtMs < BRUSH_FRAME_BUDGET_MS)) {
      const stroke = strokes[0]!;
      const piece = stroke.pieces.shift();
      if (piece) {
        const result = applyBlockEditBatch(piece);
        appliedPieces++;
        if (result) {
          stroke.meshesApplied.push(...result.meshesApplied);
          stroke.blocksChanged += result.stats.blocksChanged;
          stroke.relightMilliseconds +=
            result.stats.millisecondsWritingBlocks + result.stats.millisecondsRemovingLight +
            result.stats.millisecondsRefillingLight + result.stats.millisecondsCollecting;
          for (const chunk of result.chunksToRemesh) stroke.chunksRebuilt.add(`${chunk.x},${chunk.y},${chunk.z}`);
        }
      }
      if (stroke.pieces.length > 0) continue;
      strokes.shift();
      void Promise.all(stroke.meshesApplied).then(() => {
        lastBrushEditRef.current = {
          blocksChanged: stroke.blocksChanged,
          chunksRebuilt: stroke.chunksRebuilt.size,
          relightMilliseconds: stroke.relightMilliseconds,
          onScreenMilliseconds: performance.now() - stroke.startedAtMs,
        };
      });
    }
  }

  let lastPlantDetailUpdateMs = 0;

  const render = () => {
    profiler.beginFrame();
    // stats.begin();
    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    const pipeline = pipelineRef.current;
    if (profiler.enabled && pipeline) {
      const gauges = pipeline.queueGauges();
      profiler.sampleGauge("game.chunks.tracked", gauges.loadedChunks);
      profiler.sampleGauge("queue.chunks.columnGenerations", gauges.queuedColumnGenerations);
      profiler.sampleGauge("queue.chunks.lightings", gauges.queuedLightings);
      profiler.sampleGauge("queue.chunks.meshes", gauges.queuedMeshes);
      profiler.sampleGauge("game.chunks.waitingForMesh", gauges.chunksWaitingForMesh);
    }
    profiler.sampleGauge("game.chunks.meshed", chunkMeshesRef.current.size);
    profiler.sampleGauge("game.remotePlayers", remotePlayers.current.size);
    profiler.sampleGauge("game.water.pendingUpdates", pendingWaterUpdates.current.size);
    profiler.sampleGauge("game.light.pendingEdits", pendingLightEditsRef.current);

    // Update FPS counter
    fpsFrames.current.push(time);
    // Keep only frames from the last second
    while (fpsFrames.current.length > 0 && fpsFrames.current[0] < time - 1000) {
      fpsFrames.current.shift();
    }

    updateIndicator();
    updateBrush();
    applyPendingBrushEdits();

    if (time - lastPlantDetailUpdateMs >= PLANT_DETAIL_UPDATE_INTERVAL_MS) {
      lastPlantDetailUpdateMs = time;
      updatePlantDetail();
    }

    // The debug readout is the only consumer of this state, so nothing re-renders while it is hidden.
    if (
      isDebugVisibleRef.current &&
      Math.floor(time / 100) !== Math.floor(prevTime / 100)
    ) {
      const debugInfoToken = profiler.begin("main.frame.debugInfo");
      const playerChunkX = Math.floor(camera.position.x / CHUNK_WIDTH);
      const playerChunkY = Math.floor(camera.position.y / CHUNK_HEIGHT);
      const playerChunkZ = Math.floor(camera.position.z / CHUNK_LENGTH);

      let lookingAtBlock: { x: number; y: number; z: number } | null = null;
      let blockAtCursor: { type: number; light: number } | null = null;

      if (playerControlsRef.current?.controls.isLocked || playerControlsRef.current?.isMobile) {
        const hit = castCameraRay();
        if (hit) {
          lookingAtBlock = { x: hit.x, y: hit.y, z: hit.z };

          // Light is read from the open block in front of the face that was hit.
          const litX = hit.x + hit.normal.x;
          const litY = hit.y + hit.normal.y;
          const litZ = hit.z + hit.normal.z;
          const rawLight = pipelineRef.current?.getLight(litX, litY, litZ) ?? 0;
          const lightLevel = (rawLight >> 4) & 0xf;
          blockAtCursor = {
            type: getBlock(hit.x, hit.y, hit.z) as number,
            light: lightLevel,
          };
        }
      }

      setDebugInfo({
        fps: fpsFrames.current.length,
        playerPosition: {
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        },
        currentChunk: {
          x: playerChunkX,
          y: playerChunkY,
          z: playerChunkZ,
        },
        loadedChunks: pipelineRef.current?.store.size ?? 0,
        blockAtCursor,
        lookingAt: lookingAtBlock,
        seed: seedRef.current,
      });
      flushRaycastSteps();
      profiler.end(debugInfoToken);
    }

    // document.getElementById("crosshairLayer")!.innerHTML = `Chunks: ${
    //   scene.children.length
    // }<br />Blocks: ${
    //   scene.children.length * CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH
    // }`;

    if (playerControlsRef.current && isSimulationActive()) {
      const playerUpdateToken = profiler.begin("main.frame.playerUpdate");
      playerControlsRef.current.update(delta);
      profiler.end(playerUpdateToken);

      const networkSendToken = profiler.begin("main.frame.networkSend");
      if (networkManager.current.myPeerId) {
        const obj = playerControlsRef.current.controls.object;
        networkManager.current.send({
          type: "PLAYER_UPDATE",
          id: networkManager.current.myPeerId,
          position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
          rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
        });
      }
      profiler.end(networkSendToken);
    }

    if (isSimulationActive()) {
      const remotePlayersToken = profiler.begin("main.frame.remotePlayers");
      remotePlayers.current.forEach((rp) => rp.update(delta));
      profiler.end(remotePlayersToken);
    }

    if (benchmarkFrameCallbacksRef.current.size > 0) {
      const benchmarkToken = profiler.begin("main.frame.benchmarkCallbacks");
      benchmarkFrameCallbacksRef.current.forEach((callback) => callback(delta));
      profiler.end(benchmarkToken);
    }

    prevTime = time;

    profiler.addCounter("game.getBlock.calls", getBlockCallsRef.current);
    getBlockCallsRef.current = 0;

    const sky = skyControllerRef.current;
    if (sky && sky.update(Math.min(delta, 0.1), camera.position)) lodBridgeRef.current?.refreshBackgroundHaze();

    const shadowPass = shadowPassRef.current;
    if (shadowPass) {
      shadowPass.setQuality(gameSettingsRef.current.shadowQuality);
      shadowPass.update(camera);
    }

    const bloomPass = bloomPassRef.current;
    bloomPass?.setEnabled(gameSettingsRef.current.bloomEnabled);
    bloomPass?.beginFrame();

    renderer.clear();
    const drawFarTerrain = () => lodBridgeRef.current?.renderPass(renderer, camera);
    if (profiledRenderRef.current) {
      profiledRenderRef.current.render(drawFarTerrain);
    } else {
      drawFarTerrain();
      renderer.render(scene, camera);
    }
    sky?.cloudPass.render(camera);
    bloomPass?.endFrame();
    // stats.end();
    profiler.endFrame();
  };

  if (gameBodyStartedAtMs !== 0) {
    profiler.recordMainThreadTimer(
      "main.react.gameBody",
      profiler.now() - gameBodyStartedAtMs,
    );
  }

  return (
    <ReactProfiler id="game" onRender={reportReactCommitToProfiler}>
      <div
        className="text-md w-full h-full bg-background"
        ref={containerRef}
        style={{ touchAction: "none" }}
      >
        <UILayer
          onHost={async () => {
            setPeerId(await networkManager.current.hostGame());
          }}
          onJoin={(id) => networkManager.current.joinGame(id)}
          phase={phase}
          loadProgress={loadProgress}
          loadStageLabel={loadStageLabel}
          loadStages={loadStages}
          activeWorldName={activeWorldName}
          worlds={worlds}
          isLoadingWorlds={isLoadingWorlds}
          onPlayWorld={playWorld}
          onCreateWorld={createAndPlayWorld}
          onRenameWorld={renameWorld}
          onDeleteWorld={deleteWorld}
          onJoinHostedWorld={joinHostedWorld}
          onResume={resumePlaying}
          onOpenPauseMenu={openPauseMenu}
          onSaveNow={() => saveActiveWorld(true)}
          onExitToWorlds={exitToWorlds}
          peerId={peerId}
          connectedPlayerCount={connectedPlayerCount}
          isConnectedToHost={connectedToHost}
          selectedSlot={selectedSlot}
          hotbarSlots={hotbarSlots}
          isInventoryOpen={isInventoryOpen}
          onSelectBlock={(block) => {
            const clampedIndex = Math.max(
              0,
              Math.min(selectedSlot, HOTBAR_SIZE - 1),
            );
            const base = normalizeHotbar(hotbarSlots);
            const newSlots = [...base];
            newSlots[clampedIndex] = block;
            setHotbarSlots(newSlots);
          }}
          onSelectSlot={(index) => setSelectedSlot(index)}
          onCloseInventory={() => {
            isInventoryOpenRef.current = false;
            setIsInventoryOpen(false);
            if (!isMobile) playerControlsRef.current?.controls.lock();
          }}
          debugInfo={debugInfo}
          isDebugVisible={isDebugVisible}
          isMobile={isMobile}
          brushRadius={brushHud.enabled ? brushHud.radius : undefined}
          videoSettings={{
            renderDistanceChunks: renderSettingsRef.current.horizontalRadius,
            farTerrainChunks: renderSettingsRef.current.lodRenderDistanceChunks,
            verticalUpChunks: renderSettingsRef.current.verticalUp,
            verticalDownChunks: renderSettingsRef.current.verticalDown,
            volumeShape: renderSettingsRef.current.shape,
          }}
          onVideoSettingsChange={({
            renderDistanceChunks,
            farTerrainChunks,
            verticalUpChunks,
            verticalDownChunks,
            volumeShape,
          }) => {
            const applied = applyRenderSettings({
              ...(renderDistanceChunks !== undefined ? { horizontalRadius: renderDistanceChunks } : {}),
              ...(farTerrainChunks !== undefined ? { lodRenderDistanceChunks: farTerrainChunks } : {}),
              ...(verticalUpChunks !== undefined ? { verticalUp: verticalUpChunks } : {}),
              ...(verticalDownChunks !== undefined ? { verticalDown: verticalDownChunks } : {}),
              ...(volumeShape !== undefined ? { shape: volumeShape } : {}),
            });
            storeRenderSettings(browserStorage(), applied);
          }}
          gameSettings={gameSettings}
          onGameSettingsChange={updateGameSettings}
        />
        {isMobile && phase === "playing" && (
          <MobileControls
            containerRef={containerRef}
            settings={gameSettings}
            enabled={!isInventoryOpen}
            onMovement={(forward, backward, left, right) => {
              playerControlsRef.current?.setMoveState({
                forward,
                backward,
                left,
                right,
              });
            }}
            onCameraRotate={(dx, dy) => {
              playerControlsRef.current?.rotateCamera(dx, dy);
            }}
            onJumpStart={() => {
              playerControlsRef.current?.jump();
            }}
            onJumpEnd={() => {
              playerControlsRef.current?.stopJump();
            }}
            onBreak={() => {
              breakBlock();
            }}
            onPlace={() => {
              const blockType =
                hotbarSlotsRef.current[selectedSlotRef.current];
              if (blockType) placeBlock(blockType);
            }}
            onToggleFly={() => {
              playerControlsRef.current?.toggleFlying();
            }}
            onToggleInventory={() => {
              setIsInventoryOpen((prev) => !prev);
            }}
          />
        )}
      </div>
    </ReactProfiler>
  );
}
