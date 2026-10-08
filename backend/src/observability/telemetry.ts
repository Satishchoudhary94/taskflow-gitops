/**
 * OpenTelemetry bootstrap.
 *
 * IMPORTANT: this module must be imported FIRST in the process entrypoint
 * (see src/server.ts) so auto-instrumentation can patch `http`, `express`
 * and `pg` before they are loaded by the rest of the application.
 *
 * Behavior is controlled entirely by standard OTel environment variables:
 *   OTEL_SERVICE_NAME              — service.name resource attribute
 *   OTEL_EXPORTER_OTLP_ENDPOINT    — OTLP/HTTP collector base URL
 *   OTEL_TRACES_EXPORTER           — "otlp" | "none"
 *
 * If no endpoint is configured (or the exporter is "none"), the SDK is never
 * started and the application runs with zero tracing overhead. If a collector
 * is configured but unreachable, export failures are logged at diag level and
 * never affect request handling — tracing is strictly best-effort.
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import type { NodeSDK } from '@opentelemetry/sdk-node';

let sdk: NodeSDK | null = null;

const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').trim();
const exporter = (process.env.OTEL_TRACES_EXPORTER ?? (endpoint ? 'otlp' : 'none')).trim();
const tracingEnabled = exporter !== 'none' && endpoint !== '';

if (tracingEnabled) {
  try {
    // Required lazily so a disabled setup never pays SDK startup cost.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { NodeSDK: SDK } = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    /* eslint-enable @typescript-eslint/no-require-imports */

    // Keep exporter connection errors quiet unless something is truly wrong.
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

    sdk = new SDK({
      serviceName: process.env.OTEL_SERVICE_NAME ?? 'taskflow-backend',
      traceExporter: new OTLPTraceExporter(), // reads OTEL_EXPORTER_OTLP_ENDPOINT
      instrumentations: [
        getNodeAutoInstrumentations({
          // fs instrumentation is extremely noisy and rarely useful for APIs
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    }) as NodeSDK;

    sdk.start();
    // logger.ts is not imported here (import order!), so use stdout directly once.
    process.stdout.write(
      `${JSON.stringify({
        level: 'info',
        service: process.env.OTEL_SERVICE_NAME ?? 'taskflow-backend',
        message: 'OpenTelemetry tracing enabled',
        endpoint,
      })}\n`,
    );
  } catch (err) {
    process.stdout.write(
      `${JSON.stringify({
        level: 'warn',
        message: 'Failed to start OpenTelemetry SDK, continuing without tracing',
        error: err instanceof Error ? err.message : String(err),
      })}\n`,
    );
    sdk = null;
  }
}

/** Flush and stop the tracer provider during graceful shutdown. */
export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch {
    // Never let telemetry teardown break shutdown.
  }
}
