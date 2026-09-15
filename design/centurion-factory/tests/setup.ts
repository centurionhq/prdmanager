import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest is not a Jest-like global framework, so Testing Library's cleanup is wired in explicitly.
afterEach(() => {
  cleanup();
});
