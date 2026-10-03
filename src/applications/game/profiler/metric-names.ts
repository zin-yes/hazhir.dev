import type { ByteSummary, CounterSummary, ProfileSnapshot, TimerSummary } from "./types";

export interface PoolMethodName {
  pool: string;
  method: string;
  rest: string;
}

/** Splits `<prefix><pool>.<method>[.<rest>]` into its parts, or null if it does not match. */
export function parsePoolMethodName(name: string, prefix: string): PoolMethodName | null {
  if (!name.startsWith(prefix)) return null;
  const parts = name.slice(prefix.length).split(".");
  if (parts.length < 2) return null;
  return { pool: parts[0], method: parts[1], rest: parts.slice(2).join(".") };
}

export interface WorkerMethodRow {
  pool: string;
  method: string;
  exec: TimerSummary | null;
  sections: { name: string; timer: TimerSummary }[];
  queueWait: TimerSummary | null;
  roundTrip: TimerSummary | null;
  toWorker: TimerSummary | null;
  toMain: TimerSummary | null;
  workerSerialize: TimerSummary | null;
  mainPost: TimerSummary | null;
  mainResult: TimerSummary | null;
  paramBytes: ByteSummary | null;
  resultBytes: ByteSummary | null;
  counters: { name: string; counter: CounterSummary }[];
}

export interface EfficiencyLine {
  pool: string;
  method: string;
  counter: string;
  unitsPerSecond: number;
  nanosecondsPerUnit: number;
}

function emptyRow(pool: string, method: string): WorkerMethodRow {
  return {
    pool,
    method,
    exec: null,
    sections: [],
    queueWait: null,
    roundTrip: null,
    toWorker: null,
    toMain: null,
    workerSerialize: null,
    mainPost: null,
    mainResult: null,
    paramBytes: null,
    resultBytes: null,
    counters: [],
  };
}

/** Joins every per pool.method metric the worker pipeline produces into one row. */
export function buildWorkerMethodRows(snapshot: ProfileSnapshot): WorkerMethodRow[] {
  const rows = new Map<string, WorkerMethodRow>();
  const rowFor = (pool: string, method: string) => {
    const key = `${pool}.${method}`;
    let row = rows.get(key);
    if (!row) {
      row = emptyRow(pool, method);
      rows.set(key, row);
    }
    return row;
  };

  for (const timer of snapshot.timers) {
    const worker = parsePoolMethodName(timer.name, "worker.");
    if (worker) {
      const row = rowFor(worker.pool, worker.method);
      if (worker.rest === "exec") row.exec = timer;
      else row.sections.push({ name: worker.rest, timer });
      continue;
    }
    const queue = parsePoolMethodName(timer.name, "queue.");
    if (queue && queue.rest === "wait") {
      rowFor(queue.pool, queue.method).queueWait = timer;
      continue;
    }
    const latency = parsePoolMethodName(timer.name, "latency.");
    if (latency && latency.rest === "roundTrip") {
      rowFor(latency.pool, latency.method).roundTrip = timer;
      continue;
    }
    const transfer = parsePoolMethodName(timer.name, "transfer.");
    if (transfer) {
      const row = rowFor(transfer.pool, transfer.method);
      if (transfer.rest === "toWorker") row.toWorker = timer;
      else if (transfer.rest === "toMain") row.toMain = timer;
      else if (transfer.rest === "workerSerialize") row.workerSerialize = timer;
      continue;
    }
    const post = parsePoolMethodName(timer.name, "main.workerPost.");
    if (post) {
      rowFor(post.pool, post.method).mainPost = timer;
      continue;
    }
    const result = parsePoolMethodName(timer.name, "main.workerResult.");
    if (result) rowFor(result.pool, result.method).mainResult = timer;
  }

  for (const meter of snapshot.bytes) {
    const parsed = parsePoolMethodName(meter.name, "bytes.");
    if (!parsed) continue;
    const row = rowFor(parsed.pool, parsed.method);
    if (parsed.rest === "params") row.paramBytes = meter;
    else if (parsed.rest === "result") row.resultBytes = meter;
  }

  for (const counter of snapshot.counters) {
    const parsed = parsePoolMethodName(counter.name, "work.");
    if (!parsed) continue;
    rowFor(parsed.pool, parsed.method).counters.push({ name: parsed.rest, counter });
  }

  return Array.from(rows.values()).sort((first, second) => {
    const firstCost = first.exec?.total ?? 0;
    const secondCost = second.exec?.total ?? 0;
    return secondCost - firstCost;
  });
}

/** Nanoseconds of whole-task worker execution per unit of counted work. */
export function buildEfficiencyLines(rows: WorkerMethodRow[]): EfficiencyLine[] {
  const lines: EfficiencyLine[] = [];
  for (const row of rows) {
    if (!row.exec || row.exec.total <= 0) continue;
    for (const { name, counter } of row.counters) {
      if (counter.total <= 0) continue;
      lines.push({
        pool: row.pool,
        method: row.method,
        counter: name,
        unitsPerSecond: counter.recentPerSecond,
        nanosecondsPerUnit: (row.exec.total * 1_000_000) / counter.total,
      });
    }
  }
  return lines;
}
