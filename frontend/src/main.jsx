import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// The original design system, then the shell/component styles that extend it.
import './App.css';
import './styles/app.css';
import './styles/forms.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
