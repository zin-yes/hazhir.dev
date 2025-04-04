"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import WorkerPool from "workerpool";
import { WorkerUrl } from "worker-url";
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

import * as THREE from "three";

import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import {
  BlockType,
  LOADING_SCREEN_TEXTURES,
  NON_SOLID_BLOCKS,
  Texture,
} from "@/applications/game/blocks";
import { Sky } from "three/addons/objects/Sky.js";
import { calculateOffset, getSurfaceHeightFromSeed } from "./utils";
import UILayer from "./ui";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders/chunk";

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

  let seed = Math.floor(Math.random() * 100000000);

  let chunkPositions: { chunkX: number; chunkY: number; chunkZ: number }[] = [];
  let chunks: { [chunkName: string]: Uint8Array } = {};
  const GenerationWorkerURL = new WorkerUrl(
    new URL("./workers/generation.ts", import.meta.url)
  );
  const generationWorkerPool = useMemo(
    () =>
      WorkerPool.pool(GenerationWorkerURL.toString(), {
        maxWorkers: 3,
      }),
    []
  );
  const MeshWorkerURL = new WorkerUrl(
    new URL("./workers/mesh.ts", import.meta.url)
  );
  const meshWorkerPool = useMemo(
    () =>
      WorkerPool.pool(MeshWorkerURL.toString(), {
        maxWorkers: 3,
      }),
    []
  );
  const TextureArrayWorkerURL = new WorkerUrl(
    new URL("./workers/texture-array.ts", import.meta.url)
  );
  const textureArrayWorkerPool = useMemo(
    () =>
      WorkerPool.pool(TextureArrayWorkerURL.toString(), {
        maxWorkers: 1,
      }),
    []
  );

  const renderer = new THREE.WebGLRenderer({
    // antialias: true,
    alpha: true,
    // logarithmicDepthBuffer: true,
  });

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    85,
    window.innerWidth / window.innerHeight,
    0.1,
    10000
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

  let controls: PointerLockControls;

  let moveForward = false;
  let moveBackward = false;
  let moveLeft = false;
  let moveRight = false;
  let moveUp = false;
  let moveDown = false;

  let textureArray: THREE.DataArrayTexture;
  let shaderMaterial: THREE.ShaderMaterial;

  async function loadTextureArray() {
    const loader = new THREE.ImageLoader();

    const canvas = document.createElement("canvas");
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;
    const context = canvas.getContext("2d", {
      colorSpace: THREE.SRGBColorSpace,
      alpha: false,
      willReadFrequently: true,
    });
    if (context) {
      const textureData: Uint8ClampedArray[] = [];

      const texturesToLoad: string[] = Object.values(Texture);

      for (let i = 0; i < texturesToLoad.length; i++) {
        const image = await loader.loadAsync("game/" + texturesToLoad[i]);
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

      const indicatorGeometry = new THREE.BoxGeometry(1, 1, 1);
      const indicatorMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: false,
      });
      indicatorGeometry.scale(1.01, 1.01, 1.01);
      const indicatorMesh = new THREE.Mesh(
        indicatorGeometry,
        indicatorMaterial
      );
      indicatorMesh.visible = false;
      indicatorMesh.name = "indicator";

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

      controls = new PointerLockControls(camera, containerRef.current);

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
            chunkPositions.push({ chunkX, chunkY, chunkZ });
          }
        }
      }

      textureArrayWorkerPool
        .exec("loadTextureArray", [])
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

            shaderMaterial = new THREE.ShaderMaterial({
              uniforms: {
                Texture: {
                  value: textureArray,
                },
              },
              vertexShader: VERTEX_SHADER,
              fragmentShader: FRAGMENT_SHADER,
              blending: THREE.NormalBlending,
              blendSrcAlpha: THREE.OneFactor,
              transparent: true,
            });

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
                  generationWorkerPool
                    .exec("generateChunk", [seed, chunkX, chunkY, chunkZ])
                    .then((result: ArrayBuffer) => {
                      const chunk = new Uint8Array(result);
                      const chunkName = generateChunkName(
                        chunkX,
                        chunkY,
                        chunkZ
                      );
                      chunks[chunkName] = chunk;

                      meshWorkerPool
                        .exec("generateMesh", [result])
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

                            tasksDone++;

                            setInitialLoadCompletion(
                              tasksDone / initialLoadTasks
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
              }
            }
          }

          setInterval(() => {
            const playerChunkX = Math.round(camera.position.x / CHUNK_WIDTH);
            const playerChunkY = Math.round(camera.position.y / CHUNK_HEIGHT);
            const playerChunkZ = Math.round(camera.position.z / CHUNK_LENGTH);

            pruneChunks(playerChunkX, playerChunkY, playerChunkZ);

            generateNearbyChunks(playerChunkX, playerChunkY, playerChunkZ);
          }, 500);

          renderer.setAnimationLoop(render);
        })
        .catch((error) => {
          console.error(error);
        })
        .then(() => {
          textureArrayWorkerPool.terminate();
        });

      camera.position.y = getSurfaceHeightFromSeed(seed, 0, 0) + 2;
      //camera.position.y = 3;

      const onKeyDown = function (event: KeyboardEvent) {
        switch (event.code) {
          case "ArrowUp":
          case "KeyW":
            moveForward = true;
            break;

          case "ArrowLeft":
          case "KeyA":
            moveLeft = true;
            break;

          case "ArrowDown":
          case "KeyS":
            moveBackward = true;
            break;

          case "ArrowRight":
          case "KeyD":
            moveRight = true;
            break;
          case "Space":
            moveUp = true;
            break;
          case "ShiftLeft":
            moveDown = true;
            break;
        }
      };

      const onKeyUp = function (event: KeyboardEvent) {
        switch (event.code) {
          case "ArrowUp":
          case "Escape":
            if (initialLoadCompletion === 1 && !controls.isLocked) {
              controls.lock();
              document.getElementById("infoLayer")!.style.display = "none";
            } else {
              controls.unlock();
            }
            break;
          case "ArrowUp":
          case "KeyW":
            moveForward = false;
            break;

          case "ArrowLeft":
          case "KeyA":
            moveLeft = false;
            break;

          case "ArrowDown":
          case "KeyS":
            moveBackward = false;
            break;

          case "ArrowRight":
          case "KeyD":
            moveRight = false;
            break;
          case "Space":
            moveUp = false;
            break;
          case "ShiftLeft":
            moveDown = false;
            break;
        }
      };

      const onContextMenu = (event: MouseEvent) => {
        event.preventDefault();
      };

      const onMouseDown = (event: MouseEvent) => {
        if (event.button === 0) {
          breakBlock();
        } else if (event.button === 2) {
          // TODO: add block selection UI
          let randomBlock = Math.floor(Math.random() * 22);
          while (
            NON_SOLID_BLOCKS.includes(randomBlock) ||
            randomBlock === BlockType.WATER
          ) {
            randomBlock = Math.floor(Math.random() * 22);
          }
          placeBlock(randomBlock);
        }
      };

      containerRef.current.addEventListener("contextmenu", onContextMenu);
      containerRef.current.addEventListener("mousedown", onMouseDown);

      document.addEventListener("keydown", onKeyDown);
      document.addEventListener("keyup", onKeyUp);

      // return () => {
      //   document.removeEventListener("keydown", onKeyDown);
      //   document.removeEventListener("keyup", onKeyUp);
      //   document.removeEventListener("contextmenu", onContextMenu);
      //   document.removeEventListener("mousedown", onMouseDown);
      // };
    }
  }, [containerRef]);

  function addChunkToQueue(chunkX: number, chunkY: number, chunkZ: number) {
    chunkPositions.push({ chunkX, chunkY, chunkZ });

    generationWorkerPool
      .exec("generateChunk", [seed, chunkX, chunkY, chunkZ])
      .then((result: ArrayBuffer) => {
        const chunk = new Uint8Array(result);
        const chunkName = generateChunkName(chunkX, chunkY, chunkZ);
        chunks[chunkName] = chunk;

        meshWorkerPool
          .exec("generateMesh", [result])
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
    if (controls.isLocked) {
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
    if (controls.isLocked) {
      raycaster.setFromCamera(pointer, camera);

      const intersections = raycaster.intersectObjects(scene.children);

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

          setBlock(newBlockX, newBlockY, newBlockZ, type);

          updateIndicator();
          break;
        }
      }
    }
  }

  function breakBlock() {
    if (controls.isLocked) {
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
    positions: ArrayBuffer,
    normals: ArrayBuffer,
    indices: ArrayBuffer,
    uvs: ArrayBuffer,
    textureIndices: ArrayBuffer,
    chunkName: string,
    chunkX: number,
    chunkY: number,
    chunkZ: number
  ) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3)
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute(
      "textureIndex",
      new THREE.Int32BufferAttribute(textureIndices, 1)
    );
    geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
    const mesh = new THREE.Mesh(geometry, shaderMaterial);
    mesh.translateX(chunkX * CHUNK_WIDTH - 0.5);
    mesh.translateY(chunkY * CHUNK_HEIGHT - 0.5);
    mesh.translateZ(chunkZ * CHUNK_LENGTH - 0.5);

    mesh.frustumCulled = true;
    mesh.name = chunkName;

    scene.add(mesh);
  }

  function getBlock(x: number, y: number, z: number) {
    const chunkX = Math.floor(x / CHUNK_WIDTH);
    const chunkY = Math.floor(y / CHUNK_HEIGHT);
    const chunkZ = Math.floor(z / CHUNK_LENGTH);

    const chunkName = generateChunkName(chunkX, chunkY, chunkZ);
    const chunk = chunks[chunkName];

    if (!chunk) return BlockType.AIR;

    const blockChunkX = x - chunkX * CHUNK_WIDTH;
    const blockChunkY = y - chunkY * CHUNK_HEIGHT;
    const blockChunkZ = z - chunkZ * CHUNK_LENGTH;

    return chunk[calculateOffset(blockChunkX, blockChunkY, blockChunkZ)];
  }

  function setBlock(x: number, y: number, z: number, type: number) {
    const chunkX = Math.floor(x / CHUNK_WIDTH);
    const chunkY = Math.floor(y / CHUNK_HEIGHT);
    const chunkZ = Math.floor(z / CHUNK_LENGTH);

    const chunkName = generateChunkName(chunkX, chunkY, chunkZ);
    const chunk = chunks[chunkName];

    if (!chunk) return BlockType.AIR;

    const blockChunkX = x - chunkX * CHUNK_WIDTH;
    const blockChunkY = y - chunkY * CHUNK_HEIGHT;
    const blockChunkZ = z - chunkZ * CHUNK_LENGTH;

    chunk[calculateOffset(blockChunkX, blockChunkY, blockChunkZ)] = type;

    regenerateChunkMesh(chunkX, chunkY, chunkZ);
  }

  function regenerateChunkMesh(chunkX: number, chunkY: number, chunkZ: number) {
    if (shaderMaterial) {
      const chunkName = generateChunkName(chunkX, chunkY, chunkZ);
      meshWorkerPool
        .exec("generateMesh", [chunks[chunkName]])
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
            pruneChunkMesh(chunkName);
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
    }
  }

  function generateChunkName(chunkX: number, chunkY: number, chunkZ: number) {
    return `${chunkX},${chunkY},${chunkZ}`;
  }

  let prevTime = performance.now();

  function pruneChunkMesh(chunkName: string) {
    const mesh = scene.getObjectByName(chunkName) as THREE.Mesh;
    if (mesh) {
      mesh.geometry.dispose();
      (mesh.material as THREE.ShaderMaterial).dispose();
      mesh.remove();
      mesh.removeFromParent();
    }
  }

  function pruneChunks(
    playerChunkX: number,
    playerChunkY: number,
    playerChunkZ: number
  ) {
    let prunedChunkPositions: typeof chunkPositions = [];
    let prunedChunks: typeof chunks = {};
    chunkPositions.forEach((chunkPosition) => {
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
        prunedChunks[chunkName] = chunks[chunkName];
      }
    });
    chunks = prunedChunks;
    chunkPositions = prunedChunkPositions;
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
          chunkPositions.forEach((chunkPosition) => {
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

  const render = () => {
    // stats.begin();
    const time = performance.now();

    updateIndicator();

    // document.getElementById("crosshairLayer")!.innerHTML = `Chunks: ${
    //   scene.children.length
    // }<br />Blocks: ${
    //   scene.children.length * CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_LENGTH
    // }`;

    if (controls.isLocked === true) {
      const delta = (time - prevTime) / 1000;

      if (moveLeft || moveRight) {
        controls.moveRight(
          (Number(moveRight) - Number(moveLeft)) * FLYING_SPEED * delta
        );
      }
      if (moveUp || moveDown) {
        controls.getObject().position.y -=
          (Number(moveDown) - Number(moveUp)) * FLYING_SPEED * delta;
      }
      if (moveForward || moveBackward) {
        controls.moveForward(
          (Number(moveForward) - Number(moveBackward)) * FLYING_SPEED * delta
        );
      }
    }

    prevTime = time;

    renderer.render(scene, camera);
    // stats.end();
  };

  return (
    <div className="text-md w-full h-full bg-background" ref={containerRef}>
      <UILayer />
    </div>
  );
}
