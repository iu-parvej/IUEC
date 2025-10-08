import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import IUEC_Platform from "./IUEC_Platform.jsx";

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
