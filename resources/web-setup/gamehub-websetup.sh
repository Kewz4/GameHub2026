#!/usr/bin/env bash
# GameHub web setup for Linux — the few-KB equivalent of GameHub-WebSetup.exe.
# Downloads the real app from the latest GitHub release at install time, so the
# initial download is tiny. Offers:
#   Install  — .deb via apt, .rpm via dnf/zypper, else AppImage integrated into
#              ~/.local (bin symlink + .desktop entry + icon lookup by name).
#   Portable — AppImage into a folder of your choice, with the "portable"
#              marker next to it so ALL app data stays inside that folder.
#
# Usage:
#   ./gamehub-websetup.sh                     # interactive
#   ./gamehub-websetup.sh --install           # non-interactive install
#   ./gamehub-websetup.sh --portable [DIR]    # non-interactive portable
set -euo pipefail

REPO="Kewz4/GameHub2026"
API="https://api.github.com/repos/$REPO/releases/latest"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

fetch() { # fetch URL [OUTFILE] — curl or wget, whichever exists
  if command -v curl >/dev/null 2>&1; then
    if [ $# -gt 1 ]; then curl -fL --progress-bar -o "$2" "$1"; else curl -fsSL "$1"; fi
  elif command -v wget >/dev/null 2>&1; then
    if [ $# -gt 1 ]; then wget -q --show-progress -O "$2" "$1"; else wget -qO- "$1"; fi
  else
    die "curl or wget is required"
  fi
}

# ---- resolve the latest release ---------------------------------------------
say "Looking up the latest GameHub release..."
RELEASE_JSON="$(fetch "$API")" || die "could not reach the GitHub API"
TAG="$(printf '%s' "$RELEASE_JSON" | grep -m1 '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')"
[ -n "$TAG" ] || die "could not resolve the latest release"
say "Latest release: $TAG"

asset_url() { # asset_url REGEX — first browser_download_url whose name matches
  printf '%s' "$RELEASE_JSON" |
    grep -o '"browser_download_url": *"[^"]*"' |
    sed 's/.*"\(https[^"]*\)"/\1/' |
    grep -iE "$1" | head -n1
}

# ---- pick a mode ------------------------------------------------------------
MODE="${1:-}"
TARGET_DIR="${2:-}"
if [ -z "$MODE" ]; then
  echo
  echo "  How do you want to set up GameHub?"
  echo "    1) Install (recommended) — system package or integrated AppImage"
  echo "    2) Portable — AppImage in a folder you pick; all data stays there"
  echo
  read -r -p "  Choice [1/2]: " choice
  case "$choice" in
    2) MODE="--portable" ;;
    *) MODE="--install" ;;
  esac
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

download_appimage() {
  local url
  url="$(asset_url '\.appimage$')"
  [ -n "$url" ] || die "no AppImage in release $TAG"
  say "Downloading $(basename "$url")..."
  fetch "$url" "$TMP/GameHub.AppImage"
  chmod +x "$TMP/GameHub.AppImage"
}

case "$MODE" in
  --install)
    if command -v apt-get >/dev/null 2>&1 && url="$(asset_url '\.deb$')" && [ -n "$url" ]; then
      say "Downloading $(basename "$url")..."
      fetch "$url" "$TMP/gamehub.deb"
      say "Installing with apt (needs sudo)..."
      sudo apt-get install -y "$TMP/gamehub.deb"
    elif command -v dnf >/dev/null 2>&1 && url="$(asset_url '\.rpm$')" && [ -n "$url" ]; then
      say "Downloading $(basename "$url")..."
      fetch "$url" "$TMP/gamehub.rpm"
      say "Installing with dnf (needs sudo)..."
      sudo dnf install -y "$TMP/gamehub.rpm"
    elif command -v zypper >/dev/null 2>&1 && url="$(asset_url '\.rpm$')" && [ -n "$url" ]; then
      say "Downloading $(basename "$url")..."
      fetch "$url" "$TMP/gamehub.rpm"
      say "Installing with zypper (needs sudo)..."
      sudo zypper --non-interactive install --allow-unsigned-rpm "$TMP/gamehub.rpm"
    else
      # No native package manager match — integrate the AppImage into ~/.local.
      download_appimage
      APP_DIR="$HOME/.local/share/GameHub"
      BIN_DIR="$HOME/.local/bin"
      mkdir -p "$APP_DIR" "$BIN_DIR" "$HOME/.local/share/applications"
      mv "$TMP/GameHub.AppImage" "$APP_DIR/GameHub.AppImage"
      ln -sf "$APP_DIR/GameHub.AppImage" "$BIN_DIR/gamehub"
      cat > "$HOME/.local/share/applications/gamehub.desktop" <<DESKTOP
[Desktop Entry]
Name=GameHub
Exec=$APP_DIR/GameHub.AppImage %U
Terminal=false
Type=Application
Categories=Game;
MimeType=x-scheme-handler/hydralauncher;
DESKTOP
      say "Installed to $APP_DIR (launcher entry + 'gamehub' on PATH)."
    fi
    say "Install complete."
    ;;

  --portable)
    if [ -z "$TARGET_DIR" ]; then
      read -r -p "  Folder for portable GameHub [$HOME/GameHub]: " TARGET_DIR
      TARGET_DIR="${TARGET_DIR:-$HOME/GameHub}"
    fi
    mkdir -p "$TARGET_DIR"
    download_appimage
    mv "$TMP/GameHub.AppImage" "$TARGET_DIR/GameHub.AppImage"
    # The app treats a "portable" marker next to the AppImage as portable mode
    # and keeps all data in this folder (USB-friendly).
    touch "$TARGET_DIR/portable"
    say "Portable GameHub ready: $TARGET_DIR/GameHub.AppImage"
    say "All settings/saves will live in $TARGET_DIR/data."
    ;;

  *)
    die "unknown option: $MODE (use --install or --portable [DIR])"
    ;;
esac
