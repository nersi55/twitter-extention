/*
 * Lightweight local command queue server for the extension.
 * Endpoints:
 *   POST /enqueue { id?: string, action: string, ...payload }
 *   GET  /queue          -> current queue
 *   GET  /next           -> pop next command (or { empty: true })
 *   POST /discardNext    -> drop the next item
 *   POST /clear          -> clear the queue
 *   GET  /history        -> executed commands history
 */

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 6060;

app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));

let queue = [];
let history = [];

app.post('/enqueue', (req, res) => {
  const payload = req.body || {};
  if (!payload.action) {
    res.status(400).json({ error: 'Missing action' });
    return;
  }
  const item = {
    id: payload.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ...payload,
  };
  queue.push(item);
  console.log('Enqueued', item);
  res.json({ ok: true, queued: item, queueLength: queue.length });
});

app.get('/queue', (_req, res) => {
  res.json({ queue, length: queue.length });
});

app.get('/next', (_req, res) => {
  if (!queue.length) {
    res.json({ empty: true });
    return;
  }
  const next = queue.shift();
  history.push({ ...next, dequeuedAt: new Date().toISOString() });
  console.log('Dequeued', next);
  res.json(next);
});

app.post('/discardNext', (_req, res) => {
  if (!queue.length) {
    res.json({ ok: true, discarded: null, queueLength: 0 });
    return;
  }
  const discarded = queue.shift();
  console.log('Discarded next', discarded);
  res.json({ ok: true, discarded, queueLength: queue.length });
});

app.post('/clear', (_req, res) => {
  queue = [];
  console.log('Queue cleared');
  res.json({ ok: true, queueLength: 0 });
});

app.get('/history', (_req, res) => {
  res.json({ history, length: history.length });
});

app.listen(PORT, () => {
  console.log(`Local command server listening on http://127.0.0.1:${PORT}`);
});
