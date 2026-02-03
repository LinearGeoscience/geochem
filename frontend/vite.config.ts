import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            // Use browser-compatible Plotly distribution (absolute path required)
            'plotly.js/dist/plotly': path.resolve(__dirname, 'node_modules/plotly.js-dist-min/plotly.min.js'),
            'plotly.js': path.resolve(__dirname, 'node_modules/plotly.js-dist-min/plotly.min.js'),
        }
    },
    server: {
        host: true, // Listen on all addresses (fixes localhost issues)
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:8000',
                changeOrigin: true,
            }
        }
    }
})
