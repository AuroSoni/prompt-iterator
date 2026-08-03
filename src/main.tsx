import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initTheme } from '@/lib/theme'

// Before the first render, not in an effect: the theme class has to be on
// <html> ahead of paint (index.html's inline script handles the production
// deferred-bundle case; this covers the rest).
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
