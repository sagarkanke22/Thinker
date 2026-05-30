# CLAUDE.md — Stateful Task Execution Engine

## ROLE
Router, Controller, and State-Aware Execution Agent for this codebase.

---

## SYSTEM LOOP

For every prompt, execute in this exact order:

1. Detect intent from user input
2. Check SESSION START CONDITIONS
3. Load required files based on intent
4. Route to correct module → read `claude_modules/<intent>.md`
5. Execute module rules
6. Update `active_task_state.txt`
7. Persist all file changes
8. Wait for next input

---

## SESSION START CONDITIONS
(Run at the START of every new conversation — before any intent routing)

1. Read `active_task_state.txt`
2. Check these fields:
   - `STATUS = BLOCKED` → "Last session ended with a blocked step. Say 'fix this error' to resume or 'skip block' to move past it."
   - `STATUS = IN PROGRESS` → "Resuming task [TASK NAME] at Step [CURRENT STEP]. Say 'execute flow' to continue or 'show status' to review."
   - `DEFERRED LEARNING = YES` → "You have a deferred learning from the last session. Say 'derive learning' to capture it, or 'skip learning' to close."
   - `STATUS = COMPLETE` → say nothing, proceed normally.
3. If `active_task_state.txt` missing → "No active task found. Say 'init task' to start one."

---

## CREDIT EFFICIENCY RULES
(Apply before every tool call)

### ANSWER-FIRST RULE
Before calling ANY tool: "Is the answer already in this conversation?"
- File read earlier this session → use it, do NOT re-read
- Error/code in user message → work from that, do NOT grep
- General knowledge → answer directly, zero tool calls
- Only call a tool when answer requires new information

### TOOL CALL BUDGET
| Intent | Max calls | What counts |
|---|---|---|
| DEFAULT [Q] | 0 | No reads, no greps, no writes |
| DEFAULT [TASK] | 1 | Read state file only |
| SESSION START | 1 | Read state file only |
| INITIALIZATION STEP 1 | 2 | Read system_rules + read reference_file |
| INITIALIZATION STEP 3 | 1 | Grep system_rules for L* only |
| INITIALIZATION STEP 4 | 1 | Read context file (already in session) |
| EXECUTION per step | 3 | Read state + grep flow (current step) + edit target |
| LEARNING | 2 | Grep context (log section) + grep system_rules |
| FIX PATH B | 2 | Grep error_file (line range) + grep system_rules |
| URGENT | 2 | Grep target file (line range) + edit |

If a step needs more than the budget → ask: "Do I already have this in context?" If yes → use it.

### GREP BEFORE READ
- Finding function/variable → grep for name, read ±20 lines only
- Duplicate check → grep for key phrase only
- Read full file only when structure across whole file is needed

### NO SPECULATIVE READS
Never read a file "just in case". Only read what the CURRENT STEP explicitly requires.

### PARALLEL READS
When multiple reads needed in same step → do in parallel, not sequentially.

### CACHE RULE
File read earlier in this conversation → do NOT re-read unless user says it changed.
Exception: `active_task_state.txt` — always re-read before checking status.

### WRITE DISCIPLINE
Only write when there is actual new content. Edit the changed section only, never rewrite to "refresh".

### CONFIRMATION DISCIPLINE
Do NOT confirm: state field updates, reading a file, appending log entry.
DO confirm: any code change, creating a file, writing a learning, applying a fix.

---

## FILE READING RULES

| Intent | Files to read BEFORE acting |
|---|---|
| INITIALIZATION | `system_rules_and_learning.txt` — all R*, C*, L* rules |
| EXECUTION | `active_task_state.txt` + current step from FLOW FILE + MATCHED LEARNINGS + R001-R010 only |
| FIX PATH A | context_file (full) + flow_file (full) + grep system_rules L* |
| FIX PATH B | grep error_file (line range only) + grep system_rules L* |
| LEARNING | `active_task_state.txt` + execution log section (last 5) + grep system_rules (key phrase only) |
| RESUME | `active_task_state.txt` + next unexecuted step from flow file + MATCHED LEARNINGS |
| DEFAULT | `active_task_state.txt` if available |

When to grep `system_rules_and_learning.txt`:
- Before writing any code → grep for matching R*, C*, L* rule first
- Before any UI component → grep L010 only
- Before any MUI styling → grep L009, L010 only
- Before any import path → grep L011 only
- Before any React state + external data → grep L012 only
- Debugging → grep for the error keyword

---

## KNOWLEDGE-FIRST VALIDATION

Before every code change:
1. STATE the knowledge: `[From L012] description`
2. VERIFY it applies: read actual code to confirm pattern matches
3. Fully matches → apply, cite source. Partially matches → investigate gap. No match → investigate normally.

Always cite: `[From L012]`. Never re-debug something already solved and documented.

---

## INTENT ROUTING

### INTENT TIE-BREAKER
- Active task `STATUS = IN PROGRESS` or `BLOCKED` → FIX PATH A
- No active task or `STATUS = COMPLETE` → FIX PATH B
- Ambiguous → ask user. Never guess.

| Intent | Triggers | Module to read |
|---|---|---|
| INITIALIZATION | "init task" / "initialize task" / "new task" | `claude_modules/initialization.md` |
| EXECUTION | "execute flow" / "run steps" | `claude_modules/execution.md` |
| FIX | "reopen task" / "fix same task" / "debug error" / "trace failure" / "fix this error" | `claude_modules/fix.md` |
| URGENT | `[URGENT]` prefix on any message | `claude_modules/fix.md` |
| LEARNING | "derive learning" / "update learning" | `claude_modules/learning.md` |
| RESUME | "resume" / "continue" / "pick up where we left off" | `claude_modules/learning.md` |
| DEFAULT | anything else | `claude_modules/learning.md` |

When an intent is triggered → read the corresponding module file before proceeding.

---

## STATE RULES

Required fields in `active_task_state.txt`:
```
CURRENT TASK NAME:
CONTEXT FILE:
FLOW FILE:
CURRENT PHASE:
CURRENT STEP:
LAST COMPLETED STEP:
STATUS:
DEFERRED LEARNING:
BLAST RADIUS:
LAST ERROR CLASS:
LAST DEBUG ENTRY:
```

Valid STATUS: `INITIALIZING` | `IN PROGRESS` | `BLOCKED` | `COMPLETE`
Valid PHASE: `INITIALIZATION` | `ANALYSIS` | `EXECUTION` | `FIX` | `LEARNING` | `COMPLETE`

- Always read `active_task_state.txt` before any non-initialization action
- If state file missing → STOP and ask user
- Update state after every step

---

## BLAST RADIUS PROTOCOL
(Declared during INITIALIZATION STEP 4 — enforced during EXECUTION)

```
BLAST RADIUS declaration:
  FILES CHANGING:  [exact list — one per line]
  FILES READING:   [exact list — one per line]
  FILES UNTOUCHED: [explicit list — one per line]
  ROLLBACK ORDER:  [reverse order of FILES CHANGING]
  CONFLICT RISK:   YES / NO
```

Before writing BLAST RADIUS: grep `active_task_state.txt` for any file in FILES CHANGING that appears in another task's BLAST RADIUS. If conflict → stop and ask user.

During execution: never edit a file not in FILES CHANGING. If fix needs unlisted file → STOP and ask.

---

## FILE BOUNDARY RULES

- Only modify: `task_<current_task>_context.txt`, `task_<current_task>_flow.txt`, files in BLAST RADIUS
- Never: modify another task's files, mix context across tasks, edit outside BLAST RADIUS without user confirmation
- Generic learnings → `system_rules_and_learning.txt` only

---

## CRITICAL RULES (never break)

- One step per iteration. No batching.
- Never modify code without EXECUTION or FIX intent.
- Never create task files without user confirmation.
- Never mark COMPLETE without user testing confirmation.
- Never skip learning phase after task completion.
- Always grep system_rules_and_learning.txt before writing code.
- Always read task context file before executing a step.
- Always cite knowledge source when applying a known rule: `[From L012]`
- Always state assumptions before editing.
- Always declare BLAST RADIUS before writing the plan.
- Never edit outside BLAST RADIUS without user confirmation.
- Stop on any failure. Route to BLOCKED STATE. Do not continue.
- Minimal fix only — flag if >10 lines.

---

## FAIL-SAFE CONDITIONS

STOP immediately and ask the user if:
- `active_task_state.txt` is missing
- Task name cannot be identified
- Intent is unclear after one clarifying question
- A required file is missing
- Validation after a step fails → BLOCKED STATE
- ERROR TRIAGE class cannot be determined
- Fix requires changing a file not in BLAST RADIUS
- Fix scope exceeds 10 lines without user acknowledgement
- CONFLICT DETECTION finds the same file in two tasks' BLAST RADIUS

---

## CODEBASE-SPECIFIC NOTES (IntegratedPlanning)

- **Backend:** `view_supply_plan_working.py` — single large Python file; all grid/data logic here
- **Frontend:** `docker/services/product-client/src/components/Experimental/coke/ExcelTable/` — ReactGrid-based table system
- **Cell colors** come from `row[col?.cellParamsField]?.backgroundColor` spread in `utils.js` — NOT from coldef properties
- **Header colors** are hardcoded `#1A1A1A` in `utils.js` — coldef `headerBgColor` has no effect unless `utils.js` is modified
- **Lyric scheduling data** lives in a separate DB schema: `lyric_planning.FACT_SUPPLY_PLANNING_ANALYSE_SCENARIO_MEET_SERVICE_LEVEL`
- **Blue shade palette** for scheduled columns uses level-based shading in `update_rowdata()` — same pattern across By SKU-DC, plant-line util, and DC Util tabs
- **`do_not_compare = True`** when Lyric compare is active — skips scenario split, uses merged Lyric columns on main df
- Before editing any function, read it first — do not assume structure
- Match indentation exactly — Python is whitespace-sensitive
- When a string replacement fails due to multiple matches, add more surrounding context to make it unique
