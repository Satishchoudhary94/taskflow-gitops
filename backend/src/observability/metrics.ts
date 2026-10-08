import client from 'prom-client';
import { config } from '../config';

/**
 * Prometheus metrics registry.
 *
 * Exposed at GET /metrics. Includes:
 *  - Node.js runtime/process defaults (event loop lag, heap, GC, CPU, ...)
 *  - RED metrics for HTTP traffic (rate, errors, duration) recorded by the
 *    metrics middleware.
 */
export const registry = new client.Registry();

registry.setDefaultLabels({ service: config.serviceName });

client.collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests handled',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  // Buckets span fast API calls (5ms) to very slow requests (10s) — useful
  // later for latency SLOs and the /debug/slow endpoint.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const httpRequestsInFlight = new client.Gauge({
  name: 'http_requests_in_flight',
  help: 'Number of HTTP requests currently being processed',
  registers: [registry],
});
