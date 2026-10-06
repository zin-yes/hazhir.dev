import type { DOMAttributes } from "react";
import { profiler as gameProfiler } from "../profiler";
import { DIMENSIONS } from "../profiler/dimensions";
import type { Profiler } from "../profiler/profiler";

export const UI_EVENT_KINDS = ["pointer", "touch", "key", "click"] as const;
export type UiEventKind = (typeof UI_EVENT_KINDS)[number];

type UiEventProps = Pick<
  DOMAttributes<HTMLElement>,
  | "onPointerDownCapture"
  | "onTouchStartCapture"
  | "onKeyDownCapture"
  | "onClickCapture"
>;

export function uiEventCounterName(surfaceName: string, kind: UiEventKind) {
  return `game.ui.events.${surfaceName}.${kind}`;
}

/**
 * Capture-phase handlers that count the DOM events reaching one UI surface.
 * Capture runs before children, so a child that stops propagation is still
 * counted. The handlers never touch the event.
 */
export function createUiEventProps(
  profilerInstance: Profiler,
  surfaceName: string,
): UiEventProps {
  const counterNames = {
    pointer: uiEventCounterName(surfaceName, "pointer"),
    touch: uiEventCounterName(surfaceName, "touch"),
    key: uiEventCounterName(surfaceName, "key"),
    click: uiEventCounterName(surfaceName, "click"),
  };
  return {
    onPointerDownCapture: () => profilerInstance.addCounter(counterNames.pointer),
    onTouchStartCapture: () => profilerInstance.addCounter(counterNames.touch),
    onKeyDownCapture: () => profilerInstance.addCounter(counterNames.key),
    onClickCapture: () => profilerInstance.addCounter(counterNames.click),
  };
}

const eventPropsBySurface = new Map<string, UiEventProps>();

/** Spread onto a surface's root element. Returns the same object for the same surface, so renders allocate nothing. */
export function uiEventProps(surfaceName: string): UiEventProps {
  let eventProps = eventPropsBySurface.get(surfaceName);
  if (!eventProps) {
    eventProps = createUiEventProps(gameProfiler, surfaceName);
    eventPropsBySurface.set(surfaceName, eventProps);
  }
  return eventProps;
}

const handlerKeyCache = new Map<string, string>();

function handlerKeyFor(surfaceName: string, handlerName: string) {
  const cacheKey = `${surfaceName}\0${handlerName}`;
  let handlerKey = handlerKeyCache.get(cacheKey);
  if (!handlerKey) {
    handlerKey = `${surfaceName}.${handlerName}`;
    handlerKeyCache.set(cacheKey, handlerKey);
  }
  return handlerKey;
}

/** Times the synchronous part of a UI event handler per surface and handler. */
export function profileUiHandlerWith(
  profilerInstance: Profiler,
  surfaceName: string,
  handlerName: string,
  run: () => void,
) {
  if (!profilerInstance.enabled) {
    run();
    return;
  }
  profilerInstance.addCounter("game.ui.handlerCalls");
  const scopeToken = profilerInstance.begin(
    "main.ui.handler",
    DIMENSIONS.uiHandler,
    handlerKeyFor(surfaceName, handlerName),
  );
  try {
    run();
  } finally {
    profilerInstance.end(scopeToken);
  }
}

export function profileUiHandler(
  surfaceName: string,
  handlerName: string,
  run: () => void,
) {
  profileUiHandlerWith(gameProfiler, surfaceName, handlerName, run);
}

/** Times applying one settings control change, keyed by the control's label. */
export function profileSettingChange(settingLabel: string, run: () => void) {
  if (!gameProfiler.enabled) {
    run();
    return;
  }
  gameProfiler.addCounter("game.ui.settingChanges");
  const scopeToken = gameProfiler.begin(
    "main.ui.settingChange",
    DIMENSIONS.uiSetting,
    settingLabel,
  );
  try {
    run();
  } finally {
    gameProfiler.end(scopeToken);
  }
}
