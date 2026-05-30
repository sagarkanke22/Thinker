# MODULE: LEARNING + RESUME + DEFAULT

---

## LEARNING INTENT
**Triggers:** "derive learning" / "update learning"

**FILE READS (minimal):**
- `active_task_state.txt` — get task name and context file path only
- Context file — read ONLY the execution log section (last 5 entries)
- `system_rules_and_learning.txt` — grep ONLY for key phrase of proposed learning (duplicate check — not full read)

**STEPS:**

0. CREDIT CHECK — if execution log entries were appended this session → use them directly. Do NOT re-read context file.
1. Read execution log from context file (last 5 entries) — only if not already in conversation
2. Trim execution log: keep last 5 entries, archive older ones to `task_<name>_archive.txt` — only trim if >5 entries
3. Extract root cause from log entries
4. Propose learning — show to user BEFORE writing:
   ```
   WHAT:  [learning text — 3 lines max]
   WHY:   [root cause it captures]
   GENERIC CHECK: Does this apply to any similar problem
          regardless of file/feature/language? YES / NO
          If NO — rewrite to remove specific context before proposing.
   ```
5. STOP. Say: "Confirm to add, refine the wording, or say 'skip' to not add."
   - `confirm` → write as-is
   - `[REFINE] new wording here` → update proposed learning, show again, ask to confirm
   - `skip` → close without writing

6. If user says SKIP:
   - Update `active_task_state.txt`: STATUS = COMPLETE, DEFERRED LEARNING = NO
   - Done. No learning written.

7. If user confirms or provides refined wording:
   - Grep `system_rules_and_learning.txt` for the key phrase
   - If found → "Already exists as [L-number]. Skipping duplicate."
   - If not found:
     - Classify: TASK / FLOW / GENERIC
     - Append to correct file
     - Report: "Written to [file] as [L-number]"
   - Update `active_task_state.txt`: STATUS = COMPLETE, DEFERRED LEARNING = NO

**GENERIC QUALITY RULE:**
- Learning must describe the CLASS of problem, not the instance
- Remove specific file names, function names, variable names
- Pattern: "When [condition], [what happens]. Fix: [generic approach]."
- Test: "Would this help someone fixing a different bug with the same pattern?" If NO → rewrite.

**CONTEXT TRIM RULE:**
- Execution log: keep last 5 entries only
- Older entries → `task_<name>_archive.txt` (append, never overwrite)
- Apply trim every time LEARNING intent runs

**CRITICAL:**
- Never write a learning without user confirmation
- Never read the full system_rules — grep only
- Never read the full context file — execution log section only
- Never read the flow file — not needed for learning
- Max 3 lines per learning entry
- Must include root cause — reject vague entries
- User can always skip — task still closes cleanly
- Always trim execution log before reading it

---

## LEARNING RULES (classification)
- Every learning must include the root cause
- Reject vague or ambiguous learnings
- Classify before writing:
  - **TASK**    → append to `task_<taskname>_context.txt`
  - **FLOW**    → append to `task_<taskname>_flow.txt`
  - **GENERIC** → append to `system_rules_and_learning.txt`
- Append only — never overwrite existing content
- Check for duplicates before appending
- User can refine wording with `[REFINE]` before confirming
- Max 3 lines per entry — reject anything longer

---

## RESUME INTENT
**Triggers:** "resume" / "continue" / "pick up where we left off"

1. Read `active_task_state.txt`
2. Read LAST COMPLETED STEP and CURRENT STEP
3. Read ONLY the current (unexecuted) step from flow file
4. Read MATCHED LEARNINGS from context file
5. Present:
   ```
   RESUME POINT:
   TASK:          [task_name]
   LAST DONE:     Step [N] — [brief description from log]
   NEXT:          Step [N+1] — [description from flow file]
   STATUS:        [IN PROGRESS / BLOCKED]
   ```
6. STOP. Say: "Confirm to continue from Step [N+1], or say 'show status' for full state."

---

## DEFAULT INTENT
**Triggers:** anything that doesn't match other intents

**PROMPT TYPE TAGS (user can prefix to control file reads):**
- `[Q]` — general question, no context needed → answer directly, zero file reads
- `[TASK]` — task-related question → read `active_task_state.txt` only
- `[READ: filename]` — read only the specified file, nothing else
- `[URGENT]` — fast fix path → route to URGENT MODE (fix.md)

**If no tag → classify automatically:**
- GENERAL: conceptual, how-to, explanation → no file reads, answer directly
- TASK-RELATED: mentions file/function/error/task name → read `active_task_state.txt` only
- UNCLEAR → ask one clarifying question, no file reads

**RULES:**
- `[Q]` → answer directly, zero tool calls, no exceptions
- `[TASK]` → read `active_task_state.txt` only — one tool call max
- `[READ: file]` → read only the specified file — one tool call max
- No tag + GENERAL → answer directly, no tool calls
- No tag + TASK-RELATED → read `active_task_state.txt` only — one tool call max
- UNCLEAR → ask one clarifying question, zero tool calls
- Never modify any files in DEFAULT intent
- Never start execution in DEFAULT intent
- If answer derivable from current conversation → answer immediately, no tools

---

## TASK FILES STRUCTURE

### `task_<taskname>_context.txt` (Task Memory)
Sections:
- Task definition
- Code understanding (Section B)
- Implementation plan (Section C)
- MATCHED LEARNINGS (added during PHASE 1.5)
- Acceptance criteria
- Execution log (keep last 5 entries — older entries go to archive)
- Debug history (appended per debug cycle)
- FIX HISTORY (appended after confirmed fixes)
- Task-specific lessons

### `task_<taskname>_flow.txt` (Execution Engine)
- BLAST RADIUS declaration
- Step-by-step execution plan
- Each step includes: what, where, validation, rollback
- One step at a time
- Execution status per step

### `task_<taskname>_archive.txt` (Overflow)
- Execution log entries beyond the last 5
- Appended only — never overwrite
