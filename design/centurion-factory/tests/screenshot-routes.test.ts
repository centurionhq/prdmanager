import { describe, expect, it } from 'vitest';
import { createMemoryRouter } from 'react-router';
import { routes } from '../src/router';
// @ts-expect-error plain ESM script without type declarations
import { SCREENSHOT_ROUTES, VIEWPORTS } from '../scripts/routes.mjs';

type ScreenshotRoute = { name: string; path: string };

describe('screenshot routes', () => {
  it('captures desktop at 1440 and mobile at 375', () => {
    expect((VIEWPORTS as { width: number }[]).map((viewport) => viewport.width)).toEqual([1440, 375]);
  });

  it('covers every screen and each path resolves to a real route', () => {
    const names = (SCREENSHOT_ROUTES as ScreenshotRoute[]).map((route) => route.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(14);
    for (const route of SCREENSHOT_ROUTES as ScreenshotRoute[]) {
      const router = createMemoryRouter(routes, { initialEntries: [route.path] });
      const [pathname, query] = route.path.split('?');
      // A capture route may carry a query (e.g. ?orden=WO-311): both halves must survive.
      expect(router.state.location.pathname, route.path).toBe(pathname);
      expect(router.state.location.search, route.path).toBe(query ? `?${query}` : '');
      router.dispose();
    }
  });
});
