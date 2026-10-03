/** Tiny external store so F4 (outside React) and the panel stay in sync. */
let visible = false;
const listeners = new Set<() => void>();

export function isOverlayVisible(): boolean {
  return visible;
}

export function setOverlayVisible(nextVisible: boolean) {
  if (nextVisible === visible) return;
  visible = nextVisible;
  listeners.forEach((listener) => listener());
}

export function subscribeOverlayVisibility(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
