---
description: Decompose a requirement or a capability into layer-split control records.
argument-hint: [requirement id or plain description]
---

Use the `requirement-decomposer` subagent to turn this into candidate control records: **$1**

Before it writes anything, make it answer out loud:

1. What has to be **true in the estate** for this to hold?
2. **How many different teams** own a piece of that truth? That number is the number of controls.
3. For each: can you state the **denominator in one sentence with a quantifier**? If not, the
   control is not yet well-defined — say so instead of writing a vague `population_definition`.
4. Is there an **existing control** this belongs to instead? Same owner, same cost, same failure
   mode, same evidence source means one control with two mappings, not a new record.

Then write the records with `status: planned`, run `npm run validate`, and open a PR. Do not
populate `cost`. Do not set `policy_ref`. Do not copy framework text.

Finish by telling me what you split, what you deliberately did not split, and where you were unsure.
