import pino from 'pino';
import { trace } from '@opentelemetry/api';
import { config } from '../config';

/**
 * Structured JSON logger writing to stdout only.
 *
 * Every line carries `service` and an ISO timestamp; when a request is inside
 * an active OpenTelemetry span, `traceId`/`spanId` are injected automatically
 * so logs (Loki) can be correlated with traces (Tempo) later.
 *
 * Request-scoped fields (requestId, method, path, ...) are added via child
 * loggers created in the request-logging middleware.
 */
export const logger = pino({
  level: config.logLevel,
  base: { service: config.serviceName },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    // "level":"info" instead of pino's numeric levels — friendlier for Loki/Grafana.
    level: (label) => ({ level: label }),
  },
  mixin() {
    const span = trace.getActiveSpan();
    if (!span) return {};
    const spanContext = span.spanContext();
    return { traceId: spanContext.traceId, spanId: spanContext.spanId };
  },
});
