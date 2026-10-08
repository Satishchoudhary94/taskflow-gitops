import { Router } from 'express';
import { createHash } from 'crypto';

/**
 * Failure-injection endpoints for DevOps exercises (alerts, autoscaling,
 * OOMKilled, latency SLOs, trace inspection).
 *
 * Mounted ONLY when ENABLE_DEBUG_ENDPOINTS=true — see app.ts. Disabled by
 * default and must never be enabled in a real production environment.
 */
export const debugRouter = Router();

// Deliberate 500 → drives error-rate alerts and error logs with stacks.
debugRouter.get('/error', () => {
  throw new Error('Intentional error triggered via /debug/error');
});

// Controlled latency → drives duration histograms and latency alerts.
debugRouter.get('/slow', (req, res) => {
  const requested = Number.parseInt(String(req.query.delayMs ?? '2000'), 10);
  const delayMs = Math.min(Math.max(Number.isNaN(requested) ? 2000 : requested, 0), 30000);
  setTimeout(() => res.json({ delayed: true, delayMs }), delayMs);
});

// Busy-loop CPU burn → drives CPU throttling, limits and HPA experiments.
debugRouter.get('/cpu', (req, res) => {
  const requested = Number.parseInt(String(req.query.durationMs ?? '5000'), 10);
  const durationMs = Math.min(Math.max(Number.isNaN(requested) ? 5000 : requested, 0), 30000);
  const deadline = Date.now() + durationMs;
  let iterations = 0;
  while (Date.now() < deadline) {
    createHash('sha256').update(String(iterations)).digest('hex');
    iterations += 1;
  }
  res.json({ burned: true, durationMs, iterations });
});

// Held memory allocations → drives memory limits / OOMKilled experiments.
// Allocations accumulate across calls until ?release=true frees them.
const heldAllocations: Buffer[] = [];
debugRouter.get('/memory', (req, res) => {
  if (String(req.query.release) === 'true') {
    heldAllocations.length = 0;
    global.gc?.();
    res.json({ released: true, heldMb: 0 });
    return;
  }
  const requested = Number.parseInt(String(req.query.mb ?? '50'), 10);
  const mb = Math.min(Math.max(Number.isNaN(requested) ? 50 : requested, 1), 1024);
  // Buffer.alloc actually commits pages (unlike lazy allocation).
  heldAllocations.push(Buffer.alloc(mb * 1024 * 1024, 1));
  const heldMb = heldAllocations.reduce((sum, buf) => sum + buf.length, 0) / (1024 * 1024);
  res.json({ allocatedMb: mb, heldMb, rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) });
});
