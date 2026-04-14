import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import React from 'react';
import { App } from '../../apps/web/src/App';

describe('App shell', () => {
  it('renders the page title', () => {
    render(<App />);
    expect(screen.getByText('YKSprite Control Center')).toBeInTheDocument();
  });
});
