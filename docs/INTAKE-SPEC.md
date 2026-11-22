# FindThem intake and report conversation: spec v1

The search leader you talk to. This file says what the agent says, what it asks, in what order, and how answers reach the intelligence layer.

## Principles (these win every conflict)

1. **Accuracy first.** The agent is assumed unreliable. It proposes; only confirmed, schema-valid data reaches the engine (`docs/AGENT-CONTRACT.md`).
2. **No generated advice.** Every sentence the agent says is a fixed template (in `i18n.js`, 5 languages) filled with engine data. Jev only answers multiple-choice questions with a confidence. No LLM writes free text to the user.
3. **Every question must change the map.** The engine's `caseGaps()` decides what to ask next. Nothing is asked "for the record."
4. **The map comes first, questions second.** A first map appears as soon as the last-seen place and time are known. Every later answer refines it.
5. **"I don't know" is always a valid answer.** The engine handles unknowns (e.g. unknown direction means no direction bias). The agent never pushes for a guess.
6. **Two minutes, not an interview.** Stop asking when the most valuable remaining question is worth little, or when the person taps **Start searching**.

## The conversation

### Turn 0: always on screen
- The red **Call 911** banner (already built). The agent never repeats a 911 script; that's the person's job.

### Turn 1: where (required)
- Agent: *"Where were they last seen? Say an address or a place, or tap the map."*
- Input: voice, text, map tap or map search.
- Jev picks the place from the phone's nearby-place list (which includes street corners). Low confidence: **"Did you mean [place]?"** with Yes / Tap the map instead.
- Output: `lastSeen` (confirmed).

### Turn 2: when (required)
- Agent: *"About how long ago?"*
- Chips: 15 min · 30 min · 1 hour · 2 hours · Not sure. Free answers like "around 3:15" are converted using the phone's clock.
- Output: `minutes` + `minutesAt` (confirmed). **The first map appears now.**

### Turns 3+: ranked by `caseGaps()`
The engine scores each missing field by how much the possible answers would change the map, and asks the highest first. The usual order, though the engine decides:

| Field | Agent says | Chips | Why it matters |
|---|---|---|---|
| `travel` | "Could they have driven or taken a bus?" | Walking · Maybe car · Maybe bus · Not sure | Drivers are usually found far away (median 41 mi, Rowe 2011). A walking map is the wrong tool for that, so it says so plainly and keeps the walking map for the "maybe" share. |
| `houseChecked` | "Have you checked inside the house, garage, cars and yard?" | Yes · Not yet | 35% of urban dementia finds are in a structure (ISRID). If "Not yet", show the 2-minute checklist first. |
| `direction` | "Do you know which way they went? A doorbell camera often shows it." | Arrow on the map · Not sure | The strongest single clue (tight dispersion angle). |
| `mobility` | "How do they walk?" | Normally · Slowly · Walker or cane | Sets speed and distance. |
| `familiar` | "Is there a place they might try to go: an old home, work, church?" | Search or tap · None | The goal-seeking scenario. |
| `description` | "What are they wearing? The top color matters most." | Color chips + free text | Feeds detection (how visible they are) and the hand-off sheet, and it's what volunteers see in their task. |

**Stopping rule:** stop when the top `caseGaps()` value falls below `INTAKE_MIN_VALUE` (ASSUMPTION, tuned in the eval), or when the person taps **Start searching**. That button is visible from Turn 2.

**Several answers at once:** "He left home 20 minutes ago walking toward the park, he uses a cane" fills `lastSeen`, `minutes`, `mobility` and possibly `direction` in one turn. The agent shows them as one confirm card and skips the questions already answered.

**Corrections:** "No, 40 minutes" replaces the field, the map updates, and the agent says *"Changed to 40 minutes."*

### The confirm card (before anything is shared)
One card of chips, each one tappable to edit:

> Seen at Stevenson Blvd & Paseo Padre · 20 min ago · Walking · Slowly · Heading Northeast · Blue jacket

**Start searching** writes the case. Until then, everything stays on the phone.

## During the search: reports

1. A volunteer says or types: *"Saw a man in a blue coat by the lake ten minutes ago, heading east."*
2. Jev's multiple-choice draft goes through the safety layer (unsure fields emptied, flags set).
3. `proposeClue()` gives a preview. Agent: *"This would move about 40% of the chance toward Lake Elizabeth. Add it?"* Then **Add** / **Edit** / **Discard**.
4. Only **Add** writes an event. In English, the read-back says the flags first, then the unsure fields.

**Flags change what the agent says, never the map:**

| Flag | Agent says |
|---|---|
| `emergency` ("he's in the water", "he fell") | A red line: **"Call 911 now."** with tap-to-call. No other text. |
| `water` | "Check from the bank or path. Don't go into the water." |
| `vehicle` | "A car sighting goes to the police. The map is for walking." |
| `conflict` / `guess` / `someone else` | "I wasn't sure about [fields]. Please check them." |

## What the agent may and may not say

- **May:** read engine numbers ("about 30% chance in this area"), name places, read warnings, ask the next question, confirm or abstain.
- **May not:** say where the person "is," promise anything, give medical advice, tell anyone to enter water, roads or private property, or summarize without engine data.
- **Abstain sentence**, when Jev is unsure or the engine can't answer: *"I'm not sure. Please check this yourself."* (from `AGENT-CONTRACT.md`)

## What the intelligence layer must provide

- `caseGaps(caseDraft)` returns `[{ field, value, questionKey, chips }]`, sorted by value. Value = the expected change in the map over the plausible answers (total variation distance, weighted by how likely each answer is). Tie-break: how likely the answer is to change the first assignment the planner would give.
- `previewCase(caseDraft)` gives the map for a draft that isn't saved yet (local only).
- `proposeClue(draft)` returns `{ shift: [{ place, fromPct, toPct }], warnings }`. Nothing is written.
- Unknown fields are handled as unknown, never as a default guess shown as fact.

## Open issues (to settle before building)

1. **Case edits after sharing.** The integrity rules say the case is written once. A correction after **Start searching** ("actually 40 minutes") therefore needs a `caseUpdate` event: append-only, the latest value wins, and the engine replays it. The integrity session should add it to the rules.
2. **Latency budget per turn:**
   - speech to text about 1 s (Deepgram)
   - Jev, to be measured
   - engine under 300 ms
   - read-back optional

   Show the parsed chips while the voice is still speaking.
3. **i18n:** every template in 5 languages, and they need a native speaker's check.

## How we test it

`bench/intake-cases.json` holds scripted conversations, each with the expected final case. Metrics:
- fields right
- dangerous errors (wrong last-seen place, a time off by 2× or more, walking assumed when a car was mentioned)
- number of questions asked
- seconds to first map

Target: 0 dangerous errors, a first map by Turn 2, and 6 questions or fewer.
