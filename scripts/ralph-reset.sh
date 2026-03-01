#!/usr/bin/env bash
# Reset a specific RALPH group to pending so it can be re-run.
# Usage: ./scripts/ralph-reset.sh <group-id>

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_FILE="$REPO_ROOT/.ralph-tasks.json"

GROUP_ID="${1:?'Usage: ralph-reset.sh <group-id>'}"

if [[ ! -f "$STATE_FILE" ]]; then
  echo "No state file found: $STATE_FILE"
  echo "Run ./scripts/ralph.sh to initialize."
  exit 1
fi

python3 - <<PYEOF
import json

with open('$STATE_FILE') as f:
    state = json.load(f)

found = False
for g in state['groups']:
    if g['id'] == $GROUP_ID:
        prev = g['status']
        g['status'] = 'pending'
        g['attempts'] = 0
        found = True
        print(f"Group $GROUP_ID: {g['title']}")
        print(f"  Status: {prev} → pending")
        print(f"  Attempts: reset to 0")
        break

if not found:
    print(f"Group $GROUP_ID not found in state.")
    exit(1)

with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)

print("Done. Run: ./scripts/ralph.sh $GROUP_ID")
PYEOF
