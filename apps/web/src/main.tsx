import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const rootElement = document.getElementById('root') ?? document.body;
createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
