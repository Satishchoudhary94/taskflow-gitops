#!/bin/sh
# Generates the runtime config consumed by the SPA (served as /config.js).
# Runs automatically before nginx starts (nginx image entrypoint hook).
set -eu

API_URL="${API_URL:-}"

cat > /tmp/taskflow-runtime-config.js <<EOF
window.__TASKFLOW_CONFIG__ = { apiUrl: "${API_URL}" };
EOF

echo "runtime-config: API_URL=${API_URL:-<empty, same-origin>}"
