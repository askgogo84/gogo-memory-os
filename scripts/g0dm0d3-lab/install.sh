#!/usr/bin/env bash
# Developer-only G0DM0D3 lab. Nothing here runs on app.askgogo.in.
set -euo pipefail

UPSTREAM="https://github.com/elder-plinius/G0DM0D3.git"
PIN="f6301765fb90eb7b336bdf365319cd2fe44b1187"
SOURCE_DIR="${G0DM0D3_LAB_DIR:-${HOME}/.cache/ciq-g0dm0d3-lab}/source"
IMAGE="ciq-g0dm0d3-lab:${PIN:0:12}"
CONTAINER="ciq-g0dm0d3-lab"
PORT="${G0DM0D3_LAB_PORT:-7860}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  printf 'Usage: bash %s {start|stop|status}\n' "$0" >&2
  exit 2
}

command -v docker >/dev/null 2>&1 || { echo "Docker is required for the isolated lab." >&2; exit 1; }
case "${1:-}" in
  stop)
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    echo "Local G0DM0D3 lab stopped (image and source cache preserved)."
    exit 0 ;;
  status)
    docker ps -a --filter "name=^/${CONTAINER}$"
    exit 0 ;;
  start) ;;
  *) usage ;;
esac

command -v git >/dev/null 2>&1 || { echo "Git is required." >&2; exit 1; }
[[ "$PORT" =~ ^[0-9]{2,5}$ ]] || { echo "Invalid G0DM0D3_LAB_PORT." >&2; exit 1; }
[[ -n "${GODMODE_API_KEY:-}" && "${#GODMODE_API_KEY}" -ge 24 ]] || {
  echo "Set GODMODE_API_KEY to a random developer-only secret of at least 24 characters." >&2
  exit 1
}
export GODMODE_API_KEY
if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then export OPENROUTER_API_KEY; fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not available." >&2
  exit 1
fi
if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "Container already exists; run 'bash scripts/g0dm0d3-lab/install.sh stop' first." >&2
  exit 1
fi

if [[ ! -e "$SOURCE_DIR" ]]; then
  mkdir -p "$(dirname "$SOURCE_DIR")"
  git init -q "$SOURCE_DIR"
  git -C "$SOURCE_DIR" remote add origin "$UPSTREAM"
  # Fetch the reviewed revision, not whichever commit upstream's main points at today.
  git -C "$SOURCE_DIR" fetch --depth 1 --no-tags origin "$PIN"
  git -C "$SOURCE_DIR" checkout --detach --force FETCH_HEAD
fi

[[ -d "$SOURCE_DIR/.git" ]] || { echo "Existing lab cache is not a Git repository." >&2; exit 1; }
ACTUAL_REMOTE="$(git -C "$SOURCE_DIR" remote get-url origin)"
[[ "$ACTUAL_REMOTE" == "$UPSTREAM" ]] || { echo "Unexpected G0DM0D3 remote; refusing to build." >&2; exit 1; }
ACTUAL_PIN="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
[[ "$ACTUAL_PIN" == "$PIN" ]] || {
  echo "Upstream changed or cached source differs from audited PIN. Refusing to build." >&2
  echo "Expected $PIN; actual $ACTUAL_PIN" >&2
  exit 1
}
[[ -z "$(git -C "$SOURCE_DIR" status --porcelain)" ]] || {
  echo "Source checkout contains local changes; refusing to build." >&2; exit 1
}

echo "Building isolated lab from pinned upstream SHA $PIN..."
docker build --pull -f "$SCRIPT_DIR/Dockerfile" -t "$IMAGE" "$SOURCE_DIR"

# Pass only explicitly allowed lab environment variables. Do not export HF tokens,
# datasets, production app secrets, Vercel secrets or any user context.
args=(--detach --name "$CONTAINER" --publish "127.0.0.1:${PORT}:7860"
  --restart no --cap-drop ALL --security-opt no-new-privileges
  --pids-limit 256 --memory 1g --cpus 2
  --env GODMODE_API_KEY --env PORT=7860
  --env CORS_ORIGIN=http://localhost:7860)
if [[ -n "${OPENROUTER_API_KEY:-}" ]]; then
  args+=(--env OPENROUTER_API_KEY)
fi
docker run "${args[@]}" "$IMAGE" >/dev/null
echo "Lab API configured on 127.0.0.1:$PORT (developer-only)."
echo "Check: node scripts/g0dm0d3-lab/smoke.mjs askgogo"
echo "This does not connect production applications or enable any model calls."
