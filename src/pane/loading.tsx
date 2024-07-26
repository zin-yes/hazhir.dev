import { BackgroundGradientAnimation } from "../components/ui/background-gradient-animation";

export default function LoadingWindow() {
  return (
    <div className="w-full h-full flex justify-center items-center bg-background">
      <h2 className="text-xl">Loading...</h2>
    </div>
  );
}
