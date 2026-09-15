import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';

describe('scaffold', () => {
  it('boots the router and renders the Planta at the root route', async () => {
    window.history.replaceState(null, '', '/');
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Planta' })).toBeTruthy();
  });
});
