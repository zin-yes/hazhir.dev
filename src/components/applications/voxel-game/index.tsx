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
const WORLD_LENGTH = 10;

const CHUNK_WIDTH = 8;
const CHUNK_HEIGHT = 256;
const CHUNK_LENGTH = 8;

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
    STONE,
    LIMESTONE,
    GRASS_FLOWER,
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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

  const STONE_TEXTURE = new THREE.TextureLoader().load(
    "/voxel-game/blocks/stone.png"
  );
  STONE_TEXTURE.name = "stone";
  STONE_TEXTURE.wrapS = THREE.RepeatWrapping;
  STONE_TEXTURE.wrapT = THREE.RepeatWrapping;
  STONE_TEXTURE.minFilter = THREE.NearestFilter;
  STONE_TEXTURE.magFilter = THREE.NearestFilter;
  STONE_TEXTURE.colorSpace = THREE.SRGBColorSpace;

  const GRASS_TOP_FLOWER_TEXTURE = new THREE.TextureLoader().load(
    "/voxel-game/blocks/grass_top_flowers.png"
  );
  GRASS_TOP_FLOWER_TEXTURE.name = "grass_top_flowers";
  GRASS_TOP_FLOWER_TEXTURE.wrapS = THREE.RepeatWrapping;
  GRASS_TOP_FLOWER_TEXTURE.wrapT = THREE.RepeatWrapping;
  GRASS_TOP_FLOWER_TEXTURE.minFilter = THREE.NearestFilter;
  GRASS_TOP_FLOWER_TEXTURE.magFilter = THREE.NearestFilter;
  GRASS_TOP_FLOWER_TEXTURE.colorSpace = THREE.SRGBColorSpace;

  const GRASS_FLOWER_SIDE_TEXTURE = new THREE.TextureLoader().load(
    "/voxel-game/blocks/grass_side.png"
  );
  GRASS_FLOWER_SIDE_TEXTURE.name = "grass_side_flower";
  GRASS_FLOWER_SIDE_TEXTURE.wrapS = THREE.RepeatWrapping;
  GRASS_FLOWER_SIDE_TEXTURE.wrapT = THREE.RepeatWrapping;
  GRASS_FLOWER_SIDE_TEXTURE.minFilter = THREE.NearestFilter;
  GRASS_FLOWER_SIDE_TEXTURE.magFilter = THREE.NearestFilter;
  GRASS_FLOWER_SIDE_TEXTURE.colorSpace = THREE.SRGBColorSpace;

  const LIMESTONE_TEXTURE = new THREE.TextureLoader().load(
    "/voxel-game/blocks/limestone.png"
  );
  LIMESTONE_TEXTURE.name = "limestone";
  LIMESTONE_TEXTURE.wrapS = THREE.RepeatWrapping;
  LIMESTONE_TEXTURE.wrapT = THREE.RepeatWrapping;
  LIMESTONE_TEXTURE.minFilter = THREE.NearestFilter;
  LIMESTONE_TEXTURE.magFilter = THREE.NearestFilter;
  LIMESTONE_TEXTURE.colorSpace = THREE.SRGBColorSpace;

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
  textures.push(STONE_TEXTURE);
  textures.push(GRASS_TOP_FLOWER_TEXTURE);
  textures.push(LIMESTONE_TEXTURE);

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

  useEffect(() => {
    if (containerRef.current) {
      if (!initialized.current) {
        initialized.current = true;

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
        indicatorMesh.name = "indicator";

        scene.add(indicatorMesh);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.castShadow = true;
        scene.add(directionalLight);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
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

        camera.position.x = (WORLD_WIDTH * CHUNK_WIDTH) / 2;
        camera.position.y =
          getSurfaceHeight(
            seed,
            (WORLD_WIDTH * CHUNK_WIDTH) / 2,
            (WORLD_LENGTH * CHUNK_LENGTH) / 2
          ) + 2;
        camera.position.z = (WORLD_LENGTH * CHUNK_LENGTH) / 2;

        generateChunks(seed);
      }
    }
  }, [containerRef, overlay]);

  function getDirtHeight(seed: number, x: number, z: number): number {
    noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
    noise.SetFractalType(FastNoiseLite.FractalType.FBm);
    noise.SetSeed(seed);
    noise.SetFrequency(0.004);
    noise.SetFractalOctaves(1);
    noise.SetFractalLacunarity(0);
    noise.SetFractalGain(0);
    noise.SetFractalWeightedStrength(0);

    const dirtHeight = 13 + noise.GetNoise(x, 0, z) * 5;
    return dirtHeight;
  }

  const seed = Math.round(Math.random() * 1000);
  //const seed = 69420;
  let noise = new FastNoiseLite();
  function getSurfaceHeight(seed: number, x: number, z: number): number {
    noise.SetSeed(seed);
    noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
    noise.SetFractalType(FastNoiseLite.FractalType.FBm);
    noise.SetFrequency(0.0035);
    noise.SetFractalOctaves(4);
    noise.SetFractalLacunarity(2.24);
    noise.SetFractalGain(0.42);
    noise.SetFractalWeightedStrength(0);

    const noiseValue = noise.GetNoise(x, 0, z);
    let surfaceY = 0;

    //y=mx+b
    if (noiseValue >= -1 && noiseValue <= 0.3) {
      surfaceY = 38.4615 * noiseValue + (88.4615 / 256) * CHUNK_HEIGHT;
    } else if (noiseValue >= 0.3 && noiseValue <= 0.4) {
      surfaceY = 500 * noiseValue + (-50 / 256) * CHUNK_HEIGHT;
    } else if (noiseValue >= 0.4 && noiseValue <= 1.0) {
      surfaceY = 20 * noiseValue - 7 + (150 / 256) * CHUNK_HEIGHT;
    }

    return surfaceY;
  }

  function getFlowerGrassNoise(seed: number, x: number, z: number): number {
    noise.SetSeed(seed);
    noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
    noise.SetFractalType("None");
    noise.SetFrequency(0.005);
    noise.SetFractalOctaves(1);
    noise.SetFractalLacunarity(0);
    noise.SetFractalGain(0);
    noise.SetFractalWeightedStrength(0);
    const noiseValue = noise.GetNoise(x, 0, z);
    return noiseValue;
  }

  function getSplochNoise(
    seed: number,
    x: number,
    y: number,
    z: number
  ): number {
    noise.SetSeed(seed);
    noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
    noise.SetFractalType("None");
    noise.SetFrequency(0.04);
    noise.SetFractalOctaves(1);
    noise.SetFractalLacunarity(0);
    noise.SetFractalGain(0);
    noise.SetFractalWeightedStrength(0);

    const noiseValue = noise.GetNoise(x, y, z);
    return noiseValue;
  }

  function getTunnelCaveNoise(
    seed: number,
    x: number,
    y: number,
    z: number
  ): number {
    noise.SetSeed(seed);
    noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
    noise.SetFractalType(FastNoiseLite.FractalType.PingPong);
    noise.SetFrequency(0.01);
    noise.SetFractalOctaves(1);
    noise.SetFractalLacunarity(2.0);
    noise.SetFractalGain(0.5);
    noise.SetFractalWeightedStrength(0);
    noise.SetFractalPingPongStrength(1.17);

    const noiseValue = noise.GetNoise(x, y * 3, z);
    return noiseValue;
  }

  function getChamberCaveNoise(
    seed: number,
    x: number,
    y: number,
    z: number
  ): number {
    noise.SetSeed(seed);
    noise.SetNoiseType(FastNoiseLite.NoiseType.Cellular);
    noise.SetFractalType(FastNoiseLite.FractalType.None);
    noise.SetFrequency(0.03);
    noise.SetFractalOctaves(1);
    noise.SetFractalLacunarity(0);
    noise.SetFractalGain(0);
    noise.SetFractalWeightedStrength(0);
    noise.SetCellularDistanceFunction(
      FastNoiseLite.CellularDistanceFunction.Euclidean
    );
    noise.SetCellularReturnType(FastNoiseLite.CellularReturnType.Distance2Mul);

    const noiseValue = noise.GetNoise(x, y * 3, z);
    return noiseValue;
  }

  function getPorousnessNoise(
    seed: number,
    x: number,
    y: number,
    z: number
  ): number {
    noise.SetSeed(seed);
    noise.SetNoiseType(FastNoiseLite.NoiseType.Perlin);
    noise.SetFractalType(FastNoiseLite.FractalType.None);
    noise.SetFrequency(0.009);

    const noiseValue = noise.GetNoise(x, 0, z);
    return noiseValue;
  }

  function generateBlock(
    seed: number,
    x: number,
    y: number,
    z: number
  ): number {
    const flowerGrassNoise = getFlowerGrassNoise(seed, x, z);
    const splochNoise = getSplochNoise(seed, x, y, z);
    const tunnelCaveNoise = getTunnelCaveNoise(seed, x, y, z);
    const chamberCaveNoise = getChamberCaveNoise(seed, x, y, z);
    const porousnessNoise = getPorousnessNoise(seed, x, y, z);

    const surfaceY = getSurfaceHeight(seed, x, z);
    const seaLevel = 80;
    //const dirtHeight = 10;
    const dirtHeight = getDirtHeight(seed, x, z);
    const limestoneHeight = 40;
    //return Math.random() > 0.5 ? BlockType.COBBLESTONE : BlockType.AIR;

    let block = BlockType.AIR;

    //const isTunnelCave = tunnelCaveNoise <= -0.88 + porousnessNoise * 0.2;
    //const isTunnelCave = tunnelCaveNoise > -0.1 && tunnelCaveNoise < 0.1;
    const isTunnelCave = false;

    if (y < surfaceY) {
      if (y > surfaceY - 1) {
        if (flowerGrassNoise > 0.855) {
          block = BlockType.GRASS_FLOWER;
        } else {
          block = BlockType.GRASS;
        }
      } else {
        const isChamberCave = chamberCaveNoise > -0.7 + porousnessNoise * 0.2;
        //const isChamberCave = chamberCaveNoise > 0.5 + porousnessNoise * 0.2;
        //const isChamberCave = false;

        if (y > surfaceY - dirtHeight) {
          block = BlockType.DIRT;
        } else if (y > surfaceY - dirtHeight - limestoneHeight) {
          if (isChamberCave) return BlockType.AIR;
          if (isTunnelCave) return BlockType.AIR;
          block = BlockType.STONE;
        } else {
          if (isChamberCave) return BlockType.AIR;
          if (isTunnelCave) return BlockType.AIR;
          block = BlockType.LIMESTONE;
        }

        if (
          (splochNoise >= 0.85 || splochNoise <= -0.85) &&
          (block === BlockType.STONE || block === BlockType.LIMESTONE)
        ) {
          block = BlockType.COBBLESTONE;
        }
      }
    }

    if (block === BlockType.AIR && y < seaLevel) block = BlockType.GLASS;

    if (block === BlockType.GLASS && y === surfaceY) block = BlockType.DIRT;

    return block;
  }

  let chunks: number[][][][][] = [];

  function initiateChunk() {
    let chunk = [];
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      let arrayArray: number[][] = [];
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        let array: number[] = [];
        for (let z = 0; z < CHUNK_LENGTH; z++) {
          array.push(BlockType.COBBLESTONE);
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
      for (let chunkY = 0; chunkY < WORLD_LENGTH; chunkY++) {
        chunkRow.push(initiateChunk());
      }
      chunks.push(chunkRow);
    }
  }
  function generateChunks(seed: number) {
    initiateChunks();
    for (let chunkX = 0; chunkX < WORLD_WIDTH; chunkX++) {
      for (let chunkY = 0; chunkY < WORLD_LENGTH; chunkY++) {
        generateChunk(seed, chunkX, chunkY);
      }
    }
  }

  function generateChunk(seed: number, chunkX: number, chunkY: number) {
    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        for (let z = 0; z < CHUNK_LENGTH; z++) {
          chunks[chunkX][chunkY][x][y][z] = generateBlock(
            seed,
            x + CHUNK_WIDTH * chunkX,
            y,
            z + CHUNK_LENGTH * chunkY
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
        chunkY = Math.floor(z / CHUNK_LENGTH);

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
          chunkY >= WORLD_LENGTH
        ) {
          continue;
        }
        if (
          chunks[chunkX][chunkY][x % CHUNK_WIDTH][y][z % CHUNK_LENGTH] &&
          chunks[chunkX][chunkY][x % CHUNK_WIDTH][y][z % CHUNK_LENGTH] !==
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
        const newBlockChunkY = Math.floor(newBlockZ / CHUNK_LENGTH);

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
          newBlockChunkY >= WORLD_LENGTH
        ) {
          return;
        }

        if (
          chunks[newBlockChunkX][newBlockChunkY][newBlockX % CHUNK_WIDTH][
            newBlockY
          ][newBlockZ % CHUNK_LENGTH] !== BlockType.AIR
        )
          return;

        chunks[newBlockChunkX][newBlockChunkY][newBlockX % CHUNK_WIDTH][
          newBlockY
        ][newBlockZ % CHUNK_LENGTH] = currentBlock + 1;
        if (currentBlock + 1 === BlockType.GLASS) {
          constructChunkMesh(
            TextureTypes.glass,
            newBlockChunkX,
            newBlockChunkY
          );
        } else if (currentBlock + 1 === BlockType.LEAVES) {
          constructChunkMesh(
            TextureTypes.leaves,
            newBlockChunkX,
            newBlockChunkY
          );
        } else {
          constructChunkMeshes(newBlockChunkX, newBlockChunkY);
        }
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
        chunkY = Math.floor(z / CHUNK_LENGTH);

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
          chunkY >= WORLD_LENGTH
        ) {
          continue;
        }
        if (
          chunks[chunkX][chunkY][x % CHUNK_WIDTH][y][z % CHUNK_LENGTH] &&
          chunks[chunkX][chunkY][x % CHUNK_WIDTH][y][z % CHUNK_LENGTH] !==
            BlockType.AIR
        ) {
          scene.getObjectByName("indicator")!.position.x = x;
          scene.getObjectByName("indicator")!.position.y = y;
          scene.getObjectByName("indicator")!.position.z = z;
          result = chunks[chunkX][chunkY][x % CHUNK_WIDTH][y][z % CHUNK_LENGTH];
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
        chunkY = Math.floor(z / CHUNK_LENGTH);

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
          chunkY >= WORLD_LENGTH
        ) {
          continue;
        }
        if (
          chunks[chunkX][chunkY][x % CHUNK_WIDTH][y][z % CHUNK_LENGTH] &&
          chunks[chunkX][chunkY][x % CHUNK_WIDTH][y][z % CHUNK_LENGTH] !==
            BlockType.AIR
        ) {
          hit = true;
          break;
        }
      }

      if (hit) {
        chunks[chunkX][chunkY][x % CHUNK_WIDTH][y][z % CHUNK_LENGTH] =
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

  interface TextureType {
    type: BlockType;
    appliesTo: BlockFace[];
    texture: THREE.Texture;
  }

  const TextureTypes: any = {
    cobblestone: {
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
    stone: {
      type: BlockType.STONE,
      appliesTo: [
        BlockFace.TOP_FACE,
        BlockFace.BOTTOM_FACE,
        BlockFace.LEFT_FACE,
        BlockFace.RIGHT_FACE,
        BlockFace.FRONT_FACE,
        BlockFace.BACK_FACE,
      ],
      texture: STONE_TEXTURE,
    },
    limestone: {
      type: BlockType.LIMESTONE,
      appliesTo: [
        BlockFace.TOP_FACE,
        BlockFace.BOTTOM_FACE,
        BlockFace.LEFT_FACE,
        BlockFace.RIGHT_FACE,
        BlockFace.FRONT_FACE,
        BlockFace.BACK_FACE,
      ],
      texture: LIMESTONE_TEXTURE,
    },
    dirt: {
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
    sand: {
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
    planks: {
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
    glass: {
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
    grass_top: {
      type: BlockType.GRASS,
      appliesTo: [BlockFace.TOP_FACE],
      texture: GRASS_TOP_TEXTURE,
    },
    grass_side: {
      type: BlockType.GRASS,
      appliesTo: [
        BlockFace.LEFT_FACE,
        BlockFace.RIGHT_FACE,
        BlockFace.FRONT_FACE,
        BlockFace.BACK_FACE,
      ],
      texture: GRASS_SIDE_TEXTURE,
    },
    grass_bottom: {
      type: BlockType.GRASS,
      appliesTo: [BlockFace.BOTTOM_FACE],
      texture: GRASS_BOTTOM_TEXTURE,
    },
    grass_flower_top: {
      type: BlockType.GRASS_FLOWER,
      appliesTo: [BlockFace.TOP_FACE],
      texture: GRASS_TOP_FLOWER_TEXTURE,
    },
    grass_flower_side: {
      type: BlockType.GRASS_FLOWER,
      appliesTo: [
        BlockFace.LEFT_FACE,
        BlockFace.RIGHT_FACE,
        BlockFace.FRONT_FACE,
        BlockFace.BACK_FACE,
      ],
      texture: GRASS_FLOWER_SIDE_TEXTURE,
    },
    grass_flower_bottom: {
      type: BlockType.GRASS_FLOWER,
      appliesTo: [BlockFace.BOTTOM_FACE],
      texture: GRASS_BOTTOM_TEXTURE,
    },
    leaves: {
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
    log_top_bottom: {
      type: BlockType.LOG,
      appliesTo: [BlockFace.TOP_FACE, BlockFace.BOTTOM_FACE],
      texture: LOG_TOP_BOTTOM_TEXTURE,
    },
    log_side: {
      type: BlockType.LOG,
      appliesTo: [
        BlockFace.LEFT_FACE,
        BlockFace.RIGHT_FACE,
        BlockFace.FRONT_FACE,
        BlockFace.BACK_FACE,
      ],
      texture: LOG_SIDE_TEXTURE,
    },
  };

  function constructChunkMeshes(chunkX: number, chunkY: number) {
    Object.keys(TextureTypes).forEach((textureType) => {
      constructChunkMesh(TextureTypes[textureType], chunkX, chunkY);
    });
    constructChunkMesh(TextureTypes.cobblestone, chunkX, chunkY);
  }

  function constructChunkMesh(
    textureType: TextureType,
    chunkX: number,
    chunkY: number
  ) {
    let chunkGeometry: THREE.BufferGeometry | null = null;

    let geometries: THREE.BufferGeometry[] = [];

    for (let x = 0; x < CHUNK_WIDTH; x++) {
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        for (let z = 0; z < CHUNK_LENGTH; z++) {
          const block = chunks[chunkX][chunkY][x][y][z];

          if (block !== textureType.type || block === BlockType.AIR) continue;

          const isTopEdge = y === CHUNK_HEIGHT - 1;
          const isBottomEdge = y === 0;

          const isRightEdge = x === CHUNK_WIDTH - 1;
          const isLeftEdge = x === 0;

          const isFrontEdge = z === 0;
          const isBackEdge = z === CHUNK_LENGTH - 1;

          const hasBlockAbove =
            !isTopEdge &&
            chunks[chunkX][chunkY][x][y + 1][z] !== BlockType.AIR &&
            chunks[chunkX][chunkY][x][y + 1][z] !== BlockType.GLASS &&
            chunks[chunkX][chunkY][x][y + 1][z] !== BlockType.LEAVES;
          const hasBlockBelow =
            !isBottomEdge &&
            chunks[chunkX][chunkY][x][y - 1][z] !== BlockType.AIR &&
            chunks[chunkX][chunkY][x][y - 1][z] !== BlockType.GLASS &&
            chunks[chunkX][chunkY][x][y - 1][z] !== BlockType.LEAVES;
          const hasBlockToTheLeft =
            !isLeftEdge &&
            chunks[chunkX][chunkY][x - 1][y][z] !== BlockType.AIR &&
            chunks[chunkX][chunkY][x - 1][y][z] !== BlockType.GLASS &&
            chunks[chunkX][chunkY][x - 1][y][z] !== BlockType.LEAVES;
          const hasBlockToTheRight =
            !isRightEdge &&
            chunks[chunkX][chunkY][x + 1][y][z] !== BlockType.AIR &&
            chunks[chunkX][chunkY][x + 1][y][z] !== BlockType.GLASS &&
            chunks[chunkX][chunkY][x + 1][y][z] !== BlockType.LEAVES;
          const hasBlockInfront =
            !isFrontEdge &&
            chunks[chunkX][chunkY][x][y][z - 1] !== BlockType.AIR &&
            chunks[chunkX][chunkY][x][y][z - 1] !== BlockType.GLASS &&
            chunks[chunkX][chunkY][x][y][z - 1] !== BlockType.LEAVES;
          const hasBlockBehind =
            !isBackEdge &&
            chunks[chunkX][chunkY][x][y][z + 1] !== BlockType.AIR &&
            chunks[chunkX][chunkY][x][y][z + 1] !== BlockType.GLASS &&
            chunks[chunkX][chunkY][x][y][z + 1] !== BlockType.LEAVES;

          let faces = [];

          if (
            !hasBlockAbove &&
            textureType.appliesTo.includes(BlockFace.TOP_FACE)
          ) {
            const face = TOP_FACE;

            faces.push(face);
          }

          if (
            !hasBlockBelow &&
            textureType.appliesTo.includes(BlockFace.BOTTOM_FACE)
          ) {
            const face = BOTTOM_FACE;

            faces.push(face);
          }

          if (
            !hasBlockInfront &&
            textureType.appliesTo.includes(BlockFace.FRONT_FACE)
          ) {
            const face = FRONT_FACE;

            faces.push(face);
          }

          if (
            !hasBlockBehind &&
            textureType.appliesTo.includes(BlockFace.BACK_FACE)
          ) {
            const face = BACK_FACE;

            faces.push(face);
          }

          if (
            !hasBlockToTheLeft &&
            textureType.appliesTo.includes(BlockFace.LEFT_FACE)
          ) {
            const face = LEFT_FACE;

            faces.push(face);
          }

          if (
            !hasBlockToTheRight &&
            textureType.appliesTo.includes(BlockFace.RIGHT_FACE)
          ) {
            const face = RIGHT_FACE;

            faces.push(face);
          }

          if (faces.length > 0) {
            const facesGeometry = BufferGeometryUtils.mergeGeometries(faces);
            facesGeometry.translate(x, y, z);
            geometries.push(facesGeometry);
          }
        }
      }
    }

    scene
      .getObjectByName(
        "chunk" + chunkX + "x" + chunkY + "t" + textureType.texture.name
      )
      ?.removeFromParent();
    if (geometries.length > 0) {
      chunkGeometry = BufferGeometryUtils.mergeGeometries(geometries);

      chunkGeometry.translate(CHUNK_WIDTH * chunkX, 0, CHUNK_LENGTH * chunkY);
      chunkGeometry.computeVertexNormals();

      const material = new THREE.MeshPhongMaterial({
        map: textureType.texture,
      });

      if (
        textureType.texture.name === "glass" ||
        textureType.texture.name === "leaves"
      )
        material.transparent = true;

      const chunkMesh = new THREE.Mesh(chunkGeometry, material);
      chunkMesh.name =
        "chunk" + chunkX + "x" + chunkY + "t" + textureType.texture.name;
      chunkMesh.castShadow = true;
      chunkMesh.receiveShadow = true;

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
        controls.moveRight((Number(moveRight) - Number(moveLeft)) * 50 * delta);
      }
      if (moveUp || moveDown) {
        updateIndicator();
        controls.getObject().position.y -=
          (Number(moveDown) - Number(moveUp)) * 50 * delta;
      }
      if (moveForward || moveBackward) {
        updateIndicator();
        controls.moveForward(
          (Number(moveForward) - Number(moveBackward)) * 50 * delta
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
