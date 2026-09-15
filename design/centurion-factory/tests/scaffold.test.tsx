import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';

describe('scaffold', () => {
  it('renders the app root', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Centurion Factory' })).toBeTruthy();
  });
});
