import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { decisionSupportPlugin } from './src/sensorGatewayPlugin.js';

export default defineConfig({
  plugins: [react(), decisionSupportPlugin({ root: process.cwd() })],
  server: { host: '0.0.0.0', cors: true },
  preview: { host: '0.0.0.0' },
});
