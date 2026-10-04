// Builds the engine's generated hot-path functions (compiled density trees, surface rules, cell fills, unrolled
// noises). If code generation is unavailable (a Content-Security-Policy without 'unsafe-eval'), callers get undefined
// and keep their interpreted path, which computes the same values.

let isCodeGenerationAvailable = true;

/** Runs `new Function(...parameterNames, body)(...argumentValues)`, or returns undefined when eval is blocked. */
export function buildGeneratedFunction<Result>(parameterNames: readonly string[], body: string, argumentValues: readonly unknown[]): Result | undefined {
  if (!isCodeGenerationAvailable) return undefined;
  let factory: (...values: unknown[]) => Result;
  try {
    factory = new Function(...parameterNames, body) as (...values: unknown[]) => Result;
  } catch (error) {
    if (error instanceof EvalError) {
      isCodeGenerationAvailable = false;
      return undefined;
    }
    throw error;
  }
  return factory(...argumentValues);
}
