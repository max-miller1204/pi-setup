#!/usr/bin/env bash
set -euo pipefail

if ! command -v pi >/dev/null 2>&1; then
  echo "pi is required: https://pi.dev" >&2
  exit 1
fi

repo_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
config_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
settings_path="$config_dir/settings.json"
mkdir -p "$config_dir/agents"

if [[ -f "$settings_path" ]]; then
  backup="$settings_path.backup.$(date +%Y%m%d%H%M%S)"
  cp "$settings_path" "$backup"
  echo "Backed up settings to $backup"
fi

install -m 0644 "$repo_dir"/agents/*.md "$config_dir/agents/"

packages=(
  "git:github.com/max-miller1204/pi-setup"
  "npm:stepstone"
  "npm:pi-web-access"
  "git:github.com/elpapi42/pi-observational-memory"
  "npm:pi-mcp-adapter"
  "git:github.com/max-miller1204/pi-interactive-subagents"
)

for package in "${packages[@]}"; do
  pi install "$package"
done

python3 - "$repo_dir/config/settings.json" "$settings_path" <<'PY'
import json
import sys
from pathlib import Path

template_path = Path(sys.argv[1])
settings_path = Path(sys.argv[2])
template = json.loads(template_path.read_text())
template.pop("packages", None)

if settings_path.exists():
    current = json.loads(settings_path.read_text())
else:
    current = {}

current.update(template)
settings_path.parent.mkdir(parents=True, exist_ok=True)
settings_path.write_text(json.dumps(current, indent=2) + "\n")
PY

echo "Installed Pi setup. Run /login in Pi to configure provider credentials."
if [[ ! -f "$config_dir/themes/dots-system.json" ]]; then
  echo "Warning: dots-system is selected but not installed; run Dots theme sync or choose another Pi theme." >&2
fi
echo "Optional: install the playwright-cli skill used by browser-worker."
