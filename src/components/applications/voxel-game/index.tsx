"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

import { Sky } from "three/addons/objects/Sky.js";

import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

import Hotbar from "./hotbar";

import {
  BACK_FACE,
  FRONT_FACE,
  TOP_FACE,
  BOTTOM_FACE,
  LEFT_FACE,
  RIGHT_FACE,
} from "./faces";

import { Silkscreen } from "next/font/google";

// @ts-ignore
import FastNoiseLite from "fastnoise-lite";

const font = Silkscreen({ subsets: ["latin"], weight: ["400", "700"] });

const WORLD_WIDTH = 10;
const WORLD_DEPTH = 10;

const CHUNK_WIDTH = 16;
const CHUNK_HEIGHT = 256;
const CHUNK_DEPTH = 16;

export default function VoxelGameApplication() {
  enum BlockType {
    AIR,
    COBBLESTONE,
    DIRT,
    SAND,
    PLANKS,
    GRASS,
    GLASS,
    LOG,
    LEAVES,
  }
  interface Block {
    type: BlockType;
  }

  const containerRef = useRef<HTMLDivElement>(null);

  const fieldOfView = 85;
  let scene = new THREE.Scene();
  let camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(
    fieldOfView,
    1 / 1,
    0.1,
    1000
  );
  let renderer = new THREE.WebGLRenderer({ antialias: true });
  let controls: PointerLockControls;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(0.5 * 2 - 1, -0.5 * 2 + 1);

  let currentBlock = 0;

  let textures: THREE.Texture[] = [];
  const COBBLESTONE_TEXTURE = new THREE.TextureLoader().load(
    "/voxel-game/blocks/cobblestone.png"
  );
  COBBLESTONE_TEXTURE.name = "cobblestone";
  COBBLESTONE_TEXTURE.wrapS = THREE.RepeatWrapping;
  COBBLESTONE_TEXTURE.wrapT = THREE.RepeatWrapping;
  COBBLESTONE_TEXTURE.minFilter = THREE.NearestFilter;
  COBBLESTONE_TEXTURE.magFilter = THREE.NearestFilter;
  COBBLESTONE_TEXTURE.colorSpace = THREE.SRGBColorSpace;

  const DIRT_TEXTURE = new THREE.TextureLoader().load(
    "/voxel-game/blocks/dirt.png"
  );
  DIRT_TEXTURE.name = "dirt";
  DIRT_TEXTURE.wrapS = THREE.RepeatWrapping;
  DIRT_TEXTURE.wrapT = THREE.RepeatWrapping;
  DIRT_TEXTURE.minFilter = THREE.NearestFilter;
  DIRT_TEXTURE.magFilter = THREE.NearestFilter;
  DIRT_TEXTURE.colorSpace = THREE.SRGBColorSpace;

  const SAND_TEXTURE = new THREE.TextureLoader().load(
    "/voxel-game/blocks/sand.png"
  );
  SAND_TEXTURE.name = "sand";
  SAND_TEXTURE.wrapS = THREE.RepeatWrapping;
  SAND_TEXTURE.wrapT = THREE.RepeatWrapping;
  SAND_TEXTURE.minFilter = THREE.NearestFilter;
  SAND_TEXTURE.magFilter = THREE.NearestFilter;
  SAND_TEXTURE.colorSpace = THREE.SRGBColorSpace;

  const PLANKS_TEXTURE = new THREE.TextureLoader().load(
    "/voxel-game/blocks/planks.png"
  );
  PLANKS_TEXTURE.name = "planks";
  PLANKS_TEXTURE.wrapS = THREE.RepeatWrapping;
  PLANKS_TEXTURE.wrapT = THREE.RepeatWrapping;
  PLANKS_TEXTURE.minFilter = THREE.NearestFilter;
  PLANKS_TEXTURE.magFilter = THREE.NearestFilter;
  PLANKS_TEXTURE.colorSpace = THREE.SRGBColorSpace;

  const GLASS_TEXTURE = new THREE.TextureLoader().load(
    "/voxel-game/blocks/glass.png"
  );
  GLASS_TEXTURE.name = "glass";
  GLASS_TEXTURE.wrapS = THREE.RepeatWrapping;
  GLASS_TEXTURE.wrapT = THREE.RepeatWrapping;
  GLASS_TEXTURE.minFilter = THREE.NearestFilter;
  GLASS_TEXTURE.magFilter = THREE.NearestFilter;
  GLASS_TEXTURE.colorSpace = THREE.SRGBColorSpace;

  const GRASS_TOP_TEXTURE = new THREE.TextureLoader().load(
    "/voxel-game/blocks/grass_top.png"
  );
  GRASS_TOP_TEXTURE.name = "grass_top";
  GRASS_TOP_TEXTURE.wrapS = THREE.RepeatWrapping;
  GRASS_TOP_TEXTURE.wrapT = THREE.RepeatWrapping;
  GRASS_TOP_TEXTURE.minFilter = THREE.NearestFilter;
  GRASS_TOP_TEXTURE.magFilter = THREE.NearestFilter;
  GRASS_TOP_TEXTURE.colorSpace = THREE.SRGBColorSpace;

  const GRASS_SIDE_TEXTURE = new THREE.TextureLoader().load(
    "/voxel-game/blocks/grass_side.png"
  );
  GRASS_SIDE_TEXTURE.name = "grass_side";
  GRASS_SIDE_TEXTURE.wrapS = THREE.RepeatWrapping;
  GRASS_SIDE_TEXTURE.wrapT = THREE.RepeatWrapping;
  GRASS_SIDE_TEXTURE.minFilter = THREE.NearestFilter;
  GRASS_SIDE_TEXTURE.magFilter = THREE.NearestFilter;
  GRASS_SIDE_TEXTURE.colorSpace = THREE.SRGBColorSpace;

  const GRASS_BOTTOM_TEXTURE = new THREE.TextureLoader().load(
    "/voxel-game/blocks/dirt.png"
  );
  GRASS_BOTTOM_TEXTURE.name = "grass_bottom";
  GRASS_BOTTOM_TEXTURE.wrapS = THREE.RepeatWrapping;
  GRASS_BOTTOM_TEXTURE.wrapT = THREE.RepeatWrapping;
  GRASS_BOTTOM_TEXTURE.minFilter = THREE.NearestFilter;
  GRASS_BOTTOM_TEXTURE.magFilter = THREE.NearestFilter;
  GRASS_BOTTOM_TEXTURE.colorSpace = THREE.SRGBColorSpace;

  const LOG_TOP_BOTTOM_TEXTURE = new THREE.TextureLoader().load(
    "/voxel-game/blocks/log_top_bottom.png"
  );
  LOG_TOP_BOTTOM_TEXTURE.name = "log_top_bottom";
  LOG_TOP_BOTTOM_TEXTURE.wrapS = THREE.RepeatWrapping;
  LOG_TOP_BOTTOM_TEXTURE.wrapT = THREE.RepeatWrapping;
  LOG_TOP_BOTTOM_TEXTURE.minFilter = THREE.NearestFilter;
  LOG_TOP_BOTTOM_TEXTURE.magFilter = THREE.NearestFilter;
  LOG_TOP_BOTTOM_TEXTURE.colorSpace = THREE.SRGBColorSpace;

  const LOG_SIDE_TEXTURE = new THREE.TextureLoader().load(
    "/voxel-game/blocks/log_side.png"
  );
  LOG_SIDE_TEXTURE.name = "log_side";
  LOG_SIDE_TEXTURE.wrapS = THREE.RepeatWrapping;
  LOG_SIDE_TEXTURE.wrapT = THREE.RepeatWrapping;
  LOG_SIDE_TEXTURE.minFilter = THREE.NearestFilter;
  LOG_SIDE_TEXTURE.magFilter = THREE.NearestFilter;
  LOG_SIDE_TEXTURE.colorSpace = THREE.SRGBColorSpace;

  const LEAVES_TEXTURE = new THREE.TextureLoader().load(
    "/voxel-game/blocks/leaves.png"
  );
  LEAVES_TEXTURE.name = "leaves";
  LEAVES_TEXTURE.wrapS = THREE.RepeatWrapping;
  LEAVES_TEXTURE.wrapT = THREE.RepeatWrapping;
  LEAVES_TEXTURE.minFilter = THREE.NearestFilter;
  LEAVES_TEXTURE.magFilter = THREE.NearestFilter;
  LEAVES_TEXTURE.colorSpace = THREE.SRGBColorSpace;

  textures.push(COBBLESTONE_TEXTURE);
  textures.push(DIRT_TEXTURE);
  textures.push(SAND_TEXTURE);
  textures.push(PLANKS_TEXTURE);
  textures.push(GLASS_TEXTURE);
  textures.push(GRASS_TOP_TEXTURE);
  textures.push(GRASS_SIDE_TEXTURE);
  textures.push(LOG_TOP_BOTTOM_TEXTURE);
  textures.push(LOG_SIDE_TEXTURE);
  textures.push(LEAVES_TEXTURE);

  const initialized = useRef(false);

  const overlay = useRef<HTMLDivElement>(null);

  const resizeObserver = useMemo(
    () =>
      new ResizeObserver(() => {
        const width = containerRef.current!.clientWidth || 1;
        const height = containerRef.current!.clientHeight || 1;

        camera!.aspect = width / height;
        camera!.updateProjectionMatrix();
        renderer.setSize(width, height);
      }),
    [containerRef, camera, renderer]
  );

  const seed = 69420;

  useEffect(() => {
    if (containerRef.current) {
      if (!initialized.current) {
        initialized.current = true;

        const indicatorGeometry = new THREE.BoxGeometry(1, 1, 1);
        const indicatorMaterial = new THREE.MeshBasicMaterial({
          wireframe: true,
          aoMapIntensity: 0,
        });
        indicatorGeometry.scale(1.01, 1.01, 1.01);
        const indicatorMesh = new THREE.Mesh(
          indicatorGeometry,
          indicatorMaterial
        );
        indicatorMesh.name = "indicator";

        scene.add(indicatorMesh);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        scene.add(directionalLight);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
        scene.add(ambientLight);

        controls = new PointerLockControls(camera, containerRef.current);
        renderer.setAnimationLoop(animate);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(
          containerRef.current.clientWidth,
          containerRef.current.clientHeight
        );

        const container = document.createElement("div");
        containerRef.current.appendChild(container);

        containerRef.current.appendChild(renderer.domElement);
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

        containerRef.current.addEventListener(
          "mousemove",
          (event: MouseEvent) => {
            // pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
            // pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
            updateIndicator();
          }
        );

        containerRef.current.addEventListener("contextmenu", (event) => {
          event.preventDefault();
        });
        containerRef.current.addEventListener(
          "mousedown",
          (event: MouseEvent) => {
            if (event.button === 0) {
              breakBlock();
            } else if (event.button === 2) {
              placeBlock();
            }
          }
        );
        resizeObserver.observe(containerRef.current);

        scene.add(controls.getObject());

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
            case "Escape":
              if (overlay.current) {
                if (!controls.isLocked) {
                  overlay.current.style.visibility = "hidden";
                  overlay.current.style.pointerEvents = "none";
                  controls.lock();
                } else {
                  overlay.current!.style.visibility = "visible";
                  overlay.current!.style.pointerEvents = "auto";
                  controls.unlock();
                }
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

        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("keyup", onKeyUp);

        camera.position.x = CHUNK_WIDTH / 2;
        camera.position.y = 110;
        camera.position.z = CHUNK_DEPTH / 2;

        generateChunks(seed);
      }
    }
  }, [containerRef, overlay]);

  const DIRT_HEIGHT = 10;
  function generateBlock(seed: number, x: number, y: number, z: number): Block {
    let noise = new FastNoiseLite();
    noise.SetSeed(seed);
    noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
    noise.SetFractalType(FastNoiseLite.FractalType.FBm);

    const surfaceY = 100 + noise.GetNoise(x, z) * 20;

    return {
      type:
        y < surfaceY
          ? y > surfaceY - 1
            ? BlockType.GRASS
            : y > surfaceY - DIRT_HEIGHT
            ? BlockType.DIRT
            : BlockType.COBBLESTONE
          : BlockType.AIR,
    };
  }

  let chunks: Block[][][][][] = [];

  function initiateChunk() {
    let chunk = [];
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      let arrayArray: Block[][] = [];
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        let array: Block[] = [];
        for (let z = 0; z < CHUNK_DEPTH; z++) {
          array.push({
            type: BlockType.COBBLESTONE,
          });
        }
        arrayArray.push(array);
      }
      chunk.push(arrayArray);
    }

    return chunk;
  }

  function initiateChunks() {
    chunks = [];
    for (let chunkX = 0; chunkX < WORLD_WIDTH; chunkX++) {
      let chunkRow = [];
      for (let chunkY = 0; chunkY < WORLD_DEPTH; chunkY++) {
        chunkRow.push(initiateChunk());
      }
      chunks.push(chunkRow);
    }
  }
  function generateChunks(seed: number) {
    initiateChunks();
    for (let chunkX = 0; chunkX < WORLD_WIDTH; chunkX++) {
      for (let chunkY = 0; chunkY < WORLD_DEPTH; chunkY++) {
        generateChunk(seed, chunkX, chunkY);
      }
    }
  }

  function generateChunk(seed: number, chunkX: number, chunkY: number) {
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        for (let z = 0; z < CHUNK_DEPTH; z++) {
          chunks[chunkX][chunkY][x][y][z] = generateBlock(
            seed,
            x + CHUNK_WIDTH * chunkX,
            y,
            z + CHUNK_DEPTH * chunkY
          );
        }
      }
    }

    constructChunkMeshes(chunkX, chunkY);
  }

  function placeBlock() {
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
      let hit = false;

      let currentPoint = new THREE.Vector3(
        camera.position.x,
        camera.position.y,
        camera.position.z
      );
      let chunkX = 0;
      let chunkY = 0;
      let x = 0;
      let y = 0;
      let z = 0;
      for (let step = 0; step < 5 * 50; step++) {
        x = Math.round(currentPoint.x);
        y = Math.round(currentPoint.y);
        z = Math.round(currentPoint.z);

        chunkX = Math.floor(x / CHUNK_WIDTH);
        chunkY = Math.floor(z / CHUNK_DEPTH);

        currentPoint = currentPoint.add(
          new THREE.Vector3(
            cameraDirection.x,
            cameraDirection.y,
            cameraDirection.z
          )
        );

        if (x < 0 || y < 0 || z < 0 || chunkX < 0 || chunkY < 0) {
          continue;
        }
        if (
          y >= CHUNK_HEIGHT ||
          chunkX >= WORLD_WIDTH ||
          chunkY >= WORLD_DEPTH
        ) {
          continue;
        }
        if (
          chunks[chunkX][chunkY][x % CHUNK_WIDTH][y][z % CHUNK_DEPTH] &&
          chunks[chunkX][chunkY][x % CHUNK_WIDTH][y][z % CHUNK_DEPTH].type !==
            BlockType.AIR
        ) {
          hit = true;
          break;
        }
      }

      if (hit) {
        const newBlockX = x + faceNormal.x;
        const newBlockY = y + faceNormal.y;
        const newBlockZ = z + faceNormal.z;

        const newBlockChunkX = Math.floor(newBlockX / CHUNK_WIDTH);
        const newBlockChunkY = Math.floor(newBlockZ / CHUNK_DEPTH);

        if (
          newBlockX < 0 ||
          newBlockY < 0 ||
          newBlockZ < 0 ||
          newBlockChunkX < 0 ||
          newBlockChunkY < 0
        ) {
          return;
        }
        if (
          newBlockY >= CHUNK_HEIGHT ||
          newBlockChunkX >= WORLD_WIDTH ||
          newBlockChunkY >= WORLD_DEPTH
        ) {
          return;
        }

        if (
          chunks[newBlockChunkX][newBlockChunkY][newBlockX % CHUNK_WIDTH][
            newBlockY
          ][newBlockZ % CHUNK_DEPTH].type !== BlockType.AIR
        )
          return;

        chunks[newBlockChunkX][newBlockChunkY][newBlockX % CHUNK_WIDTH][
          newBlockY
        ][newBlockZ % CHUNK_DEPTH].type = currentBlock + 1;

        constructChunkMeshes(newBlockChunkX, newBlockChunkY);
        updateIndicator();
      }
    }
  }

  function updateIndicator() {
    if (controls.isLocked) {
      let cameraDirection: THREE.Vector3 = new THREE.Vector3();
      camera.getWorldDirection(cameraDirection);
      cameraDirection.normalize();
      cameraDirection.multiplyScalar(0.02);
      let result = null;

      let currentPoint = new THREE.Vector3(
        camera.position.x,
        camera.position.y,
        camera.position.z
      );
      let x = 0;
      let y = 0;
      let z = 0;
      let chunkX = 0;
      let chunkY = 0;
      for (let step = 0; step < 5 * 50; step++) {
        x = Math.round(currentPoint.x);
        y = Math.round(currentPoint.y);
        z = Math.round(currentPoint.z);

        chunkX = Math.floor(x / CHUNK_WIDTH);
        chunkY = Math.floor(z / CHUNK_DEPTH);

        currentPoint = currentPoint.add(
          new THREE.Vector3(
            cameraDirection.x,
            cameraDirection.y,
            cameraDirection.z
          )
        );

        if (x < 0 || y < 0 || z < 0 || chunkX < 0 || chunkY < 0) {
          continue;
        }
        if (
          y >= CHUNK_HEIGHT ||
          chunkX >= WORLD_WIDTH ||
          chunkY >= WORLD_DEPTH
        ) {
          continue;
        }
        if (
          chunks[chunkX][chunkY][x % CHUNK_WIDTH][y][z % CHUNK_DEPTH] &&
          chunks[chunkX][chunkY][x % CHUNK_WIDTH][y][z % CHUNK_DEPTH].type !==
            BlockType.AIR
        ) {
          scene.getObjectByName("indicator")!.position.x = x;
          scene.getObjectByName("indicator")!.position.y = y;
          scene.getObjectByName("indicator")!.position.z = z;
          result = chunks[chunkX][chunkY][x % CHUNK_WIDTH][y][z % CHUNK_DEPTH];
          break;
        }
      }

      if (result) {
        scene.getObjectByName("indicator")!.visible = true;
      } else {
        scene.getObjectByName("indicator")!.visible = false;
      }
    }
  }

  function breakBlock() {
    if (controls.isLocked) {
      let cameraDirection: THREE.Vector3 = new THREE.Vector3();
      camera.getWorldDirection(cameraDirection);
      cameraDirection.normalize();
      cameraDirection.multiplyScalar(0.02);
      let hit = false;

      let currentPoint = new THREE.Vector3(
        camera.position.x,
        camera.position.y,
        camera.position.z
      );
      let x = 0;
      let y = 0;
      let z = 0;
      let chunkX = 0;
      let chunkY = 0;
      for (let step = 0; step < 5 * 50; step++) {
        x = Math.round(currentPoint.x);
        y = Math.round(currentPoint.y);
        z = Math.round(currentPoint.z);

        chunkX = Math.floor(x / CHUNK_WIDTH);
        chunkY = Math.floor(z / CHUNK_DEPTH);

        currentPoint = currentPoint.add(
          new THREE.Vector3(
            cameraDirection.x,
            cameraDirection.y,
            cameraDirection.z
          )
        );

        if (x < 0 || y < 0 || z < 0 || chunkX < 0 || chunkY < 0) {
          continue;
        }
        if (
          y >= CHUNK_HEIGHT ||
          chunkX >= WORLD_WIDTH ||
          chunkY >= WORLD_DEPTH
        ) {
          continue;
        }
        if (
          chunks[chunkX][chunkY][x % CHUNK_WIDTH][y][z % CHUNK_DEPTH] &&
          chunks[chunkX][chunkY][x % CHUNK_WIDTH][y][z % CHUNK_DEPTH].type !==
            BlockType.AIR
        ) {
          hit = true;
          break;
        }
      }

      if (hit) {
        chunks[chunkX][chunkY][x % CHUNK_WIDTH][y][z % CHUNK_DEPTH].type =
          BlockType.AIR;

        let neighbors = [];

        constructChunkMeshes(chunkX, chunkY);
        updateIndicator();
      }
    }
  }

  enum BlockFace {
    TOP_FACE,
    BOTTOM_FACE,
    LEFT_FACE,
    RIGHT_FACE,
    FRONT_FACE,
    BACK_FACE,
  }

  const TEXTURE_TYPES = [
    {
      type: BlockType.COBBLESTONE,
      appliesTo: [
        BlockFace.TOP_FACE,
        BlockFace.BOTTOM_FACE,
        BlockFace.LEFT_FACE,
        BlockFace.RIGHT_FACE,
        BlockFace.FRONT_FACE,
        BlockFace.BACK_FACE,
      ],
      texture: COBBLESTONE_TEXTURE,
    },
    {
      type: BlockType.DIRT,
      appliesTo: [
        BlockFace.TOP_FACE,
        BlockFace.BOTTOM_FACE,
        BlockFace.LEFT_FACE,
        BlockFace.RIGHT_FACE,
        BlockFace.FRONT_FACE,
        BlockFace.BACK_FACE,
      ],
      texture: DIRT_TEXTURE,
    },
    {
      type: BlockType.SAND,
      appliesTo: [
        BlockFace.TOP_FACE,
        BlockFace.BOTTOM_FACE,
        BlockFace.LEFT_FACE,
        BlockFace.RIGHT_FACE,
        BlockFace.FRONT_FACE,
        BlockFace.BACK_FACE,
      ],
      texture: SAND_TEXTURE,
    },
    {
      type: BlockType.PLANKS,
      appliesTo: [
        BlockFace.TOP_FACE,
        BlockFace.BOTTOM_FACE,
        BlockFace.LEFT_FACE,
        BlockFace.RIGHT_FACE,
        BlockFace.FRONT_FACE,
        BlockFace.BACK_FACE,
      ],
      texture: PLANKS_TEXTURE,
    },
    {
      type: BlockType.GLASS,
      appliesTo: [
        BlockFace.TOP_FACE,
        BlockFace.BOTTOM_FACE,
        BlockFace.LEFT_FACE,
        BlockFace.RIGHT_FACE,
        BlockFace.FRONT_FACE,
        BlockFace.BACK_FACE,
      ],
      texture: GLASS_TEXTURE,
    },
    {
      type: BlockType.GRASS,
      appliesTo: [BlockFace.TOP_FACE],
      texture: GRASS_TOP_TEXTURE,
    },
    {
      type: BlockType.GRASS,
      appliesTo: [
        BlockFace.LEFT_FACE,
        BlockFace.RIGHT_FACE,
        BlockFace.FRONT_FACE,
        BlockFace.BACK_FACE,
      ],
      texture: GRASS_SIDE_TEXTURE,
    },
    {
      type: BlockType.GRASS,
      appliesTo: [BlockFace.BOTTOM_FACE],
      texture: GRASS_BOTTOM_TEXTURE,
    },
    {
      type: BlockType.LEAVES,
      appliesTo: [
        BlockFace.TOP_FACE,
        BlockFace.BOTTOM_FACE,
        BlockFace.LEFT_FACE,
        BlockFace.RIGHT_FACE,
        BlockFace.FRONT_FACE,
        BlockFace.BACK_FACE,
      ],
      texture: LEAVES_TEXTURE,
    },
    {
      type: BlockType.LOG,
      appliesTo: [BlockFace.TOP_FACE, BlockFace.BOTTOM_FACE],
      texture: LOG_TOP_BOTTOM_TEXTURE,
    },
    {
      type: BlockType.LOG,
      appliesTo: [
        BlockFace.LEFT_FACE,
        BlockFace.RIGHT_FACE,
        BlockFace.FRONT_FACE,
        BlockFace.BACK_FACE,
      ],
      texture: LOG_SIDE_TEXTURE,
    },
  ];

  function constructChunkMeshes(chunkX: number, chunkY: number) {
    for (
      let textureTypeIndex = 0;
      textureTypeIndex < TEXTURE_TYPES.length;
      textureTypeIndex++
    ) {
      constructChunkMesh(textureTypeIndex, chunkX, chunkY);
    }
  }

  function constructChunkMesh(
    textureTypeIndex: number,
    chunkX: number,
    chunkY: number
  ) {
    const currentTextureType = TEXTURE_TYPES[textureTypeIndex];

    let chunkGeometry: THREE.BufferGeometry | null = null;

    let geometries: THREE.BufferGeometry[] = [];

    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        for (let z = 0; z < CHUNK_DEPTH; z++) {
          const block = chunks[chunkX][chunkY][x][y][z];

          if (
            block.type !== currentTextureType.type ||
            block.type === BlockType.AIR
          )
            continue;

          const isTopEdge = y === CHUNK_HEIGHT - 1;
          const isBottomEdge = y === 0;

          const isRightEdge = x === CHUNK_WIDTH - 1;
          const isLeftEdge = x === 0;

          const isFrontEdge = z === 0;
          const isBackEdge = z === CHUNK_DEPTH - 1;

          const hasBlockAbove =
            !isTopEdge &&
            chunks[chunkX][chunkY][x][y + 1][z].type !== BlockType.AIR &&
            chunks[chunkX][chunkY][x][y + 1][z].type !== BlockType.GLASS &&
            chunks[chunkX][chunkY][x][y + 1][z].type !== BlockType.LEAVES;
          const hasBlockBelow =
            !isBottomEdge &&
            chunks[chunkX][chunkY][x][y - 1][z].type !== BlockType.AIR &&
            chunks[chunkX][chunkY][x][y - 1][z].type !== BlockType.GLASS &&
            chunks[chunkX][chunkY][x][y - 1][z].type !== BlockType.LEAVES;
          const hasBlockToTheLeft =
            !isLeftEdge &&
            chunks[chunkX][chunkY][x - 1][y][z].type !== BlockType.AIR &&
            chunks[chunkX][chunkY][x - 1][y][z].type !== BlockType.GLASS &&
            chunks[chunkX][chunkY][x - 1][y][z].type !== BlockType.LEAVES;
          const hasBlockToTheRight =
            !isRightEdge &&
            chunks[chunkX][chunkY][x + 1][y][z].type !== BlockType.AIR &&
            chunks[chunkX][chunkY][x + 1][y][z].type !== BlockType.GLASS &&
            chunks[chunkX][chunkY][x + 1][y][z].type !== BlockType.LEAVES;
          const hasBlockInfront =
            !isFrontEdge &&
            chunks[chunkX][chunkY][x][y][z - 1].type !== BlockType.AIR &&
            chunks[chunkX][chunkY][x][y][z - 1].type !== BlockType.GLASS &&
            chunks[chunkX][chunkY][x][y][z - 1].type !== BlockType.LEAVES;
          const hasBlockBehind =
            !isBackEdge &&
            chunks[chunkX][chunkY][x][y][z + 1].type !== BlockType.AIR &&
            chunks[chunkX][chunkY][x][y][z + 1].type !== BlockType.GLASS &&
            chunks[chunkX][chunkY][x][y][z + 1].type !== BlockType.LEAVES;

          let faces = [];

          if (
            !hasBlockAbove &&
            currentTextureType.appliesTo.includes(BlockFace.TOP_FACE)
          ) {
            const face = TOP_FACE;

            faces.push(face);
          }

          if (
            !hasBlockBelow &&
            currentTextureType.appliesTo.includes(BlockFace.BOTTOM_FACE)
          ) {
            const face = BOTTOM_FACE;

            faces.push(face);
          }

          if (
            !hasBlockInfront &&
            currentTextureType.appliesTo.includes(BlockFace.FRONT_FACE)
          ) {
            const face = FRONT_FACE;

            faces.push(face);
          }

          if (
            !hasBlockBehind &&
            currentTextureType.appliesTo.includes(BlockFace.BACK_FACE)
          ) {
            const face = BACK_FACE;

            faces.push(face);
          }

          if (
            !hasBlockToTheLeft &&
            currentTextureType.appliesTo.includes(BlockFace.LEFT_FACE)
          ) {
            const face = LEFT_FACE;

            faces.push(face);
          }

          if (
            !hasBlockToTheRight &&
            currentTextureType.appliesTo.includes(BlockFace.RIGHT_FACE)
          ) {
            const face = RIGHT_FACE;

            faces.push(face);
          }

          if (faces.length > 0) {
            const facesGeometry = BufferGeometryUtils.mergeGeometries(faces);
            facesGeometry.translate(x, y, z);
            facesGeometry.computeVertexNormals();
            geometries.push(facesGeometry);
          }
        }
      }
    }

    scene
      .getObjectByName(
        "chunk" +
          chunkX +
          "x" +
          chunkY +
          "t" +
          TEXTURE_TYPES[textureTypeIndex].texture.name
      )
      ?.removeFromParent();
    if (geometries.length > 0) {
      chunkGeometry = BufferGeometryUtils.mergeGeometries(geometries);

      chunkGeometry.translate(CHUNK_WIDTH * chunkX, 0, CHUNK_DEPTH * chunkY);
      chunkGeometry.computeVertexNormals();

      const material = new THREE.MeshBasicMaterial({
        map: currentTextureType.texture,
      });

      if (
        currentTextureType.texture.name === "glass" ||
        currentTextureType.texture.name === "leaves"
      )
        material.transparent = true;

      const chunkMesh = new THREE.Mesh(chunkGeometry, material);
      chunkMesh.name =
        "chunk" +
        chunkX +
        "x" +
        chunkY +
        "t" +
        TEXTURE_TYPES[textureTypeIndex].texture.name;

      scene.add(chunkMesh);
    }
  }

  let moveForward = false;
  let moveBackward = false;
  let moveLeft = false;
  let moveRight = false;
  let moveUp = false;
  let moveDown = false;

  let prevTime = performance.now();

  const animate = () => {
    const time = performance.now();

    if (controls.isLocked === true) {
      const delta = (time - prevTime) / 1000;

      if (moveLeft || moveRight) {
        updateIndicator();
        controls.moveRight((Number(moveRight) - Number(moveLeft)) * 10 * delta);
      }
      if (moveUp || moveDown) {
        updateIndicator();
        controls.getObject().position.y -=
          (Number(moveDown) - Number(moveUp)) * 10 * delta;
      }
      if (moveForward || moveBackward) {
        updateIndicator();
        controls.moveForward(
          (Number(moveForward) - Number(moveBackward)) * 10 * delta
        );
      }
    }

    prevTime = time;

    renderer.render(scene, camera);
  };

  function setCurrentBlock(value: number) {
    currentBlock = value;
  }

  return (
    <div ref={containerRef} className={"w-full h-full"}>
      <div
        className={
          "absolute top-0 bottom-0 right-0 left-0 flex items-center justify-center pointer-events-none mix-blend-difference text-3xl " +
          font.className
        }
      >
        +
      </div>

      <Hotbar setBlock={setCurrentBlock} />
      <div
        className={
          "absolute top-0 bottom-0 right-0 left-0 flex flex-col items-center justify-center text-2xl bg-black opacity-80 " +
          font.className
        }
        ref={overlay}
      >
        <div className="flex flex-col gap-4 w-[80%] justify-center items-center">
          <h1 className="font-bold text-3xl w-full text-center">VOXEL GAME</h1>
          <p className="w-full text-left">
            Press{" "}
            <span className="font-bold text-black bg-white px-2">ESCAPE</span>{" "}
            to start playing.
          </p>
          <p className="w-full text-left">
            Controls are{" "}
            <span className="font-bold text-black bg-white px-2">WASD</span>,{" "}
            <span className="font-bold text-black bg-white px-2">SPACE</span>,{" "}
            <span className="font-bold text-black bg-white px-2">SHIFT</span>.
          </p>
          <p className="w-full text-left">
            Use{" "}
            <span className="font-bold text-black bg-white px-2">
              LEFT CLICK
            </span>{" "}
            and{" "}
            <span className="font-bold text-black bg-white px-2">
              RIGHT CLICK
            </span>{" "}
            to remove and place a block respectively.
          </p>
          <p className="w-full text-left">
            Use the mouse scroll wheel or number keys 1 - 5 to select a block.
          </p>
        </div>
      </div>
    </div>
  );
}
