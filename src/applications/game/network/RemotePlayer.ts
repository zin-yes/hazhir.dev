import * as THREE from "three";

export class RemotePlayer {
  public id: string;
  public mesh: THREE.Mesh;
  private targetPosition: THREE.Vector3;
  private targetRotation: THREE.Quaternion;

  constructor(id: string, scene: THREE.Scene, initialPosition: THREE.Vector3) {
    this.id = id;
    this.targetPosition = initialPosition.clone();
    this.targetRotation = new THREE.Quaternion();

    // Simple player mesh: 0.6 x 1.8 x 0.6 box
    const geometry = new THREE.BoxGeometry(0.6, 1.8, 0.6);
    const material = new THREE.MeshStandardMaterial({ color: 0xff0000 }); // Red player
    this.mesh = new THREE.Mesh(geometry, material);

    this.mesh.position.copy(initialPosition);
    // Adjust pivot if necessary, but center is fine for now if we offset y by half height
    this.mesh.position.y -= 0.72;

    scene.add(this.mesh);
  }

  public updatePosition(
    position: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number }
  ) {
    this.targetPosition.set(position.x, position.y, position.z);
    // Assuming rotation is Euler for now, or direction vector.
    // Let's assume the packet sends Euler angles or direction.
    // For simplicity, let's just look at the rotation.
    // If rotation is passed as Euler:
    // this.mesh.rotation.set(rotation.x, rotation.y, rotation.z);
  }

  public update(delta: number) {
    // Interpolate position
    this.mesh.position.lerp(this.targetPosition, 10 * delta);

    // Adjust visual mesh to be grounded (since position is usually feet or eye level)
    // If the incoming position is feet position:
    // The mesh center is at (0, 0, 0) relative to the mesh object.
    // If we want the mesh bottom to be at the position, we need to offset the geometry or the mesh.
    // In constructor I added 0.9. But if targetPosition is updated, I need to maintain that offset relative to the "player position".
    // Let's assume the network sends the "feet" position.
    // So the mesh center should be at targetPosition.y + 0.9

    const renderPos = this.targetPosition.clone();
    renderPos.y -= 0.72;

    this.mesh.position.lerp(renderPos, 10 * delta);
  }

  public dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
