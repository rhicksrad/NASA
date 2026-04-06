#!/usr/bin/env bash
set -euo pipefail

APT_GET=""
if command -v apt-get >/dev/null 2>&1; then
  if [ "$(id -u)" -eq 0 ]; then
    APT_GET="apt-get"
  elif command -v sudo >/dev/null 2>&1; then
    APT_GET="sudo apt-get"
  fi
fi

if [ -n "$APT_GET" ]; then
  ALSA_PACKAGE="libasound2"
  if apt-cache show libasound2t64 >/dev/null 2>&1; then
    ALSA_PACKAGE="libasound2t64"
  fi

  $APT_GET update
  $APT_GET install -y \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libxkbcommon0 \
    "$ALSA_PACKAGE"
fi

pnpm exec playwright install chromium
