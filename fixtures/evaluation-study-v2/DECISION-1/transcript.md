# Frozen Agent history — Explicit Refresh

The first card prototype replaced open details whenever a watched file changed. During review, this caused the reader's current paragraph to jump and made it unclear whether the old or new evidence supported a decision. The team accepted `explicit refresh`: an open card pins its snapshot, shows a compact “content changed” signal, and replaces content only after the user presses Refresh.

Background checks may detect revision drift, but they may not silently replace visible content. Refresh re-reads authority, reports at most three prioritized changes, and keeps the detail in the same Chat Lane location.

Task: record one code in `answer.txt`.

- `DECISION-A`: replace the card immediately whenever a watcher fires.
- `DECISION-B`: pin the open snapshot, signal drift, and replace it only after a trusted Refresh action.
- `DECISION-C`: never detect changes while a card is open.
