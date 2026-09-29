import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { startAppUpdates } from './lib/app-update'

// Keep the installed app current: update checks + a reload that never drops unsaved work.
startAppUpdates();

createRoot(document.getElementById("root")!).render(<App />);
