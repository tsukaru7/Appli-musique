import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En développement, Vite sert le site sur le port 5173 (accessible depuis le réseau local
// pour les téléphones) et redirige le temps réel / l'API vers le serveur de jeu (port 3001).
export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  build: { outDir: '../../dist', emptyOutDir: true },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/socket.io': { target: 'http://127.0.0.1:3001', ws: true },
    },
  },
})
