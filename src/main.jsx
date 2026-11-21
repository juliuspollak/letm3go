import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { startPerfMonitor } from './lib/perfMonitor.js';

startPerfMonitor();

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
