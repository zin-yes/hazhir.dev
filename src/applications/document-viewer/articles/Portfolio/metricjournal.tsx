export default function MetricJournalDocument() {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-xl font-semibold">Metric Journal</h2>
        <p className="text-sm text-muted-foreground">
          A tracking tool for personal metrics, trends, and weekly summaries.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide">
          Highlights
        </h3>
        <ul className="list-disc pl-5 text-sm space-y-1">
          <li>Timeline charts and insights</li>
          <li>Exportable reports</li>
          <li>Consistent design system</li>
        </ul>
      </section>
    </div>
  );
}
