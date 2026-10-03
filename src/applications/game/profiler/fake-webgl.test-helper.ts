import type { GpuTimerContext } from "./gpu-timer";

export const ARRAY_BUFFER = 0x8892;
export const TEXTURE_2D_ARRAY = 0x8c1a;
export const TEXTURE_2D = 0x0de1;
export const TEXTURE0 = 0x84c0;
export const RGBA8 = 0x8058;
const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;

interface FakeQuery {
  id: number;
  available: boolean;
  nanoseconds: number;
}

/**
 * A scriptable stand-in for WebGL2RenderingContext. Methods are own
 * properties so `for...in` sees them, like it does on a real context.
 */
export function createFakeWebGl(options: { hasTimerExtension?: boolean } = {}) {
  const hasTimerExtension = options.hasTimerExtension ?? true;
  const calls: { name: string; args: unknown[] }[] = [];
  const queries: FakeQuery[] = [];
  const state = { disjoint: false, activeQuery: null as FakeQuery | null, deletedQueries: 0 };

  const record = (name: string) =>
    function (...args: unknown[]) {
      calls.push({ name, args });
      return undefined;
    };

  const gl = {
    QUERY_RESULT: 0x8866,
    QUERY_RESULT_AVAILABLE: 0x8867,
    calls,
    queries,
    state,
    getExtension(name: string) {
      if (name === "EXT_disjoint_timer_query_webgl2" && hasTimerExtension) {
        return { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT };
      }
      return null;
    },
    createQuery() {
      const query = { id: queries.length, available: false, nanoseconds: 0 };
      queries.push(query);
      return query;
    },
    deleteQuery() {
      state.deletedQueries++;
    },
    beginQuery(_target: number, query: FakeQuery) {
      if (state.activeQuery) throw new Error("nested timer query");
      state.activeQuery = query;
    },
    endQuery() {
      state.activeQuery = null;
    },
    getQueryParameter(query: FakeQuery, parameter: number) {
      return parameter === 0x8867 ? query.available : query.nanoseconds;
    },
    getParameter(parameter: number) {
      if (parameter !== GPU_DISJOINT_EXT) return undefined;
      const wasDisjoint = state.disjoint;
      state.disjoint = false;
      return wasDisjoint;
    },
    finish: record("finish"),
    bindBuffer: record("bindBuffer"),
    bufferData: record("bufferData"),
    bufferSubData: record("bufferSubData"),
    deleteBuffer: record("deleteBuffer"),
    activeTexture: record("activeTexture"),
    bindTexture: record("bindTexture"),
    texStorage3D: record("texStorage3D"),
    texSubImage3D: record("texSubImage3D"),
    texImage2D: record("texImage2D"),
    drawElements: record("drawElements"),
    uniform1i: record("uniform1i"),
    drawingBufferWidth: 800,
  };

  return {
    gl,
    asTimerContext: () => gl as unknown as GpuTimerContext,
    asWebGl2: () => gl as unknown as WebGL2RenderingContext,
    finishQuery(index: number, nanoseconds: number) {
      queries[index].available = true;
      queries[index].nanoseconds = nanoseconds;
    },
  };
}
