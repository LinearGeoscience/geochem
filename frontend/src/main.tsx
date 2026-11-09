import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
// Self-hosted Inter (bundled by Vite — no CDN requests)
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import './index.css'
import { installWebglContextGuard } from './utils/webglContextGuard'
import { installAutoReclassify } from './utils/attributeClassify'
import { installHalfDlNudge } from './utils/halfDlNudge'

// Free WebGL contexts Plotly throws away before the browser drops live ones (3D viewer, maps)
installWebglContextGuard()
// Attribute classes follow data edits and below-detection changes
installAutoReclassify()
installHalfDlNudge()

// Dev-only diagram QA sheet (?qa=diagrams), used by scripts/qa/renderDiagrams.mjs
const DiagramQAView = React.lazy(() => import('./views/DiagramQAView'))
const qaMode = import.meta.env.DEV && new URLSearchParams(window.location.search).get('qa') === 'diagrams'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        {qaMode
            ? <React.Suspense fallback={null}><DiagramQAView /></React.Suspense>
            : <App />}
    </React.StrictMode>,
)
