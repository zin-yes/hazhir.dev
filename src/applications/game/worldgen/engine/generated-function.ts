// Builds the engine's generated hot-path functions (compiled density trees, surface rules, cell fills, unrolled
// noises). If code generation is unavailable (a Content-Security-Policy without 'unsafe-eval'), callers get undefined
// and keep their interpreted path, which computes the same values.

let isCodeGenerationAvailable = true;
let hasReportedPath = false;

/** Tells a worker's console once which path worldgen runs (silent outside workers, e.g. in tests). */
function reportPathOnce(): void {
  if (hasReportedPath) return;
  hasReportedPath = true;
  if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope === "undefined") return;
  console.info(
    isCodeGenerationAvailable
      ? "[worldgen] generated code active (compiled density, surface rules, noise)"
      : "[worldgen] eval is blocked: using the interpreted paths (same output, slower)",
  );
}

/** Runs `new Function(...parameterNames, body)(...argumentValues)`, or returns undefined when eval is blocked. */
export function buildGeneratedFunction<Result>(parameterNames: readonly string[], body: string, argumentValues: readonly unknown[]): Result | undefined {
  if (!isCodeGenerationAvailable) return undefined;
  let factory: (...values: unknown[]) => Result;
  try {
    factory = new Function(...parameterNames, body) as (...values: unknown[]) => Result;
  } catch (error) {
    if (error instanceof EvalError) {
      isCodeGenerationAvailable = false;
      reportPathOnce();
      return undefined;
    }
    throw error;
  }
  reportPathOnce();
  return factory(...argumentValues);
}
