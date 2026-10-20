# Resume an unfinished session (2026-10-19)

**Owner's ask.** X-ing out of a review and opening it again should pick up where you left off.

**Today.** Every answer is saved as it's graded (evidence), so nothing answered is lost; what's lost
is the session itself: its question list, the position, the score and misses so far. Reopening
assembles a new one.

**Design.** `session_progress` (one row per student, course and kind: `quick` or `deep`): the
session id, its items (question and topic ids), the position, correct / skipped / ungraded counts,
the missed question ids, the seconds so far, a title, and when it was last saved. Owner-only under
RLS, returned by `my_data()`. The quiz saves it after every question (through the store's save
queue) and clears it when the session finishes. Opening a quick review or a dive with saved
progress from the last 24 hours asks "Pick up where you left off?" (Resume / Start a new one).
Resuming keeps the session id, so finishing records one session with the full score; questions
removed since are dropped; a dive resumed writes nothing new.

**Tasks.** (1) migration + pgTAP; (2) types, store load/save/clear; (3) the runner restores and
saves progress; (4) the session page's resume prompt for quick reviews and dives; e2e; (5) docs.
