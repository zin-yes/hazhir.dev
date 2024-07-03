import CalculatorApp from "../_apps/calculator";

export default function CalculatorPage() {
  return (
    <main className="flex justify-center items-center w-[100vw] h-[100vh]">
      <div className="w-[400px] border-2 rounded-xl">
        <CalculatorApp />
      </div>
    </main>
  );
}
