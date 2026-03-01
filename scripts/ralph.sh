#!/usr/bin/env bash
# RollHook Registry — RALPH Loop
# Autonomous per-group implementation runner for the Zot registry integration.
#
# Usage:
#   ./scripts/ralph.sh              # Run all pending groups
#   ./scripts/ralph.sh 3            # Run only group 3 (re-run specific group)
#   ./scripts/ralph.sh --reset 3    # Reset group 3 to pending, then run
#   ./scripts/ralph.sh --status     # Print status and exit
#
# Prerequisites:
#   brew install coreutils   # for gtimeout
#   claude CLI must be in PATH

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCS_DIR="$REPO_ROOT/docs/registry"
PROMPTS_DIR="$DOCS_DIR/prompts"
STATE_FILE="$REPO_ROOT/.ralph-tasks.json"
LOGS_DIR="$REPO_ROOT/.ralph-logs"
REPORT_FILE="$DOCS_DIR/RALPH_REPORT.md"

MAX_RETRIES=3
CLAUDE_TIMEOUT=1800  # 30 minutes per group

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

TOTAL_GROUPS=7

# ── Helpers ──────────────────────────────────────────────────────────────────

log_info()    { echo -e "${BLUE}[ralph]${NC} $*"; }
log_success() { echo -e "${GREEN}[ralph]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[ralph]${NC} $*"; }
log_error()   { echo -e "${RED}[ralph]${NC} $*"; }

require_commands() {
  if ! command -v claude &>/dev/null; then
    log_error "claude CLI not found. Install Claude Code and ensure 'claude' is in PATH."
    exit 1
  fi
  if ! command -v gtimeout &>/dev/null; then
    log_error "gtimeout not found. Install: brew install coreutils"
    exit 1
  fi
  if ! command -v python3 &>/dev/null; then
    log_error "python3 not found."
    exit 1
  fi
}

# ── State management ──────────────────────────────────────────────────────────

init_state() {
  if [[ -f "$STATE_FILE" ]]; then
    log_info "Resuming from existing state: $STATE_FILE"
    return
  fi

  log_info "Initializing task state..."
  python3 - <<PYEOF
import json

groups = []
for i in range(1, $TOTAL_GROUPS + 1):
    titles = {
        1: "Foundation — Secret Consolidation",
        2: "Zot Binary & Process Manager",
        3: "OCI Reverse Proxy",
        4: "Registry API & Visibility",
        5: "Auto-Deploy on Registry Push",
        6: "Dashboard Registry UI",
        7: "GitHub Action Rewrite",
    }
    groups.append({
        "id": i,
        "title": titles[i],
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
  local group_id=$1
  local field=$2
  python3 -c "
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == $group_id:
        print(g.get('$field', ''))
        break
"
}

get_title() {
  get_field "$1" "title"
}

set_field() {
  local group_id=$1
  local field=$2
  local value=$3
  python3 - <<PYEOF
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == $group_id:
        g['$field'] = '$value' if '$value' not in ('True', 'False', 'None') else {'True': True, 'False': False, 'None': None}['$value']
        break
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
PYEOF
}

inc_attempts() {
  local group_id=$1
  python3 - <<PYEOF
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == $group_id:
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

print(f"Groups: {total} total | {done} complete | {pending} pending | {blocked} blocked")
print()
for g in state['groups']:
    icon = icons.get(g['status'], '⬜')
    attempts = f" (attempts: {g['attempts']})" if g['attempts'] > 0 else ""
    print(f"  {icon} Group {g['id']}: {g['title']}{attempts}")
PYEOF
}

# ── Validation ────────────────────────────────────────────────────────────────

validate_codebase() {
  local label=${1:-""}
  log_info "Running validation${label:+ ($label)}..."
  cd "$REPO_ROOT"

  if ! bun run typecheck 2>&1; then
    log_error "typecheck failed"
    return 1
  fi
  if ! bun run lint 2>&1; then
    log_error "lint failed"
    return 1
  fi
  if ! bun run test 2>&1; then
    log_error "unit tests failed"
    return 1
  fi

  log_success "Validation passed"
  return 0
}

# ── Claude invocation ─────────────────────────────────────────────────────────

run_group() {
  local group_id=$1
  local prompt_file="$PROMPTS_DIR/group-$group_id.md"
  local context_file="$PROMPTS_DIR/shared-context.md"
  local log_file="$LOGS_DIR/group-$group_id.log"

  mkdir -p "$LOGS_DIR"

  if [[ ! -f "$prompt_file" ]]; then
    log_error "Prompt file not found: $prompt_file"
    return 1
  fi
  if [[ ! -f "$context_file" ]]; then
    log_error "Shared context file not found: $context_file"
    return 1
  fi

  # Compose full prompt: shared context + group-specific instructions
  local full_prompt
  full_prompt="$(cat "$context_file")"$'\n\n---\n\n'"$(cat "$prompt_file")"

  log_info "Starting Claude for Group $group_id (timeout: ${CLAUDE_TIMEOUT}s)..."
  log_info "Log: $log_file"
  echo ""

  local exit_code=0
  # < /dev/null: prevents claude from blocking on stdin (interactive prompts/dialogs)
  # CLAUDE_CODE_ENABLE_TASKS=true: enable task tracking in non-interactive mode
  # --output-format stream-json --verbose: force realtime stdout flushing
  #   (default text format buffers the entire response; log stays empty until done)
  # --no-session-persistence: avoid session file conflicts between groups
  if CLAUDE_CODE_ENABLE_TASKS=true gtimeout "$CLAUDE_TIMEOUT" claude \
    -p "$full_prompt" \
    --dangerously-skip-permissions \
    --output-format stream-json \
    --verbose \
    --no-session-persistence \
    < /dev/null 2>&1 | tee "$log_file"; then
    exit_code=${PIPESTATUS[0]}
  else
    exit_code=${PIPESTATUS[0]}
  fi

  # Check for timeout
  if [[ $exit_code -eq 124 ]]; then
    log_error "Claude timed out after ${CLAUDE_TIMEOUT}s for Group $group_id"
    return 1
  fi

  # Signals are plain text embedded in stream-json — grep works on raw bytes
  # Check for completion signal
  if grep -q "RALPH_TASK_COMPLETE: Group $group_id" "$log_file"; then
    return 0
  fi

  # Check for blocked signal
  if grep -q "RALPH_TASK_BLOCKED: Group $group_id" "$log_file"; then
    local reason
    reason=$(grep "RALPH_TASK_BLOCKED: Group $group_id" "$log_file" | head -1 | sed 's/.*RALPH_TASK_BLOCKED: Group [0-9]* - //')
    log_warn "Group $group_id blocked: $reason"
    return 2  # Special exit code for blocked
  fi

  log_warn "Claude finished but no completion signal found in output."
  log_warn "Check log: $log_file"
  return 1
}

# ── Report generation ─────────────────────────────────────────────────────────

generate_report() {
  local end_time
  end_time=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

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
    "# RollHook Registry — RALPH Report",
    "",
    f"Generated: $end_time",
    f"Groups: {total} total | {done} complete | {pending} pending | {blocked} blocked",
    "",
    "## Group Status",
    "",
]
for g in state['groups']:
    icon = icons.get(g['status'], '⬜')
    attempts = f" (attempts: {g['attempts']})" if g['attempts'] > 0 else ""
    lines.append(f"- {icon} **Group {g['id']}**: {g['title']}{attempts}")

lines += [
    "",
    "## Next Steps",
    "",
]
if done == total:
    lines += [
        "All groups complete.",
        "",
        "1. Review commits: \`git log --oneline -20\`",
        "2. Run E2E: \`bun run test:e2e\`",
        "3. Manual smoke test: docker login/push/pull via RollHook",
        "4. Create PR: \`/pr\`",
    ]
elif pending > 0:
    lines += [
        "Run \`./scripts/ralph.sh\` to continue from where it left off.",
    ]

if blocked > 0:
    lines += [
        "",
        "## Blocked Groups",
        "",
        "Check logs in \`.ralph-logs/\` for details on blocked groups.",
        "Fix issues manually and re-run: \`./scripts/ralph.sh --reset <group-id>\`",
    ]

with open('$REPORT_FILE', 'w') as f:
    f.write('\n'.join(lines) + '\n')

print("Report written to: $REPORT_FILE")
PYEOF
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  local target_group=""
  local do_reset=false
  local status_only=false

  # Parse args
  while [[ $# -gt 0 ]]; do
    case $1 in
      --status)
        status_only=true
        shift
        ;;
      --reset)
        do_reset=true
        target_group="${2:?'--reset requires a group number'}"
        shift 2
        ;;
      [0-9]*)
        target_group="$1"
        shift
        ;;
      *)
        echo "Unknown argument: $1"
        echo "Usage: $0 [group_id] [--reset group_id] [--status]"
        exit 1
        ;;
    esac
  done

  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║   RollHook Registry — RALPH Loop             ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════════════╝${NC}"
  echo ""

  require_commands
  cd "$REPO_ROOT"
  init_state

  if $status_only; then
    print_status
    exit 0
  fi

  # Handle reset
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

  # Determine which groups to run
  local groups_to_run=()
  if [[ -n "$target_group" ]]; then
    groups_to_run=("$target_group")
  else
    for i in $(seq 1 $TOTAL_GROUPS); do
      groups_to_run+=("$i")
    done
  fi

  # Run groups
  for group_id in "${groups_to_run[@]}"; do
    local status
    status=$(get_field "$group_id" "status")

    if [[ "$status" == "complete" ]]; then
      echo -e "✅ Group $group_id: $(get_title "$group_id") — already complete, skipping"
      continue
    fi

    if [[ "$status" == "blocked" ]]; then
      echo -e "🚫 Group $group_id: $(get_title "$group_id") — blocked, skipping"
      continue
    fi

    local attempts
    attempts=$(get_field "$group_id" "attempts")

    if [[ "$attempts" -ge "$MAX_RETRIES" ]]; then
      log_warn "Group $group_id has reached max retries ($MAX_RETRIES). Marking blocked."
      set_field "$group_id" "status" "blocked"
      continue
    fi

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${BOLD}Group $group_id: $(get_title "$group_id")${NC}"
    echo "Attempt: $((attempts + 1)) / $MAX_RETRIES"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # Pre-group validation (skip for group 1 — nothing to validate yet)
    if [[ "$group_id" -gt 1 ]]; then
      if ! validate_codebase "pre-group $group_id"; then
        log_error "Pre-group validation failed. Fix issues before continuing."
        log_error "Run: bun run typecheck && bun run lint && bun run test"
        exit 1
      fi
      echo ""
    fi

    # Mark in progress
    set_field "$group_id" "status" "in_progress"
    inc_attempts "$group_id"

    # Run Claude
    run_result=0
    run_group "$group_id" || run_result=$?

    echo ""

    if [[ $run_result -eq 0 ]]; then
      # Success
      log_success "Group $group_id complete: $(get_title "$group_id")"
      set_field "$group_id" "status" "complete"
      set_field "$group_id" "completed_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

      # Post-group validation
      echo ""
      if validate_codebase "post-group $group_id"; then
        log_success "Post-group validation passed"
      else
        log_warn "Post-group validation FAILED — the implementation may have issues."
        log_warn "Review the output and fix before continuing."
        log_warn "To retry: ./scripts/ralph.sh --reset $group_id"
        # Don't exit — let user decide. Group is marked complete if Claude signaled.
      fi

    elif [[ $run_result -eq 2 ]]; then
      # Blocked
      log_warn "Group $group_id blocked. Check: .ralph-logs/group-$group_id.log"
      set_field "$group_id" "status" "blocked"

    else
      # Failed
      log_error "Group $group_id failed (attempt $((attempts + 1)) / $MAX_RETRIES)"
      set_field "$group_id" "status" "pending"
      log_info "Check log: .ralph-logs/group-$group_id.log"

      new_attempts=$(get_field "$group_id" "attempts")
      if [[ "$new_attempts" -ge "$MAX_RETRIES" ]]; then
        log_warn "Max retries reached. Marking Group $group_id as blocked."
        set_field "$group_id" "status" "blocked"
      else
        log_info "To retry: ./scripts/ralph.sh $group_id"
        # Stop the loop — don't continue to next group if this one failed
        if [[ -z "$target_group" ]]; then
          log_warn "Stopping run. Fix Group $group_id before proceeding."
          break
        fi
      fi
    fi

    echo ""
  done

  echo ""
  generate_report
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║          RALPH LOOP DONE                     ║${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════════════╝${NC}"
  echo ""
  print_status
  echo ""
  echo "Full report: $REPORT_FILE"
}

main "$@"
