#!/usr/bin/env bash
# Cloud Agent `install` phase: durable, idempotent setup that is captured in the
# environment snapshot. Installs system tooling (Docker, Supabase CLI, psql),
# node dependencies, and pre-pulls the Supabase stack images so first boot is
# fast. Per-boot processes (dockerd, supabase, next dev) live in cloud-start.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

SUPABASE_CLI_VERSION="2.117.0"

echo "==> Installing system packages (docker, fuse-overlayfs, postgresql-client)"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
# fuse3/fuse-overlayfs postinst can exit non-zero in a container (udev), but the
# binaries install fine and are all we need, so don't let that abort install.
sudo apt-get install -y -qq docker.io fuse-overlayfs postgresql-client || true

echo "==> Configuring Docker to use the fuse-overlayfs storage driver"
# Kernel overlayfs mounts fail in this nested VM; fuse-overlayfs works. The
# classic graphdriver needs the containerd snapshotter turned off.
echo '{ "storage-driver": "fuse-overlayfs", "features": { "containerd-snapshotter": false } }' \
  | sudo tee /etc/docker/daemon.json >/dev/null

echo "==> Installing Supabase CLI ${SUPABASE_CLI_VERSION}"
if ! command -v supabase >/dev/null 2>&1 || [ "$(supabase --version 2>/dev/null)" != "$SUPABASE_CLI_VERSION" ]; then
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/supabase.deb" \
    "https://github.com/supabase/cli/releases/download/v${SUPABASE_CLI_VERSION}/supabase_${SUPABASE_CLI_VERSION}_linux_amd64.deb"
  sudo dpkg -i "$tmp/supabase.deb"
  rm -rf "$tmp"
fi

echo "==> Installing node dependencies (npm ci)"
npm ci

echo "==> Pre-pulling Supabase stack Docker images (best-effort, speeds first boot)"
# Runs dockerd briefly just to warm the image cache into the snapshot. Guarded so
# a DinD hiccup never fails the durable install; images pull on first boot if so.
# Skipped when a daemon is already running (e.g. this VM already booted).
if docker info >/dev/null 2>&1; then
  echo "    (docker already running; pulling images against the live daemon)"
  ( set +e
    supabase start >/tmp/install-supabase.log 2>&1 && supabase stop --no-backup >/dev/null 2>&1 ) || true
else
  (
    set +e
    sudo dockerd >/tmp/install-dockerd.log 2>&1 &
    dpid=$!
    for _ in $(seq 1 30); do [ -S /var/run/docker.sock ] && break; sleep 1; done
    sudo chmod 666 /var/run/docker.sock 2>/dev/null
    echo 0 | sudo tee /proc/sys/net/bridge/bridge-nf-call-iptables >/dev/null 2>&1
    echo 0 | sudo tee /proc/sys/net/bridge/bridge-nf-call-ip6tables >/dev/null 2>&1
    ( for _ in $(seq 1 120); do echo 0 | sudo tee /proc/sys/net/bridge/bridge-nf-call-iptables >/dev/null 2>&1; sleep 0.5; done ) &
    enforcer=$!
    supabase start >/tmp/install-supabase.log 2>&1 && supabase stop --no-backup >/dev/null 2>&1
    kill "$enforcer" 2>/dev/null
    sudo kill "$dpid" 2>/dev/null
    wait "$dpid" 2>/dev/null
  ) || echo "    (image pre-pull skipped; images will pull on first boot)"
fi

echo "==> install complete"
