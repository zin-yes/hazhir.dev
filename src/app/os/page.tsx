import CalculatorApp from "./_apps/calculator";
import Pane from "./_components/pane";

export default function OperatingSystemPage() {
  return (
    <main className="w-[100vw] h-[100vh]">
      <Pane
        action_bar={{ title: "Calculator" }}
        settings={{ allow_overflow: false }}
      >
        <CalculatorApp />
      </Pane>
    </main>
  );
}
