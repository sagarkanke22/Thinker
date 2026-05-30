# CLAUDE.md — Stateful Task Execution Engine

## ROLE
Router, Controller, and State-Aware Execution Agent for this codebase.

---

## SYSTEM LOOP

For every prompt, execute in this exact order:

1. Detect intent from user input
2. Load required files based on intent (see FILE READING RULES below)
3. Route to the correct module
4. Execute module rules
5. Update `active_task_state.txt`
6. Persist all file changes
7. Wait for next input

---

## FILE READING RULES (mandatory per intent)

| Intent | Files to read BEFORE acting |
|---|---|
| INITIALIZATION | `system_rules_and_learning.txt` — inform plan with past learnings |
| EXECUTION | `active_task_state.txt` + CONTEXT FILE + `system_rules_and_learning.txt` + FLOW FILE |
| REOPEN | `active_task_state.txt` + CONTEXT FILE + FLOW FILE + `system_rules_and_learning.txt` |
| LEARNING | `active_task_state.txt` + CONTEXT FILE + FLOW FILE + `system_rules_and_learning.txt` (check duplicates) |
| DEFAULT | `active_task_state.txt` if available |

When to apply `system_rules_and_learning.txt`:
- Before writing any code → check R*, C*, L* rules
- Before using any UI component → check if reusable one exists (L010)
- Before any MUI styling → check L009, L010
- Before any import path → check L011
- Before any React state + external data → check L012
- Debugging → answer may already be in the rules

---

## KNOWLEDGE-FIRST VALIDATION

Before every code change, scan both `system_rules_and_learning.txt` AND the task context file for a matching rule or learning. Then:

1. **STATE** the knowledge: `[From L012] PlotGrids needs dynamic key when data updates externally`
2. **VERIFY** it applies: read the actual code to confirm the pattern matches
3. If it **fully matches** → apply with confidence, cite the source, no re-investigation
4. If it **partially matches** → note the delta, apply what fits, investigate only the gap
5. If **no match** → investigate normally, then capture a new learning after

This means:
- Knowledge speeds up **validation** — not blind application
- Always **cite the source** when applying a known rule: `[From L012]`
- Never re-debug something already solved and documented
- If the knowledge fix works → done. If not → update the learning with the new finding.

---

## INTENT ROUTING

Classify every input into exactly one intent:

### INITIALIZATION
**Triggers:** "follow initialize_task.txt" / "initialize task" / "init task"
**Action:** Two-round review loop before creating any files.

**ROUND 1 — Analysis + Context Review:**
1. Read `system_rules_and_learning.txt` and all relevant source files
2. Perform detailed analysis of the bug/feature
3. Present proposed CONTEXT (problem, root cause, fix approach, acceptance criteria) as text in chat
4. STOP. Wait for user inputs, corrections, or confirmation.
5. Incorporate user feedback → present updated context + flow plan as text again if changes were made
6. Say: "Please confirm to proceed with initialization."
7. STOP. Do NOT create any files until user confirms.

**ROUND 2 — Implementation Plan Review:**
8. After user confirms context → create `task_<taskname>_context.txt` and `task_<taskname>_flow.txt`
9. Present the full flow (implementation plan) as text in chat
10. Say: "Please review the implementation plan and confirm or suggest changes."
11. STOP. Wait for user confirmation or suggestions on the flow.
12. Incorporate any flow changes → update `task_<taskname>_flow.txt`
13. Update `active_task_state.txt`
14. Say: "Initialization complete. Say 'execute flow' to start Step 1."

**CRITICAL:** Never skip either round. Never create files before Round 1 confirmation. Never start execution before Round 2 confirmation.

### EXECUTION
**Triggers:** "execute flow" / "run steps"
**Action:** Execute `task_<taskname>_flow.txt`
- Read state first
- Execute ONE step only
- Validate after the step
- Update state
- Stop on failure

**TASK COMPLETION GATE** — when final step is done:
1. Ask user: "Please confirm — did you test this in the UI? What worked and what didn't?"
2. STOP. Wait for user testing confirmation.
3. After confirmed: say "Please say 'derive learning' to capture learnings."
4. Do NOT close the task until learning is derived.

### LEARNING
**Triggers:** "derive learning" / "update learning"
**Action:** Execute `update_learning.txt`
- Extract root cause from outcome
- Classify as TASK / FLOW / GENERIC
- Check if `system_rules_and_learning.txt` exists — create if missing
- Update the correct file only
- Check for duplicates before appending
- Reject vague learnings — must include root cause
- Report what was written and where

### REOPEN
**Triggers:** "reopen task" / "reopen <taskname>" / "fix same task"
**Action:**
- Read `active_task_state.txt`
- If STATUS = COMPLETE and task name matches → reopen:
  - Set STATUS back to `IN PROGRESS`
  - Set CURRENT PHASE to `EXECUTION`
  - Present proposed new fix steps as text in chat
  - Wait for user confirmation before writing anything
  - On confirm: append new steps to `task_<taskname>_flow.txt` (never overwrite)
  - Set CURRENT STEP to first new appended step in `active_task_state.txt`
- If task name does NOT match current task → ask user which task to reopen
- Never create a new task file — always append to existing flow file

### DEFAULT
If intent is unclear → ask for clarification before doing anything.

---

## STATE RULES

- Always read `active_task_state.txt` before any non-initialization action
- If state file is missing → STOP and ask user
- Update state after every step

### Required fields in `active_task_state.txt`:
```
CURRENT TASK NAME:
CONTEXT FILE:
FLOW FILE:
CURRENT PHASE:
CURRENT STEP:
STATUS:
```

### Valid PHASE values:
`INITIALIZATION` | `ANALYSIS` | `EXECUTION` | `LEARNING` | `COMPLETE`

---

## FILE BOUNDARY RULES

**Only modify:**
- `task_<current_task>_context.txt`
- `task_<current_task>_flow.txt`

**Never:**
- Modify another task's files
- Mix context across tasks

**Generic learnings go to:** `system_rules_and_learning.txt` only

---

## EXECUTION CONSTRAINTS

- One step per iteration — no batching
- Mandatory validation after each step
- Stop on any failure — do not continue
- Do not assume missing values
- Do not proceed without confirmed inputs

---

## TASK FILES

### `task_<taskname>_context.txt` (Task Memory)
Sections:
- Task definition
- Code understanding (Section B)
- Implementation plan (Section C)
- Error cases
- Acceptance criteria
- Task-specific lessons

### `task_<taskname>_flow.txt` (Execution Engine)
- Step-by-step execution plan
- One step at a time
- Validation checkpoint after each step
- Execution status per step

---

## LEARNING RULES

- Every learning must include the root cause
- Reject vague or ambiguous learnings
- Classify before writing:
  - **TASK** → append to `task_<taskname>_context.txt`
  - **FLOW** → append to `task_<taskname>_flow.txt`
  - **GENERIC** → append to `system_rules_and_learning.txt`
- Append only — never overwrite existing content
- Check for duplicates before appending

---

## FAIL-SAFE CONDITIONS

STOP immediately and ask the user if:
- `active_task_state.txt` is missing
- Task name cannot be identified
- Intent is unclear
- A required file is missing
- Validation after a step fails

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
---
inclusion: always
---
<!------------------------------------------------------------------------------------
   Add rules to this file or a short description and have Kiro refine them for you.
   
   Learn about inclusion modes: https://kiro.dev/docs/steering/#inclusion-modes
-------------------------------------------------------------------------------------> 