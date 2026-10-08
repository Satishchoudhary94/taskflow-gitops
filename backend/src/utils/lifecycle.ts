/**
 * Tiny shared lifecycle flag.
 *
 * server.ts flips this on SIGTERM/SIGINT; the /ready endpoint reads it so the
 * instance is pulled out of load-balancer rotation while in-flight requests
 * finish — the core of zero-downtime rolling updates.
 */
let shuttingDown = false;

export function markShuttingDown(): void {
  shuttingDown = true;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}
