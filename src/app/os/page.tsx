import CalculatorApp from "./_apps/calculator";
import Pane from "./_components/pane";

export default function OperatingSystemPage() {
  return (
    <main className="w-[100vw] h-[100vh]">
      <CalculatorPane />
    </main>
  );
}

function CalculatorPane() {
  return (
    <Pane
      action_bar={{ title: "Calculator" }}
      settings={{
        min_width: 300,
        min_height: 440,
        starting_width: 350,
        starting_height: 460,
        allow_overflow: false,
      }}
    >
      <CalculatorApp />
    </Pane>
  );
}
