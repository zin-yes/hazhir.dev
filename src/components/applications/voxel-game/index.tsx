"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

import { GUI } from "three/addons/libs/lil-gui.module.min.js";
import Stats from "three/addons/libs/stats.module.js";

import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SAOPass } from "three/addons/postprocessing/SAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Sky } from "three/addons/objects/Sky.js";
import Hotbar from "./hotbar";

import { Silkscreen } from "next/font/google";

const font = Silkscreen({ subsets: ["latin"], weight: ["400", "700"] });

import ParticleSystem, {
  Body,
  BoxZone,
  Emitter,
  Gravity,
  Life,
  Mass,
  MeshRenderer,
  Position,
  RadialVelocity,
  Radius,
  Rate,
  Rotate,
  Scale,
  Span,
  Vector3D,
} from "three-nebula";

export default function VoxelGamePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  let scene = new THREE.Scene();
  let camera: THREE.PerspectiveCamera;
  let renderer = new THREE.WebGLRenderer({ antialias: true });
  let composer = new EffectComposer(renderer);
  let renderPass: RenderPass, saoPass: SAOPass;
  let controls: PointerLockControls;

  const resizeObserver = new ResizeObserver(() => {
    const width = containerRef.current!.clientWidth || 1;
    const height = containerRef.current!.clientHeight || 1;

    camera!.aspect = width / height;
    camera!.updateProjectionMatrix();
    renderer.setSize(width, height);

    composer.setSize(width, height);
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(0.5 * 2 - 1, -0.5 * 2 + 1);

  let currentBlock = 0;

  let textures: THREE.Texture[] = [];

  const initialized = useRef(false);

  const overlay = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      if (!initialized.current) {
        initialized.current = true;

        camera = new THREE.PerspectiveCamera(
          75,
          containerRef.current.clientWidth / containerRef.current.clientHeight,
          0.1,
          1000
        );

        const COBBLESTONE = new THREE.TextureLoader().load(
          "/voxel-game/blocks/cobblestone.png"
        );
        COBBLESTONE.name = "cobblestone";
        COBBLESTONE.wrapS = THREE.RepeatWrapping;
        COBBLESTONE.wrapT = THREE.RepeatWrapping;
        COBBLESTONE.minFilter = THREE.NearestFilter;
        COBBLESTONE.magFilter = THREE.NearestFilter;
        COBBLESTONE.colorSpace = THREE.SRGBColorSpace;

        const DIRT = new THREE.TextureLoader().load(
          "/voxel-game/blocks/dirt.png"
        );
        DIRT.name = "dirt";
        DIRT.wrapS = THREE.RepeatWrapping;
        DIRT.wrapT = THREE.RepeatWrapping;
        DIRT.minFilter = THREE.NearestFilter;
        DIRT.magFilter = THREE.NearestFilter;
        DIRT.colorSpace = THREE.SRGBColorSpace;

        const SAND = new THREE.TextureLoader().load(
          "/voxel-game/blocks/sand.png"
        );
        SAND.name = "sand";
        SAND.wrapS = THREE.RepeatWrapping;
        SAND.wrapT = THREE.RepeatWrapping;
        SAND.minFilter = THREE.NearestFilter;
        SAND.magFilter = THREE.NearestFilter;
        SAND.colorSpace = THREE.SRGBColorSpace;

        const PLANKS = new THREE.TextureLoader().load(
          "/voxel-game/blocks/planks.png"
        );
        PLANKS.name = "planks";
        PLANKS.wrapS = THREE.RepeatWrapping;
        PLANKS.wrapT = THREE.RepeatWrapping;
        PLANKS.minFilter = THREE.NearestFilter;
        PLANKS.magFilter = THREE.NearestFilter;
        PLANKS.colorSpace = THREE.SRGBColorSpace;

        const GLASS = new THREE.TextureLoader().load(
          "/voxel-game/blocks/glass.png"
        );
        GLASS.name = "glass";
        GLASS.wrapS = THREE.RepeatWrapping;
        GLASS.wrapT = THREE.RepeatWrapping;
        GLASS.minFilter = THREE.NearestFilter;
        GLASS.magFilter = THREE.NearestFilter;
        GLASS.colorSpace = THREE.SRGBColorSpace;

        textures.push(COBBLESTONE);
        textures.push(DIRT);
        textures.push(SAND);
        textures.push(PLANKS);
        textures.push(GLASS);

        const geometry = new THREE.BoxGeometry(1, 1, 1);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
        scene.add(directionalLight);
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
        scene.add(ambientLight);

        for (let x = -10; x < 10; x++) {
          for (let z = -10; z < 10; z++) {
            const texture = textures[1];
            const material = new THREE.MeshPhongMaterial({
              map: texture,
            });

            const cube = new THREE.Mesh(geometry, material);
            cube.translateX(x);
            cube.translateY(-1);
            cube.translateZ(z);
            scene.add(cube);
          }
        }

        for (let x = -10; x < 10; x++) {
          for (let z = -10; z < 10; z++) {
            const texture = textures[0];
            const material = new THREE.MeshPhongMaterial({
              map: texture,
            });

            const cube = new THREE.Mesh(geometry, material);
            cube.translateX(x);
            cube.translateY(-2);
            cube.translateZ(z);
            scene.add(cube);
          }
        }

        controls = new PointerLockControls(camera, containerRef.current);
        renderer.setAnimationLoop(animate);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(
          containerRef.current.clientWidth,
          containerRef.current.clientHeight
        );

        const container = document.createElement("div");
        containerRef.current.appendChild(container);

        composer = new EffectComposer(renderer);
        renderPass = new RenderPass(scene, camera);
        composer.addPass(renderPass);
        saoPass = new SAOPass(scene, camera, new THREE.Vector2(1, 1));
        composer.addPass(saoPass);
        const outputPass = new OutputPass();
        composer.addPass(outputPass);

        saoPass.params.saoBias = 0.5;
        saoPass.params.saoIntensity = 0.004;
        saoPass.params.saoScale = 1.4;
        saoPass.params.saoKernelRadius = 20;
        saoPass.params.saoMinResolution = 0;
        saoPass.params.saoBlurRadius = 20;
        saoPass.params.saoBlurStdDev = 63.7;
        saoPass.params.saoBlurDepthCutoff = 0.02;
        saoPass.params.saoBlur = true;

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

        // containerRef.current.addEventListener(
        //   "mousemove",
        //   (event: MouseEvent) => {
        //     pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        //     pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
        //   }
        // );

        containerRef.current.addEventListener("contextmenu", (event) => {
          event.preventDefault();
        });
        containerRef.current.addEventListener(
          "mousedown",
          (event: MouseEvent) => {
            raycaster.setFromCamera(pointer, camera);

            const intersections = raycaster.intersectObjects(scene.children);

            if (intersections[0].object == sky) {
              return;
            }
            if (event.button === 2) {
              if (intersections.length > 0) {
                const intersectedBlock = intersections[0];
                const faceNormal = intersectedBlock.face?.normal;

                const texture = textures[currentBlock];
                const material = new THREE.MeshPhongMaterial({
                  map: texture,
                });

                material.transparent = true;
                const cube = new THREE.Mesh(geometry, material);
                cube.translateX(
                  intersectedBlock.object.position.x + faceNormal!.x
                );
                cube.translateY(
                  intersectedBlock.object.position.y + faceNormal!.y
                );
                cube.translateZ(
                  intersectedBlock.object.position.z + faceNormal!.z
                );
                scene.add(cube);
              }
            } else if (event.button === 0) {
              if (intersections.length > 0) {
                intersections[0].object.removeFromParent();
              }

              // if (!controls.isLocked) {
              //   controls.lock();
              // }
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
              if (!controls.isLocked) {
                overlay.current!.style.visibility = "hidden";
                overlay.current!.style.pointerEvents = "none";
                controls.lock();
              } else {
                overlay.current!.style.visibility = "visible";
                overlay.current!.style.pointerEvents = "auto";
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

        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("keyup", onKeyUp);
      }
    }
  }, [containerRef, overlay]);

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

      if (moveLeft || moveRight)
        controls.moveRight((Number(moveRight) - Number(moveLeft)) * 10 * delta);
      if (moveUp || moveDown)
        controls.getObject().position.y -=
          (Number(moveDown) - Number(moveUp)) * 10 * delta;
      if (moveForward || moveBackward)
        controls.moveForward(
          (Number(moveForward) - Number(moveBackward)) * 10 * delta
        );
    }

    prevTime = time;

    composer.render();
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
