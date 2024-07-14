import dynamic from "next/dynamic";

const VoxelGame = dynamic(
  () => import("@/components/applications/voxel-game"),
  {
    ssr: false,
  }
);

export default function VoxelGamePage() {
  return (
    <main className="w-[100vw] h-[100vh]">
      <VoxelGame />
    </main>
  );
}
