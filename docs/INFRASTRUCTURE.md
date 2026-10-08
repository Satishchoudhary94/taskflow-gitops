# TaskFlow — Infrastructure & Platform Journal

Living document for the DevOps side of TaskFlow: the cluster build, the tools, the
configuration, and the commands. The application itself is documented in
[`../README.md`](../README.md) — this file is everything *below* the app.

**Owner:** Satish (`schoudhary94` on Docker Hub)
**Started:** 2026-08-31 · **Last updated:** 2026-09-01

---

## 1. Status ledger

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Application (frontend, backend, Postgres) | ✅ Done | 55/55 tests, lint + builds clean |
| 1 | Docker images built | ✅ Done | Multi-stage, non-root |
| 2 | Images pushed to Docker Hub | ✅ Done | Public — see §2 |
| 3 | kubeadm cluster: 1 control plane + 2 workers (3 VMs) | 🔄 In progress | §4–§8 |
| 4 | Kubernetes manifests (Deployment/Service/Ingress/…) | ⬜ Not started | Contract in §9 |
| 5 | Helm chart | ⬜ Not started | |
| 6 | Argo CD / GitOps repo | ⬜ Not started | |
| 7 | CI/CD pipeline | ⬜ Not started | |
| 8 | HashiCorp Vault | ⬜ Not started | Secrets currently plain env vars |
| 9 | Observability (Prometheus, Grafana, Loki, Tempo, OTel Collector) | ⬜ Not started | App already emits all signals |
| 10 | Autoscaling (HPA) + PDB + NetworkPolicy | ⬜ Not started | |

---

## 2. Container registry (verified 2026-09-01)

| Image | Tag | Digest | Visibility |
|---|---|---|---|
| `schoudhary94/taskflow-backend` | `v1` | `sha256:a22ac437ae73…` | **Public** |
| `schoudhary94/taskflow-frontend` | `v1` | `sha256:ae49e9b78095…` | **Public** |

Verified by an anonymous manifest fetch against `registry-1.docker.io` — both returned
`200` without credentials.

**Two consequences for the manifests:**

- **No `imagePullSecrets` needed.** The kubelets pull anonymously. If you ever flip these
  repos to private, you must add a `kubernetes.io/dockerconfigjson` Secret and reference it
  in every Pod spec (and in the `default` ServiceAccount if you want it implicit).
- **There is no separate migrate image, and there should not be one.** Compose builds
  `taskflow-migrate` from `./backend` — the *same Dockerfile* as the backend, differing only
  in the runtime command. In Kubernetes the migration Job reuses the backend image and
  overrides `command`. Pushing a second identical image would just double the pull traffic
  and give you two things to keep in version lockstep.

### Tagging policy (decide before Phase 4)

`:v1` is fine for a first push but breaks GitOps: rolling a fix while keeping the tag means
the cluster cannot tell old from new, and `imagePullPolicy: IfNotPresent` will happily keep
the stale layer. Recommended before Argo CD:

- Tag with the **git SHA** (`schoudhary94/taskflow-backend:a1b2c3d`) — immutable, traceable.
- Optionally also move a `:latest` or `:stable` pointer for humans, never for manifests.
- Pin by **digest** in production manifests if you want true immutability.

---

## 3. Target topology

```
        Laptop (8 cores, 12 GiB RAM, 322 GB free, KVM available)
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
    ┌───────────┐       ┌───────────┐       ┌───────────┐
    │   VM 1    │       │   VM 2    │       │   VM 3    │
    │  cp-01    │       │ worker-01 │       │ worker-02 │
    │ control   │       │           │       │           │
    │  plane    │       │           │       │           │
    └───────────┘       └───────────┘       └───────────┘
      kube-apiserver      kubelet             kubelet
      etcd                kube-proxy          kube-proxy
      scheduler           containerd          containerd
      controller-manager
      kubelet, kube-proxy, containerd
```

Chosen over single-node (minikube/kind, both already installed) because it is the only
setup that actually exercises `kubeadm join`, real node-to-node networking, scheduler
placement across hosts, node failure, and rescheduling.

### ⚠️ Host capacity reality check

Measured on 2026-09-01: **12 GiB total RAM, ~5.1 GiB available** (the rest is host +
running Docker workloads).

| Node | vCPU | RAM | Disk | Why |
|---|---|---|---|---|
| `cp-01` | **2** (hard minimum) | 2.5 GiB | 20 GB | `kubeadm init` **fails** below 2 CPUs |
| `worker-01` | 2 | 2 GiB | 20 GB | |
| `worker-02` | 2 | 2 GiB | 20 GB | |
| **Total** | 6 vCPU | **6.5 GiB** | 60 GB | of 8 vCPU / 12 GiB |

That leaves ~5.5 GiB for the host — workable, but **stop the Compose stack before
starting the VMs** (`cd ~/taskflow && docker compose down`), or you will be swapping. The
laptop currently has 25 Docker images totalling 45 GB; `docker system prune` is worth
running if disk gets tight.

If it turns out too tight, drop to **one** worker first and add the second later — a
2-node cluster still teaches join, placement and rescheduling.

---

## 4. Tooling decisions

| Layer | Choice | Why | Installed? |
|---|---|---|---|
| Hypervisor | **libvirt/KVM** (or Multipass) | `/dev/kvm` is present and VT-x is enabled — native perf, no VirtualBox kernel-module pain on this kernel | ❌ install needed |
| VM provisioning | **Vagrant** (libvirt provider) or Multipass | Reproducible; you can rebuild the whole cluster from a file | ❌ install needed |
| Guest OS | Ubuntu 22.04 / 24.04 LTS | Best-documented path for `kubeadm`; `pkgs.k8s.io` has debs | — |
| Container runtime | **containerd** | Default for kubeadm since dockershim removal | ❌ install on each node |
| Cluster bootstrap | **kubeadm** | The whole point of the exercise | ❌ install on each node |
| CNI | **Calico** | Supports **NetworkPolicy**, which is on your roadmap (Phase 10). Flannel is simpler but has no NetworkPolicy enforcement | ❌ apply after init |
| Ingress | ingress-nginx (later) | Needed to expose frontend + backend on one host | Phase 4 |
| Storage | `local-path-provisioner` or hostPath (later) | Postgres needs a PVC; no cloud volumes here | Phase 4 |

Already on the laptop: `kubectl`, `minikube`, `kind`. Keep `kubectl` — you will point it
at the new cluster via `~/.kube/config`.

### Kubernetes version

Pick one minor version and use it **identically on all three nodes** — a control plane and
kubelet more than one minor apart will not work.

> Check the current stable release before you start (`https://kubernetes.io/releases/`)
> and substitute it everywhere below. The examples use `v1.34`; do not trust that number
> without checking, and once chosen, hold every node to it.

---

## 5. Network plan

Three CIDRs must never overlap. This is the single most common way a home kubeadm cluster
breaks, and the symptom (pods that can't reach each other, or a node that loses its own
SSH session) looks nothing like a networking config error.

| Network | Value | Notes |
|---|---|---|
| **VM / node network** | e.g. `192.168.56.0/24` | Host-only or bridged, **static IPs** — a DHCP lease change breaks the API server cert SANs and every join |
| **Pod CIDR** | `10.244.0.0/16` | Passed to `kubeadm init --pod-network-cidr`; **must** match the CNI config |
| **Service CIDR** | `10.96.0.0/12` | kubeadm default; leave alone unless it collides |

> **Calico's default pod CIDR is `192.168.0.0/16`**, which collides with the typical home
> router LAN and with common host-only ranges. Use `10.244.0.0/16` for pods and edit the
> Calico manifest's `CALICO_IPV4POOL_CIDR` to match what you passed to `kubeadm init`.

Planned addresses — **fill these in as you build**:

| Node | Hostname | IP | Role |
|---|---|---|---|
| VM 1 | `cp-01` | `192.168.56.10` _(tbd)_ | control-plane |
| VM 2 | `worker-01` | `192.168.56.11` _(tbd)_ | worker |
| VM 3 | `worker-02` | `192.168.56.12` _(tbd)_ | worker |

### Ports that must be reachable

| Node | Port(s) | Component |
|---|---|---|
| Control plane | `6443` | kube-apiserver ← all nodes + your laptop |
| Control plane | `2379–2380` | etcd (server/peer) |
| Control plane | `10257`, `10259` | controller-manager, scheduler |
| All nodes | `10250` | kubelet API ← control plane |
| Workers | `30000–32767` | NodePort range |
| All nodes | `179` (if BGP) / IP-in-IP | Calico |

---

## 6. Commands — Phase A: every node (cp-01, worker-01, worker-02)

Run all of §6 on **all three** VMs.

### A1. Identity and hostname

```bash
sudo hostnamectl set-hostname cp-01        # worker-01 / worker-02 on the others

# Every node needs a unique MAC and product_uuid — cloned VMs often share them.
ip link show
sudo cat /sys/class/dmi/id/product_uuid

# Static resolution so nodes can find each other by name
sudo tee -a /etc/hosts <<'EOF'
192.168.56.10  cp-01
192.168.56.11  worker-01
192.168.56.12  worker-02
EOF
```

### A2. Disable swap (kubelet refuses to start with swap on)

```bash
sudo swapoff -a
sudo sed -i '/ swap / s/^/#/' /etc/fstab        # make it survive reboot
free -h                                          # Swap total must be 0
```

### A3. Kernel modules and sysctl

```bash
cat <<'EOF' | sudo tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF

sudo modprobe overlay
sudo modprobe br_netfilter

cat <<'EOF' | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF

sudo sysctl --system

# Verify — all three must be 1
sysctl net.bridge.bridge-nf-call-iptables net.ipv4.ip_forward
```

### A4. containerd

```bash
sudo apt-get update
sudo apt-get install -y containerd

sudo mkdir -p /etc/containerd
containerd config default | sudo tee /etc/containerd/config.toml >/dev/null
```

**The cgroup driver is the classic failure.** kubelet uses `systemd`; containerd's
generated default does not. Mismatch → kubelet crash-loops after `kubeadm init` with
messages that never mention cgroups.

```bash
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
grep SystemdCgroup /etc/containerd/config.toml        # must print true

sudo systemctl restart containerd
sudo systemctl enable containerd
sudo systemctl status containerd --no-pager
```

### A5. kubeadm, kubelet, kubectl

> The old `apt.kubernetes.io` / `packages.cloud.google.com` repos are retired. Use
> `pkgs.k8s.io`, and note the **minor version is part of the URL** — substitute your
> chosen version in both lines.

```bash
sudo apt-get install -y apt-transport-https ca-certificates curl gpg
sudo mkdir -p /etc/apt/keyrings

curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.34/deb/Release.key \
  | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg

echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.34/deb/ /' \
  | sudo tee /etc/apt/sources.list.d/kubernetes.list

sudo apt-get update
sudo apt-get install -y kubelet kubeadm kubectl

# Freeze them: an unattended apt upgrade that bumps one node's kubelet will break the cluster
sudo apt-mark hold kubelet kubeadm kubectl

kubeadm version
```

---

## 7. Commands — Phase B: control plane (cp-01 only)

### B1. Pre-flight

```bash
sudo kubeadm config images pull        # pull first: makes init fast and surfaces network issues early
```

### B2. Initialise

```bash
sudo kubeadm init \
  --apiserver-advertise-address=192.168.56.10 \
  --pod-network-cidr=10.244.0.0/16 \
  --node-name=cp-01
```

- `--apiserver-advertise-address` — **must** be the VM's real IP, not `127.0.0.1`. If the
  VM has both a NAT and a host-only interface, kubeadm may pick the wrong one; be explicit.
- `--pod-network-cidr` — must match the CNI (§5).
- Consider `--control-plane-endpoint=cp-01:6443` if you might ever add a second control
  plane; it cannot be added retroactively without regenerating certs.

**Save the `kubeadm join …` line it prints.** The token expires in 24h; §7.5 regenerates it.

### B3. kubeconfig for your user

```bash
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config

kubectl get nodes         # cp-01 will show NotReady until the CNI is installed — expected
```

### B4. Install the CNI (Calico)

```bash
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.28.0/manifests/tigera-operator.yaml

# Download rather than apply directly — the pod CIDR must be edited to 10.244.0.0/16
curl -O https://raw.githubusercontent.com/projectcalico/calico/v3.28.0/manifests/custom-resources.yaml
# edit: spec.calicoNetwork.ipPools[0].cidr -> 10.244.0.0/16
kubectl create -f custom-resources.yaml

watch kubectl get pods -n calico-system
kubectl get nodes         # cp-01 -> Ready once Calico is up
```

> Check for a newer Calico release rather than pinning `v3.28.0` blindly, and confirm it
> supports your chosen Kubernetes minor version.

### B5. Copy the kubeconfig to your laptop (optional, recommended)

Lets you run `kubectl` from the host instead of SSH-ing into cp-01 every time.

```bash
# from the LAPTOP
scp cp-01:/home/<user>/.kube/config ~/.kube/taskflow-cluster.config
export KUBECONFIG=~/.kube/taskflow-cluster.config
kubectl get nodes
```

The cert is issued for cp-01's IP — keep the VM IP static or this stops working.

---

## 8. Commands — Phase C & D: workers and verification

### C1. Join (run on worker-01 and worker-02)

```bash
sudo kubeadm join 192.168.56.10:6443 \
  --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash>
```

### C2. Lost or expired the join command? (on cp-01)

```bash
kubeadm token create --print-join-command
```

### C3. Label the workers (cosmetic, but `kubectl get nodes` reads better)

```bash
# on cp-01
kubectl label node worker-01 node-role.kubernetes.io/worker=worker
kubectl label node worker-02 node-role.kubernetes.io/worker=worker
```

### D1. Verify the cluster

```bash
kubectl get nodes -o wide                    # all three Ready
kubectl get pods -A                          # every pod Running
kubectl cluster-info
kubectl get --raw='/readyz?verbose'
```

### D2. Verify scheduling and cross-node networking

```bash
kubectl create deployment nginx-test --image=nginx --replicas=4
kubectl get pods -o wide                     # should land on BOTH workers

# pod-to-pod across nodes
kubectl run tmp --rm -it --image=busybox --restart=Never -- \
  wget -qO- http://<a-nginx-pod-ip>

kubectl delete deployment nginx-test
```

### D3. Reset a node (when something goes wrong)

```bash
sudo kubeadm reset -f
sudo rm -rf /etc/cni/net.d ~/.kube/config
sudo iptables -F && sudo iptables -t nat -F && sudo iptables -t mangle -F && sudo iptables -X
sudo systemctl restart containerd kubelet
```

---

## 9. App → cluster contract

Everything the manifests must satisfy. Taken from the running application — treat this as
the spec you write YAML against.

### Backend — `schoudhary94/taskflow-backend:v1`

| Property | Value |
|---|---|
| Container port | `3000` (binds `0.0.0.0`, via `HOST`) |
| Runs as | uid **1000** (`node`), non-root |
| Liveness probe | `GET /health` — **never** point this at `/ready` |
| Readiness probe | `GET /ready` — 503 when DB is down or during drain |
| Startup probe | `GET /health` |
| Metrics | `GET /metrics` (Prometheus text; scrape annotation or ServiceMonitor) |
| Stateless? | Yes — JWT is self-contained, no sessions, no local writes |
| Logs | JSON to stdout only |
| Graceful shutdown | Handles SIGTERM; keep `SHUTDOWN_TIMEOUT_MS` **<** `terminationGracePeriodSeconds` |
| securityContext | `runAsNonRoot: true`, `runAsUser: 1000`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, drop `ALL` caps |

Required env (ConfigMap unless marked): `NODE_ENV`, `PORT`, `HOST`, `DATABASE_HOST`,
`DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, **`DATABASE_PASSWORD` (Secret →
Vault later)**, **`JWT_SECRET` (Secret → Vault later)**, `JWT_EXPIRATION`, `CORS_ORIGIN`,
`LOG_LEVEL`, `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `ENABLE_DEBUG_ENDPOINTS`.
Full descriptions in [`../README.md`](../README.md#environment-variables).

> **Liveness vs readiness is the load-bearing detail.** `/health` deliberately does *not*
> check the database. If you point liveness at `/ready`, a brief Postgres blip restarts
> every backend pod simultaneously and turns a recoverable dependency outage into a
> self-inflicted one. This behaviour is verified — see the README's health-check section.

### Frontend — `schoudhary94/taskflow-frontend:v1`

| Property | Value |
|---|---|
| Container port | `8080` (nginx-unprivileged) |
| Runs as | uid **101** (`nginx`), non-root |
| Probe | `GET /healthz` |
| `readOnlyRootFilesystem` | Works — runtime config is written to `/tmp`; mount an `emptyDir` at `/tmp` |
| Config | **`API_URL`** env var, read at container **start** (not build) |

> `API_URL` must be the URL the **browser** uses — your Ingress host, e.g.
> `http://taskflow.local/api`. Setting it to the in-cluster `http://taskflow-backend:3000`
> is the mistake to avoid: it resolves inside the cluster but not in the user's browser.

### Database migrations — a Job, not an initContainer in the Deployment

Reuses the **backend image** with an overridden command:

```
image:   schoudhary94/taskflow-backend:v1
command: ["node", "dist/db/migrate.js"]
```

The runner is idempotent (tracks applied files in `schema_migrations`), each migration runs
in a transaction, and it retries the DB connection for ~60s — so it tolerates being started
before Postgres is ready. Run it as a Job (later: an Argo CD PreSync hook) that must
complete before the backend rolls out. Compose already models this ordering.

Seed data (dev only): same image, `command: ["node", "dist/db/seed.js"]`.

### PostgreSQL

Not stateless: StatefulSet + PVC (needs a storage class on bare-metal kubeadm —
`local-path-provisioner` is the usual choice). Credentials from a Secret, later Vault.

---

## 10. Gotchas ledger

Hit-and-fixed, so they are not re-debugged from scratch.

| # | Symptom | Cause | Fix |
|---|---|---|---|
| 1 | `docker compose build` → `failed to resolve source metadata … i/o timeout` | BuildKit can't resolve Docker Hub; only IPv6 records come back on this laptop | `docker pull <base-image>` with the daemon first, then build |
| 2 | *(watch for)* kubelet crash-loops right after `kubeadm init` | containerd cgroup driver ≠ systemd | §6 A4 — `SystemdCgroup = true` |
| 3 | *(watch for)* Nodes `NotReady` forever after init | No CNI installed yet | §7 B4 — expected until Calico is up |
| 4 | *(watch for)* Pods can't reach each other / SSH drops | Pod CIDR overlaps the VM LAN (Calico default `192.168.0.0/16`) | §5 — use `10.244.0.0/16`, match CNI to `kubeadm init` |
| 5 | *(watch for)* `kubeadm join` fails after a day | Token TTL is 24h | `kubeadm token create --print-join-command` |
| 6 | *(watch for)* API server unreachable after VM restart | DHCP changed the node IP; cert SANs are stale | Static IPs on all three VMs |

---

## 11. Running journal

Append as you go — date, what changed, what broke.

### 2026-08-31 — Application complete
Frontend, backend, Postgres built and validated end-to-end under Compose. 55/55 tests
(24 unit, 31 integration against real Postgres), lint and both builds clean. Verified by
hand: liveness stayed `200` while readiness returned `503` with Postgres stopped, and the
backend recovered without a restart; graceful shutdown drained cleanly on SIGTERM;
containers run non-root (uid 1000 / 101); `/debug/*` gated off by default; tracing
survived a nonexistent OTLP collector while still stamping `traceId` into logs.

### 2026-09-01 — Images published
`docker login` + push. `schoudhary94/taskflow-backend:v1` and
`schoudhary94/taskflow-frontend:v1`, both public (anonymous pull returns `200`). The
`taskflow-migrate` image was deliberately **not** pushed — identical to the backend build;
the migration Job overrides the command instead.

### 2026-09-01 — Cluster plan fixed
Chose 3 local VMs (1 control plane + 2 workers) over minikube/kind, to get real
`kubeadm join`, node networking, placement and rescheduling. Capacity checked: 8 cores /
12 GiB RAM / 322 GB free, KVM available, no hypervisor tooling installed yet. Budget
6 vCPU / 6.5 GiB across the three VMs — Compose stack must be down while they run.

### 2026-09-__ — kubeadm cluster
_(next: install hypervisor + Vagrant, build the three VMs, work §6 → §8)_

- [ ] Hypervisor + provisioning tool installed
- [ ] 3 VMs created with static IPs, hostnames set
- [ ] §6 Phase A completed on all three nodes
- [ ] `kubeadm init` succeeded on cp-01
- [ ] Calico installed, pod CIDR matches
- [ ] Both workers joined, all nodes `Ready`
- [ ] Cross-node pod-to-pod networking verified (§8 D2)
