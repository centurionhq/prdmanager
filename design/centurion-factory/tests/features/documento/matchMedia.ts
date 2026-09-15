/** Test-only `window.matchMedia` mock so `useMediaQuery` can be forced to a viewport in jsdom. */
export function mockMatchMedia(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Restores jsdom's default (no `matchMedia` implementation); call from `afterEach`. */
export function restoreMatchMedia(): void {
  // @ts-expect-error -- deleting to go back to jsdom's default "not implemented".
  delete window.matchMedia;
}
