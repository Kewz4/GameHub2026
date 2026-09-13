#!/usr/bin/env bash
set -euo pipefail

# Only run inside an isolated Xvfb/DBus CI session, never a user's desktop.
: "${GAMEHUB_LINUX_NATIVE_QA:?explicit isolated Linux QA opt-in required}"
if [[ "${GAMEHUB_LINUX_NATIVE_QA}" != "1" || -n "${WAYLAND_DISPLAY:-}" ]]; then
  exit 2
fi
mkdir -p artifacts/linux-parity
session_runtime=$(mktemp -d "${RUNNER_TEMP:-/tmp}/gamehub-linux-runtime.XXXXXX")
export XDG_RUNTIME_DIR="$session_runtime"
export PULSE_RUNTIME_PATH="$session_runtime/pulse"
mkdir -p "$PULSE_RUNTIME_PATH"
chmod 700 "$session_runtime" "$PULSE_RUNTIME_PATH"
openbox >artifacts/linux-parity/openbox.log 2>&1 &
wm_pid=$!
xcompmgr -a >artifacts/linux-parity/compositor.log 2>&1 &
compositor_pid=$!
pulseaudio --daemonize=no --exit-idle-time=-1 --use-pid-file=false >artifacts/linux-parity/pulse.log 2>&1 &
pulse_pid=$!
cleanup() {
  # Only the three services created by this shell are stopped.
  kill "$wm_pid" "$compositor_pid" "$pulse_pid" 2>/dev/null || true
}
trap cleanup EXIT
for attempt in {1..30}; do
  if pactl info >/dev/null 2>&1 && xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id'; then
    break
  fi
  sleep 0.2
done

failed=0
run_check() {
  local name="$1"
  shift
  if "$@" >"artifacts/linux-parity/${name}.log" 2>&1; then
    printf '%s passed\n' "$name"
  else
    cat "artifacts/linux-parity/${name}.log"
    printf '%s failed\n' "$name"
    failed=1
  fi
}
export PLAYWRIGHT_PACKAGE="$PWD/node_modules/playwright"
export GAMEHUB_LINUX_COMPOSITOR_QA=1
export GAMEHUB_LINUX_AUDIO_QA=1
run_check native node scripts/qa-linux-native.cjs
run_check interface env GAMEHUB_BACKGROUND_QA=true node scripts/qa-linux-ui-smoke.mjs
run_check overlay env GAMEHUB_BACKGROUND_QA=true node scripts/shoot-overlay.mjs
exit "$failed"
