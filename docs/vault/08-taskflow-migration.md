# 08 — Migrating TaskFlow backend secrets to Vault

Status: **DONE — executed 2026-10-29** (approved by Satish). Helm revision 4 = Stage A, 5 = Stage B.

## Scope

| Moves to Vault | Stays as it is |
|---|---|
| `JWT_SECRET` (from `taskflow-backend-secret`) | Old Secrets `taskflow-backend-secret`, `taskflow-postgres-secret`: not modified, not deleted |
| `DATABASE_PASSWORD` (copy of `POSTGRES_PASSWORD` from `taskflow-postgres-secret`) | Postgres StatefulSet, its pod and PVC `postgres-data-taskflow-postgres-0`: no change, no restart |
| | Frontend, Ingress, HPA, PDB, NetworkPolicies: no change |

Values are **copied, not rotated**: the backend gets the same bytes it has today.
Postgres reads `POSTGRES_PASSWORD` only on first init, so changing it in Vault
would NOT change the database password. Real rotation is Phase 10 (dynamic credentials).

## Target state

```
Vault  taskflow/prod/backend {JWT_SECRET, DATABASE_PASSWORD}
  │  policy taskflow-backend-prod-read  (read taskflow/data/prod/backend only)
  │  role   auth/kubernetes/role/taskflow-backend  (SA taskflow-backend, ns taskflow, aud vault, 15m)
  ▼
VSO (VaultConnection / VaultAuth / VaultStaticSecret "taskflow-backend-vault", from the Helm chart)
  ▼
K8s Secret taskflow-backend-secret-vault (owned by VSO)
  ▼
Deployment taskflow-backend (ServiceAccount taskflow-backend, env via secretKeyRef)
```

## Chart changes (prepared, not applied)

- `templates/backend/serviceaccount.yaml` — new SA `taskflow-backend`, token not mounted
- `templates/backend/deployment.yaml` — `serviceAccountName`, `automountServiceAccountToken: false`
- `templates/backend/vault-secret.yaml` — VSO resources when `vault.enabled=true`; fails fast if VSO CRDs are missing
- `templates/_helpers.tpl` — `taskflow.backendServiceAccountName`
- `values.yaml` — `backend.serviceAccount`, `vault.*` (default `enabled: false`)
- Chart version stays 0.2.0 for this change (see "Known issue" below)

Rendered diff vs the live release (revision 3):

| Stage | Changes |
|---|---|
| A | CHANGE Deployment taskflow-backend (SA only); ADD ServiceAccount, VaultConnection, VaultAuth, VaultStaticSecret |
| B | Deployment taskflow-backend: `secretKeyRef` names → `taskflow-backend-secret-vault` |

## Pre-checks (all passed on 2026-10-29)

- [x] Local chart render == live release revision 3
- [x] No existing SA `taskflow-backend` or Secret `taskflow-backend-secret-vault` in `taskflow`
- [x] Old Secrets have no Helm ownership labels (Helm cannot delete them)
- [x] VSO 1.6.2 running; lab sync, rotation and deny tests passed (Phase 7)
- [x] Vault unsealed, `vault status` → `Sealed false`

## Stage 0 — Vault side (no cluster change)

```bash
# 0.1 Policy: read the prod backend secret only
vault policy write taskflow-backend-prod-read - <<'EOF'
path "taskflow/data/prod/backend" {
  capabilities = ["read"]
}
EOF

# 0.2 Role: only SA taskflow-backend in namespace taskflow, audience vault
vault write auth/kubernetes/role/taskflow-backend \
  bound_service_account_names=taskflow-backend \
  bound_service_account_namespaces=taskflow \
  audience=vault \
  token_policies=taskflow-backend-prod-read \
  token_ttl=15m token_max_ttl=30m

# 0.3 Copy current values into Vault. Values go K8s → jq → Vault through a pipe:
#     never printed, never in shell history, never in process arguments.
kubectl get secret taskflow-backend-secret taskflow-postgres-secret -n taskflow -o json \
  | jq '.items | map({(.metadata.name): .data}) | add
        | {JWT_SECRET: (.["taskflow-backend-secret"].JWT_SECRET | @base64d),
           DATABASE_PASSWORD: (.["taskflow-postgres-secret"].POSTGRES_PASSWORD | @base64d)}' \
  | vault kv put taskflow/prod/backend -

vault kv metadata get taskflow/prod/backend   # expect current_version 1
```

**Gate 0 — allowed/denied tests** (a SA token for `taskflow-backend` is only creatable once the SA exists, so these run right after Stage A, before Stage B):

| # | Test | Expected |
|---|---|---|
| 1 | Login as SA `taskflow-backend` in `taskflow`, aud `vault` | allow, policies `default`, `taskflow-backend-prod-read` |
| 2 | Read `taskflow/prod/backend` (keys only) | allow, `DATABASE_PASSWORD`, `JWT_SECRET` |
| 3 | Read `taskflow/lab/backend` | 403 |
| 4 | Write `taskflow/prod/backend` | 403 |
| 5 | Login as SA `default` in `taskflow` | 403 service account name not authorized |
| 6 | Login as SA `taskflow-backend` in `taskflow-vault-lab` with role `taskflow-backend` | 403 namespace not authorized |

## Stage A — ServiceAccount + VSO sync (backend still on old Secrets)

```bash
helm upgrade taskflow helm/taskflow -n taskflow --set vault.enabled=true
kubectl rollout status deploy/taskflow-backend -n taskflow
kubectl get vaultstaticsecret taskflow-backend-vault -n taskflow       # SYNCED/HEALTHY/READY True
```

Effect: one rolling restart of the backend (new ServiceAccount; VSO's first sync may
trigger one more). 2 replicas + PDB minAvailable 1 → no downtime expected.

**Gate A — the synced Secret equals the old ones** (prints only true/false):

```bash
kubectl get secret taskflow-backend-secret taskflow-postgres-secret taskflow-backend-secret-vault -n taskflow -o json \
  | jq '.items | map({(.metadata.name): .data}) | add
        | {jwt_match: (.["taskflow-backend-secret"].JWT_SECRET == .["taskflow-backend-secret-vault"].JWT_SECRET),
           db_match:  (.["taskflow-postgres-secret"].POSTGRES_PASSWORD == .["taskflow-backend-secret-vault"].DATABASE_PASSWORD)}'
```

Both must be `true`, and Gate 0 tests must pass, before Stage B.

## Stage B — switch the backend to the Vault-managed Secret

```bash
helm upgrade taskflow helm/taskflow -n taskflow --set vault.enabled=true \
  --set backend.secrets.databasePassword.name=taskflow-backend-secret-vault \
  --set backend.secrets.databasePassword.key=DATABASE_PASSWORD \
  --set backend.secrets.jwtSecret.name=taskflow-backend-secret-vault
kubectl rollout status deploy/taskflow-backend -n taskflow
```

**Gate B — app health:**
- Backend pods Ready, 0 restarts; `kubectl logs` shows no DB auth errors
- `/ready` returns 200 (readiness probe checks the DB)
- Existing login still works (same `JWT_SECRET` → existing tokens stay valid)
- `kubectl get deploy taskflow-backend -o yaml` shows `secretKeyRef.name: taskflow-backend-secret-vault`

After a soak period, bake the Stage B values into `values.yaml` and commit, so Git matches the cluster.

## Rollback

| Failure point | Action | Effect |
|---|---|---|
| Stage 0 | `vault kv metadata delete taskflow/prod/backend`; delete role and policy | No cluster change happened |
| Stage A | `helm rollback taskflow 3 -n taskflow` | Backend back on `default` SA; VSO resources and their Secret removed; old Secrets untouched |
| Stage B | `helm rollback taskflow 4 -n taskflow` | Backend back on old Secrets within one rolling restart; VSO keeps syncing |
| Full | `helm rollback taskflow 3 -n taskflow` | Exactly today's state |

The old Secrets are the rollback anchor: they are not modified and are deleted only
in a separate, later change with its own approval.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Vault sealed (vault-0 restart, manual unseal) | VSO cannot refresh; existing Secret stays; app keeps running | Unseal runbook; auto-unseal in Phase 11 |
| VaultStaticSecret deleted | VSO-owned Secret is garbage-collected; pods that restart fail with `CreateContainerConfigError` | Roll back Stage B first (backend back on old Secrets) before disabling `vault.enabled` |
| Copied value differs (encoding, newline) | Backend fails DB auth / JWT verify | Gate A byte-for-byte comparison before Stage B |
| Someone edits the Secret by hand | VSO overwrites it on next sync | Vault is the source of truth; change values in Vault only |
| Plain HTTP to Vault in-cluster | Secrets cross the pod network unencrypted | Lab limitation; TLS in Phase 11 |

## Known issue (separate change)

`taskflow.labels` puts `helm.sh/chart: taskflow-<version>` on pod templates, so any
chart version bump restarts every pod, including Postgres. Fix: a pod-label helper
without the chart version, plus the version bump to 0.3.0, as its own planned change.

## Approval

- [x] Plan reviewed and approved by Satish
- [x] Stage 0 executed and verified (`taskflow/prod/backend` v1, both keys non-empty)
- [x] Stage A executed (revision 4), Gate 0 + Gate A passed
- [x] Stage B executed (revision 5), Gate B passed
- [x] Final values baked into `values.yaml` (plain render == revision 5)
- [ ] Changes committed

## Execution record (sanitised)

| Check | Result |
|---|---|
| Gate 0.1 login SA `taskflow-backend` / ns `taskflow` | allow; policies `default`, `taskflow-backend-prod-read`; TTL 899s |
| Gate 0.2 read `taskflow/prod/backend` | allow; keys `DATABASE_PASSWORD`, `JWT_SECRET` |
| Gate 0.3 read `taskflow/lab/backend` | 403 permission denied |
| Gate 0.4 write `taskflow/prod/backend` | 403 permission denied |
| Gate 0.5 SA `default` / ns `taskflow` | 403 service account name not authorized |
| Gate 0.6 lab SA vs prod role | 403 namespace not authorized |
| Gate A byte-for-byte comparison | `jwt_match: true`, `db_match: true` |
| Gate B `/health`, `/ready` | 200, `database: connected` |
| Gate B pods | 2/2 backend Ready, 0 restarts; Postgres and frontend not restarted |
| Gate B Ingress | frontend 200 |

Pre-existing issue found during Gate B (not caused by this change): the
`taskflow` database has 0 tables; schema migrations were never run in the
cluster, so `/api/auth/login` returns 500 `relation "users" does not exist`.
The backend authenticated to Postgres with the Vault-provided password.
Resolved 2026-10-29: ran `node dist/db/migrate.js` in a backend pod (Vault-provided
credentials); `001_initial_schema.sql` applied, second run applied nothing, login now
returns 401 for unknown users. Still to do: run migrations automatically.
Original note: fix tracked separately (migration Job / Helm hook, needs approval: it writes the schema).
