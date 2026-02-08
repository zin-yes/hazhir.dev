export default function AtlasDocument() {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-xl font-semibold">Atlas</h2>
        <p className="text-sm text-muted-foreground">
          A visual exploration platform for large-scale maps and datasets.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide">
          Highlights
        </h3>
        <ul className="list-disc pl-5 text-sm space-y-1">
          <li>Custom tile rendering pipeline</li>
          <li>Fast pan/zoom interactions</li>
          <li>Searchable layers with metadata</li>
        </ul>
      </section>
    </div>
  );
}
