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

import { Sky } from "three/addons/objects/Sky.js";

import {
  CHUNK_HEIGHT,
  CHUNK_LENGTH,
  CHUNK_PRUNING_DISTANCE,
  CHUNK_WIDTH,
  NEGATIVE_X_RENDER_DISTANCE,
  NEGATIVE_Y_RENDER_DISTANCE,
  NEGATIVE_Z_RENDER_DISTANCE,
  POSITIVE_X_RENDER_DISTANCE,
  POSITIVE_Y_RENDER_DISTANCE,
  POSITIVE_Z_RENDER_DISTANCE,
  TEXTURE_SIZE,
} from "./config";
import { WorkerPool, chunkColumnAffinityKey } from "./worker-pool";

import * as THREE from "three";

import {
  BlockType,
  NON_COLLIDABLE_BLOCKS,
  TRANSPARENT_BLOCKS,
  Texture,
  getBlockLightLevel,
  getBoundingBox,
  isReplaceable,
} from "@/applications/game/blocks";
import { BlockHighlighter } from "./block-highlighter";
import { HOTBAR_SIZE, normalizeHotbar } from "./constants";
import { NetworkManager } from "./network/NetworkManager";
import { RemotePlayer } from "./network/RemotePlayer";
import { PhysicsEngine } from "./physics-engine";
import { LoadTracker, type LoadStageStatus } from "./load-progress";
import { PlayerControls } from "./player-controls";
import {
  createChunkSurfaceGeometry,
  createPlantInstanceGeometry,
  plantTemplateVertexCount,
  releaseChunkGeometry,
} from "./chunk-geometry";
import {
  FRAGMENT_SHADER,
  PLANT_VERTEX_SHADER,
  VERTEX_SHADER,
} from "./shaders/chunk";
import { TickableBlockIndex, pickTickedBlocks } from "./random-tick";
import { type BorderFace, extractBorderSlab } from "./chunk-borders";
import {
  type ChunkCoordinate,
  type LightChunkSource,
  relightAfterBlockChange,
} from "./light-engine";
import { LightEditTrace, classifyLightEdit } from "./profiler/light-trace";
import { castVoxelRay } from "./voxel-ray";
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
const RANDOM_TICKS_PER_CHUNK = 100;
// Chunks whose centers are farther than this from the camera draw plants as flat sheets.
const PLANT_VOXEL_DETAIL_DISTANCE = 72;
const PLANT_DETAIL_UPDATE_INTERVAL_MS = 250;

interface PlantDetailMeshes {
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
  const pendingEditStartedAtRef = useRef<Map<string, number>>(new Map());

  // const stats = new Stats();
  // stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
  // document.body.appendChild(stats.dom);
  const containerRef = useRef<HTMLDivElement>(null);

  const seedRef = useRef(Math.floor(Math.random() * 100000000));
  const networkManager = useRef(new NetworkManager());
  const remotePlayers = useRef<Map<string, RemotePlayer>>(new Map());
  const [peerId, setPeerId] = useState<string>("");
  const [connectedToHost, setConnectedToHost] = useState(false);
  const connectedToHostRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const chunkPositions = useRef<
    { chunkX: number; chunkY: number; chunkZ: number }[]
  >([]);
  const chunks = useRef<{ [chunkName: string]: Uint8Array }>({});
  const lightChunks = useRef<{ [chunkName: string]: Uint8Array }>({});
  const chunkVersions = useRef<{ [chunkName: string]: number }>({});
  const modifiedChunks = useRef<Map<string, Map<number, number>>>(new Map());
  const pendingWaterUpdates = useRef<Set<string>>(new Set());
  const generationWorkerPool = useMemo(
    () =>
      new WorkerPool(
        () =>
          new Worker(new URL("./workers/unified-worker.ts", import.meta.url), {
            name: "generation",
          }),
        3,
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
        2,
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
        3,
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

  const scene = useMemo(() => new THREE.Scene(), []);

  const camera = useMemo(
    () =>
      new THREE.PerspectiveCamera(
        85,
        window.innerWidth / window.innerHeight,
        0.1,
        10000,
      ),
    [],
  );

  const resizeObserver = useMemo(
    () =>
      new ResizeObserver(() => {
        if (containerRef.current) {
          const width = containerRef.current.clientWidth || 1;
          const height = containerRef.current.clientHeight || 1;

          if (camera) {
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
          }
          renderer.setSize(width, height);
        }
      }),
    [containerRef, camera, renderer],
  );

  const [selectedSlot, setSelectedSlot] = useState(0);
  const selectedSlotRef = useRef(0);
  const [hotbarSlots, setHotbarSlots] = useState<BlockType[]>(
    normalizeHotbar(DEFAULT_HOTBAR_BLOCKS),
  );
  const hotbarSlotsRef = useRef(hotbarSlots);
  const [isInventoryOpen, setIsInventoryOpen] = useState(false);
  const isInventoryOpenRef = useRef(false);
  const [isDebugVisible, setIsDebugVisible] = useState(false);
  const isDebugVisibleRef = useRef(false);
  const [isMobile, setIsMobile] = useState(false);
  const [phase, setPhaseState] = useState<GamePhase>("title");
  const phaseRef = useRef<GamePhase>("title");
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadStageLabel, setLoadStageLabel] = useState("Starting threads");
  const [loadStages, setLoadStages] = useState<LoadStageStatus[]>([]);
  const loadProgressRef = useRef(0);
  const loadTracker = useMemo(
    () =>
      new LoadTracker(({ progress, label, stages }) => {
        setLoadStages(stages);
        loadProgressRef.current = progress;
        setLoadProgress(progress);
        setLoadStageLabel(label);
        if (progress >= 1) {
          setTimeout(() => {
            if (phaseRef.current === "loading") setPhase("paused");
          }, 150);
        }
      }),
    [],
  );
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

      if (!isInventoryOpen && playerControlsRef.current?.controls.isLocked) {
        const keyNum = parseInt(event.key);
        if (!Number.isNaN(keyNum) && keyNum >= 1 && keyNum <= HOTBAR_SIZE) {
          setSelectedSlot(keyNum - 1);
        }
      }
    };

    const onWheel = (event: WheelEvent) => {
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
  const lightChunkSource: LightChunkSource = {
    getBlocks: (chunkX, chunkY, chunkZ) =>
      chunks.current[generateChunkName(chunkX, chunkY, chunkZ)],
    getLight: (chunkX, chunkY, chunkZ) =>
      lightChunks.current[generateChunkName(chunkX, chunkY, chunkZ)],
  };
  const pendingLightEditsRef = useRef(0);
  const lightIdleResolversRef = useRef<Array<() => void>>([]);
  const queuedMeshRequestsRef = useRef(new Map<string, Promise<void>>());
  const tickableBlocksRef = useRef(new TickableBlockIndex());

  const NEIGHBOR_CHUNK_OFFSETS: {
    key: string;
    dx: number;
    dy: number;
    dz: number;
    borderFacingUs: BorderFace;
  }[] = [
    { key: "-1,0,0", dx: -1, dy: 0, dz: 0, borderFacingUs: "left" },
    { key: "1,0,0", dx: 1, dy: 0, dz: 0, borderFacingUs: "right" },
    { key: "0,1,0", dx: 0, dy: 1, dz: 0, borderFacingUs: "top" },
    { key: "0,-1,0", dx: 0, dy: -1, dz: 0, borderFacingUs: "bottom" },
    { key: "0,0,1", dx: 0, dy: 0, dz: 1, borderFacingUs: "front" },
    { key: "0,0,-1", dx: 0, dy: 0, dz: -1, borderFacingUs: "back" },
  ];

  /** The six face neighbors' blocks and light, which the light spread reads and the worker copies. */
  function gatherNeighborLightInputs(
    chunkX: number,
    chunkY: number,
    chunkZ: number,
  ) {
    const neighbors: { [key: string]: ArrayBuffer | undefined } = {};
    const neighborLights: { [key: string]: ArrayBuffer | undefined } = {};
    for (const { key, dx, dy, dz } of NEIGHBOR_CHUNK_OFFSETS) {
      const name = generateChunkName(chunkX + dx, chunkY + dy, chunkZ + dz);
      neighbors[key] = chunks.current[name]?.buffer as ArrayBuffer | undefined;
      neighborLights[key] = lightChunks.current[name]?.buffer as
        | ArrayBuffer
        | undefined;
    }
    return { neighbors, neighborLights };
  }

  /**
   * A chunk where every open cell already has full sky light can only gain block
   * light, and only from a neighbor that has some next to it. With none, spreading
   * light through the chunk changes nothing, so the whole worker round trip is skipped.
   */
  function canSkipLightSpread(
    chunkX: number,
    chunkY: number,
    chunkZ: number,
  ): boolean {
    for (const { dx, dy, dz, borderFacingUs } of NEIGHBOR_CHUNK_OFFSETS) {
      const neighborLight =
        lightChunks.current[
          generateChunkName(chunkX + dx, chunkY + dy, chunkZ + dz)
        ];
      if (!neighborLight) continue;
      const border = new Uint8Array(extractBorderSlab(neighborLight, borderFacingUs));
      for (let index = 0; index < border.length; index++) {
        if ((border[index] & 0xf) !== 0) return false;
      }
    }
    return true;
  }

  function startWorldGeneration(currentSeed: number) {
    if (intervalRef.current) clearInterval(intervalRef.current);

    // Clear chunks
    Object.keys(chunks.current).forEach((key) => pruneChunkMesh(key));
    chunks.current = {};
    lightChunks.current = {};
    chunkPositions.current = [];

    loadTracker.resetWorldStages();
    const loadStartedAtMs = profiler.now();

    let initialLoadTasks =
      (POSITIVE_X_RENDER_DISTANCE + NEGATIVE_X_RENDER_DISTANCE) *
      (POSITIVE_Y_RENDER_DISTANCE + NEGATIVE_Y_RENDER_DISTANCE) *
      (POSITIVE_Z_RENDER_DISTANCE + NEGATIVE_Z_RENDER_DISTANCE);

    let tasksDone = 0;
    let chunksGenerated = 0;
    let chunksLit = 0;
    let chunksSpread = 0;

    const chunksToGenerate: { x: number; y: number; z: number }[] = [];

    const spawnPosition = playerControlsRef.current?.controls.object.position;
    const centerChunkX = Math.round((spawnPosition?.x ?? 0) / CHUNK_WIDTH);
    const centerChunkY = Math.round((spawnPosition?.y ?? 0) / CHUNK_HEIGHT);
    const centerChunkZ = Math.round((spawnPosition?.z ?? 0) / CHUNK_LENGTH);

    for (
      let chunkX = centerChunkX - NEGATIVE_X_RENDER_DISTANCE;
      chunkX < centerChunkX + POSITIVE_X_RENDER_DISTANCE;
      chunkX++
    ) {
      for (
        let chunkY = centerChunkY + POSITIVE_Y_RENDER_DISTANCE;
        chunkY > centerChunkY - NEGATIVE_Y_RENDER_DISTANCE;
        chunkY--
      ) {
        for (
          let chunkZ = centerChunkZ - NEGATIVE_Z_RENDER_DISTANCE;
          chunkZ < centerChunkZ + POSITIVE_Z_RENDER_DISTANCE;
          chunkZ++
        ) {
          chunksToGenerate.push({ x: chunkX, y: chunkY, z: chunkZ });
          chunkPositions.current.push({ chunkX, chunkY, chunkZ });
        }
      }
    }

    // 1. Generate Blocks
    Promise.all(
      chunksToGenerate.map(async ({ x, y, z }) => {
        const result = await generationWorkerPool.exec(
          "generateChunk",
          [currentSeed, x, y, z],
          undefined,
          { affinityKey: chunkColumnAffinityKey(x, z) },
        );
        const chunk = new Uint8Array(result);
        const chunkName = generateChunkName(x, y, z);
        chunks.current[chunkName] = chunk;

        if (modifiedChunks.current.has(chunkName)) {
          modifiedChunks.current.get(chunkName)!.forEach((type, index) => {
            chunk[index] = type;
          });
        }

        profiler.recordTimer(
          "chunk.pipeline.generate",
          profiler.now() - loadStartedAtMs,
          "latency",
        );
        profiler.addCounter("game.chunks.generated");
        chunksGenerated++;
        loadTracker.report("terrain", chunksGenerated / initialLoadTasks);
      }),
    ).then(async () => {
      profiler.recordTimer(
        "chunk.load.terrain",
        profiler.now() - loadStartedAtMs,
        "latency",
      );
      const lightingStartedAtMs = profiler.now();
      // 2. Initialize Light
      const queues: { [key: string]: Uint32Array } = {};
      const fullySunlitChunks = new Set<string>();

      // A chunk's sky light comes from the chunk above it, so each column of chunks is
      // lit top-down. Columns are independent of each other and run side by side.
      const chunkColumns = new Map<string, { x: number; y: number; z: number }[]>();
      chunksToGenerate.forEach((chunkPosition) => {
        const columnKey = `${chunkPosition.x},${chunkPosition.z}`;
        chunkColumns.set(columnKey, [
          ...(chunkColumns.get(columnKey) ?? []),
          chunkPosition,
        ]);
      });

      await Promise.all(
        Array.from(chunkColumns.values()).map(async (column) => {
          const topDown = [...column].sort((first, second) => second.y - first.y);
          for (const { x, y, z } of topDown) {
            const chunkName = generateChunkName(x, y, z);
            const chunk = chunks.current[chunkName];

            const topChunkName = generateChunkName(x, y + 1, z);
            const topChunk = chunks.current[topChunkName]?.buffer;
            const topChunkLight = lightChunks.current[topChunkName]?.buffer;

            const { light, queue, isFullySunlit } = await lightingWorkerPool.exec(
              "initializeChunkLight",
              [chunk.buffer, currentSeed, x, y, z, topChunk, topChunkLight],
            );
            lightChunks.current[chunkName] = light;
            queues[chunkName] = queue;
            if (isFullySunlit) fullySunlitChunks.add(chunkName);

            profiler.recordTimer(
              "chunk.pipeline.initLight",
              profiler.now() - lightingStartedAtMs,
              "latency",
            );
            chunksLit++;
            loadTracker.report("lighting", chunksLit / initialLoadTasks);
          }
        }),
      );

      profiler.recordTimer(
        "chunk.load.lighting",
        profiler.now() - lightingStartedAtMs,
        "latency",
      );
      const lightSpreadStartedAtMs = profiler.now();
      // 3. Propagate Light
      const lightUpdates: { [key: string]: Uint8Array[] } = {};

      await Promise.all(
        chunksToGenerate.map(async ({ x, y, z }) => {
          const chunkName = generateChunkName(x, y, z);
          const light = lightChunks.current[chunkName];
          const chunk = chunks.current[chunkName];
          const queue = queues[chunkName];

          const { centerLight, neighborLightUpdates } =
            fullySunlitChunks.has(chunkName) && canSkipLightSpread(x, y, z)
              ? { centerLight: light, neighborLightUpdates: {} }
              : await lightingWorkerPool.exec("propagateChunkLight", [
                  chunk.buffer,
                  light.buffer,
                  ...Object.values(gatherNeighborLightInputs(x, y, z)),
                  queue,
                ]);

          if (!lightUpdates[chunkName]) lightUpdates[chunkName] = [];
          lightUpdates[chunkName].push(centerLight);

          profiler.recordTimer(
            "chunk.pipeline.propagateLight",
            profiler.now() - lightSpreadStartedAtMs,
            "latency",
          );
          chunksSpread++;
          loadTracker.report("light-spread", chunksSpread / initialLoadTasks);

          Object.entries(neighborLightUpdates).forEach(([key, update]) => {
            const [dx, dy, dz] = key.split(",").map(Number);
            const neighborName = generateChunkName(x + dx, y + dy, z + dz);
            if (!lightUpdates[neighborName]) lightUpdates[neighborName] = [];
            lightUpdates[neighborName].push(update as Uint8Array);
          });
        }),
      );

      profiler.recordTimer(
        "chunk.load.lightSpread",
        profiler.now() - lightSpreadStartedAtMs,
        "latency",
      );
      // Merge updates
      const mergeInitialToken = profiler.begin("main.light.mergeInitial");
      Object.keys(lightUpdates).forEach((chunkName) => {
        const updates = lightUpdates[chunkName];
        if (updates.length === 0) return;

        const merged = new Uint8Array(updates[0]);
        for (let i = 1; i < updates.length; i++) {
          const update = updates[i];
          for (let j = 0; j < merged.length; j++) {
            merged[j] = Math.max(merged[j], update[j]);
          }
        }
        lightChunks.current[chunkName] = merged;
      });
      profiler.end(mergeInitialToken);

      const meshingStartedAtMs = profiler.now();
      // 4. Generate Mesh
      chunksToGenerate.forEach(({ x, y, z }) => {
        const chunkName = generateChunkName(x, y, z);
        const chunk = chunks.current[chunkName];
        const light = lightChunks.current[chunkName];

        if (!light) return;

        const { borders, borderLights } = getChunkBorders(x, y, z);

        meshWorkerPool
          .exec("generateMesh", [
            chunk.buffer,
            light.buffer,
            borders,
            borderLights,
            currentSeed,
            x,
            y,
            z,
          ])
          .then(
            (meshResult: ChunkMeshResult | null) => {
              if (!meshResult) return;
              addChunkMesh(meshResult, chunkName, x, y, z);

              profiler.recordTimer(
                "chunk.pipeline.mesh",
                profiler.now() - meshingStartedAtMs,
                "latency",
              );
              profiler.recordTimer(
                "chunk.pipeline.total",
                profiler.now() - loadStartedAtMs,
                "latency",
              );
              tasksDone++;

              loadTracker.report("meshing", tasksDone / initialLoadTasks);
              if (tasksDone >= initialLoadTasks) {
                profiler.recordTimer(
                  "chunk.load.meshing",
                  profiler.now() - meshingStartedAtMs,
                  "latency",
                );
                profiler.recordTimer(
                  "chunk.load.total",
                  profiler.now() - loadStartedAtMs,
                  "latency",
                );
                loadTracker.finish();
              }
            },
          )
          .catch((err) => {
            console.error(err);
          });
      });
    });

    intervalRef.current = setInterval(() => {
      const streamingToken = profiler.begin("main.interval.chunkStreaming");
      const playerChunkX = Math.round(camera.position.x / CHUNK_WIDTH);
      const playerChunkY = Math.round(camera.position.y / CHUNK_HEIGHT);
      const playerChunkZ = Math.round(camera.position.z / CHUNK_LENGTH);

      pruneChunks(playerChunkX, playerChunkY, playerChunkZ);

      generateNearbyChunks(playerChunkX, playerChunkY, playerChunkZ);
      profiler.end(streamingToken);
    }, 500);
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

      const sky = new Sky();
      sky.name = "sky";
      sky.scale.setScalar(450000);

      const phi = THREE.MathUtils.degToRad(90);
      const theta = THREE.MathUtils.degToRad(180);
      const sunPosition = new THREE.Vector3().setFromSphericalCoords(
        1,
        phi,
        theta,
      );

      sky.material.uniforms.sunPosition.value = sunPosition;

      scene.add(sky);

      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      containerRef.current.appendChild(renderer.domElement);

      profiledRenderRef.current = createProfiledRender(renderer, scene, camera);
      const unmountProfilerOverlay = mountProfilerOverlay({
        runBenchmark: (options?: BenchmarkOptions) =>
          runBenchmark(createBenchmarkBridge(), options),
      });
      const uninstallBrowserObservers = installBrowserObservers(profiler);
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
          renderDistanceChunksX:
            POSITIVE_X_RENDER_DISTANCE + NEGATIVE_X_RENDER_DISTANCE,
          renderDistanceChunksY:
            POSITIVE_Y_RENDER_DISTANCE + NEGATIVE_Y_RENDER_DISTANCE,
          renderDistanceChunksZ:
            POSITIVE_Z_RENDER_DISTANCE + NEGATIVE_Z_RENDER_DISTANCE,
          chunkPruningDistance: CHUNK_PRUNING_DISTANCE,
          generationWorkers: 3,
          lightingWorkers: 2,
          meshWorkers: 3,
          textureCount: Object.values(Texture).length,
        },
      });
      const removeSceneMemorySampler = profiler.addSampler(() =>
        sampleSceneMemory({
          getScene: () => scene,
          getChunks: () => chunks.current,
          getLightChunks: () => lightChunks.current,
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

      for (
        let chunkX = -NEGATIVE_X_RENDER_DISTANCE;
        chunkX < POSITIVE_X_RENDER_DISTANCE;
        chunkX++
      ) {
        for (
          let chunkY = POSITIVE_Y_RENDER_DISTANCE;
          chunkY > -NEGATIVE_Y_RENDER_DISTANCE;
          chunkY--
        ) {
          for (
            let chunkZ = -NEGATIVE_Z_RENDER_DISTANCE;
            chunkZ < POSITIVE_Z_RENDER_DISTANCE;
            chunkZ++
          ) {
            chunkPositions.current.push({ chunkX, chunkY, chunkZ });
          }
        }
      }

      const bootWorkerPools = [
        generationWorkerPool,
        lightingWorkerPool,
        meshWorkerPool,
        textureArrayWorkerPool,
      ];
      const totalBootWorkers = 3 + 2 + 3 + 1;
      let bootWorkersReady = 0;
      bootWorkerPools.forEach((pool) =>
        pool.warmUp(() => {
          bootWorkersReady++;
          loadTracker.report("threads", bootWorkersReady / totalBootWorkers);
        }),
      );

      textureArrayWorkerPool
        .exec("loadTextureArray", [window.location.origin], (fraction) =>
          loadTracker.report("textures", fraction * 0.9),
        )
        .then((result) => {
          if (result) {
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

            materialsRef.current.opaque = new THREE.ShaderMaterial({
              uniforms: {
                Texture: {
                  value: textureArray,
                },
                waterTextureIndex: {
                  value: waterTextureIndex,
                },
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
              },
              vertexShader: PLANT_VERTEX_SHADER,
              fragmentShader: FRAGMENT_SHADER,
              blending: THREE.NormalBlending,
              blendSrcAlpha: THREE.OneFactor,
              transparent: false,
              depthWrite: true,
            });

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
        if (!playerControlsRef.current?.controls.isLocked) return;
        if (event.button === 0) {
          breakBlock();
        } else if (event.button === 2) {
          const blockType = hotbarSlotsRef.current[selectedSlotRef.current];
          if (blockType) {
            placeBlock(blockType);
          }
        }
      };

      const container = containerRef.current;
      container.addEventListener("contextmenu", onContextMenu);
      container.addEventListener("mousedown", onMouseDown);

      // document.addEventListener("keydown", onKeyDown);
      document.addEventListener("keyup", onKeyUp);

      const nm = networkManager.current;

      nm.onPlayerJoin = (id) => {
        console.log("Player joined:", id);
        // Send handshake
        nm.send(
          {
            type: "HANDSHAKE",
            seed: seedRef.current,
            initialPosition: { x: 0, y: 100, z: 0 },
          },
          id,
        );

        const blocks: { x: number; y: number; z: number; blockType: number }[] =
          [];
        modifiedChunks.current.forEach((modifications, chunkName) => {
          const [cx, cy, cz] = chunkName.split(",").map(Number);
          modifications.forEach((type, index) => {
            const z = index % CHUNK_HEIGHT;
            const y = Math.floor(index / CHUNK_HEIGHT) % CHUNK_WIDTH;
            const x = Math.floor(
              Math.floor(index / CHUNK_HEIGHT) / CHUNK_WIDTH,
            );

            const globalX = cx * CHUNK_WIDTH + x;
            const globalY = cy * CHUNK_HEIGHT + y;
            const globalZ = cz * CHUNK_LENGTH + z;

            blocks.push({
              x: globalX,
              y: globalY,
              z: globalZ,
              blockType: type,
            });
          });
        });

        if (blocks.length > 0) {
          nm.send(
            {
              type: "WORLD_STATE",
              blocks,
            },
            id,
          );
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
        } else if (data.type === "WORLD_STATE") {
          profiler.addCounter("game.network.worldStateBlocks", data.blocks.length);
          const applyWorldStateToken = profiler.begin(
            "main.network.applyWorldState",
          );
          const chunksToUpdate = new Set<string>();
          data.blocks.forEach((b) => {
            const chunkX = Math.floor(b.x / CHUNK_WIDTH);
            const chunkY = Math.floor(b.y / CHUNK_HEIGHT);
            const chunkZ = Math.floor(b.z / CHUNK_LENGTH);
            const chunkName = generateChunkName(chunkX, chunkY, chunkZ);
            const blockChunkX = b.x - chunkX * CHUNK_WIDTH;
            const blockChunkY = b.y - chunkY * CHUNK_HEIGHT;
            const blockChunkZ = b.z - chunkZ * CHUNK_LENGTH;
            const index = calculateOffset(
              blockChunkX,
              blockChunkY,
              blockChunkZ,
            );

            if (!modifiedChunks.current.has(chunkName)) {
              modifiedChunks.current.set(chunkName, new Map());
            }
            modifiedChunks.current.get(chunkName)!.set(index, b.blockType);

            if (chunks.current[chunkName]) {
              const previousBlock = chunks.current[chunkName][index];
              chunks.current[chunkName][index] = b.blockType;
              chunksToUpdate.add(chunkName);
              relightAfterBlockChange(
                lightChunkSource,
                b.x,
                b.y,
                b.z,
                previousBlock,
              ).chunksToRemesh.forEach((chunk) =>
                chunksToUpdate.add(generateChunkName(chunk.x, chunk.y, chunk.z)),
              );

              if (blockChunkX === 0)
                chunksToUpdate.add(
                  generateChunkName(chunkX - 1, chunkY, chunkZ),
                );
              if (blockChunkX === CHUNK_WIDTH - 1)
                chunksToUpdate.add(
                  generateChunkName(chunkX + 1, chunkY, chunkZ),
                );
              if (blockChunkY === 0)
                chunksToUpdate.add(
                  generateChunkName(chunkX, chunkY - 1, chunkZ),
                );
              if (blockChunkY === CHUNK_HEIGHT - 1)
                chunksToUpdate.add(
                  generateChunkName(chunkX, chunkY + 1, chunkZ),
                );
              if (blockChunkZ === 0)
                chunksToUpdate.add(
                  generateChunkName(chunkX, chunkY, chunkZ - 1),
                );
              if (blockChunkZ === CHUNK_LENGTH - 1)
                chunksToUpdate.add(
                  generateChunkName(chunkX, chunkY, chunkZ + 1),
                );
            }
          });

          chunksToUpdate.forEach((chunkName) => {
            const [cx, cy, cz] = chunkName.split(",").map(Number);
            if (!chunkVersions.current[chunkName])
              chunkVersions.current[chunkName] = 0;
            chunkVersions.current[chunkName]++;
            regenerateChunkMesh(cx, cy, cz);
          });
          profiler.end(applyWorldStateToken);
        }

        if (nm.isHost && data.type !== "HANDSHAKE") {
          nm.broadcast(data, senderId);
        }
        profiler.end(handlePacketToken);
      };

      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);

        document.removeEventListener("keyup", onKeyUp);
        if (container) {
          container.removeEventListener("contextmenu", onContextMenu);
          container.removeEventListener("mousedown", onMouseDown);
        }

        nm.disconnect();

        profiledRenderRef.current?.dispose();
        profiledRenderRef.current = null;
        removeSceneMemorySampler();
        stopCalibrationListener();
        uninstallBrowserObservers();
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

  function addChunkToQueue(chunkX: number, chunkY: number, chunkZ: number) {
    chunkPositions.current.push({ chunkX, chunkY, chunkZ });
    const requestedAtMs = profiler.now();

    generationWorkerPool
      .exec(
        "generateChunk",
        [seedRef.current, chunkX, chunkY, chunkZ],
        undefined,
        { affinityKey: chunkColumnAffinityKey(chunkX, chunkZ) },
      )
      .then(async (result: ArrayBuffer) => {
        const generatedAtMs = profiler.now();
        profiler.recordTimer(
          "chunk.pipeline.generate",
          generatedAtMs - requestedAtMs,
          "latency",
        );
        profiler.addCounter("game.chunks.generated");
        const chunk = new Uint8Array(result);
        const chunkName = generateChunkName(chunkX, chunkY, chunkZ);
        chunks.current[chunkName] = chunk;

        if (modifiedChunks.current.has(chunkName)) {
          modifiedChunks.current.get(chunkName)!.forEach((type, index) => {
            chunk[index] = type;
          });
        }

        // Initialize Light
        const topChunkName = generateChunkName(chunkX, chunkY + 1, chunkZ);
        const topChunk = chunks.current[topChunkName]?.buffer;
        const topChunkLight = lightChunks.current[topChunkName]?.buffer;

        const { light, queue, isFullySunlit } = await lightingWorkerPool.exec(
          "initializeChunkLight",
          [
            chunk.buffer,
            seedRef.current,
            chunkX,
            chunkY,
            chunkZ,
            topChunk,
            topChunkLight,
          ],
        );
        lightChunks.current[chunkName] = light;
        const lightInitializedAtMs = profiler.now();
        profiler.recordTimer(
          "chunk.pipeline.initLight",
          lightInitializedAtMs - generatedAtMs,
          "latency",
        );

        // Propagate Light
        const { centerLight, neighborLightUpdates } =
          isFullySunlit && canSkipLightSpread(chunkX, chunkY, chunkZ)
            ? { centerLight: lightChunks.current[chunkName], neighborLightUpdates: {} }
            : await lightingWorkerPool.exec("propagateChunkLight", [
                chunk.buffer,
                lightChunks.current[chunkName].buffer,
                ...Object.values(
                  gatherNeighborLightInputs(chunkX, chunkY, chunkZ),
                ),
                queue,
              ]);
        lightChunks.current[chunkName] = centerLight;
        profiler.recordTimer(
          "chunk.pipeline.propagateLight",
          profiler.now() - lightInitializedAtMs,
          "latency",
        );

        // Apply neighbor updates
        const mergeNeighborToken = profiler.begin("main.light.mergeNeighbor");
        Object.entries(neighborLightUpdates).forEach(([key, update]) => {
          const [dx, dy, dz] = key.split(",").map(Number);
          const neighborName = generateChunkName(
            chunkX + dx,
            chunkY + dy,
            chunkZ + dz,
          );
          if (lightChunks.current[neighborName]) {
            const current = lightChunks.current[neighborName];
            const u = update as Uint8Array;
            for (let i = 0; i < current.length; i++) {
              current[i] = Math.max(current[i], u[i]);
            }
          }
        });
        profiler.end(mergeNeighborToken);

        const adjChunks = {
          left: chunks.current[generateChunkName(chunkX - 1, chunkY, chunkZ)],
          right: chunks.current[generateChunkName(chunkX + 1, chunkY, chunkZ)],
          bottom: chunks.current[generateChunkName(chunkX, chunkY - 1, chunkZ)],
          top: chunks.current[generateChunkName(chunkX, chunkY + 1, chunkZ)],
          back: chunks.current[generateChunkName(chunkX, chunkY, chunkZ - 1)],
          front: chunks.current[generateChunkName(chunkX, chunkY, chunkZ + 1)],
        };

        if (adjChunks.left) regenerateChunkMesh(chunkX - 1, chunkY, chunkZ);
        if (adjChunks.right) regenerateChunkMesh(chunkX + 1, chunkY, chunkZ);
        if (adjChunks.bottom) regenerateChunkMesh(chunkX, chunkY - 1, chunkZ);
        if (adjChunks.top) regenerateChunkMesh(chunkX, chunkY + 1, chunkZ);
        if (adjChunks.back) regenerateChunkMesh(chunkX, chunkY, chunkZ - 1);
        if (adjChunks.front) regenerateChunkMesh(chunkX, chunkY, chunkZ + 1);

        const { borders, borderLights } = getChunkBorders(
          chunkX,
          chunkY,
          chunkZ,
        );

        const meshStartedAtMs = profiler.now();
        meshWorkerPool
          .exec("generateMesh", [
            result,
            lightChunks.current[chunkName].buffer,
            borders,
            borderLights,
            seedRef.current,
            chunkX,
            chunkY,
            chunkZ,
          ])
          .then(
            (meshResult: ChunkMeshResult | null) => {
              if (!meshResult) return;
              addChunkMesh(meshResult, chunkName,
                chunkX,
                chunkY,
                chunkZ,
              );
              profiler.recordTimer(
                "chunk.pipeline.mesh",
                profiler.now() - meshStartedAtMs,
                "latency",
              );
              profiler.recordTimer(
                "chunk.pipeline.total",
                profiler.now() - requestedAtMs,
                "latency",
              );
            },
          )
          .catch((err) => {
            console.error(err);
          });
      })
      .catch((err) => {
        console.error(err);
      });
  }

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

  function castCameraRay(): VoxelRayHit | null {
    camera.getWorldDirection(rayDirection);
    const hit = castVoxelRay(
      [camera.position.x, camera.position.y, camera.position.z],
      [rayDirection.x, rayDirection.y, rayDirection.z],
      (x, y, z) => {
        const block = getBlock(x, y, z);
        return block !== null && block !== BlockType.AIR;
      },
      MAX_REACH_IN_BLOCKS,
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
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.frustumCulled = true;
    mesh.name = name;
    mesh.renderOrder = renderOrder;
    const sceneAddToken = profiler.begin("main.chunk.sceneAdd");
    scene.add(mesh);
    profiler.end(sceneAddToken);
    return mesh;
  }

  function applyPlantDetail(plantDetail: PlantDetailMeshes) {
    const isNear =
      plantDetail.center.distanceTo(camera.position) <= PLANT_VOXEL_DETAIL_DISTANCE;
    for (const mesh of plantDetail.voxel) mesh.visible = isNear;
    for (const mesh of plantDetail.billboard) mesh.visible = !isNear;
  }

  function updatePlantDetail() {
    plantDetailRef.current.forEach(applyPlantDetail);
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
      meshes.push(
        placeChunkMesh(opaqueGeometry, opaque, chunkName, 0, chunkX, chunkY, chunkZ),
      );
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
    const chunkX = Math.floor(x / CHUNK_WIDTH);
    const chunkY = Math.floor(y / CHUNK_HEIGHT);
    const chunkZ = Math.floor(z / CHUNK_LENGTH);

    const chunkName = generateChunkName(chunkX, chunkY, chunkZ);
    const chunk = chunks.current[chunkName];

    if (!chunk) return null;

    const blockChunkX = x - chunkX * CHUNK_WIDTH;
    const blockChunkY = y - chunkY * CHUNK_HEIGHT;
    const blockChunkZ = z - chunkZ * CHUNK_LENGTH;

    return chunk[calculateOffset(blockChunkX, blockChunkY, blockChunkZ)];
  }

  function scheduleWaterUpdate(x: number, y: number, z: number) {
    pendingWaterUpdates.current.add(`${x},${y},${z}`);
  }

  useEffect(() => {
    const interval = setInterval(() => {
      if (!isSimulationActive()) return;
      if (pendingWaterUpdates.current.size === 0) return;

      const waterToken = profiler.begin("main.interval.water");
      const updates = Array.from(pendingWaterUpdates.current);
      pendingWaterUpdates.current.clear();

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
    profiler.addCounter("game.setBlock.calls");
    const scopeToken = profiler.begin("main.edit.setBlock");
    try {
      return setBlockUnprofiled(x, y, z, type, broadcast);
    } finally {
      profiler.end(scopeToken);
    }
  }

  function setBlockUnprofiled(
    x: number,
    y: number,
    z: number,
    type: number,
    broadcast: boolean = true,
  ) {
    const chunkX = Math.floor(x / CHUNK_WIDTH);
    const chunkY = Math.floor(y / CHUNK_HEIGHT);
    const chunkZ = Math.floor(z / CHUNK_LENGTH);

    const chunkName = generateChunkName(chunkX, chunkY, chunkZ);

    const blockChunkX = x - chunkX * CHUNK_WIDTH;
    const blockChunkY = y - chunkY * CHUNK_HEIGHT;
    const blockChunkZ = z - chunkZ * CHUNK_LENGTH;

    const blockIndex = calculateOffset(blockChunkX, blockChunkY, blockChunkZ);

    if (!modifiedChunks.current.has(chunkName)) {
      modifiedChunks.current.set(chunkName, new Map());
    }
    modifiedChunks.current.get(chunkName)!.set(blockIndex, type);

    const chunk = chunks.current[chunkName];

    if (!chunk) return BlockType.AIR;
    if (profiler.enabled) {
      pendingEditStartedAtRef.current.set(chunkName, profiler.now());
    }

    // Get old block before modifying for light change detection
    const oldBlock = chunk[blockIndex];

    chunk[blockIndex] = type;

    scheduleWaterUpdate(x, y, z);
    scheduleWaterUpdate(x + 1, y, z);
    scheduleWaterUpdate(x - 1, y, z);
    scheduleWaterUpdate(x, y + 1, z);
    scheduleWaterUpdate(x, y - 1, z);
    scheduleWaterUpdate(x, y, z + 1);
    scheduleWaterUpdate(x, y, z - 1);

    if (!chunkVersions.current[chunkName]) chunkVersions.current[chunkName] = 0;
    chunkVersions.current[chunkName]++;

    // Light is patched in place around the edit, then only the chunks it touched are re-meshed.
    const trace = new LightEditTrace(
      profiler,
      classifyLightEdit(
        getBlockLightLevel(oldBlock),
        getBlockLightLevel(type),
        type === BlockType.AIR,
      ),
    );
    pendingLightEditsRef.current++;
    (async () => {
      try {
        const relight = await trace.stage("relight", () => {
          const relightToken = profiler.begin("main.light.relight");
          try {
            return relightAfterBlockChange(
              lightChunkSource,
              x,
              y,
              z,
              oldBlock,
            );
          } finally {
            profiler.end(relightToken);
          }
        });
        trace.markRelit();
        trace.count("cellsRemoved", relight.stats.cellsRemoved);
        trace.count("cellsLit", relight.stats.cellsLit);
        trace.count("cellsVisited", relight.stats.cellsVisited);
        trace.count("chunksRelit", relight.chunksToRemesh.length);
        profiler.addCounter("game.light.cellsVisited", relight.stats.cellsVisited);

        // The edited chunk goes first so the change shows up as soon as possible.
        const chunksToRemesh = new Map<string, ChunkCoordinate>();
        const requestRemesh = (chunk: ChunkCoordinate) =>
          chunksToRemesh.set(generateChunkName(chunk.x, chunk.y, chunk.z), chunk);
        requestRemesh({ x: chunkX, y: chunkY, z: chunkZ });
        // Block data next to a chunk edge is part of the neighbor's mesh too.
        if (blockChunkX === 0) requestRemesh({ x: chunkX - 1, y: chunkY, z: chunkZ });
        if (blockChunkX === CHUNK_WIDTH - 1)
          requestRemesh({ x: chunkX + 1, y: chunkY, z: chunkZ });
        if (blockChunkY === 0) requestRemesh({ x: chunkX, y: chunkY - 1, z: chunkZ });
        if (blockChunkY === CHUNK_HEIGHT - 1)
          requestRemesh({ x: chunkX, y: chunkY + 1, z: chunkZ });
        if (blockChunkZ === 0) requestRemesh({ x: chunkX, y: chunkY, z: chunkZ - 1 });
        if (blockChunkZ === CHUNK_LENGTH - 1)
          requestRemesh({ x: chunkX, y: chunkY, z: chunkZ + 1 });
        relight.chunksToRemesh.forEach(requestRemesh);

        await trace.stage("queueMeshes", () => {
          chunksToRemesh.forEach((chunk) =>
            trace.trackMesh(regenerateChunkMesh(chunk.x, chunk.y, chunk.z)),
          );
        });
        await trace.finish();
      } finally {
        pendingLightEditsRef.current--;
        if (pendingLightEditsRef.current === 0) {
          lightIdleResolversRef.current.splice(0).forEach((resolve) => resolve());
        }
      }
    })();

    if (broadcast && networkManager.current.myPeerId) {
      networkManager.current.send({
        type: "BLOCK_UPDATE",
        x,
        y,
        z,
        blockType: type,
      });
    }
  }

  function getChunkBorders(chunkX: number, chunkY: number, chunkZ: number) {
    const extractBordersToken = profiler.begin("main.chunk.extractBorders");
    const borders: { [face in BorderFace]?: ArrayBuffer } = {};
    const borderLights: { [face in BorderFace]?: ArrayBuffer } = {};

    const extractBorder = (
      neighborX: number,
      neighborY: number,
      neighborZ: number,
      face: BorderFace,
    ) => {
      const name = generateChunkName(neighborX, neighborY, neighborZ);
      const chunk = chunks.current[name];
      const light = lightChunks.current[name];
      if (chunk) borders[face] = extractBorderSlab(chunk, face);
      if (light) borderLights[face] = extractBorderSlab(light, face);
    };

    extractBorder(chunkX, chunkY + 1, chunkZ, "top");
    extractBorder(chunkX, chunkY - 1, chunkZ, "bottom");
    extractBorder(chunkX, chunkY, chunkZ + 1, "front");
    extractBorder(chunkX, chunkY, chunkZ - 1, "back");
    extractBorder(chunkX + 1, chunkY, chunkZ, "right");
    extractBorder(chunkX - 1, chunkY, chunkZ, "left");

    profiler.end(extractBordersToken);
    if (profiler.enabled) {
      profiler.recordBytes(
        "bytes.borders.perMesh",
        estimateTransferBytes([borders, borderLights]),
      );
    }
    return { borders, borderLights };
  }

  function collectBorderBuffers(
    ...borderGroups: { [face: string]: ArrayBuffer | undefined }[]
  ): ArrayBuffer[] {
    return borderGroups.flatMap((group) =>
      Object.values(group).filter((buffer): buffer is ArrayBuffer => !!buffer),
    );
  }

  // Several neighbors finishing in a row each ask for a re-mesh of the same chunk.
  // Only one request waits per chunk, and it reads the newest data when a worker is free.
  function regenerateChunkMesh(
    chunkX: number,
    chunkY: number,
    chunkZ: number,
  ): Promise<void> {
    if (!materialsRef.current.opaque || !materialsRef.current.transparent)
      return Promise.resolve();
    const chunkName = generateChunkName(chunkX, chunkY, chunkZ);
    if (!lightChunks.current[chunkName]) return Promise.resolve();
    const alreadyQueued = queuedMeshRequestsRef.current.get(chunkName);
    if (alreadyQueued) {
      profiler.addCounter("game.mesh.regenerationsMerged");
      return alreadyQueued;
    }
    profiler.addCounter("game.mesh.regenerations");

    let hasBeenDispatched = false;
    let versionAtDispatch = chunkVersions.current[chunkName];
    const meshApplied: Promise<void> = meshWorkerPool
      .execLazy("generateMesh", () => {
        hasBeenDispatched = true;
        queuedMeshRequestsRef.current.delete(chunkName);
        const chunk = chunks.current[chunkName];
        const light = lightChunks.current[chunkName];
        if (!chunk || !light) return null;

        versionAtDispatch = chunkVersions.current[chunkName];
        const regenerateToken = profiler.begin("main.chunk.regenerateBookkeeping");
        const { borders, borderLights } = getChunkBorders(chunkX, chunkY, chunkZ);
        profiler.end(regenerateToken);
        return {
          params: [
            chunk,
            light.buffer,
            borders,
            borderLights,
            seedRef.current,
            chunkX,
            chunkY,
            chunkZ,
          ],
          transfer: collectBorderBuffers(borders, borderLights),
        };
      })
      .then((meshResult: ChunkMeshResult | null) => {
        if (!meshResult) return;
        if (chunkVersions.current[chunkName] !== versionAtDispatch) return;
        addChunkMesh(meshResult, chunkName, chunkX, chunkY, chunkZ);
        const editStartedAtMs = pendingEditStartedAtRef.current.get(chunkName);
        if (editStartedAtMs !== undefined) {
          pendingEditStartedAtRef.current.delete(chunkName);
          profiler.recordTimer(
            "chunk.pipeline.edit",
            profiler.now() - editStartedAtMs,
            "latency",
          );
        }
      })
      .catch((err) => {
        console.error(err);
      });
    if (!hasBeenDispatched) queuedMeshRequestsRef.current.set(chunkName, meshApplied);
    return meshApplied;
  }

  function generateChunkName(chunkX: number, chunkY: number, chunkZ: number) {
    return `${chunkX},${chunkY},${chunkZ}`;
  }

  let prevTime = performance.now();

  function pruneChunkMesh(chunkName: string) {
    const disposeToken = profiler.begin("main.chunk.dispose");
    profiler.removeMesh(chunkName);
    plantDetailRef.current.delete(chunkName);
    const meshes = chunkMeshesRef.current.get(chunkName);
    if (meshes) {
      for (const mesh of meshes) {
        releaseChunkGeometry(mesh.geometry);
        mesh.removeFromParent();
      }
      chunkMeshesRef.current.delete(chunkName);
    }
    profiler.end(disposeToken);
  }

  function pruneChunks(
    playerChunkX: number,
    playerChunkY: number,
    playerChunkZ: number,
  ) {
    let prunedChunkPositions: typeof chunkPositions.current = [];
    let prunedChunks: typeof chunks.current = {};
    chunkPositions.current.forEach((chunkPosition) => {
      const chunkName = generateChunkName(
        chunkPosition.chunkX,
        chunkPosition.chunkY,
        chunkPosition.chunkZ,
      );
      if (
        new THREE.Vector3(
          chunkPosition.chunkX,
          chunkPosition.chunkY,
          chunkPosition.chunkZ,
        ).distanceTo(
          new THREE.Vector3(playerChunkX, playerChunkY, playerChunkZ),
        ) > CHUNK_PRUNING_DISTANCE
      ) {
        pruneChunkMesh(chunkName);
        profiler.addCounter("game.chunks.pruned");
      } else {
        prunedChunkPositions.push(chunkPosition);
        if (chunks.current[chunkName]) {
          prunedChunks[chunkName] = chunks.current[chunkName];
        }
      }
    });
    chunks.current = prunedChunks;
    chunkPositions.current = prunedChunkPositions;
  }

  function generateNearbyChunks(
    _chunkX: number,
    _chunkY: number,
    _chunkZ: number,
  ) {
    for (
      let chunkX = _chunkX - NEGATIVE_X_RENDER_DISTANCE;
      chunkX < _chunkX + POSITIVE_X_RENDER_DISTANCE;
      chunkX++
    ) {
      for (
        let chunkY = _chunkY + POSITIVE_Y_RENDER_DISTANCE;
        chunkY > _chunkY - NEGATIVE_Y_RENDER_DISTANCE;
        chunkY--
      ) {
        for (
          let chunkZ = _chunkZ - NEGATIVE_Z_RENDER_DISTANCE;
          chunkZ < _chunkZ + POSITIVE_Z_RENDER_DISTANCE;
          chunkZ++
        ) {
          let foundAMatch = false;
          chunkPositions.current.forEach((chunkPosition) => {
            if (
              chunkPosition.chunkX === chunkX &&
              chunkPosition.chunkY === chunkY &&
              chunkPosition.chunkZ === chunkZ
            ) {
              foundAMatch = true;
              return;
            }
          });
          if (!foundAMatch) {
            addChunkToQueue(chunkX, chunkY, chunkZ);
          }
        }
      }
    }
  }

  function growTree(x: number, y: number, z: number) {
    const height = 4 + Math.floor(Math.random() * 3); // 4 to 6

    // Trunk
    for (let i = 0; i < height; i++) {
      setBlock(x, y + i, z, BlockType.LOG);
    }

    // Leaves
    // Top (y+height)
    setBlock(x, y + height, z, BlockType.LEAVES);
    setBlock(x + 1, y + height, z, BlockType.LEAVES);
    setBlock(x - 1, y + height, z, BlockType.LEAVES);
    setBlock(x, y + height, z + 1, BlockType.LEAVES);
    setBlock(x, y + height, z - 1, BlockType.LEAVES);

    // Layer 2 (y+height-1)
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) {
          if (Math.random() > 0.5) continue;
        }
        if (dx === 0 && dz === 0) continue; // Trunk
        setBlock(x + dx, y + height - 1, z + dz, BlockType.LEAVES);
      }
    }

    // Layer 3 (y+height-2)
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) {
          if (Math.random() > 0.5) continue;
        }
        if (dx === 0 && dz === 0) continue; // Trunk
        setBlock(x + dx, y + height - 2, z + dz, BlockType.LEAVES);
      }
    }
  }

  function reactsToRandomTicks(block: number) {
    return block === BlockType.SAPLING || block === BlockType.GRASS;
  }

  function tickChunks() {
    if (connectedToHostRef.current) return;
    if (profiler.enabled) {
      profiler.addCounter(
        "game.randomTicks",
        Object.keys(chunks.current).length * RANDOM_TICKS_PER_CHUNK,
      );
    }
    Object.keys(chunks.current).forEach((chunkName) => {
      const chunk = chunks.current[chunkName];
      if (!chunk) return;
      const tickableIndices = tickableBlocksRef.current.indicesFor(
        chunk,
        chunkVersions.current[chunkName] ?? 0,
        reactsToRandomTicks,
      );
      const tickedIndices = pickTickedBlocks(
        tickableIndices,
        chunk.length,
        RANDOM_TICKS_PER_CHUNK,
      );
      if (tickedIndices.length === 0) return;

      const [chunkX, chunkY, chunkZ] = chunkName.split(",").map(Number);
      for (const blockIndex of tickedIndices) {
        const z = blockIndex % CHUNK_HEIGHT;
        const y = Math.floor(blockIndex / CHUNK_HEIGHT) % CHUNK_HEIGHT;
        const x = Math.floor(blockIndex / (CHUNK_WIDTH * CHUNK_HEIGHT));
        const block = chunk[blockIndex];

        const globalX = chunkX * CHUNK_WIDTH + x;
        const globalY = chunkY * CHUNK_HEIGHT + y;
        const globalZ = chunkZ * CHUNK_LENGTH + z;

        if (block === BlockType.SAPLING) {
          // Tree growth
          if (Math.random() < 0.1) {
            growTree(globalX, globalY, globalZ);
          }
        } else if (block === BlockType.GRASS) {
          // Grass death
          const blockAbove = getBlock(globalX, globalY + 1, globalZ);
          if (
            blockAbove !== BlockType.AIR &&
            blockAbove !== null &&
            !TRANSPARENT_BLOCKS.includes(blockAbove)
          ) {
            setBlock(globalX, globalY, globalZ, BlockType.DIRT);
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
              setBlock(targetX, targetY, targetZ, BlockType.GRASS);
            }
          }
        }
      }
    });
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
    const buildSnapshotToken = profiler.begin("main.save.buildSnapshot");
    const snapshot = buildSnapshotOfActiveWorld();
    profiler.end(buildSnapshotToken);
    if (!snapshot) return;
    if (profiler.enabled) {
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
    modifiedChunks.current = new Map(
      world.modifiedChunks.map(([chunkName, edits]) => [
        chunkName,
        new Map(edits),
      ]),
    );
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
    setPeerId("");
    activeWorldRef.current = null;
    await refreshWorlds();
    setPhase("title");
  }

  function joinHostedWorld(hostId: string) {
    activeWorldRef.current = null;
    modifiedChunks.current = new Map();
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

  let lastPlantDetailUpdateMs = 0;

  const render = () => {
    profiler.beginFrame();
    // stats.begin();
    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    // Update FPS counter
    fpsFrames.current.push(time);
    // Keep only frames from the last second
    while (fpsFrames.current.length > 0 && fpsFrames.current[0] < time - 1000) {
      fpsFrames.current.shift();
    }

    updateIndicator();

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
          const chunkX = Math.floor(litX / CHUNK_WIDTH);
          const chunkY = Math.floor(litY / CHUNK_HEIGHT);
          const chunkZ = Math.floor(litZ / CHUNK_LENGTH);
          const lightChunk =
            lightChunks.current[generateChunkName(chunkX, chunkY, chunkZ)];
          let lightLevel = 0;
          if (lightChunk) {
            const rawLight =
              lightChunk[
                calculateOffset(
                  litX - chunkX * CHUNK_WIDTH,
                  litY - chunkY * CHUNK_HEIGHT,
                  litZ - chunkZ * CHUNK_LENGTH,
                )
              ];
            lightLevel = (rawLight >> 4) & 0xf;
          }
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
        loadedChunks: Object.keys(chunks.current).length,
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

    benchmarkFrameCallbacksRef.current.forEach((callback) => callback(delta));

    prevTime = time;

    profiler.addCounter("game.getBlock.calls", getBlockCallsRef.current);
    getBlockCallsRef.current = 0;

    if (profiledRenderRef.current) {
      profiledRenderRef.current.render();
    } else {
      renderer.render(scene, camera);
    }
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
          onHost={() => {
            networkManager.current.hostGame().then((id) => setPeerId(id));
          }}
          onJoin={(id) => {
            networkManager.current.joinGame(id);
          }}
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
        />
        {isMobile && phase === "playing" && (
          <MobileControls
            containerRef={containerRef}
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
