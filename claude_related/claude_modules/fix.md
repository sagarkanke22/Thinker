# MODULE: FIX + URGENT MODE

---

## URGENT MODE
(Fast path — triggered by `[URGENT]` prefix)

**What is SKIPPED:** context file creation, flow file creation, PHASE 1.5, PHASE 2, learning derivation (deferred, not lost).

**What is NEVER skipped:** reading the actual file at the location, user confirmation before applying fix, abbreviated checklist.

**URGENT FLOW:**

1. Extract from user message: `file`, `location` (line number / function / error), `fix_description`
2. If `file` not provided → call REFERENCE FILE FINDER (SIGNAL A or B only)
3. Read ONLY the specified location (grep / line range ±20 lines)
4. If fix requires >10 lines → flag: "This fix touches [N] lines. That is larger than minimal. Confirm to proceed or narrow the scope."
5. Show to user:
   ```
   URGENT FIX:
   FILE:  [path/to/file]
   WHERE: [line/function]
   WHAT:  [what will change — max 3 lines]
   STAYS: [what will not change]
   LINES: [count of lines changing]
   ```
   STOP. Say: "Confirm to apply."
6. After confirmation → apply ONLY the minimal fix
7. Run abbreviated checklist: SYNTAX (getDiagnostics passes) + SCOPE (no variable used before assignment)
8. Update `active_task_state.txt`: DEFERRED LEARNING: YES, STATUS: COMPLETE (urgent)
9. If active task context file exists → append DEBUG ENTRY:
   ```
   ── DEBUG ENTRY #N ────────────────────────────────────
   ERROR CLASS  : [type from triage]
   ERROR        : [what was fixed]
   ROOT CAUSE   : [exact reason]
   FIX APPLIED  : [what changed and where]
   CHECKLIST    : [which checklist item was violated, or N/A]
   LESSON       : DEFERRED
   LESSON TAG   : DEFERRED
   ── END ENTRY #N ──────────────────────────────────────
   ```
10. Report: "Fix applied. Learning deferred." Say: "Say 'derive learning' when ready to capture this."

**CRITICAL:**
- Never apply fix without confirmation even in urgent mode
- Never read more than ±20 lines around the target location
- Never create task files in urgent mode
- Learning is deferred — not lost
- If fix scope >10 lines → always flag before applying

---

## FIX INTENT
**Triggers:** "reopen task" / "fix same task" / "debug error" / "trace failure" / "fix this error"

**INTENT TIE-BREAKER:**
- Existing task `STATUS = IN PROGRESS` or `BLOCKED` → PATH A
- No active task or `STATUS = COMPLETE` → PATH B
- Ambiguous → ask user before proceeding

**PATH A — Has existing task (reopen):**
Required: `context_file`, `flow_file`, `new_description`. Optional: `new_reference_file`.

**PATH B — New error (debug):**
Required: `error_file`, `error_description`. Optional: `line_number` or `function_name`, `new_reference_file`.

If required inputs not provided → ask before proceeding.

**FILE READS:**
- PATH A: Read `context_file` full + `flow_file` full + `new_reference_file` if provided
  → If context_file already read this session → skip re-read, use session content
- PATH B: Grep `error_file` at specified line/function only (±20 lines) — never read full file
  → If user pasted the error/code → work from that, skip grep
- Both: Grep `system_rules_and_learning.txt` for L* match — never read full file

---

## ERROR TRIAGE
(PATH B only — run before building fix context)

Classify into exactly one type:

| Class | Definition | First action |
|---|---|---|
| SYNTAX | Parse/getDiagnostics failure | Find exact line flagged, check indentation/brackets |
| RUNTIME | Exception raised at execution | Read full stack trace top-to-bottom, find exact raise line |
| LOGIC | Wrong output, no exception | Trace execution path that produced wrong output |
| SCOPE | NameError / undefined variable | Find where variable is first assigned, trace every branch |
| BOUNDARY | Hybrid parts bleeding into each other | Re-read integration point, check which part the logic belongs to |
| REGRESSION | Existing feature broken by new change | Re-read existing feature path, check if strReplace touched it |

State findings before touching anything:
```
ERROR TRIAGE:
CLASS:          [type]
EVIDENCE:       [exact line / stack trace line / wrong output]
ROOT CAUSE:     [exact reason]
BLAST RADIUS:   [files/functions that could be affected]
MINIMAL FIX:    [smallest change that resolves it]
WILL NOT TOUCH: [explicit list of what stays the same]
```
STOP. Wait for user confirmation before applying any fix.

**All fix work goes into a separate fix file — NOT the main context file.**
User provides the fix file name (e.g. `task_<name>_fix.txt`).
Main context file updated ONLY AFTER user confirms fix is working.

---

### PHASE 1 — BUILD FIX CONTEXT (written to fix file)

**STEP 1 — Build context:**
- PATH A: Read existing context + flow → summarize what was solved + steps taken
- PATH B: Run ERROR TRIAGE → classify + identify root cause
- Read `new_reference_file` if provided
- Write to fix file under: FIX CONTEXT
- Present context in chat
- STOP. Say: "Please confirm, add, or remove anything."

**STEP 2 — Update context after user confirms:**
- Apply additions or removals to fix file
- Say: "Context confirmed. Matching learnings..."

---

### PHASE 1.5 — MATCH LEARNINGS (written to fix file)

**STEP 3 — Match L* learnings to fix context:**
- Grep `system_rules_and_learning.txt` for key phrases from fix context
- Score top 5 L* entries, show match %
- STOP. Say: "Which of these apply? Confirm to add or skip."
- Append confirmed learnings to fix file under: FIX MATCHED LEARNINGS

---

### PHASE 2 — FIX PLAN (written to fix file)

**STEP 4 — Build fix plan:**
- Read R001-R010 only from `system_rules_and_learning.txt`
- Apply MINIMAL FIX DEFINITION — flag if >10 lines
- Build minimal fix steps from fix context + confirmed learnings + R* rules
- Each step must include rollback instruction
- Write to fix file under: FIX EXECUTION PLAN
- Present plan in chat
- STOP. Say: "Please review the fix plan and confirm."

---

### PHASE 3 — EXECUTE (one step at a time)

**STEP 5 — Execute fix steps:**
- Follow EXECUTION intent rules (one step per iteration)
- State ASSUMPTIONS before each edit
- Validate after each step using STEP VALIDATION MATRIX
- Run full POST-IMPLEMENTATION CHECKLIST after final fix step
- Write execution log to fix file under: FIX EXECUTION LOG

---

### PHASE 4 — CONFIRM + MERGE

**STEP 6 — After fix is done:**
- Ask user: "Please confirm — did you test this? What worked and what didn't?"
- STOP. Wait for user feedback.

**STEP 7 — After user confirms fix is working:**
- Ask: "Do you want to add this fix session to the main context file?"
  - YES → append FIX CONTEXT + FIX EXECUTION LOG to main context file under: FIX HISTORY. Update `active_task_state.txt`.
  - NO → leave fix file as-is, main context unchanged.
- Follow LEARNING intent rules to propose a learning.

**CRITICAL:**
- Never touch main context file until user confirms fix is working
- All fix work lives in the fix file only
- PATH B: never read the full error_file — grep/line range only
- Always run ERROR TRIAGE before PATH B fix
- Never apply fix without user confirmation
- Apply MINIMAL FIX DEFINITION — flag if >10 lines
- One step per iteration in STEP 5
- User must provide fix file name — do not create without it

---

## DEBUG HISTORY FORMAT
(Appended to `task_<taskname>_context.txt` after every resolved debug cycle)

```
── DEBUG ENTRY #N ────────────────────────────────────
ERROR CLASS  : [Syntax/Runtime/Logic/Scope/Boundary/Regression]
ERROR        : [what failed]
ROOT CAUSE   : [exact line and reason]
FIX APPLIED  : [what was changed and where]
CHECKLIST    : [which checklist item was violated]
LESSON       : [rule derived from this failure]
LESSON TAG   : [TASK-SPECIFIC / FLOW / UNIVERSAL]
── END ENTRY #N ──────────────────────────────────────
```
