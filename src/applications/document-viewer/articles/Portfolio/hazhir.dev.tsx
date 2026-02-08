export default function HazhirDevDocument() {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-xl font-semibold">hazhir.dev</h2>
        <p className="text-sm text-muted-foreground">
          Personal operating-system-inspired web experience and experiments.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide">
          Highlights
        </h3>
        <ul className="list-disc pl-5 text-sm space-y-1">
          <li>Windowed UI with draggable panes</li>
          <li>Custom app framework</li>
          <li>Interactive visual components</li>
        </ul>
      </section>
    </div>
  );
}
