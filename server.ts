import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
// @ts-ignore - JavaScript serverless handlers
import geocodeHandler from './api/geocode.js';
// @ts-ignore - JavaScript serverless handlers
import pricesHandler from './api/prices.js';
// @ts-ignore - JavaScript serverless handlers
import trendsHandler from './api/trends.js';
// @ts-ignore - JavaScript serverless handlers
import amenitiesHandler from './api/amenities.js';
// @ts-ignore - JavaScript serverless handlers
import dataHandler from './api/data.js';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API endpoints matching Vercel serverless function routes
  app.all('/api/geocode', geocodeHandler);
  app.all('/api/prices', pricesHandler);
  app.all('/api/trends', trendsHandler);
  app.all('/api/amenities', amenitiesHandler);
  app.all('/api/data', dataHandler);
  app.all('/api/data/*', dataHandler);

  // Serve static checklist data
  app.get('/data/document-checklists.json', (req, res) => {
    const filePath = path.join(process.cwd(), 'data', 'document-checklists.json');
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'application/json');
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'Singapore Property Price Advisor' });
  });

  // Vite middleware for development vs static build in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Singapore Property Advisor server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
