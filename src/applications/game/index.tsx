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
} from "@/applications/game/blocks";
import { BlockHighlighter } from "./block-highlighter";
import { NetworkManager } from "./network/NetworkManager";
import { RemotePlayer } from "./network/RemotePlayer";
import { PhysicsEngine } from "./physics-engine";
import { PlayerControls } from "./player-controls";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders/chunk";
import UILayer from "./ui/index";
import { calculateOffset, getSurfaceHeightFromSeed } from "./utils";

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
  const intervalRef = useRef<Timer | null>(null);

  const chunkPositions = useRef<
    { chunkX: number; chunkY: number; chunkZ: number }[]
  >([]);
  const chunks = useRef<{ [chunkName: string]: Uint8Array }>({});
  const chunkVersions = useRef<{ [chunkName: string]: number }>({});
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
  const [hotbarSlots, setHotbarSlots] = useState<BlockType[]>([
    BlockType.DIRT,
    BlockType.GRASS,
    BlockType.STONE,
    BlockType.LOG,
    BlockType.PLANKS,
    BlockType.LEAVES,
    BlockType.GLASS,
    BlockType.SAND,
    BlockType.COBBLESTONE,
  ]);
  const hotbarSlotsRef = useRef(hotbarSlots);
  const [isInventoryOpen, setIsInventoryOpen] = useState(false);
  const isInventoryOpenRef = useRef(false);

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
        if (event.key >= "1" && event.key <= "9") {
          setSelectedSlot(parseInt(event.key) - 1);
        }
      }
    };

    const onWheel = (event: WheelEvent) => {
      if (!isInventoryOpen && playerControlsRef.current?.controls.isLocked) {
        const direction = Math.sign(event.deltaY);
        setSelectedSlot((prev) => {
          let next = prev + direction;
          if (next < 0) next = 8;
          if (next > 8) next = 0;
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
    chunkPositions.current = [];

    let initialLoadTasks =
      (POSITIVE_X_RENDER_DISTANCE + NEGATIVE_X_RENDER_DISTANCE) *
      (POSITIVE_Y_RENDER_DISTANCE + NEGATIVE_Y_RENDER_DISTANCE) *
      (POSITIVE_Z_RENDER_DISTANCE + NEGATIVE_Z_RENDER_DISTANCE);

    let tasksDone = 0;

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
          generationWorkerPool
            .exec("generateChunk", [currentSeed, chunkX, chunkY, chunkZ])
            .then((result: ArrayBuffer) => {
              const chunk = new Uint8Array(result);
              const chunkName = generateChunkName(chunkX, chunkY, chunkZ);
              chunks.current[chunkName] = chunk;

              const borders = getChunkBorders(chunkX, chunkY, chunkZ);

              meshWorkerPool
                .exec("generateMesh", [result, borders])
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
                    };
                    transparent: {
                      positions: ArrayBuffer;
                      normals: ArrayBuffer;
                      indices: ArrayBuffer;
                      uvs: ArrayBuffer;
                      textureIndices: ArrayBuffer;
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

                    tasksDone++;

                    setInitialLoadCompletion(tasksDone / initialLoadTasks);
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
      }
    }

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
              document.getElementById("infoLayer")!.style.display = "none";
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
      .then((result: ArrayBuffer) => {
        const chunk = new Uint8Array(result);
        const chunkName = generateChunkName(chunkX, chunkY, chunkZ);
        chunks.current[chunkName] = chunk;

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

        const borders = getChunkBorders(chunkX, chunkY, chunkZ);

        meshWorkerPool
          .exec("generateMesh", [result, borders])
          .then(
            ({
              positions,
              normals,
              indices,
              uvs,
              textureIndices,
            }: {
              positions: ArrayBuffer;
              normals: ArrayBuffer;
              indices: ArrayBuffer;
              uvs: ArrayBuffer;
              textureIndices: ArrayBuffer;
            }) => {
              addChunkMesh(
                positions,
                normals,
                indices,
                uvs,
                textureIndices,
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
        if (getBlock(x, y, z) !== BlockType.AIR) {
          scene.getObjectByName("indicator")!.position.x = x;
          scene.getObjectByName("indicator")!.position.y = y;
          scene.getObjectByName("indicator")!.position.z = z;
          scene.getObjectByName("indicator")!.visible = true;
          return;
        }
      }
      scene.getObjectByName("indicator")!.visible = false;
    }
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(0.5 * 2 - 1, -0.5 * 2 + 1);

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
        if (getBlock(x, y, z) !== BlockType.AIR) {
          const newBlockX = x + faceNormal.x;
          const newBlockY = y + faceNormal.y;
          const newBlockZ = z + faceNormal.z;

          if (getBlock(newBlockX, newBlockY, newBlockZ) !== BlockType.AIR)
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
    },
    transparent: {
      positions: ArrayBuffer;
      normals: ArrayBuffer;
      indices: ArrayBuffer;
      uvs: ArrayBuffer;
      textureIndices: ArrayBuffer;
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
    const chunk = chunks.current[chunkName];

    if (!chunk) return BlockType.AIR;

    const blockChunkX = x - chunkX * CHUNK_WIDTH;
    const blockChunkY = y - chunkY * CHUNK_HEIGHT;
    const blockChunkZ = z - chunkZ * CHUNK_LENGTH;

    chunk[calculateOffset(blockChunkX, blockChunkY, blockChunkZ)] = type;

    if (!chunkVersions.current[chunkName]) chunkVersions.current[chunkName] = 0;
    chunkVersions.current[chunkName]++;

    regenerateChunkMesh(chunkX, chunkY, chunkZ);

    if (blockChunkX === 0) regenerateChunkMesh(chunkX - 1, chunkY, chunkZ);
    if (blockChunkX === CHUNK_WIDTH - 1)
      regenerateChunkMesh(chunkX + 1, chunkY, chunkZ);
    if (blockChunkY === 0) regenerateChunkMesh(chunkX, chunkY - 1, chunkZ);
    if (blockChunkY === CHUNK_HEIGHT - 1)
      regenerateChunkMesh(chunkX, chunkY + 1, chunkZ);
    if (blockChunkZ === 0) regenerateChunkMesh(chunkX, chunkY, chunkZ - 1);
    if (blockChunkZ === CHUNK_LENGTH - 1)
      regenerateChunkMesh(chunkX, chunkY, chunkZ + 1);

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

    // Top (y+1), need y=0
    const topChunk =
      chunks.current[generateChunkName(chunkX, chunkY + 1, chunkZ)];
    if (topChunk) {
      const border = new Uint8Array(CHUNK_WIDTH * CHUNK_LENGTH);
      for (let x = 0; x < CHUNK_WIDTH; x++) {
        for (let z = 0; z < CHUNK_LENGTH; z++) {
          border[x * CHUNK_LENGTH + z] = topChunk[calculateOffset(x, 0, z)];
        }
      }
      borders.top = border.buffer;
    }

    // Bottom (y-1), need y=HEIGHT-1
    const bottomChunk =
      chunks.current[generateChunkName(chunkX, chunkY - 1, chunkZ)];
    if (bottomChunk) {
      const border = new Uint8Array(CHUNK_WIDTH * CHUNK_LENGTH);
      for (let x = 0; x < CHUNK_WIDTH; x++) {
        for (let z = 0; z < CHUNK_LENGTH; z++) {
          border[x * CHUNK_LENGTH + z] =
            bottomChunk[calculateOffset(x, CHUNK_HEIGHT - 1, z)];
        }
      }
      borders.bottom = border.buffer;
    }

    // Front (z+1), need z=0
    const frontChunk =
      chunks.current[generateChunkName(chunkX, chunkY, chunkZ + 1)];
    if (frontChunk) {
      const border = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT);
      for (let x = 0; x < CHUNK_WIDTH; x++) {
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          border[x * CHUNK_HEIGHT + y] = frontChunk[calculateOffset(x, y, 0)];
        }
      }
      borders.front = border.buffer;
    }

    // Back (z-1), need z=LENGTH-1
    const backChunk =
      chunks.current[generateChunkName(chunkX, chunkY, chunkZ - 1)];
    if (backChunk) {
      const border = new Uint8Array(CHUNK_WIDTH * CHUNK_HEIGHT);
      for (let x = 0; x < CHUNK_WIDTH; x++) {
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          border[x * CHUNK_HEIGHT + y] =
            backChunk[calculateOffset(x, y, CHUNK_LENGTH - 1)];
        }
      }
      borders.back = border.buffer;
    }

    // Right (x+1), need x=0
    const rightChunk =
      chunks.current[generateChunkName(chunkX + 1, chunkY, chunkZ)];
    if (rightChunk) {
      const border = new Uint8Array(CHUNK_HEIGHT * CHUNK_LENGTH);
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        for (let z = 0; z < CHUNK_LENGTH; z++) {
          border[y * CHUNK_LENGTH + z] = rightChunk[calculateOffset(0, y, z)];
        }
      }
      borders.right = border.buffer;
    }

    // Left (x-1), need x=WIDTH-1
    const leftChunk =
      chunks.current[generateChunkName(chunkX - 1, chunkY, chunkZ)];
    if (leftChunk) {
      const border = new Uint8Array(CHUNK_HEIGHT * CHUNK_LENGTH);
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        for (let z = 0; z < CHUNK_LENGTH; z++) {
          border[y * CHUNK_LENGTH + z] =
            leftChunk[calculateOffset(CHUNK_WIDTH - 1, y, z)];
        }
      }
      borders.left = border.buffer;
    }

    return borders;
  }

  function regenerateChunkMesh(chunkX: number, chunkY: number, chunkZ: number) {
    if (materialsRef.current.opaque && materialsRef.current.transparent) {
      const chunkName = generateChunkName(chunkX, chunkY, chunkZ);
      const currentVersion = chunkVersions.current[chunkName];

      const borders = getChunkBorders(chunkX, chunkY, chunkZ);

      meshWorkerPool
        .exec("generateMesh", [chunks.current[chunkName], borders])
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
            };
            transparent: {
              positions: ArrayBuffer;
              normals: ArrayBuffer;
              indices: ArrayBuffer;
              uvs: ArrayBuffer;
              textureIndices: ArrayBuffer;
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

        if (block === BlockType.GRASS) {
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

  const render = () => {
    // stats.begin();
    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    updateIndicator();

    // document.getElementById("crosshairLayer")!.innerHTML = `Chunks: ${
    //   scene.children.length
    // }<br />Blocks: ${
    //   scene.children.length * CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH
    // }`;

    if (playerControlsRef.current) {
      playerControlsRef.current.update(delta);

      if (networkManager.current.myPeerId) {
        const obj = playerControlsRef.current.controls.getObject();
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
        peerId={peerId}
        selectedSlot={selectedSlot}
        hotbarSlots={hotbarSlots}
        isInventoryOpen={isInventoryOpen}
        onSelectBlock={(block) => {
          const newSlots = [...hotbarSlots];
          newSlots[selectedSlot] = block;
          setHotbarSlots(newSlots);
        }}
      />
    </div>
  );
}
