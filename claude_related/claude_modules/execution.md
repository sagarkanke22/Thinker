# MODULE: EXECUTION

---

## EXECUTION INTENT
**Triggers:** "execute flow" / "run steps"

**FILE READS (minimal):**
- `active_task_state.txt` — get current step number and file paths
- Flow file — read ONLY the current step (not the full file)
- Context file — read ONLY the MATCHED LEARNINGS section
- `system_rules_and_learning.txt` — read ONLY R001-R010

**WHY this is enough:**
- Full context was read during init — already in session
- Matched learnings are in the context file — no re-lookup needed
- Completed steps are irrelevant — only current step matters
- R001-R010 are the only universal rules needed per step

---

### EXECUTE ONE STEP

0. **CREDIT CHECK** before any tool call:
   - Current step already in conversation? → use it, skip read
   - MATCHED LEARNINGS already in conversation? → use them, skip read
   - If both loaded → go directly to step 4, zero reads needed

1. Read current step from flow file (only if not already in conversation)
2. Read MATCHED LEARNINGS from context file (only if not already in conversation)
3. Grep R001-R010 only — do NOT read full system_rules file
4. Apply knowledge-first validation:
   - Matched learning applies → cite: `[From L015]`
   - R* rule applies → cite: `[From R006]`
   - Neither → proceed normally
5. State ASSUMPTIONS explicitly before any change:
   ```
   ASSUMPTIONS:
   - [assumption 1 — e.g. "function uses df_main, not df_copy"]
   - [assumption 2 — e.g. "this branch only runs when flag=True"]
   ```
   If any assumption unverified → read the relevant lines to confirm before editing.
6. Execute the step (read target file, make change, validate)
7. Run STEP VALIDATION MATRIX (see below)
8. If validation PASSES:
   - Append brief execution log to context file (2 lines max): "STEP N done: [what changed] [file:line]"
   - Update `active_task_state.txt`: CURRENT STEP: N+1, LAST COMPLETED STEP: N
   - STOP. Report what was done and state next step.
9. If validation FAILS → route to BLOCKED STATE

---

## BLOCKED STATE

When a step fails validation:

1. Do NOT continue to next step
2. Update `active_task_state.txt`:
   - STATUS: BLOCKED
   - LAST ERROR CLASS: [Syntax/Runtime/Logic/Scope/Boundary/Regression]
   - LAST DEBUG ENTRY: [what failed and why]
3. Append DEBUG ENTRY to active context file immediately:
   ```
   ── DEBUG ENTRY #N ────────────────────────────────────
   ERROR CLASS  : [type]
   ERROR        : [what failed]
   ROOT CAUSE   : [exact line and reason — or UNKNOWN if not yet traced]
   FIX APPLIED  : PENDING
   CHECKLIST    : [which checklist item was violated]
   LESSON       : PENDING
   LESSON TAG   : PENDING
   ── END ENTRY #N ──────────────────────────────────────
   ```
   After fix confirmed working → update FIX APPLIED + LESSON fields.
4. Report to user:
   ```
   BLOCKED AT STEP N:
   ERROR CLASS: [type]
   WHAT FAILED: [description]
   ROOT CAUSE:  [if known]
   OPTIONS:
     Say 'fix this error' to debug and fix
     Say 'rollback step N' to undo and retry differently
     Say 'skip block' to skip this step (only if non-critical)
   ```
5. STOP. Wait for user instruction. Never auto-fix. Never continue past a block.

---

## ROLLBACK STEP N

- Read the rollback instruction for Step N from the flow file
- Undo the change made in Step N
- Update `active_task_state.txt`: STATUS = IN PROGRESS, CURRENT STEP = N
- Report: "Step N rolled back. Ready to retry."

---

## TASK COMPLETION GATE
(when final step is done)

1. Ask user: "Please confirm — did you test this in the UI? What worked and what didn't?"
2. STOP. Wait for user testing confirmation.
3. After confirmed — show TASK CLOSE SUMMARY:
   ```
   TASK CLOSED: [task_name]
   STEPS COMPLETED: [N]
   FILES CHANGED: [list from BLAST RADIUS]
   DEFERRED LEARNING: [YES/NO]
   Next: Say 'derive learning' to capture learnings.
   ```
4. Update `active_task_state.txt`: STATUS = COMPLETE
5. Do NOT mark COMPLETE without user testing confirmation.
6. AUTO-LEARNING PROMPT — after TASK CLOSE SUMMARY:
   - Check context file for any DEBUG ENTRYs this session
   - If any exist → extract strongest LESSON from most recent entry → propose:
     ```
     AUTO-LEARNING PROPOSAL:
     WHAT:  [learning text — 3 lines max]
     WHY:   [root cause it captures]
     FROM:  DEBUG ENTRY #N — [brief description]
     ```
     Say: "Confirm to write, '[REFINE] new wording' to adjust, or 'skip'."
   - User replies → follow LEARNING intent rules
   - If no debug entries → "No inline fixes to capture. Task closed."

**CRITICAL:**
- One step per iteration — no batching
- Never read the full flow file — only current step
- Never read the full system_rules — only R001-R010
- Never read the full context file — only MATCHED LEARNINGS section
- Stop on any failure — route to BLOCKED STATE, do not continue
- Always state assumptions before editing

---

## STEP VALIDATION MATRIX
(Run after every step)

| Step Type | Validation Actions |
|---|---|
| File edit (Python) | getDiagnostics passes + re-read changed lines ±5 + check indentation |
| File edit (JSX/JS) | getDiagnostics passes + re-read changed lines ±5 + check imports |
| State file update | Read state file back → confirm all required fields present |
| Learning written | Grep for written entry text → confirm it appears exactly once |
| Plan written | Read flow file → confirm step count matches plan presented to user |
| Rollback | Re-read the changed file → confirm change is fully reverted |

**If any validation action fails → BLOCKED STATE immediately.**

---

## MINIMAL FIX DEFINITION
(Apply in FIX intent, URGENT mode, and BLOCKED STATE recovery)

```
MINIMAL FIX = smallest set of line changes that:
  1. Makes the failing assertion/test pass
  2. Does not touch any line that currently passes
  3. Does not rename any variable
  4. Does not restructure any logic outside the broken path
  5. Does not add new imports unless strictly required

SIZE GATE:
  ≤ 5 lines changed  → apply after confirmation
  6–10 lines changed → flag: "This touches [N] lines. Still minimal?"
  > 10 lines changed → STOP: "This is a larger change. Break into steps or confirm full scope."
```

---

## KNOWN ANTI-PATTERNS
(Check before every edit)

| Anti-pattern | How to catch it | Prevention |
|---|---|---|
| strReplace duplicates branches | oldStr matches more than once | Include full if/elif/else block in oldStr |
| Dict tail pulled into except | Inserted try/except before dict literal | Re-read 20+ lines after insertion near a dict |
| Variable undefined on some path | Set inside conditional only | Initialise unconditionally at function top |
| Step outside loop | Loop body indented wrongly | Map full execution sequence before writing |
| Guard drops assignment line | Replaced only guard line, not dict body | Include guard + assignment + dict body in oldStr |
| Wrong DataFrame column select | Column added to df_A, selected from df_B | Trace exact DataFrame name through every step |
| Fix targets symptom not root | Error stops but returns elsewhere | Run ERROR TRIAGE before any fix |
| Assumption wrong about branch | Assumed flag=True always runs | Read the condition that controls the branch |

---

## POST-IMPLEMENTATION CHECKLIST
(Run after EVERY strReplace — report each item)

  SYNTAX
  [ ] getDiagnostics passes with no errors on changed file

  DUPLICATION
  [ ] No duplicate code blocks — if/elif/else chains have no repeated branches
  [ ] No orphaned fragments — no partial lines or dangling strings left from edits
  [ ] Any dict + apply block pair not duplicated (re-read 20+ lines after any insertion near a dict)

  VARIABLE SCOPE
  [ ] Every new variable declared UNCONDITIONALLY before any branching
  [ ] No variable referenced before assignment on any path
  [ ] Any collection used as a guard recomputed AFTER new items are added, before it is used in checks

  INSERTION POINT
  [ ] Re-read surrounding lines after every strReplace
  [ ] try/except indentation matches surrounding code
  [ ] Dict tails not pulled inside except blocks (re-read insertion point + 20 lines after)
  [ ] Steps that must run BEFORE an anchor are before it
  [ ] Steps that must run INSIDE a loop are inside it

  BEHAVIOUR
  [ ] Inactive path behaves exactly as before
  [ ] Existing branches/keys/columns not modified
  [ ] New feature activates only on the correct condition
  [ ] Presence guards in place for every new reference

  BLAST RADIUS
  [ ] No file changed that is not in BLAST RADIUS
  [ ] All files in BLAST RADIUS have been validated
  [ ] Rollback instructions verified for each changed file

  TASK-TYPE SPECIFIC

  PURE DEVELOPMENT ONLY
  [ ] No new imports added not already in file
  [ ] No new helper functions invented outside the spec
  [ ] Pattern matches similar existing feature — verified

  REFERENCE BASED ONLY
  [ ] Every confirmed difference implemented — none skipped
  [ ] No block copied that was listed in DO NOT COPY
  [ ] DataFrame / variable names traced and matched

  HYBRID ONLY
  [ ] Reference part — passed REFERENCE BASED checks
  [ ] New build part — passed PURE DEVELOPMENT checks
  [ ] Boundary clean — parts do not bleed into each other
  [ ] Integration point connects parts as described
  [ ] No single strReplace spans both parts

  BUG FIX ONLY
  [ ] Fix targets root cause, not symptom
  [ ] No variable renamed anywhere in the function
  [ ] No logic changed outside the broken path
  [ ] All BLAST RADIUS locations verified after fix
  [ ] Adjacent issues flagged as separate task — not fixed
  [ ] ERROR TRIAGE was run before fix was applied

---

## EXECUTION CONSTRAINTS
- One step per iteration — no batching
- Mandatory validation after each step (STEP VALIDATION MATRIX)
- Stop on any failure — route to BLOCKED STATE
- Do not assume missing values — log assumptions explicitly
- Do not proceed without confirmed inputs
- Never modify code without EXECUTION or FIX intent
- Never create files without user confirmation
- Never edit outside BLAST RADIUS without user confirmation
