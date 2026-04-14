import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import React from 'react';
import App from '../../apps/web/src/App';

describe('App shell', () => {
  test('renders the page title', () => {
    render(<App />);
    expect(screen.getByText('YKSprite Control Center')).toBeInTheDocument();
  });
});
