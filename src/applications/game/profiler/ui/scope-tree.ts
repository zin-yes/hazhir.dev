import type { TimerSummary } from "../types";

export interface ScopeTreeRow {
  timer: TimerSummary;
  depth: number;
}

/**
 * Orders main-thread scopes as a tree using the parent each scope was last
 * seen under; siblings are sorted by inclusive total, largest first.
 */
export function buildScopeTree(timers: TimerSummary[]): ScopeTreeRow[] {
  const mainTimers = timers.filter((timer) => timer.domain === "main-cpu");
  const knownNames = new Set(mainTimers.map((timer) => timer.name));
  const childrenByParent = new Map<string | null, TimerSummary[]>();

  for (const timer of mainTimers) {
    const parentKey = timer.parent && knownNames.has(timer.parent) && timer.parent !== timer.name ? timer.parent : null;
    const siblings = childrenByParent.get(parentKey) ?? [];
    siblings.push(timer);
    childrenByParent.set(parentKey, siblings);
  }

  const rows: ScopeTreeRow[] = [];
  const visited = new Set<string>();
  const visit = (parentKey: string | null, depth: number) => {
    const siblings = (childrenByParent.get(parentKey) ?? []).sort(
      (first, second) => second.total - first.total,
    );
    for (const timer of siblings) {
      if (visited.has(timer.name)) continue;
      visited.add(timer.name);
      rows.push({ timer, depth });
      visit(timer.name, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}
