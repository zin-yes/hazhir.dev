export default function GammaEngineDocument() {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-xl font-semibold">Gamma Engine</h2>
        <p className="text-sm text-muted-foreground">
          A lightweight rendering engine for interactive previews and prototypes.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide">
          Highlights
        </h3>
        <ul className="list-disc pl-5 text-sm space-y-1">
          <li>Modular pipeline stages</li>
          <li>Deterministic updates</li>
          <li>Small bundle footprint</li>
        </ul>
      </section>
    </div>
  );
}
