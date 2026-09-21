import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { invoicesRouter } from './routes/invoices.js';
import { approvalsRouter } from './routes/approvals.js';
import { settingsRouter } from './routes/settings.js';
import { reportsRouter } from './routes/reports.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './data/uploads');

app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/invoices', invoicesRouter(UPLOAD_DIR));
app.use('/api/approvals', approvalsRouter());
app.use('/api/settings', settingsRouter());
app.use('/api/reports', reportsRouter());

app.listen(PORT, '0.0.0.0', () => {
  console.log(`accounting-agent server running on http://0.0.0.0:${PORT}`);
});
