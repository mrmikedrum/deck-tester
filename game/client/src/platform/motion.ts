// The reduced-motion setting (`prefers-reduced-motion: reduce`): read once at start, and followed when the person
// changes it. The scene shortens its moves under it; decision timing never changes with it.

export interface ReducedMotion {
  /** Whether reduced motion is asked for now. */
  read(): boolean;
  /** Calls `on` with each change; returns the unsubscribe. */
  subscribe(on: (reduced: boolean) => void): () => void;
}

/** What of a window this reads: `matchMedia`, where there is one. */
export interface MotionWindow {
  readonly matchMedia?: (query: string) => {
    readonly matches: boolean;
    addEventListener(type: "change", f: (e: { readonly matches: boolean }) => void): void;
    removeEventListener(type: "change", f: (e: { readonly matches: boolean }) => void): void;
  };
}

const QUERY = "(prefers-reduced-motion: reduce)";

/** The setting on `win` (off, never changing, without `matchMedia`). */
export function reducedMotionSource(win: MotionWindow | undefined): ReducedMotion {
  const mql = typeof win?.matchMedia === "function" ? win.matchMedia(QUERY) : null;
  return {
    read: () => mql?.matches ?? false,
    subscribe(on) {
      if (!mql) return () => undefined;
      const f = (e: { readonly matches: boolean }): void => on(e.matches);
      mql.addEventListener("change", f);
      return () => mql.removeEventListener("change", f);
    },
  };
}
