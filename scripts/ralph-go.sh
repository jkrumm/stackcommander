#!/usr/bin/env bash
# RollHook — Go Rewrite RALPH Loop
#
# Usage:
#   ./scripts/ralph-go.sh              # Run all pending groups
#   ./scripts/ralph-go.sh 3            # Run only group 3
#   ./scripts/ralph-go.sh --reset 3    # Reset group 3 to pending, then run
#   ./scripts/ralph-go.sh --status     # Print status and exit
#
# Logs are written to .ralph-go-logs/group-N.log (quiet terminal by default).
# To watch a group in real-time: tail -f .ralph-go-logs/group-N.log
#
# Prerequisites:
#   brew install coreutils   # for gtimeout
#   claude CLI must be in PATH

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCS_DIR="$REPO_ROOT/docs/go-rewrite"
PROMPTS_DIR="$DOCS_DIR/prompts"
STATE_FILE="$REPO_ROOT/.ralph-go-tasks.json"
LOGS_DIR="$REPO_ROOT/.ralph-go-logs"
REPORT_FILE="$DOCS_DIR/RALPH_REPORT.md"

MAX_RETRIES=3
CLAUDE_TIMEOUT=2700  # 45 minutes per group (Group 9 may need full timeout — 3 retries available)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

TOTAL_GROUPS=10

GROUP_TITLES=(
  ""  # 1-indexed
  "Go Module + Skeleton"
  "Auth + OpenAPI + Scalar"
  "SQLite + Job Persistence"
  "Docker SDK Integration"
  "Zot Manager + OCI Proxy"
  "Job Queue + Discovery + Validate"
  "Pull + Rolling Deploy + Notifier"
  "Full API + Wire-Up"
  "Dockerfile Cutover + E2E Quality Pass"
  "OpenAPI Polish + Orval + Cleanup"
)

log_info()    { echo -e "${BLUE}[ralph]${NC} $*"; }
log_success() { echo -e "${GREEN}[ralph]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[ralph]${NC} $*"; }
log_error()   { echo -e "${RED}[ralph]${NC} $*"; }

require_commands() {
  local missing=0
  for cmd in claude gtimeout python3; do
    if ! command -v "$cmd" &>/dev/null; then
      log_error "$cmd not found."
      missing=1
    fi
  done
  if [[ $missing -eq 1 ]]; then
    echo "Install: brew install coreutils (for gtimeout)"
    exit 1
  fi
}

# ── State management ──────────────────────────────────────────────────────────

init_state() {
  if [[ -f "$STATE_FILE" ]]; then
    log_info "Resuming from existing state."
    return
  fi

  log_info "Initializing task state..."
  python3 - <<PYEOF
import json

title_list = [
    "Go Module + Skeleton",
    "Auth + OpenAPI + Scalar",
    "SQLite + Job Persistence",
    "Docker SDK Integration",
    "Zot Manager + OCI Proxy",
    "Job Queue + Discovery + Validate",
    "Pull + Rolling Deploy + Notifier",
    "Full API + Wire-Up",
    "Dockerfile Cutover + E2E Quality Pass",
    "OpenAPI Polish + Orval + Cleanup",
]

groups = []
for i, title in enumerate(title_list, start=1):
    groups.append({
        "id": i,
        "title": title,
        "status": "pending",
        "attempts": 0,
        "started_at": None,
        "completed_at": None,
    })

state = {"groups": groups, "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
with open("$STATE_FILE", "w") as f:
    json.dump(state, f, indent=2)
print("State initialized.")
PYEOF
}

get_field() {
  python3 -c "
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == $1:
        print(g.get('$2', ''))
        break
"
}

set_field() {
  python3 - <<PYEOF
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == $1:
        val = '$3'
        if val in ('True', 'False', 'None'):
            val = {'True': True, 'False': False, 'None': None}[val]
        g['$2'] = val
        break
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
PYEOF
}

inc_attempts() {
  python3 - <<PYEOF
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == $1:
        g['attempts'] = g.get('attempts', 0) + 1
        break
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
PYEOF
}

print_status() {
  python3 - <<PYEOF
import json

with open('$STATE_FILE') as f:
    state = json.load(f)

icons = {'complete': '✅', 'blocked': '🚫', 'pending': '⬜', 'in_progress': '🔄'}
total = len(state['groups'])
done = sum(1 for g in state['groups'] if g['status'] == 'complete')
blocked = sum(1 for g in state['groups'] if g['status'] == 'blocked')
pending = total - done - blocked

print(f"  {total} groups | {done} complete | {pending} pending | {blocked} blocked")
print()
for g in state['groups']:
    icon = icons.get(g['status'], '⬜')
    attempts = f"  (attempt {g['attempts']})" if g['attempts'] > 0 else ""
    print(f"  {icon}  Group {g['id']}: {g['title']}{attempts}")
PYEOF
}

# ── Validation ────────────────────────────────────────────────────────────────

validate_go() {
  local label=${1:-""}
  log_info "Go validation${label:+ ($label)}..."
  cd "$REPO_ROOT"

  if ! go build ./... 2>&1; then
    log_error "go build failed"
    return 1
  fi
  if ! go vet ./... 2>&1; then
    log_error "go vet failed"
    return 1
  fi
  if ! go test ./... 2>&1; then
    log_error "go test failed"
    return 1
  fi

  log_success "Go validation passed"
  return 0
}

# ── Claude invocation ─────────────────────────────────────────────────────────

run_group() {
  local group_id=$1
  local prompt_file="$PROMPTS_DIR/group-$group_id.md"
  local context_file="$DOCS_DIR/shared-context.md"
  local log_file="$LOGS_DIR/group-$group_id.log"

  mkdir -p "$LOGS_DIR"

  if [[ ! -f "$prompt_file" ]]; then
    log_error "Prompt not found: $prompt_file"
    return 1
  fi

  local full_prompt
  full_prompt="$(cat "$context_file")"$'\n\n---\n\n'"$(cat "$prompt_file")"

  log_info "Claude running (timeout: ${CLAUDE_TIMEOUT}s) → log: .ralph-go-logs/group-$group_id.log"
  log_info "Watch live: tail -f .ralph-go-logs/group-$group_id.log"
  echo ""

  local exit_code=0
  # Output goes to log file only — keeps terminal clean.
  # Use stream-json for real-time file writes (text format buffers until completion).
  if CLAUDE_CODE_ENABLE_TASKS=true CLAUDECODE="" gtimeout "$CLAUDE_TIMEOUT" claude \
    -p "$full_prompt" \
    --dangerously-skip-permissions \
    --output-format stream-json \
    --verbose \
    --no-session-persistence \
    < /dev/null > "$log_file" 2>&1; then
    exit_code=0
  else
    exit_code=$?
  fi

  if [[ $exit_code -eq 124 ]]; then
    log_error "Timed out after ${CLAUDE_TIMEOUT}s"
    return 1
  fi

  if grep -q "RALPH_TASK_COMPLETE: Group $group_id" "$log_file"; then
    return 0
  fi

  if grep -q "RALPH_TASK_BLOCKED: Group $group_id" "$log_file"; then
    return 2
  fi

  log_warn "Claude finished but no completion signal in log."
  return 1
}

# ── Report ────────────────────────────────────────────────────────────────────

generate_report() {
  python3 - <<PYEOF
import json
from datetime import datetime

with open('$STATE_FILE') as f:
    state = json.load(f)

icons = {'complete': '✅', 'blocked': '🚫', 'pending': '⬜', 'in_progress': '🔄'}
total = len(state['groups'])
done = sum(1 for g in state['groups'] if g['status'] == 'complete')
blocked = sum(1 for g in state['groups'] if g['status'] == 'blocked')
pending = total - done - blocked

lines = [
    "# RollHook Go Rewrite — RALPH Report",
    "",
    f"Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)",
    f"Groups: {total} total | {done} complete | {pending} pending | {blocked} blocked",
    "",
    "## Status",
    "",
]
for g in state['groups']:
    icon = icons.get(g['status'], '⬜')
    attempts = f" (attempts: {g['attempts']})" if g['attempts'] > 0 else ""
    lines.append(f"- {icon} **Group {g['id']}**: {g['title']}{attempts}")

lines += ["", "## Next Steps", ""]
if done == total:
    lines += [
        "All groups complete.",
        "",
        "1. Review: \`git log --oneline -20\`",
        "2. Final E2E: \`bun run test:e2e\`",
        "3. Create PR: \`/pr\`",
    ]
elif pending > 0:
    lines.append("Run \`./scripts/ralph-go.sh\` to continue.")

with open('$REPORT_FILE', 'w') as f:
    f.write('\n'.join(lines) + '\n')

print(f"Report: $REPORT_FILE")
PYEOF
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  local target_group=""
  local do_reset=false
  local status_only=false

  while [[ $# -gt 0 ]]; do
    case $1 in
      --status) status_only=true; shift ;;
      --reset)
        do_reset=true
        target_group="${2:?'--reset requires a group number'}"
        shift 2
        ;;
      [0-9]*) target_group="$1"; shift ;;
      *) echo "Unknown: $1"; echo "Usage: $0 [group] [--reset group] [--status]"; exit 1 ;;
    esac
  done

  echo ""
  echo -e "${BOLD}  RollHook — Go Rewrite RALPH Loop${NC}"
  echo ""

  require_commands
  cd "$REPO_ROOT"
  init_state

  if $status_only; then
    print_status
    exit 0
  fi

  if $do_reset; then
    log_info "Resetting Group $target_group to pending..."
    set_field "$target_group" "status" "pending"
    python3 - <<PYEOF
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == $target_group:
        g['attempts'] = 0
        break
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
PYEOF
  fi

  print_status
  echo ""

  local groups_to_run=()
  if [[ -n "$target_group" ]]; then
    groups_to_run=("$target_group")
  else
    for i in $(seq 1 $TOTAL_GROUPS); do
      groups_to_run+=("$i")
    done
  fi

  for group_id in "${groups_to_run[@]}"; do
    local status
    status=$(get_field "$group_id" "status")

    if [[ "$status" == "complete" ]]; then
      echo -e "  ✅  Group $group_id: ${GROUP_TITLES[$group_id]} — skipped (complete)"
      continue
    fi
    if [[ "$status" == "blocked" ]]; then
      echo -e "  🚫  Group $group_id: ${GROUP_TITLES[$group_id]} — skipped (blocked)"
      continue
    fi

    local attempts
    attempts=$(get_field "$group_id" "attempts")

    if [[ "$attempts" -ge "$MAX_RETRIES" ]]; then
      log_warn "Group $group_id reached max retries. Marking blocked."
      set_field "$group_id" "status" "blocked"
      continue
    fi

    echo ""
    echo "  ────────────────────────────────────────────"
    echo -e "  ${BOLD}Group $group_id: ${GROUP_TITLES[$group_id]}${NC}"
    echo "  Attempt: $((attempts + 1)) / $MAX_RETRIES"
    echo "  ────────────────────────────────────────────"
    echo ""

    # Pre-group validation (skip group 1 — nothing to validate yet)
    if [[ "$group_id" -gt 1 ]] && [[ -f "$REPO_ROOT/go.mod" ]]; then
      if ! validate_go "pre-group $group_id"; then
        log_error "Pre-group validation failed. Fix before continuing."
        exit 1
      fi
      echo ""
    fi

    set_field "$group_id" "status" "in_progress"
    inc_attempts "$group_id"

    run_result=0
    run_group "$group_id" || run_result=$?
    echo ""

    if [[ $run_result -eq 0 ]]; then
      log_success "Group $group_id complete."
      set_field "$group_id" "status" "complete"
      set_field "$group_id" "completed_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

      echo ""
      if validate_go "post-group $group_id"; then
        log_success "Post-group validation passed ✓"
      else
        log_warn "Post-group validation FAILED. Review log and fix."
        log_warn "Retry: ./scripts/ralph-go.sh --reset $group_id"
      fi

    elif [[ $run_result -eq 2 ]]; then
      log_warn "Group $group_id blocked. See: .ralph-go-logs/group-$group_id.log"
      set_field "$group_id" "status" "blocked"

    else
      log_error "Group $group_id failed (attempt $((attempts + 1)) / $MAX_RETRIES)"
      set_field "$group_id" "status" "pending"
      log_info "Log: .ralph-go-logs/group-$group_id.log"

      new_attempts=$(get_field "$group_id" "attempts")
      if [[ "$new_attempts" -ge "$MAX_RETRIES" ]]; then
        set_field "$group_id" "status" "blocked"
      elif [[ -z "$target_group" ]]; then
        log_warn "Stopping. Fix Group $group_id before proceeding."
        break
      fi
    fi

    echo ""
  done

  echo ""
  generate_report
  echo ""
  echo -e "${BOLD}  RALPH loop done.${NC}"
  echo ""
  print_status
  echo ""
}

main "$@"
