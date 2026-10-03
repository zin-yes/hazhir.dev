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
} from "@/applications/game/blocks";
import { BlockHighlighter } from "./block-highlighter";
import { HOTBAR_SIZE, normalizeHotbar } from "./constants";
import { NetworkManager } from "./network/NetworkManager";
import { RemotePlayer } from "./network/RemotePlayer";
import { PhysicsEngine } from "./physics-engine";
import { LoadTracker, type LoadStageStatus } from "./load-progress";
import { PlayerControls } from "./player-controls";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders/chunk";
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
import { calculateOffset, getSurfaceHeightFromSeed } from "./utils";
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
  }>({});

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
          chunksToGenerate.push({ x: chunkX, y: chunkY, z: chunkZ });
          chunkPositions.current.push({ chunkX, chunkY, chunkZ });
        }
      }
    }

    // 1. Generate Blocks
    Promise.all(
      chunksToGenerate.map(async ({ x, y, z }) => {
        const result = await generationWorkerPool.exec("generateChunk", [
          currentSeed,
          x,
          y,
          z,
        ]);
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
      const queues: { [key: string]: number[] } = {};

      // Group by Y to ensure top-down lighting initialization
      const chunksByY: { [y: number]: { x: number; z: number }[] } = {};
      chunksToGenerate.forEach(({ x, y, z }) => {
        if (!chunksByY[y]) chunksByY[y] = [];
        chunksByY[y].push({ x, z });
      });

      const sortedYs = Object.keys(chunksByY)
        .map(Number)
        .sort((a, b) => b - a);

      for (const y of sortedYs) {
        await Promise.all(
          chunksByY[y].map(async ({ x, z }) => {
            const chunkName = generateChunkName(x, y, z);
            const chunk = chunks.current[chunkName];

            const topChunkName = generateChunkName(x, y + 1, z);
            const topChunk = chunks.current[topChunkName]?.buffer;
            const topChunkLight = lightChunks.current[topChunkName]?.buffer;

            const { light, queue } = await lightingWorkerPool.exec(
              "initializeChunkLight",
              [chunk.buffer, currentSeed, x, y, z, topChunk, topChunkLight],
            );
            lightChunks.current[chunkName] = light;
            queues[chunkName] = queue;

            profiler.recordTimer(
              "chunk.pipeline.initLight",
              profiler.now() - lightingStartedAtMs,
              "latency",
            );
            chunksLit++;
            loadTracker.report("lighting", chunksLit / initialLoadTasks);
          }),
        );
      }

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

          const neighbors = {
            "-1,0,0": chunks.current[generateChunkName(x - 1, y, z)]?.buffer,
            "1,0,0": chunks.current[generateChunkName(x + 1, y, z)]?.buffer,
            "0,1,0": chunks.current[generateChunkName(x, y + 1, z)]?.buffer,
            "0,-1,0": chunks.current[generateChunkName(x, y - 1, z)]?.buffer,
            "0,0,1": chunks.current[generateChunkName(x, y, z + 1)]?.buffer,
            "0,0,-1": chunks.current[generateChunkName(x, y, z - 1)]?.buffer,
          };

          const neighborLights = {
            "-1,0,0":
              lightChunks.current[generateChunkName(x - 1, y, z)]?.buffer,
            "1,0,0":
              lightChunks.current[generateChunkName(x + 1, y, z)]?.buffer,
            "0,1,0":
              lightChunks.current[generateChunkName(x, y + 1, z)]?.buffer,
            "0,-1,0":
              lightChunks.current[generateChunkName(x, y - 1, z)]?.buffer,
            "0,0,1":
              lightChunks.current[generateChunkName(x, y, z + 1)]?.buffer,
            "0,0,-1":
              lightChunks.current[generateChunkName(x, y, z - 1)]?.buffer,
          };

          const { centerLight, neighborLightUpdates } =
            await lightingWorkerPool.exec("propagateChunkLight", [
              chunk.buffer,
              light.buffer,
              neighbors,
              neighborLights,
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
            ({
              opaque,
              transparent,
            }: {
              opaque: {
                positions: ArrayBuffer;
                normals: ArrayBuffer;
                indices: ArrayBuffer;
                uvs: ArrayBuffer;
                textureIndices: ArrayBuffer;
                lightLevels: ArrayBuffer;
                ambientOcclusion: ArrayBuffer;
              };
              transparent: {
                positions: ArrayBuffer;
                normals: ArrayBuffer;
                indices: ArrayBuffer;
                uvs: ArrayBuffer;
                textureIndices: ArrayBuffer;
                lightLevels: ArrayBuffer;
                ambientOcclusion: ArrayBuffer;
              };
            }) => {
              addChunkMesh(opaque, transparent, chunkName, x, y, z);

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

      camera.position.y = getSurfaceHeightFromSeed(seedRef.current, 0, 0) + 2;
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
            camera.position.set(
              0,
              getSurfaceHeightFromSeed(data.seed, 0, 0) + 2,
              0,
            );
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
              chunks.current[chunkName][index] = b.blockType;
              chunksToUpdate.add(chunkName);

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
      .exec("generateChunk", [seedRef.current, chunkX, chunkY, chunkZ])
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

        const { light, queue } = await lightingWorkerPool.exec(
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
        const neighbors = {
          "-1,0,0":
            chunks.current[generateChunkName(chunkX - 1, chunkY, chunkZ)]
              ?.buffer,
          "1,0,0":
            chunks.current[generateChunkName(chunkX + 1, chunkY, chunkZ)]
              ?.buffer,
          "0,1,0":
            chunks.current[generateChunkName(chunkX, chunkY + 1, chunkZ)]
              ?.buffer,
          "0,-1,0":
            chunks.current[generateChunkName(chunkX, chunkY - 1, chunkZ)]
              ?.buffer,
          "0,0,1":
            chunks.current[generateChunkName(chunkX, chunkY, chunkZ + 1)]
              ?.buffer,
          "0,0,-1":
            chunks.current[generateChunkName(chunkX, chunkY, chunkZ - 1)]
              ?.buffer,
        };

        const neighborLights = {
          "-1,0,0":
            lightChunks.current[generateChunkName(chunkX - 1, chunkY, chunkZ)]
              ?.buffer,
          "1,0,0":
            lightChunks.current[generateChunkName(chunkX + 1, chunkY, chunkZ)]
              ?.buffer,
          "0,1,0":
            lightChunks.current[generateChunkName(chunkX, chunkY + 1, chunkZ)]
              ?.buffer,
          "0,-1,0":
            lightChunks.current[generateChunkName(chunkX, chunkY - 1, chunkZ)]
              ?.buffer,
          "0,0,1":
            lightChunks.current[generateChunkName(chunkX, chunkY, chunkZ + 1)]
              ?.buffer,
          "0,0,-1":
            lightChunks.current[generateChunkName(chunkX, chunkY, chunkZ - 1)]
              ?.buffer,
        };

        const { centerLight, neighborLightUpdates } =
          await lightingWorkerPool.exec("propagateChunkLight", [
            chunk.buffer,
            lightChunks.current[chunkName].buffer,
            neighbors,
            neighborLights,
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
            ({
              opaque,
              transparent,
            }: {
              opaque: {
                positions: ArrayBuffer;
                normals: ArrayBuffer;
                indices: ArrayBuffer;
                uvs: ArrayBuffer;
                textureIndices: ArrayBuffer;
                lightLevels: ArrayBuffer;
                ambientOcclusion: ArrayBuffer;
              };
              transparent: {
                positions: ArrayBuffer;
                normals: ArrayBuffer;
                indices: ArrayBuffer;
                uvs: ArrayBuffer;
                textureIndices: ArrayBuffer;
                lightLevels: ArrayBuffer;
                ambientOcclusion: ArrayBuffer;
              };
            }) => {
              addChunkMesh(
                opaque,
                transparent,
                chunkName,
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

  function updateIndicatorUnprofiled() {
    if (playerControlsRef.current?.controls.isLocked || playerControlsRef.current?.isMobile) {
      let cameraDirection: THREE.Vector3 = new THREE.Vector3();
      camera.getWorldDirection(cameraDirection);
      cameraDirection.normalize();
      cameraDirection.multiplyScalar(0.02);

      let currentPoint = new THREE.Vector3(
        camera.position.x,
        camera.position.y,
        camera.position.z,
      );

      for (let step = 0; step < 5 * 50; step++) {
        raycastStepsRef.current++;
        const x = Math.round(currentPoint.x);
        const y = Math.round(currentPoint.y);
        const z = Math.round(currentPoint.z);

        currentPoint = currentPoint.add(
          new THREE.Vector3(
            cameraDirection.x,
            cameraDirection.y,
            cameraDirection.z,
          ),
        );
        if (getBlock(x, y, z) !== BlockType.AIR && getBlock(x, y, z) !== null) {
          const indicator = scene.getObjectByName(
            "indicator",
          ) as THREE.LineSegments;
          const blockType = getBlock(x, y, z) as BlockType;

          const { scale, offset } = getBoundingBox(blockType);

          indicator.position.x = x + offset[0];
          indicator.position.y = y + offset[1];
          indicator.position.z = z + offset[2];
          indicator.scale.set(scale[0], scale[1], scale[2]);
          indicator.visible = true;
          return;
        }
      }
      scene.getObjectByName("indicator")!.visible = false;
    }
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(0.5 * 2 - 1, -0.5 * 2 + 1);

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
      raycaster.setFromCamera(pointer, camera);

      const intersections = raycaster.intersectObjects(
        scene.children.filter((obj) => obj.name !== "indicator"),
      );

      let faceNormal = new THREE.Vector3();
      if (intersections && intersections.length > 0) {
        faceNormal = intersections[0].face!.normal;
      } else {
        return;
      }

      let cameraDirection: THREE.Vector3 = new THREE.Vector3();
      camera.getWorldDirection(cameraDirection);
      cameraDirection.normalize();
      cameraDirection.multiplyScalar(0.02);

      let currentPoint = new THREE.Vector3(
        camera.position.x,
        camera.position.y,
        camera.position.z,
      );
      let x = 0;
      let y = 0;
      let z = 0;
      for (let step = 0; step < 5 * 50; step++) {
        raycastStepsRef.current++;
        x = Math.round(currentPoint.x);
        y = Math.round(currentPoint.y);
        z = Math.round(currentPoint.z);

        currentPoint = currentPoint.add(
          new THREE.Vector3(
            cameraDirection.x,
            cameraDirection.y,
            cameraDirection.z,
          ),
        );
        const hitBlock = getBlock(x, y, z);
        if (hitBlock !== BlockType.AIR) {
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
            const point = intersections[0].point;
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
          break;
        }
      }
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
      let cameraDirection: THREE.Vector3 = new THREE.Vector3();
      camera.getWorldDirection(cameraDirection);
      cameraDirection.normalize();
      cameraDirection.multiplyScalar(0.02);

      let currentPoint = new THREE.Vector3(
        camera.position.x,
        camera.position.y,
        camera.position.z,
      );

      for (let step = 0; step < 5 * 50; step++) {
        raycastStepsRef.current++;
        const x = Math.round(currentPoint.x);
        const y = Math.round(currentPoint.y);
        const z = Math.round(currentPoint.z);

        currentPoint = currentPoint.add(
          new THREE.Vector3(
            cameraDirection.x,
            cameraDirection.y,
            cameraDirection.z,
          ),
        );
        if (getBlock(x, y, z) !== BlockType.AIR) {
          setBlock(x, y, z, BlockType.AIR);
          break;
        }
      }
    }
  }

  function addMeshToScene(mesh: THREE.Mesh) {
    const scopeToken = profiler.begin("main.chunk.sceneAdd");
    scene.add(mesh);
    profiler.end(scopeToken);
  }

  function recordChunkGeometryStats(
    chunkName: string,
    kind: "opaque" | "transparent",
    geometry: {
      positions: ArrayBuffer;
      normals: ArrayBuffer;
      indices: ArrayBuffer;
      uvs: ArrayBuffer;
      textureIndices: ArrayBuffer;
      lightLevels: ArrayBuffer;
      ambientOcclusion: ArrayBuffer;
    },
  ) {
    if (!profiler.enabled) return;
    const bytesByAttribute = {
      positions: geometry.positions.byteLength,
      normals: geometry.normals.byteLength,
      uvs: geometry.uvs.byteLength,
      textureIndices: geometry.textureIndices.byteLength,
      lightLevels: geometry.lightLevels.byteLength,
      ambientOcclusion: geometry.ambientOcclusion.byteLength,
      indices: geometry.indices.byteLength,
    };
    profiler.recordMesh(chunkName, {
      kind,
      vertexCount: geometry.positions.byteLength / 12,
      triangleCount: geometry.indices.byteLength / 12,
      bytesByAttribute,
    });
    profiler.recordBytes(
      "bytes.geometry.toGpu",
      Object.values(bytesByAttribute).reduce((sum, bytes) => sum + bytes, 0),
    );
  }

  function addChunkMesh(
    opaque: {
      positions: ArrayBuffer;
      normals: ArrayBuffer;
      indices: ArrayBuffer;
      uvs: ArrayBuffer;
      textureIndices: ArrayBuffer;
      lightLevels: ArrayBuffer;
      ambientOcclusion: ArrayBuffer;
    },
    transparent: {
      positions: ArrayBuffer;
      normals: ArrayBuffer;
      indices: ArrayBuffer;
      uvs: ArrayBuffer;
      textureIndices: ArrayBuffer;
      lightLevels: ArrayBuffer;
      ambientOcclusion: ArrayBuffer;
    },
    chunkName: string,
    chunkX: number,
    chunkY: number,
    chunkZ: number,
  ) {
    if (!materialsRef.current.opaque || !materialsRef.current.transparent)
      return;

    const buildGeometryToken = profiler.begin("main.chunk.buildGeometry");
    recordChunkGeometryStats(chunkName, "opaque", opaque);
    recordChunkGeometryStats(chunkName, "transparent", transparent);

    // Opaque Mesh
    const opaqueGeometry = new THREE.BufferGeometry();
    opaqueGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(opaque.positions, 3),
    );
    opaqueGeometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(opaque.normals, 3),
    );
    opaqueGeometry.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(opaque.uvs, 2),
    );
    opaqueGeometry.setAttribute(
      "textureIndex",
      new THREE.Int32BufferAttribute(opaque.textureIndices, 1),
    );
    opaqueGeometry.setAttribute(
      "lightLevel",
      new THREE.Float32BufferAttribute(opaque.lightLevels, 1),
    );
    opaqueGeometry.setAttribute(
      "ambientOcclusion",
      new THREE.Float32BufferAttribute(opaque.ambientOcclusion, 1),
    );
    opaqueGeometry.setIndex(new THREE.Uint32BufferAttribute(opaque.indices, 1));
    const opaqueMesh = new THREE.Mesh(
      opaqueGeometry,
      materialsRef.current.opaque,
    );
    opaqueMesh.translateX(chunkX * CHUNK_WIDTH - 0.5);
    opaqueMesh.translateY(chunkY * CHUNK_HEIGHT - 0.5);
    opaqueMesh.translateZ(chunkZ * CHUNK_LENGTH - 0.5);

    opaqueMesh.frustumCulled = true;
    opaqueMesh.name = chunkName;
    opaqueMesh.renderOrder = 0;

    addMeshToScene(opaqueMesh);

    // Transparent Mesh
    const transparentGeometry = new THREE.BufferGeometry();
    transparentGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(transparent.positions, 3),
    );
    transparentGeometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(transparent.normals, 3),
    );
    transparentGeometry.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(transparent.uvs, 2),
    );
    transparentGeometry.setAttribute(
      "textureIndex",
      new THREE.Int32BufferAttribute(transparent.textureIndices, 1),
    );
    transparentGeometry.setAttribute(
      "lightLevel",
      new THREE.Float32BufferAttribute(transparent.lightLevels, 1),
    );
    transparentGeometry.setAttribute(
      "ambientOcclusion",
      new THREE.Float32BufferAttribute(transparent.ambientOcclusion, 1),
    );
    transparentGeometry.setIndex(
      new THREE.Uint32BufferAttribute(transparent.indices, 1),
    );
    const transparentMesh = new THREE.Mesh(
      transparentGeometry,
      materialsRef.current.transparent,
    );
    transparentMesh.translateX(chunkX * CHUNK_WIDTH - 0.5);
    transparentMesh.translateY(chunkY * CHUNK_HEIGHT - 0.5);
    transparentMesh.translateZ(chunkZ * CHUNK_LENGTH - 0.5);

    transparentMesh.frustumCulled = true;
    transparentMesh.name = chunkName + "_transparent";
    transparentMesh.renderOrder = 1;

    addMeshToScene(transparentMesh);
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

  async function updateChunkLightAndMesh(
    chunkX: number,
    chunkY: number,
    chunkZ: number,
  ) {
    const chunkName = generateChunkName(chunkX, chunkY, chunkZ);
    const chunk = chunks.current[chunkName];
    if (!chunk) return;
    profiler.addCounter("game.light.updates");

    const topChunkName = generateChunkName(chunkX, chunkY + 1, chunkZ);
    const topChunk = chunks.current[topChunkName]?.buffer;
    const topChunkLight = lightChunks.current[topChunkName]?.buffer;

    const { light, queue } = await lightingWorkerPool.exec(
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

    const neighbors = {
      "-1,0,0":
        chunks.current[generateChunkName(chunkX - 1, chunkY, chunkZ)]?.buffer,
      "1,0,0":
        chunks.current[generateChunkName(chunkX + 1, chunkY, chunkZ)]?.buffer,
      "0,1,0":
        chunks.current[generateChunkName(chunkX, chunkY + 1, chunkZ)]?.buffer,
      "0,-1,0":
        chunks.current[generateChunkName(chunkX, chunkY - 1, chunkZ)]?.buffer,
      "0,0,1":
        chunks.current[generateChunkName(chunkX, chunkY, chunkZ + 1)]?.buffer,
      "0,0,-1":
        chunks.current[generateChunkName(chunkX, chunkY, chunkZ - 1)]?.buffer,
    };

    const neighborLights = {
      "-1,0,0":
        lightChunks.current[generateChunkName(chunkX - 1, chunkY, chunkZ)]
          ?.buffer,
      "1,0,0":
        lightChunks.current[generateChunkName(chunkX + 1, chunkY, chunkZ)]
          ?.buffer,
      "0,1,0":
        lightChunks.current[generateChunkName(chunkX, chunkY + 1, chunkZ)]
          ?.buffer,
      "0,-1,0":
        lightChunks.current[generateChunkName(chunkX, chunkY - 1, chunkZ)]
          ?.buffer,
      "0,0,1":
        lightChunks.current[generateChunkName(chunkX, chunkY, chunkZ + 1)]
          ?.buffer,
      "0,0,-1":
        lightChunks.current[generateChunkName(chunkX, chunkY, chunkZ - 1)]
          ?.buffer,
    };

    const { centerLight, neighborLightUpdates } = await lightingWorkerPool.exec(
      "propagateChunkLight",
      [
        chunk.buffer,
        lightChunks.current[chunkName].buffer,
        neighbors,
        neighborLights,
        queue,
      ],
    );
    lightChunks.current[chunkName] = centerLight;

    // Apply neighbor updates
    const mergeNeighborToken = profiler.begin("main.light.mergeNeighbor");
    if (neighborLightUpdates) {
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
          // Regenerate neighbor mesh if light changed
          regenerateChunkMesh(chunkX + dx, chunkY + dy, chunkZ + dz);
        }
      });
    }
    profiler.end(mergeNeighborToken);

    regenerateChunkMesh(chunkX, chunkY, chunkZ);
  }

  async function updateLightForRegion(cx: number, cy: number, cz: number) {
    profiler.addCounter("game.light.updates");
    const chunksToUpdate: { x: number; y: number; z: number }[] = [];
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (chunks.current[generateChunkName(cx + x, cy + y, cz + z)]) {
            chunksToUpdate.push({ x: cx + x, y: cy + y, z: cz + z });
          }
        }
      }
    }

    // 1. Initialize (Top-Down)
    const queues: { [key: string]: number[] } = {};
    const chunksByY: { [y: number]: { x: number; z: number }[] } = {};
    chunksToUpdate.forEach(({ x, y, z }) => {
      if (!chunksByY[y]) chunksByY[y] = [];
      chunksByY[y].push({ x, z });
    });

    const sortedYs = Object.keys(chunksByY)
      .map(Number)
      .sort((a, b) => b - a);

    for (const y of sortedYs) {
      await Promise.all(
        chunksByY[y].map(async ({ x, z }) => {
          const chunkName = generateChunkName(x, y, z);
          const chunk = chunks.current[chunkName];

          const topChunkName = generateChunkName(x, y + 1, z);
          const topChunk = chunks.current[topChunkName]?.buffer;
          const topChunkLight = lightChunks.current[topChunkName]?.buffer;

          const { light, queue } = await lightingWorkerPool.exec(
            "initializeChunkLight",
            [chunk.buffer, seedRef.current, x, y, z, topChunk, topChunkLight],
          );
          lightChunks.current[chunkName] = light;
          queues[chunkName] = queue;
        }),
      );
    }

    // 2. Propagate Center
    const centerName = generateChunkName(cx, cy, cz);
    if (lightChunks.current[centerName]) {
      const neighbors = {
        "-1,0,0": chunks.current[generateChunkName(cx - 1, cy, cz)]?.buffer,
        "1,0,0": chunks.current[generateChunkName(cx + 1, cy, cz)]?.buffer,
        "0,1,0": chunks.current[generateChunkName(cx, cy + 1, cz)]?.buffer,
        "0,-1,0": chunks.current[generateChunkName(cx, cy - 1, cz)]?.buffer,
        "0,0,1": chunks.current[generateChunkName(cx, cy, cz + 1)]?.buffer,
        "0,0,-1": chunks.current[generateChunkName(cx, cy, cz - 1)]?.buffer,
      };

      const neighborLights = {
        "-1,0,0":
          lightChunks.current[generateChunkName(cx - 1, cy, cz)]?.buffer,
        "1,0,0": lightChunks.current[generateChunkName(cx + 1, cy, cz)]?.buffer,
        "0,1,0": lightChunks.current[generateChunkName(cx, cy + 1, cz)]?.buffer,
        "0,-1,0":
          lightChunks.current[generateChunkName(cx, cy - 1, cz)]?.buffer,
        "0,0,1": lightChunks.current[generateChunkName(cx, cy, cz + 1)]?.buffer,
        "0,0,-1":
          lightChunks.current[generateChunkName(cx, cy, cz - 1)]?.buffer,
      };

      const { centerLight, neighborLightUpdates } =
        await lightingWorkerPool.exec("propagateChunkLight", [
          chunks.current[centerName].buffer,
          lightChunks.current[centerName].buffer,
          neighbors,
          neighborLights,
          queues[centerName],
        ]);
      lightChunks.current[centerName] = centerLight;

      // Apply updates to neighbors
      const mergeCenterToken = profiler.begin("main.light.mergeNeighbor");
      if (neighborLightUpdates) {
        Object.entries(neighborLightUpdates).forEach(([key, update]) => {
          const [dx, dy, dz] = key.split(",").map(Number);
          const neighborName = generateChunkName(cx + dx, cy + dy, cz + dz);
          if (lightChunks.current[neighborName]) {
            const current = lightChunks.current[neighborName];
            const u = update as Uint8Array;
            for (let i = 0; i < current.length; i++) {
              current[i] = Math.max(current[i], u[i]);
            }
          }
        });
      }
      profiler.end(mergeCenterToken);
    }

    // 3. Propagate Neighbors
    const neighborsToPropagate = chunksToUpdate.filter(
      (c) => c.x !== cx || c.y !== cy || c.z !== cz,
    );

    await Promise.all(
      neighborsToPropagate.map(async ({ x, y, z }) => {
        const chunkName = generateChunkName(x, y, z);
        const chunk = chunks.current[chunkName];
        const light = lightChunks.current[chunkName];
        const queue = queues[chunkName];

        const neighbors = {
          "-1,0,0": chunks.current[generateChunkName(x - 1, y, z)]?.buffer,
          "1,0,0": chunks.current[generateChunkName(x + 1, y, z)]?.buffer,
          "0,1,0": chunks.current[generateChunkName(x, y + 1, z)]?.buffer,
          "0,-1,0": chunks.current[generateChunkName(x, y - 1, z)]?.buffer,
          "0,0,1": chunks.current[generateChunkName(x, y, z + 1)]?.buffer,
          "0,0,-1": chunks.current[generateChunkName(x, y, z - 1)]?.buffer,
        };

        const neighborLights = {
          "-1,0,0": lightChunks.current[generateChunkName(x - 1, y, z)]?.buffer,
          "1,0,0": lightChunks.current[generateChunkName(x + 1, y, z)]?.buffer,
          "0,1,0": lightChunks.current[generateChunkName(x, y + 1, z)]?.buffer,
          "0,-1,0": lightChunks.current[generateChunkName(x, y - 1, z)]?.buffer,
          "0,0,1": lightChunks.current[generateChunkName(x, y, z + 1)]?.buffer,
          "0,0,-1": lightChunks.current[generateChunkName(x, y, z - 1)]?.buffer,
        };

        const { centerLight, neighborLightUpdates } =
          await lightingWorkerPool.exec("propagateChunkLight", [
            chunk.buffer,
            light.buffer,
            neighbors,
            neighborLights,
            queue,
          ]);
        lightChunks.current[chunkName] = centerLight;

        // Apply updates (though mostly redundant if we don't iterate further)
        const mergeSpreadToken = profiler.begin("main.light.mergeNeighbor");
        if (neighborLightUpdates) {
          Object.entries(neighborLightUpdates).forEach(([key, update]) => {
            const [dx, dy, dz] = key.split(",").map(Number);
            const neighborName = generateChunkName(x + dx, y + dy, z + dz);
            if (lightChunks.current[neighborName]) {
              const current = lightChunks.current[neighborName];
              const u = update as Uint8Array;
              for (let i = 0; i < current.length; i++) {
                current[i] = Math.max(current[i], u[i]);
              }
            }
          });
        }
        profiler.end(mergeSpreadToken);
      }),
    );

    // 4. Mesh
    chunksToUpdate.forEach((c) => regenerateChunkMesh(c.x, c.y, c.z));
  }

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

    // Update Lighting asynchronously
    (async () => {
      // Check if the block being placed/removed is a light source
      const isLightChange =
        getBlockLightLevel(type) > 0 || getBlockLightLevel(oldBlock) > 0;

      if (isLightChange) {
        await updateLightForRegion(chunkX, chunkY, chunkZ);
      } else {
        await updateChunkLightAndMesh(chunkX, chunkY, chunkZ);

        // Also update the chunk below if it exists, as sky light might have changed
        const bottomChunkName = generateChunkName(chunkX, chunkY - 1, chunkZ);
        if (chunks.current[bottomChunkName]) {
          await updateChunkLightAndMesh(chunkX, chunkY - 1, chunkZ);
        }

        // Only regenerate neighbors if block is on chunk edge
        if (blockChunkX === 0) regenerateChunkMesh(chunkX - 1, chunkY, chunkZ);
        if (blockChunkX === CHUNK_WIDTH - 1)
          regenerateChunkMesh(chunkX + 1, chunkY, chunkZ);
        if (blockChunkY === 0) regenerateChunkMesh(chunkX, chunkY - 1, chunkZ);
        if (blockChunkY === CHUNK_HEIGHT - 1)
          regenerateChunkMesh(chunkX, chunkY + 1, chunkZ);
        if (blockChunkZ === 0) regenerateChunkMesh(chunkX, chunkY, chunkZ - 1);
        if (blockChunkZ === CHUNK_LENGTH - 1)
          regenerateChunkMesh(chunkX, chunkY, chunkZ + 1);
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
    const borders: {
      top?: ArrayBuffer;
      bottom?: ArrayBuffer;
      left?: ArrayBuffer;
      right?: ArrayBuffer;
      front?: ArrayBuffer;
      back?: ArrayBuffer;
    } = {};

    const borderLights: {
      top?: ArrayBuffer;
      bottom?: ArrayBuffer;
      left?: ArrayBuffer;
      right?: ArrayBuffer;
      front?: ArrayBuffer;
      back?: ArrayBuffer;
    } = {};

    const extractBorder = (
      nx: number,
      ny: number,
      nz: number,
      face: "top" | "bottom" | "left" | "right" | "front" | "back",
    ) => {
      const name = generateChunkName(nx, ny, nz);
      const chunk = chunks.current[name];
      const light = lightChunks.current[name];

      if (chunk) {
        let border: Uint8Array;
        if (face === "top") {
          border = new Uint8Array(CHUNK_WIDTH * CHUNK_LENGTH);
          for (let x = 0; x < CHUNK_WIDTH; x++)
            for (let z = 0; z < CHUNK_LENGTH; z++)
              border[x * CHUNK_LENGTH + z] = chunk[calculateOffset(x, 0, z)];
          borders.top = border.buffer as ArrayBuffer;
        } else if (face === "bottom") {
          border = new Uint8Array(CHUNK_WIDTH * CHUNK_LENGTH);
          for (let x = 0; x < CHUNK_WIDTH; x++)
            for (let z = 0; z < CHUNK_LENGTH; z++)
              border[x * CHUNK_LENGTH + z] =
                chunk[calculateOffset(x, CHUNK_HEIGHT - 1, z)];
          borders.bottom = border.buffer as ArrayBuffer;
        } else if (face === "front") {
          border = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT);
          for (let x = 0; x < CHUNK_WIDTH; x++)
            for (let y = 0; y < CHUNK_HEIGHT; y++)
              border[x * CHUNK_HEIGHT + y] = chunk[calculateOffset(x, y, 0)];
          borders.front = border.buffer as ArrayBuffer;
        } else if (face === "back") {
          border = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT);
          for (let x = 0; x < CHUNK_WIDTH; x++)
            for (let y = 0; y < CHUNK_HEIGHT; y++)
              border[x * CHUNK_HEIGHT + y] =
                chunk[calculateOffset(x, y, CHUNK_LENGTH - 1)];
          borders.back = border.buffer as ArrayBuffer;
        } else if (face === "right") {
          border = new Uint8Array(CHUNK_HEIGHT * CHUNK_LENGTH);
          for (let y = 0; y < CHUNK_HEIGHT; y++)
            for (let z = 0; z < CHUNK_LENGTH; z++)
              border[y * CHUNK_LENGTH + z] = chunk[calculateOffset(0, y, z)];
          borders.right = border.buffer as ArrayBuffer;
        } else if (face === "left") {
          border = new Uint8Array(CHUNK_HEIGHT * CHUNK_LENGTH);
          for (let y = 0; y < CHUNK_HEIGHT; y++)
            for (let z = 0; z < CHUNK_LENGTH; z++)
              border[y * CHUNK_LENGTH + z] =
                chunk[calculateOffset(CHUNK_WIDTH - 1, y, z)];
          borders.left = border.buffer as ArrayBuffer;
        }
      }

      if (light) {
        let border: Uint8Array;
        if (face === "top") {
          border = new Uint8Array(CHUNK_WIDTH * CHUNK_LENGTH);
          for (let x = 0; x < CHUNK_WIDTH; x++)
            for (let z = 0; z < CHUNK_LENGTH; z++)
              border[x * CHUNK_LENGTH + z] = light[calculateOffset(x, 0, z)];
          borderLights.top = border.buffer as ArrayBuffer;
        } else if (face === "bottom") {
          border = new Uint8Array(CHUNK_WIDTH * CHUNK_LENGTH);
          for (let x = 0; x < CHUNK_WIDTH; x++)
            for (let z = 0; z < CHUNK_LENGTH; z++)
              border[x * CHUNK_LENGTH + z] =
                light[calculateOffset(x, CHUNK_HEIGHT - 1, z)];
          borderLights.bottom = border.buffer as ArrayBuffer;
        } else if (face === "front") {
          border = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT);
          for (let x = 0; x < CHUNK_WIDTH; x++)
            for (let y = 0; y < CHUNK_HEIGHT; y++)
              border[x * CHUNK_HEIGHT + y] = light[calculateOffset(x, y, 0)];
          borderLights.front = border.buffer as ArrayBuffer;
        } else if (face === "back") {
          border = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT);
          for (let x = 0; x < CHUNK_WIDTH; x++)
            for (let y = 0; y < CHUNK_HEIGHT; y++)
              border[x * CHUNK_HEIGHT + y] =
                light[calculateOffset(x, y, CHUNK_LENGTH - 1)];
          borderLights.back = border.buffer as ArrayBuffer;
        } else if (face === "right") {
          border = new Uint8Array(CHUNK_HEIGHT * CHUNK_LENGTH);
          for (let y = 0; y < CHUNK_HEIGHT; y++)
            for (let z = 0; z < CHUNK_LENGTH; z++)
              border[y * CHUNK_LENGTH + z] = light[calculateOffset(0, y, z)];
          borderLights.right = border.buffer as ArrayBuffer;
        } else if (face === "left") {
          border = new Uint8Array(CHUNK_HEIGHT * CHUNK_LENGTH);
          for (let y = 0; y < CHUNK_HEIGHT; y++)
            for (let z = 0; z < CHUNK_LENGTH; z++)
              border[y * CHUNK_LENGTH + z] =
                light[calculateOffset(CHUNK_WIDTH - 1, y, z)];
          borderLights.left = border.buffer as ArrayBuffer;
        }
      }
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

  function regenerateChunkMesh(chunkX: number, chunkY: number, chunkZ: number) {
    if (materialsRef.current.opaque && materialsRef.current.transparent) {
      const chunkName = generateChunkName(chunkX, chunkY, chunkZ);
      const currentVersion = chunkVersions.current[chunkName];

      if (!lightChunks.current[chunkName]) return;

      profiler.addCounter("game.mesh.regenerations");
      const regenerateToken = profiler.begin("main.chunk.regenerateBookkeeping");
      const { borders, borderLights } = getChunkBorders(chunkX, chunkY, chunkZ);

      meshWorkerPool
        .exec("generateMesh", [
          chunks.current[chunkName],
          lightChunks.current[chunkName].buffer,
          borders,
          borderLights,
          seedRef.current,
          chunkX,
          chunkY,
          chunkZ,
        ])
        .then(
          ({
            opaque,
            transparent,
          }: {
            opaque: {
              positions: ArrayBuffer;
              normals: ArrayBuffer;
              indices: ArrayBuffer;
              uvs: ArrayBuffer;
              textureIndices: ArrayBuffer;
              lightLevels: ArrayBuffer;
              ambientOcclusion: ArrayBuffer;
            };
            transparent: {
              positions: ArrayBuffer;
              normals: ArrayBuffer;
              indices: ArrayBuffer;
              uvs: ArrayBuffer;
              textureIndices: ArrayBuffer;
              lightLevels: ArrayBuffer;
              ambientOcclusion: ArrayBuffer;
            };
          }) => {
            if (chunkVersions.current[chunkName] === currentVersion) {
              pruneChunkMesh(chunkName);
              addChunkMesh(
                opaque,
                transparent,
                chunkName,
                chunkX,
                chunkY,
                chunkZ,
              );
              const editStartedAtMs =
                pendingEditStartedAtRef.current.get(chunkName);
              if (editStartedAtMs !== undefined) {
                pendingEditStartedAtRef.current.delete(chunkName);
                profiler.recordTimer(
                  "chunk.pipeline.edit",
                  profiler.now() - editStartedAtMs,
                  "latency",
                );
              }
            }
          },
        )
        .catch((err) => {
          console.error(err);
        });
      profiler.end(regenerateToken);
    }
  }

  function generateChunkName(chunkX: number, chunkY: number, chunkZ: number) {
    return `${chunkX},${chunkY},${chunkZ}`;
  }

  let prevTime = performance.now();

  function pruneChunkMesh(chunkName: string) {
    const disposeToken = profiler.begin("main.chunk.dispose");
    profiler.removeMesh(chunkName);
    let mesh = scene.getObjectByName(chunkName) as THREE.Mesh;
    while (mesh) {
      mesh.geometry.dispose();
      mesh.removeFromParent();
      mesh = scene.getObjectByName(chunkName) as THREE.Mesh;
    }

    let transparentMesh = scene.getObjectByName(
      chunkName + "_transparent",
    ) as THREE.Mesh;
    while (transparentMesh) {
      transparentMesh.geometry.dispose();
      transparentMesh.removeFromParent();
      transparentMesh = scene.getObjectByName(
        chunkName + "_transparent",
      ) as THREE.Mesh;
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

  function tickChunks() {
    if (connectedToHostRef.current) return;
    if (profiler.enabled) {
      profiler.addCounter(
        "game.randomTicks",
        Object.keys(chunks.current).length * 100,
      );
    }
    Object.keys(chunks.current).forEach((chunkName) => {
      if (!chunks.current[chunkName]) return;
      const [chunkX, chunkY, chunkZ] = chunkName.split(",").map(Number);

      // 30 random ticks per chunk
      for (let i = 0; i < 100; i++) {
        const x = Math.floor(Math.random() * CHUNK_WIDTH);
        const y = Math.floor(Math.random() * CHUNK_HEIGHT);
        const z = Math.floor(Math.random() * CHUNK_LENGTH);

        const block = chunks.current[chunkName][calculateOffset(x, y, z)];

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
        playerObject.position.set(
          0,
          getSurfaceHeightFromSeed(world.seed, 0, 0) + 2,
          0,
        );
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

    // Update debug info every few frames to avoid excessive re-renders
    if (Math.floor(time / 100) !== Math.floor(prevTime / 100)) {
      const debugInfoToken = profiler.begin("main.frame.debugInfo");
      const playerChunkX = Math.floor(camera.position.x / CHUNK_WIDTH);
      const playerChunkY = Math.floor(camera.position.y / CHUNK_HEIGHT);
      const playerChunkZ = Math.floor(camera.position.z / CHUNK_LENGTH);

      // Find what block we're looking at
      let lookingAtBlock: { x: number; y: number; z: number } | null = null;
      let blockAtCursor: { type: number; light: number } | null = null;

      if (playerControlsRef.current?.controls.isLocked || playerControlsRef.current?.isMobile) {
        let cameraDirection: THREE.Vector3 = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);
        cameraDirection.normalize();
        cameraDirection.multiplyScalar(0.02);

        let currentPoint = new THREE.Vector3(
          camera.position.x,
          camera.position.y,
          camera.position.z,
        );

        let lastX = Math.round(currentPoint.x);
        let lastY = Math.round(currentPoint.y);
        let lastZ = Math.round(currentPoint.z);

        for (let step = 0; step < 5 * 50; step++) {
          raycastStepsRef.current++;
          const x = Math.round(currentPoint.x);
          const y = Math.round(currentPoint.y);
          const z = Math.round(currentPoint.z);

          currentPoint = currentPoint.add(
            new THREE.Vector3(
              cameraDirection.x,
              cameraDirection.y,
              cameraDirection.z,
            ),
          );
          const blockType = getBlock(x, y, z);
          if (blockType !== null && blockType !== BlockType.AIR) {
            lookingAtBlock = { x, y, z };

            const chunkX = Math.floor(lastX / CHUNK_WIDTH);
            const chunkY = Math.floor(lastY / CHUNK_HEIGHT);
            const chunkZ = Math.floor(lastZ / CHUNK_LENGTH);

            const chunkName = generateChunkName(chunkX, chunkY, chunkZ);
            const lightChunk = lightChunks.current[chunkName];

            let lightLevel = 0;
            if (lightChunk) {
              const blockChunkX = lastX - chunkX * CHUNK_WIDTH;
              const blockChunkY = lastY - chunkY * CHUNK_HEIGHT;
              const blockChunkZ = lastZ - chunkZ * CHUNK_LENGTH;
              const rawLight =
                lightChunk[
                  calculateOffset(blockChunkX, blockChunkY, blockChunkZ)
                ];
              lightLevel = (rawLight >> 4) & 0xf;
            }

            blockAtCursor = { type: blockType, light: lightLevel };
            break;
          }

          lastX = x;
          lastY = y;
          lastZ = z;
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
