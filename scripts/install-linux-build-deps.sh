#!/usr/bin/env bash
set -euo pipefail

# Ubuntu build runners only. Runtime package dependencies are declared in the
# package configuration; this also supplies headers for the bundled UKMM CLI.
sudo apt-get update
sudo apt-get install -y \
  pkg-config libssl-dev libudev-dev libgtk-3-dev \
  libx11-dev libxi-dev libxtst-dev libxdo-dev libxrandr-dev \
  libxinerama-dev libxcursor-dev libxcb-shape0-dev libxcb-xfixes0-dev \
  libxkbcommon-dev libwayland-dev libegl1-mesa-dev \
  libsdl2-2.0-0 pulseaudio-utils ffmpeg
