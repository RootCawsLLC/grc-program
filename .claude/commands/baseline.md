---
description: Run the full day-one baseline — intake, control health, gap assessment — and interpret it.
---

Run `npm run baseline` and then interpret the output for me.

Structure your interpretation in this order, because it is the order the work should happen in:

1. **Remediation gaps.** These have someone else's deadline attached. Any open finding with no
   control mapped is the sharpest signal in the whole run — it means an assurance activity found
   something the control model has nowhere to put.
2. **Risk gaps.** Scenarios with nothing operating against them. This is the direction to lead a
   leadership conversation with, because it is about loss rather than paperwork.
3. **Control health bands.** How many controls are actually instrumented versus merely declared.
   Do not compute an average or a score — the tool deliberately refuses to and so should you.
4. **Coverage gaps.** Least urgent, most commonly done first because it is easiest to count. If
   `in_scope` is still `null` across the requirement index, say plainly that every coverage number
   is currently undetermined rather than reporting a percentage.

Then tell me the three things worth doing this week and why, in risk-weighted order — not framework
order. If the answer depends on one of the open questions in `docs/DISCOVERY.md`, name the question
instead of assuming an answer.
