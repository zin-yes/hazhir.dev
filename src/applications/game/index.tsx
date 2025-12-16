"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
  LOADING_SCREEN_TEXTURES,
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
import { PlayerControls } from "./player-controls";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders/chunk";
import UILayer from "./ui/index";
import { calculateOffset, getSurfaceHeightFromSeed } from "./utils";
import { updateWater } from "./water-physics";

const FLYING_SPEED = 10;

// TODO: Sakura biome
// TODO: Jungle biome
// import Stats from "stats.js";

export default function Game() {
  const initialized = useRef(false);

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
        3
      ),
    []
  );
  const lightingWorkerPool = useMemo(
    () =>
      new WorkerPool(
        () =>
          new Worker(new URL("./workers/unified-worker.ts", import.meta.url), {
            name: "lighting",
          }),
        2
      ),
    []
  );
  const meshWorkerPool = useMemo(
    () =>
      new WorkerPool(
        () =>
          new Worker(new URL("./workers/unified-worker.ts", import.meta.url), {
            name: "mesh",
          }),
        3
      ),
    []
  );
  const textureArrayWorkerPool = useMemo(
    () =>
      new WorkerPool(
        () =>
          new Worker(new URL("./workers/unified-worker.ts", import.meta.url), {
            name: "texture-array",
          }),
        1
      ),
    []
  );

  const renderer = useMemo(
    () =>
      new THREE.WebGLRenderer({
        // antialias: true,
        alpha: true,
        // logarithmicDepthBuffer: true,
      }),
    []
  );

  const scene = useMemo(() => new THREE.Scene(), []);

  const camera = useMemo(
    () =>
      new THREE.PerspectiveCamera(
        85,
        window.innerWidth / window.innerHeight,
        0.1,
        10000
      ),
    []
  );

  let initialLoadCompletion = 0;

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
    [containerRef, camera, renderer]
  );

  function setInitialLoadCompletion(value: number) {
    const loadingLayerBackground = document.getElementById(
      "loadingLayerBackground"
    ) as HTMLDivElement;

    if (loadingLayerBackground) {
      if (Math.random() > 0.6) {
        loadingLayerBackground.innerHTML += `<div class="w-[10%] aspect-square" style="image-rendering:pixelated;background-image: url(/game/${
          LOADING_SCREEN_TEXTURES[
            Math.floor(Math.random() * LOADING_SCREEN_TEXTURES.length)
          ]
        });background-size: 100% 100%;background-position: center center"></div>`;
      }
    }

    initialLoadCompletion = value;

    const initialLoadCompletionElement = document.getElementById(
      "initialLoadCompletion"
    ) as HTMLDivElement;
    const loadingLayerElement = document.getElementById(
      "loadingLayer"
    ) as HTMLDivElement;
    if (initialLoadCompletionElement) {
      initialLoadCompletionElement.innerHTML =
        Math.round(initialLoadCompletion * 100) + "%";
      if (initialLoadCompletion === 1) {
        setTimeout(() => {
          if (loadingLayerElement) {
            loadingLayerElement.style.pointerEvents = "none";
            loadingLayerElement.style.opacity = "0";
          }
        }, 400);
        setTimeout(() => {
          if (loadingLayerElement) {
            loadingLayerBackground.remove();
            loadingLayerElement.remove();
          }
        }, 1400);
      }
    }
  }

  const [selectedSlot, setSelectedSlot] = useState(0);
  const selectedSlotRef = useRef(0);
  const [hotbarSlots, setHotbarSlots] = useState<BlockType[]>(
    normalizeHotbar([
      BlockType.DIRT,
      BlockType.GRASS,
      BlockType.STONE,
      BlockType.LOG,
      BlockType.PLANKS,
      BlockType.LEAVES,
      BlockType.GLASS,
      BlockType.GLOWSTONE,
      BlockType.COBBLESTONE,
    ])
  );
  const hotbarSlotsRef = useRef(hotbarSlots);
  const [isInventoryOpen, setIsInventoryOpen] = useState(false);
  const isInventoryOpenRef = useRef(false);
  const [isDebugVisible, setIsDebugVisible] = useState(false);
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

      if (event.code === "KeyE") {
        if (isInventoryOpen) {
          setIsInventoryOpen(false);
          playerControlsRef.current?.controls.lock();
        } else {
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

    let initialLoadTasks =
      (POSITIVE_X_RENDER_DISTANCE + NEGATIVE_X_RENDER_DISTANCE) *
      (POSITIVE_Y_RENDER_DISTANCE + NEGATIVE_Y_RENDER_DISTANCE) *
      (POSITIVE_Z_RENDER_DISTANCE + NEGATIVE_Z_RENDER_DISTANCE);

    let tasksDone = 0;

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
      })
    ).then(async () => {
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
              [chunk.buffer, currentSeed, x, y, z, topChunk, topChunkLight]
            );
            lightChunks.current[chunkName] = light;
            queues[chunkName] = queue;
          })
        );
      }

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

          Object.entries(neighborLightUpdates).forEach(([key, update]) => {
            const [dx, dy, dz] = key.split(",").map(Number);
            const neighborName = generateChunkName(x + dx, y + dy, z + dz);
            if (!lightUpdates[neighborName]) lightUpdates[neighborName] = [];
            lightUpdates[neighborName].push(update as Uint8Array);
          });
        })
      );

      // Merge updates
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
              };
              transparent: {
                positions: ArrayBuffer;
                normals: ArrayBuffer;
                indices: ArrayBuffer;
                uvs: ArrayBuffer;
                textureIndices: ArrayBuffer;
                lightLevels: ArrayBuffer;
              };
            }) => {
              addChunkMesh(opaque, transparent, chunkName, x, y, z);

              tasksDone++;

              setInitialLoadCompletion(tasksDone / initialLoadTasks);
            }
          )
          .catch((err) => {
            console.error(err);
          });
      });
    });

    intervalRef.current = setInterval(() => {
      const playerChunkX = Math.round(camera.position.x / CHUNK_WIDTH);
      const playerChunkY = Math.round(camera.position.y / CHUNK_HEIGHT);
      const playerChunkZ = Math.round(camera.position.z / CHUNK_LENGTH);

      pruneChunks(playerChunkX, playerChunkY, playerChunkZ);

      generateNearbyChunks(playerChunkX, playerChunkY, playerChunkZ);
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
          TEXTURE_SIZE
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
      sky.scale.setScalar(450000);

      const phi = THREE.MathUtils.degToRad(90);
      const theta = THREE.MathUtils.degToRad(180);
      const sunPosition = new THREE.Vector3().setFromSphericalCoords(
        1,
        phi,
        theta
      );

      sky.material.uniforms.sunPosition.value = sunPosition;

      scene.add(sky);

      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      containerRef.current.appendChild(renderer.domElement);

      const physics = new PhysicsEngine(getBlock);
      playerControlsRef.current = new PlayerControls(
        camera,
        containerRef.current,
        physics
      );

      playerControlsRef.current.controls.addEventListener("lock", () => {
        const infoLayer = document.getElementById("infoLayer");
        if (infoLayer) infoLayer.style.display = "none";
      });

      playerControlsRef.current.controls.addEventListener("unlock", () => {
        const infoLayer = document.getElementById("infoLayer");
        if (infoLayer) infoLayer.style.display = "flex";
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

      textureArrayWorkerPool
        .exec("loadTextureArray", [window.location.origin])
        .then((result) => {
          if (result) {
            textureArray = new THREE.DataArrayTexture(
              result.data,
              TEXTURE_SIZE,
              TEXTURE_SIZE,
              result.length
            );
            textureArray.format = THREE.RGBAFormat;
            textureArray.colorSpace = THREE.SRGBColorSpace;
            textureArray.minFilter = THREE.LinearMipMapNearestFilter;
            textureArray.magFilter = THREE.NearestFilter;
            textureArray.generateMipmaps = true;
            textureArray.needsUpdate = true;

            const waterTextureIndex = Object.values(Texture).indexOf(
              Texture.WATER
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

            startWorldGeneration(seedRef.current);
          }

          renderer.setAnimationLoop(render);
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
          case "KeyT":
            placeTree();
            break;
          case "Escape":
            if (isInventoryOpenRef.current) {
              setIsInventoryOpen(false);
              playerControlsRef.current?.controls.lock();
              break;
            }

            if (
              initialLoadCompletion === 1 &&
              !playerControlsRef.current?.controls.isLocked
            ) {
              playerControlsRef.current?.controls.lock();
              setIsInventoryOpen(false);
            } else {
              playerControlsRef.current?.controls.unlock();
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
          id
        );

        const blocks: { x: number; y: number; z: number; blockType: number }[] =
          [];
        modifiedChunks.current.forEach((modifications, chunkName) => {
          const [cx, cy, cz] = chunkName.split(",").map(Number);
          modifications.forEach((type, index) => {
            const z = index % CHUNK_HEIGHT;
            const y = Math.floor(index / CHUNK_HEIGHT) % CHUNK_WIDTH;
            const x = Math.floor(
              Math.floor(index / CHUNK_HEIGHT) / CHUNK_WIDTH
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
            id
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
        if (data.type === "HANDSHAKE") {
          seedRef.current = data.seed;
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
                data.position.z
              )
            );
            remotePlayers.current.set(data.id, rp);
          }
          rp.updatePosition(data.position, data.rotation);
        } else if (data.type === "BLOCK_UPDATE") {
          setBlock(data.x, data.y, data.z, data.blockType, false);
        } else if (data.type === "WORLD_STATE") {
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
              blockChunkZ
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
                  generateChunkName(chunkX - 1, chunkY, chunkZ)
                );
              if (blockChunkX === CHUNK_WIDTH - 1)
                chunksToUpdate.add(
                  generateChunkName(chunkX + 1, chunkY, chunkZ)
                );
              if (blockChunkY === 0)
                chunksToUpdate.add(
                  generateChunkName(chunkX, chunkY - 1, chunkZ)
                );
              if (blockChunkY === CHUNK_HEIGHT - 1)
                chunksToUpdate.add(
                  generateChunkName(chunkX, chunkY + 1, chunkZ)
                );
              if (blockChunkZ === 0)
                chunksToUpdate.add(
                  generateChunkName(chunkX, chunkY, chunkZ - 1)
                );
              if (blockChunkZ === CHUNK_LENGTH - 1)
                chunksToUpdate.add(
                  generateChunkName(chunkX, chunkY, chunkZ + 1)
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
        }

        if (nm.isHost && data.type !== "HANDSHAKE") {
          nm.broadcast(data, senderId);
        }
      };

      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);

        document.removeEventListener("keyup", onKeyUp);
        if (container) {
          container.removeEventListener("contextmenu", onContextMenu);
          container.removeEventListener("mousedown", onMouseDown);
        }

        nm.disconnect();

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
        meshWorkerPool.terminate();
        textureArrayWorkerPool.terminate();

        initialized.current = false;
      };
    }
  }, [containerRef]);

  function addChunkToQueue(chunkX: number, chunkY: number, chunkZ: number) {
    chunkPositions.current.push({ chunkX, chunkY, chunkZ });

    generationWorkerPool
      .exec("generateChunk", [seedRef.current, chunkX, chunkY, chunkZ])
      .then(async (result: ArrayBuffer) => {
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
          ]
        );
        lightChunks.current[chunkName] = light;

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

        // Apply neighbor updates
        Object.entries(neighborLightUpdates).forEach(([key, update]) => {
          const [dx, dy, dz] = key.split(",").map(Number);
          const neighborName = generateChunkName(
            chunkX + dx,
            chunkY + dy,
            chunkZ + dz
          );
          if (lightChunks.current[neighborName]) {
            const current = lightChunks.current[neighborName];
            const u = update as Uint8Array;
            for (let i = 0; i < current.length; i++) {
              current[i] = Math.max(current[i], u[i]);
            }
          }
        });

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
          chunkZ
        );

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
              };
              transparent: {
                positions: ArrayBuffer;
                normals: ArrayBuffer;
                indices: ArrayBuffer;
                uvs: ArrayBuffer;
                textureIndices: ArrayBuffer;
                lightLevels: ArrayBuffer;
              };
            }) => {
              addChunkMesh(
                opaque,
                transparent,
                chunkName,
                chunkX,
                chunkY,
                chunkZ
              );
            }
          )
          .catch((err) => {
            console.error(err);
          });
      })
      .catch((err) => {
        console.error(err);
      });
  }

  function updateIndicator() {
    if (playerControlsRef.current?.controls.isLocked) {
      let cameraDirection: THREE.Vector3 = new THREE.Vector3();
      camera.getWorldDirection(cameraDirection);
      cameraDirection.normalize();
      cameraDirection.multiplyScalar(0.02);

      let currentPoint = new THREE.Vector3(
        camera.position.x,
        camera.position.y,
        camera.position.z
      );

      for (let step = 0; step < 5 * 50; step++) {
        const x = Math.round(currentPoint.x);
        const y = Math.round(currentPoint.y);
        const z = Math.round(currentPoint.z);

        currentPoint = currentPoint.add(
          new THREE.Vector3(
            cameraDirection.x,
            cameraDirection.y,
            cameraDirection.z
          )
        );
        if (getBlock(x, y, z) !== BlockType.AIR && getBlock(x, y, z) !== null) {
          const indicator = scene.getObjectByName(
            "indicator"
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

  function generateTree(x: number, y: number, z: number) {
    const seed = seedRef.current;
    const rnd = (offset: number) => {
      const val =
        Math.sin(x * 12.9898 + z * 78.233 + seed + offset) * 43758.5453;
      return val - Math.floor(val);
    };

    const height = 4 + Math.floor(rnd(0) * 3); // 4 to 6

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
          if (rnd(dx * dz) > 0.5) continue;
        }
        if (dx === 0 && dz === 0) continue; // Trunk
        setBlock(x + dx, y + height - 1, z + dz, BlockType.LEAVES);
      }
    }

    // Layer 3 (y+height-2)
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) {
          if (rnd(dx * dz + 10) > 0.5) continue;
        }
        if (dx === 0 && dz === 0) continue; // Trunk
        setBlock(x + dx, y + height - 2, z + dz, BlockType.LEAVES);
      }
    }
  }

  function placeTree() {
    if (playerControlsRef.current?.controls.isLocked) {
      raycaster.setFromCamera(pointer, camera);

      const intersections = raycaster.intersectObjects(
        scene.children.filter((obj) => obj.name !== "indicator")
      );

      if (intersections.length === 0) return;

      const intersect = intersections[0];
      const faceNormal = intersect.face!.normal;

      const targetX = Math.round(intersect.point.x + faceNormal.x * 0.01);
      const targetY = Math.round(intersect.point.y + faceNormal.y * 0.01);
      const targetZ = Math.round(intersect.point.z + faceNormal.z * 0.01);

      const blockBelow = getBlock(targetX, targetY - 1, targetZ);

      if (blockBelow === BlockType.GRASS) {
        generateTree(targetX, targetY, targetZ);
      }
    }
  }

  function placeBlock(type: BlockType) {
    if (playerControlsRef.current?.controls.isLocked) {
      raycaster.setFromCamera(pointer, camera);

      const intersections = raycaster.intersectObjects(
        scene.children.filter((obj) => obj.name !== "indicator")
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
        camera.position.z
      );
      let x = 0;
      let y = 0;
      let z = 0;
      for (let step = 0; step < 5 * 50; step++) {
        x = Math.round(currentPoint.x);
        y = Math.round(currentPoint.y);
        z = Math.round(currentPoint.z);

        currentPoint = currentPoint.add(
          new THREE.Vector3(
            cameraDirection.x,
            cameraDirection.y,
            cameraDirection.z
          )
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
              newBlockZ - 0.5
            ),
            new THREE.Vector3(newBlockX + 0.5, newBlockY + 0.5, newBlockZ + 0.5)
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
            newBlockZ
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
    if (playerControlsRef.current?.controls.isLocked) {
      let cameraDirection: THREE.Vector3 = new THREE.Vector3();
      camera.getWorldDirection(cameraDirection);
      cameraDirection.normalize();
      cameraDirection.multiplyScalar(0.02);

      let currentPoint = new THREE.Vector3(
        camera.position.x,
        camera.position.y,
        camera.position.z
      );

      for (let step = 0; step < 5 * 50; step++) {
        const x = Math.round(currentPoint.x);
        const y = Math.round(currentPoint.y);
        const z = Math.round(currentPoint.z);

        currentPoint = currentPoint.add(
          new THREE.Vector3(
            cameraDirection.x,
            cameraDirection.y,
            cameraDirection.z
          )
        );
        if (getBlock(x, y, z) !== BlockType.AIR) {
          setBlock(x, y, z, BlockType.AIR);
          break;
        }
      }
    }
  }

  function addChunkMesh(
    opaque: {
      positions: ArrayBuffer;
      normals: ArrayBuffer;
      indices: ArrayBuffer;
      uvs: ArrayBuffer;
      textureIndices: ArrayBuffer;
      lightLevels: ArrayBuffer;
    },
    transparent: {
      positions: ArrayBuffer;
      normals: ArrayBuffer;
      indices: ArrayBuffer;
      uvs: ArrayBuffer;
      textureIndices: ArrayBuffer;
      lightLevels: ArrayBuffer;
    },
    chunkName: string,
    chunkX: number,
    chunkY: number,
    chunkZ: number
  ) {
    if (!materialsRef.current.opaque || !materialsRef.current.transparent)
      return;

    // Opaque Mesh
    const opaqueGeometry = new THREE.BufferGeometry();
    opaqueGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(opaque.positions, 3)
    );
    opaqueGeometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(opaque.normals, 3)
    );
    opaqueGeometry.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(opaque.uvs, 2)
    );
    opaqueGeometry.setAttribute(
      "textureIndex",
      new THREE.Int32BufferAttribute(opaque.textureIndices, 1)
    );
    opaqueGeometry.setAttribute(
      "lightLevel",
      new THREE.Float32BufferAttribute(opaque.lightLevels, 1)
    );
    opaqueGeometry.setIndex(new THREE.Uint32BufferAttribute(opaque.indices, 1));
    const opaqueMesh = new THREE.Mesh(
      opaqueGeometry,
      materialsRef.current.opaque
    );
    opaqueMesh.translateX(chunkX * CHUNK_WIDTH - 0.5);
    opaqueMesh.translateY(chunkY * CHUNK_HEIGHT - 0.5);
    opaqueMesh.translateZ(chunkZ * CHUNK_LENGTH - 0.5);

    opaqueMesh.frustumCulled = true;
    opaqueMesh.name = chunkName;
    opaqueMesh.renderOrder = 0;

    scene.add(opaqueMesh);

    // Transparent Mesh
    const transparentGeometry = new THREE.BufferGeometry();
    transparentGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(transparent.positions, 3)
    );
    transparentGeometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(transparent.normals, 3)
    );
    transparentGeometry.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(transparent.uvs, 2)
    );
    transparentGeometry.setAttribute(
      "textureIndex",
      new THREE.Int32BufferAttribute(transparent.textureIndices, 1)
    );
    transparentGeometry.setAttribute(
      "lightLevel",
      new THREE.Float32BufferAttribute(transparent.lightLevels, 1)
    );
    transparentGeometry.setIndex(
      new THREE.Uint32BufferAttribute(transparent.indices, 1)
    );
    const transparentMesh = new THREE.Mesh(
      transparentGeometry,
      materialsRef.current.transparent
    );
    transparentMesh.translateX(chunkX * CHUNK_WIDTH - 0.5);
    transparentMesh.translateY(chunkY * CHUNK_HEIGHT - 0.5);
    transparentMesh.translateZ(chunkZ * CHUNK_LENGTH - 0.5);

    transparentMesh.frustumCulled = true;
    transparentMesh.name = chunkName + "_transparent";
    transparentMesh.renderOrder = 1;

    scene.add(transparentMesh);
  }

  function getBlock(x: number, y: number, z: number) {
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
      if (pendingWaterUpdates.current.size === 0) return;

      const updates = Array.from(pendingWaterUpdates.current);
      pendingWaterUpdates.current.clear();

      updates.forEach((key) => {
        const [x, y, z] = key.split(",").map(Number);
        updateWater(x, y, z, getBlock, setBlock, scheduleWaterUpdate);
      });
    }, 650);

    return () => clearInterval(interval);
  }, []);

  async function updateChunkLightAndMesh(
    chunkX: number,
    chunkY: number,
    chunkZ: number
  ) {
    const chunkName = generateChunkName(chunkX, chunkY, chunkZ);
    const chunk = chunks.current[chunkName];
    if (!chunk) return;

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
      ]
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
      ]
    );
    lightChunks.current[chunkName] = centerLight;

    // Apply neighbor updates
    if (neighborLightUpdates) {
      Object.entries(neighborLightUpdates).forEach(([key, update]) => {
        const [dx, dy, dz] = key.split(",").map(Number);
        const neighborName = generateChunkName(
          chunkX + dx,
          chunkY + dy,
          chunkZ + dz
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

    regenerateChunkMesh(chunkX, chunkY, chunkZ);
  }

  async function updateLightForRegion(cx: number, cy: number, cz: number) {
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
            [chunk.buffer, seedRef.current, x, y, z, topChunk, topChunkLight]
          );
          lightChunks.current[chunkName] = light;
          queues[chunkName] = queue;
        })
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
    }

    // 3. Propagate Neighbors
    const neighborsToPropagate = chunksToUpdate.filter(
      (c) => c.x !== cx || c.y !== cy || c.z !== cz
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
      })
    );

    // 4. Mesh
    chunksToUpdate.forEach((c) => regenerateChunkMesh(c.x, c.y, c.z));
  }

  function setBlock(
    x: number,
    y: number,
    z: number,
    type: number,
    broadcast: boolean = true
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
      face: "top" | "bottom" | "left" | "right" | "front" | "back"
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
          borders.top = border.buffer;
        } else if (face === "bottom") {
          border = new Uint8Array(CHUNK_WIDTH * CHUNK_LENGTH);
          for (let x = 0; x < CHUNK_WIDTH; x++)
            for (let z = 0; z < CHUNK_LENGTH; z++)
              border[x * CHUNK_LENGTH + z] =
                chunk[calculateOffset(x, CHUNK_HEIGHT - 1, z)];
          borders.bottom = border.buffer;
        } else if (face === "front") {
          border = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT);
          for (let x = 0; x < CHUNK_WIDTH; x++)
            for (let y = 0; y < CHUNK_HEIGHT; y++)
              border[x * CHUNK_HEIGHT + y] = chunk[calculateOffset(x, y, 0)];
          borders.front = border.buffer;
        } else if (face === "back") {
          border = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT);
          for (let x = 0; x < CHUNK_WIDTH; x++)
            for (let y = 0; y < CHUNK_HEIGHT; y++)
              border[x * CHUNK_HEIGHT + y] =
                chunk[calculateOffset(x, y, CHUNK_LENGTH - 1)];
          borders.back = border.buffer;
        } else if (face === "right") {
          border = new Uint8Array(CHUNK_HEIGHT * CHUNK_LENGTH);
          for (let y = 0; y < CHUNK_HEIGHT; y++)
            for (let z = 0; z < CHUNK_LENGTH; z++)
              border[y * CHUNK_LENGTH + z] = chunk[calculateOffset(0, y, z)];
          borders.right = border.buffer;
        } else if (face === "left") {
          border = new Uint8Array(CHUNK_HEIGHT * CHUNK_LENGTH);
          for (let y = 0; y < CHUNK_HEIGHT; y++)
            for (let z = 0; z < CHUNK_LENGTH; z++)
              border[y * CHUNK_LENGTH + z] =
                chunk[calculateOffset(CHUNK_WIDTH - 1, y, z)];
          borders.left = border.buffer;
        }
      }

      if (light) {
        let border: Uint8Array;
        if (face === "top") {
          border = new Uint8Array(CHUNK_WIDTH * CHUNK_LENGTH);
          for (let x = 0; x < CHUNK_WIDTH; x++)
            for (let z = 0; z < CHUNK_LENGTH; z++)
              border[x * CHUNK_LENGTH + z] = light[calculateOffset(x, 0, z)];
          borderLights.top = border.buffer;
        } else if (face === "bottom") {
          border = new Uint8Array(CHUNK_WIDTH * CHUNK_LENGTH);
          for (let x = 0; x < CHUNK_WIDTH; x++)
            for (let z = 0; z < CHUNK_LENGTH; z++)
              border[x * CHUNK_LENGTH + z] =
                light[calculateOffset(x, CHUNK_HEIGHT - 1, z)];
          borderLights.bottom = border.buffer;
        } else if (face === "front") {
          border = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT);
          for (let x = 0; x < CHUNK_WIDTH; x++)
            for (let y = 0; y < CHUNK_HEIGHT; y++)
              border[x * CHUNK_HEIGHT + y] = light[calculateOffset(x, y, 0)];
          borderLights.front = border.buffer;
        } else if (face === "back") {
          border = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT);
          for (let x = 0; x < CHUNK_WIDTH; x++)
            for (let y = 0; y < CHUNK_HEIGHT; y++)
              border[x * CHUNK_HEIGHT + y] =
                light[calculateOffset(x, y, CHUNK_LENGTH - 1)];
          borderLights.back = border.buffer;
        } else if (face === "right") {
          border = new Uint8Array(CHUNK_HEIGHT * CHUNK_LENGTH);
          for (let y = 0; y < CHUNK_HEIGHT; y++)
            for (let z = 0; z < CHUNK_LENGTH; z++)
              border[y * CHUNK_LENGTH + z] = light[calculateOffset(0, y, z)];
          borderLights.right = border.buffer;
        } else if (face === "left") {
          border = new Uint8Array(CHUNK_HEIGHT * CHUNK_LENGTH);
          for (let y = 0; y < CHUNK_HEIGHT; y++)
            for (let z = 0; z < CHUNK_LENGTH; z++)
              border[y * CHUNK_LENGTH + z] =
                light[calculateOffset(CHUNK_WIDTH - 1, y, z)];
          borderLights.left = border.buffer;
        }
      }
    };

    extractBorder(chunkX, chunkY + 1, chunkZ, "top");
    extractBorder(chunkX, chunkY - 1, chunkZ, "bottom");
    extractBorder(chunkX, chunkY, chunkZ + 1, "front");
    extractBorder(chunkX, chunkY, chunkZ - 1, "back");
    extractBorder(chunkX + 1, chunkY, chunkZ, "right");
    extractBorder(chunkX - 1, chunkY, chunkZ, "left");

    return { borders, borderLights };
  }

  function regenerateChunkMesh(chunkX: number, chunkY: number, chunkZ: number) {
    if (materialsRef.current.opaque && materialsRef.current.transparent) {
      const chunkName = generateChunkName(chunkX, chunkY, chunkZ);
      const currentVersion = chunkVersions.current[chunkName];

      if (!lightChunks.current[chunkName]) return;

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
            };
            transparent: {
              positions: ArrayBuffer;
              normals: ArrayBuffer;
              indices: ArrayBuffer;
              uvs: ArrayBuffer;
              textureIndices: ArrayBuffer;
              lightLevels: ArrayBuffer;
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
                chunkZ
              );
            }
          }
        )
        .catch((err) => {
          console.error(err);
        });
    }
  }

  function generateChunkName(chunkX: number, chunkY: number, chunkZ: number) {
    return `${chunkX},${chunkY},${chunkZ}`;
  }

  let prevTime = performance.now();

  function pruneChunkMesh(chunkName: string) {
    let mesh = scene.getObjectByName(chunkName) as THREE.Mesh;
    while (mesh) {
      mesh.geometry.dispose();
      mesh.removeFromParent();
      mesh = scene.getObjectByName(chunkName) as THREE.Mesh;
    }

    let transparentMesh = scene.getObjectByName(
      chunkName + "_transparent"
    ) as THREE.Mesh;
    while (transparentMesh) {
      transparentMesh.geometry.dispose();
      transparentMesh.removeFromParent();
      transparentMesh = scene.getObjectByName(
        chunkName + "_transparent"
      ) as THREE.Mesh;
    }
  }

  function pruneChunks(
    playerChunkX: number,
    playerChunkY: number,
    playerChunkZ: number
  ) {
    let prunedChunkPositions: typeof chunkPositions.current = [];
    let prunedChunks: typeof chunks.current = {};
    chunkPositions.current.forEach((chunkPosition) => {
      const chunkName = generateChunkName(
        chunkPosition.chunkX,
        chunkPosition.chunkY,
        chunkPosition.chunkZ
      );
      if (
        new THREE.Vector3(
          chunkPosition.chunkX,
          chunkPosition.chunkY,
          chunkPosition.chunkZ
        ).distanceTo(
          new THREE.Vector3(playerChunkX, playerChunkY, playerChunkZ)
        ) > CHUNK_PRUNING_DISTANCE
      ) {
        pruneChunkMesh(chunkName);
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
    _chunkZ: number
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
      tickChunks();
    }, 50); // 20 ticks per second

    return () => clearInterval(tickInterval);
  }, []);

  function saveWorld() {
    if (!playerControlsRef.current) return;
    const playerObj = playerControlsRef.current.controls.object;
    const saveData = {
      seed: seedRef.current,
      modifiedChunks: Array.from(modifiedChunks.current.entries()).map(
        ([key, map]) => [key, Array.from(map.entries())]
      ),
      position: {
        x: playerObj.position.x,
        y: playerObj.position.y,
        z: playerObj.position.z,
      },
      rotation: {
        x: playerObj.rotation.x,
        y: playerObj.rotation.y,
        z: playerObj.rotation.z,
      },
      hotbarSlots: normalizeHotbar(hotbarSlotsRef.current),
    };
    localStorage.setItem("hazhir-dev-save", JSON.stringify(saveData));
    alert("World saved!");
  }

  function loadWorld() {
    const saveString = localStorage.getItem("hazhir-dev-save");
    if (!saveString) {
      alert("No save found!");
      return;
    }
    try {
      const saveData = JSON.parse(saveString);
      seedRef.current = saveData.seed;
      modifiedChunks.current = new Map(
        saveData.modifiedChunks.map(
          ([key, entries]: [string, [number, number][]]) => [
            key,
            new Map(entries),
          ]
        )
      );
      setHotbarSlots(normalizeHotbar(saveData.hotbarSlots));

      if (playerControlsRef.current) {
        const playerObj = playerControlsRef.current.controls.object;
        playerObj.position.set(
          saveData.position.x,
          saveData.position.y,
          saveData.position.z
        );
        playerObj.rotation.set(
          saveData.rotation.x,
          saveData.rotation.y,
          saveData.rotation.z
        );
      }

      startWorldGeneration(seedRef.current);
      alert("World loaded!");
    } catch (e) {
      console.error("Failed to load save:", e);
      alert("Failed to load save!");
    }
  }

  const render = () => {
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
      const playerChunkX = Math.floor(camera.position.x / CHUNK_WIDTH);
      const playerChunkY = Math.floor(camera.position.y / CHUNK_HEIGHT);
      const playerChunkZ = Math.floor(camera.position.z / CHUNK_LENGTH);

      // Find what block we're looking at
      let lookingAtBlock: { x: number; y: number; z: number } | null = null;
      let blockAtCursor: { type: number; light: number } | null = null;

      if (playerControlsRef.current?.controls.isLocked) {
        let cameraDirection: THREE.Vector3 = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);
        cameraDirection.normalize();
        cameraDirection.multiplyScalar(0.02);

        let currentPoint = new THREE.Vector3(
          camera.position.x,
          camera.position.y,
          camera.position.z
        );

        let lastX = Math.round(currentPoint.x);
        let lastY = Math.round(currentPoint.y);
        let lastZ = Math.round(currentPoint.z);

        for (let step = 0; step < 5 * 50; step++) {
          const x = Math.round(currentPoint.x);
          const y = Math.round(currentPoint.y);
          const z = Math.round(currentPoint.z);

          currentPoint = currentPoint.add(
            new THREE.Vector3(
              cameraDirection.x,
              cameraDirection.y,
              cameraDirection.z
            )
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
    }

    // document.getElementById("crosshairLayer")!.innerHTML = `Chunks: ${
    //   scene.children.length
    // }<br />Blocks: ${
    //   scene.children.length * CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH
    // }`;

    if (playerControlsRef.current) {
      playerControlsRef.current.update(delta);

      if (networkManager.current.myPeerId) {
        const obj = playerControlsRef.current.controls.object;
        networkManager.current.send({
          type: "PLAYER_UPDATE",
          id: networkManager.current.myPeerId,
          position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
          rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
        });
      }
    }

    remotePlayers.current.forEach((rp) => rp.update(delta));

    prevTime = time;

    renderer.render(scene, camera);
    // stats.end();
  };

  return (
    <div className="text-md w-full h-full bg-background" ref={containerRef}>
      <UILayer
        onHost={() => {
          networkManager.current.hostGame().then((id) => setPeerId(id));
        }}
        onJoin={(id) => {
          networkManager.current.joinGame(id);
        }}
        onSave={saveWorld}
        onLoad={loadWorld}
        peerId={peerId}
        selectedSlot={selectedSlot}
        hotbarSlots={hotbarSlots}
        isInventoryOpen={isInventoryOpen}
        onSelectBlock={(block) => {
          const clampedIndex = Math.max(
            0,
            Math.min(selectedSlot, HOTBAR_SIZE - 1)
          );
          const base = normalizeHotbar(hotbarSlots);
          const newSlots = [...base];
          newSlots[clampedIndex] = block;
          setHotbarSlots(newSlots);
        }}
        debugInfo={debugInfo}
        isDebugVisible={isDebugVisible}
      />
    </div>
  );
}
