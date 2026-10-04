/** GitHub-style table; returns a placeholder line when there are no rows. */
export function markdownTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "_no data_";
  const escape = (cell: string) => cell.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines = [
    `| ${headers.map(escape).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
  ];
  return lines.join("\n");
}

export function markdownHeading(level: number, text: string): string {
  return `${"#".repeat(level)} ${text}`;
}
