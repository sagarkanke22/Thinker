# MODULE: INITIALIZATION + REFERENCE FILE FINDER

---

## REFERENCE FILE FINDER
(Called by INITIALIZATION, FIX, and DEBUG when reference_file is unknown)

**STEP 1 — Classify task type:**
- FRONTEND → search in: `docker/services/product-client/src/`
- BACKEND  → search in: `docker/services/nuclios-server/api/`
- BOTH     → search in both

**STEP 2 — Collect one signal (try A → E, stop at first result):**

- SIGNAL A: Error message / traceback → extract file path from stack trace directly
- SIGNAL B: Component or function name → grep in relevant folder → returns file path
- SIGNAL C: Parent folder name → listDirectory → show file list, ask user to pick
- SIGNAL D: Screenshot of UI → identify component name → apply SIGNAL B
- SIGNAL E: Description only → ask "What is the name of the UI element or function?" → apply B or C

**STEP 3:** Say: "Found: [path/to/file]. Is this the right reference file?" STOP. Wait.

**STEP 4:** After confirmation → set as `reference_file` → return to calling intent.

**RULES:** Try A → E in order. Stop at first result. Never read full file during discovery. Never proceed past STEP 3 without user confirmation.

---

## INITIALIZATION INTENT
**Triggers:** "init task" / "initialize task" / "new task"

**Required inputs:** task_name, reference_file, description. If any missing → ask. Do NOT guess.

If user unsure about reference_file → call REFERENCE FILE FINDER above.

---

### PHASE 1 — CONTEXT (reference file + user description only)

**STEP 1 — Create task files + collect context:**
- Create `task_<name>_context.txt` with task name, reference file, description
- Create `task_<name>_flow.txt` (empty skeleton)
- Update `active_task_state.txt`:
  - CURRENT TASK NAME: [task_name]
  - CONTEXT FILE: [path]
  - FLOW FILE: [path]
  - CURRENT PHASE: INITIALIZATION
  - CURRENT STEP: 1
  - STATUS: INITIALIZING
  - LAST COMPLETED STEP: 0
  - DEFERRED LEARNING: NO
  - BLAST RADIUS: [fill at STEP 4]
- Read ONLY the reference_file(s) — nothing else
- Build context from reference file + user description:
  - Problem statement
  - Root cause (evidence from reference file)
  - Fix approach
  - Acceptance criteria
- Append context to task_context.txt
- Present context as text in chat
- STOP. Say: "Please confirm, add, or remove anything from the context."

**STEP 2 — Update context after user confirms:**
- Apply any additions or removals
- Update task_context.txt with confirmed context
- Say: "Context confirmed. Say 'create plan' to build the execution plan."
- STOP.

---

### PHASE 1.5 — MATCH LEARNINGS

**Trigger:** "create plan" / after Step 2 confirmation

**STEP 3 — Match L* learnings + show match % + get confirmation:**
- Scan ALL L* entries in `system_rules_and_learning.txt`
- Score each: (matching keywords / total keywords in L* entry) × 100
- Show top 5 sorted by score descending:
  ```
  Matched learnings:
  [L015] 90% — plan_end_date gate pattern
  [L017] 75% — stale globals in action handlers
  [L018] 60% — global declaration must precede assignment
  [L016] 55% — inventory graph cascade failure from empty df
  [L007] 50% — timing issue: list used as gate before items added
  ```
- STOP. Say: "Which of these should be added to the context? Confirm all, select specific ones, or skip."
- After user confirms → append ONLY confirmed L* entries to task_context.txt under: MATCHED LEARNINGS
- Do NOT apply learnings to the plan directly — they become part of context

---

### PHASE 2 — EXECUTION PLAN

**Trigger:** user confirms matched learnings

**STEP 4 — Build execution plan:**
- Read generic R* rules from `system_rules_and_learning.txt`
- Read final context from task_context.txt (already includes confirmed learnings)
- Declare BLAST RADIUS before writing steps:
  ```
  BLAST RADIUS:
  Files that will change: [list each file]
  Files that will be read: [list each file]
  Files that must NOT change: [list explicitly]
  Rollback order if blocked: [reverse order of FILES CHANGING]
  ```
- Build step-by-step plan from final context + R* rules only
- Each step must include:
  - What to change
  - Which file and approximate line
  - Validation after the step
  - Rollback instruction if the step fails
- Present plan as text in chat
- STOP. Say: "Please review the plan and confirm or suggest changes."

**STEP 5 — Finalize plan after user confirms:**
- Apply any changes
- Write confirmed steps to task_flow.txt (include rollback per step)
- Update `active_task_state.txt`:
  - CURRENT STEP: 1
  - STATUS: IN PROGRESS
  - BLAST RADIUS: [from Step 4]
- Say: "Plan ready. Say 'execute flow' to start Step 1."

---

**CRITICAL:**
- PHASE 1 uses ONLY the reference file — no system rules
- PHASE 1.5 shows matched learnings — user decides what goes into context
- PHASE 2 reads ONLY final context + generic R* rules — no direct learning lookup
- Both task files created in Step 1 before any confirmation
- `active_task_state.txt` already exists — only update it, never recreate
- No code is touched until EXECUTION intent
- BLAST RADIUS must be declared before any step is written
