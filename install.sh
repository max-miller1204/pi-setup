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
  backup="$(mktemp "$settings_path.backup.XXXXXXXX")"
  cp "$settings_path" "$backup"
  echo "Backed up settings to $backup"
fi

# Retire only the setup's former active resource names. Preserve their exact contents.
retired_backup=""
retire_resource() {
  local source="$1" relative="$2"
  if [[ -e "$source" || -L "$source" ]]; then
    if [[ -z "$retired_backup" ]]; then
      retired_backup="$(mktemp -d "$config_dir/retired-resources.XXXXXX")"
      echo "Backed up retired resources to $retired_backup"
    fi
    mkdir -p "$retired_backup/$(dirname "$relative")"
    mv -- "$source" "$retired_backup/$relative"
  fi
}
retire_resource "$config_dir/agents/reviewer.md" "agents/reviewer.md"
retire_resource "$config_dir/agents/review-pass.md" "agents/review-pass.md"
retire_resource "$config_dir/extensions/read-only-git.ts" "extensions/read-only-git.ts"
retire_resource "$HOME/.agents/skills/iterative-review" "skills/iterative-review"
retire_resource "$HOME/.agents/skills/reviewed-pr" "skills/reviewed-pr"

install -m 0644 "$repo_dir"/agents/*.md "$config_dir/agents/"

skills_dir="$HOME/.agents/skills"
skills_backup=""
mkdir -p "$skills_dir"
shopt -s nullglob
active_skill_dirs=("$repo_dir"/skills/*/)
for skill_dir in "${active_skill_dirs[@]}"; do
  skill_name="$(basename "$skill_dir")"
  target="$skills_dir/$skill_name"
  if [[ -e "$target" || -L "$target" ]]; then
    if [[ -z "$skills_backup" ]]; then
      skills_backup="$(mktemp -d "$config_dir/skills-backup.XXXXXX")"
      echo "Backed up skills to $skills_backup"
    fi
    cp -RL "$target" "$skills_backup/$skill_name"
  fi
  mkdir -p "$target"
  cp -R "$skill_dir". "$target/"
done

packages=(
  "npm:pi-web-access"
  "git:github.com/max-miller1204/pi-observational-memory"
  "npm:pi-mcp-adapter"
  "git:github.com/max-miller1204/pi-interactive-subagents"
  "git:github.com/max-miller1204/pi-setup"
  "git:github.com/obra/superpowers"
  "git:github.com/max-miller1204/pi-session-tasks"
)

for superseded in "npm:stepstone" "git:github.com/elpapi42/pi-observational-memory"; do
  if [[ -f "$settings_path" ]]; then
    installed="$(python3 - "$settings_path" "$superseded" <<'PY'
import json
import sys
from pathlib import Path

packages = json.loads(Path(sys.argv[1]).read_text()).get("packages", [])
assert isinstance(packages, list), "settings packages must be a list"
print("true" if sys.argv[2] in packages else "false")
PY
)"
    if [[ "$installed" == "true" ]]; then
      pi remove "$superseded"
    fi
  fi
done

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
