import { describe, expect, test } from "bun:test";
import { DIMENSIONS } from "../profiler/dimensions";
import { Profiler } from "../profiler/profiler";
import { createUiEventProps, profileUiHandlerWith } from "./ui-profiling";

function createEnabledProfiler() {
  let nowMs = 0;
  const profiler = new Profiler(() => (nowMs += 2));
  profiler.setEnabled(true);
  return profiler;
}

function counterTotal(profiler: Profiler, name: string) {
  return profiler.snapshot().counters.find((counter) => counter.name === name)?.total ?? 0;
}

describe("createUiEventProps", () => {
  test("counts each event kind under its own surface", () => {
    const profiler = createEnabledProfiler();
    const hotbarProps = createUiEventProps(profiler, "hotbar");
    const inventoryProps = createUiEventProps(profiler, "inventory");

    for (let press = 0; press < 3; press++) hotbarProps.onPointerDownCapture?.({} as never);
    hotbarProps.onKeyDownCapture?.({} as never);
    inventoryProps.onClickCapture?.({} as never);
    inventoryProps.onTouchStartCapture?.({} as never);
    inventoryProps.onTouchStartCapture?.({} as never);

    expect(counterTotal(profiler, "game.ui.events.hotbar.pointer")).toBe(3);
    expect(counterTotal(profiler, "game.ui.events.hotbar.key")).toBe(1);
    expect(counterTotal(profiler, "game.ui.events.hotbar.touch")).toBe(0);
    expect(counterTotal(profiler, "game.ui.events.inventory.touch")).toBe(2);
    expect(counterTotal(profiler, "game.ui.events.inventory.click")).toBe(1);
  });
});

describe("profileUiHandlerWith", () => {
  test("times the handler per surface and handler, and closes the scope when it throws", () => {
    const profiler = createEnabledProfiler();
    let handlerRuns = 0;
    profileUiHandlerWith(profiler, "titleMenu", "play", () => handlerRuns++);
    profileUiHandlerWith(profiler, "titleMenu", "play", () => handlerRuns++);
    expect(() =>
      profileUiHandlerWith(profiler, "titleMenu", "delete", () => {
        throw new Error("handler failed");
      }),
    ).toThrow("handler failed");
    profileUiHandlerWith(profiler, "inventory", "select", () => handlerRuns++);

    expect(handlerRuns).toBe(3);
    const entries =
      profiler.snapshot().breakdowns.find((breakdown) => breakdown.dimension === DIMENSIONS.uiHandler)
        ?.entries ?? [];
    const callsByKey = Object.fromEntries(entries.map((entry) => [entry.key, entry.calls]));
    expect(callsByKey).toEqual({
      "titleMenu.play": 2,
      "titleMenu.delete": 1,
      "inventory.select": 1,
    });
    expect(counterTotal(profiler, "game.ui.handlerCalls")).toBe(4);
  });

  test("still runs the handler while the profiler is off", () => {
    const profiler = new Profiler();
    let handlerRuns = 0;
    profileUiHandlerWith(profiler, "hotbar", "select", () => handlerRuns++);
    expect(handlerRuns).toBe(1);
    expect(counterTotal(profiler, "game.ui.handlerCalls")).toBe(0);
  });
});
