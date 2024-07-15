import * as THREE from "three";

const BACK_FACE = new THREE.PlaneGeometry(1, 1);
BACK_FACE.translate(0, 0, 0.5);
BACK_FACE.computeVertexNormals();

const FRONT_FACE = new THREE.PlaneGeometry(1, 1);
FRONT_FACE.translate(0, 0, 0.5);
FRONT_FACE.rotateY(180 * (Math.PI / 180));
FRONT_FACE.computeVertexNormals();

const LEFT_FACE = new THREE.PlaneGeometry(1, 1);
LEFT_FACE.rotateY(-90 * (Math.PI / 180));
LEFT_FACE.translate(-0.5, 0, 0);
LEFT_FACE.computeVertexNormals();

const RIGHT_FACE = new THREE.PlaneGeometry(1, 1);
RIGHT_FACE.rotateY(90 * (Math.PI / 180));
RIGHT_FACE.translate(0.5, 0, 0);
RIGHT_FACE.computeVertexNormals();

const TOP_FACE = new THREE.PlaneGeometry(1, 1);
TOP_FACE.rotateX(-90 * (Math.PI / 180));
TOP_FACE.translate(0, 0.5, 0);
TOP_FACE.computeVertexNormals();

const BOTTOM_FACE = new THREE.PlaneGeometry(1, 1);
BOTTOM_FACE.rotateX(90 * (Math.PI / 180));
BOTTOM_FACE.translate(0, -0.5, 0);
BOTTOM_FACE.computeVertexNormals();

export { BACK_FACE, FRONT_FACE, LEFT_FACE, RIGHT_FACE, TOP_FACE, BOTTOM_FACE };
