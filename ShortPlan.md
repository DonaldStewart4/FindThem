# FindThem in 2 minutes

**A phone app for the first hour after a person with dementia goes missing. It tells family and neighbors where to look first, splits the area between them, and updates the map as places come up empty.**

## Why
- 6 in 10 people with dementia wander at least once.
- About half of those not found within 24 hours are seriously hurt or die (Alzheimer's Association).
- Search teams know where lost people with dementia usually end up. Families don't, and the first hour is usually spent searching with no plan and no record of who has looked where.

## Who it's for
- The caregiver, family and neighbors who start searching **before police or search-and-rescue arrive**.
- They're on a phone, stressed, outside, maybe with weak signal.

## What it does
1. **Call 911 first.** The emergency banner is always on screen.
2. **Check the house and yard.** A 2-minute checklist: closets, garage, cars, shed.
3. **Enter what you know.** Where and when they were last seen, which way they went, how well they walk, and familiar places like an old home or church.
4. **See the map.** A heatmap of where they most likely are, plus the top 3 places to check first, e.g. "Creek 130 ft off Main St".
5. **Split the search.** Each volunteer gets an area by link. Everyone sees the same live map.
6. **Update as you go.** Mark an area searched, or report a sighting, and the map shifts for everyone.
7. **Hand off to police.** One tap gives a sheet of what was searched, how well, and what's left.

## How it works (lightly)
- Thousands of simulated "walkers" move along the real streets the way research says people with dementia do:
  - they keep going straight until they get stuck
  - they're usually found within a mile
  - they often end up just off the road, in a creek or brush
- Where the walkers end up becomes the starting map.
- Each searched area that comes up empty lowers its chance on the map, and every other area rises (Bayesian search theory, the method used to find Air France 447).
- The prediction runs on the phone. The only thing online is the shared list of what's been searched.

## What it is NOT
- **Not a replacement for 911**, police or search-and-rescue.
- **Not a guarantee.** It's a guide to focus the search.
- Not a chatbot. AI never touches the probabilities.
- Not a tracker, GPS watch or wander alarm.
- Not connected to cameras.
- Not a general missing-persons network. It's one person, one hour, one map.
- It doesn't send untrained volunteers into water or dense brush. Those spots are flagged for professionals.

## Must work by the deadline (Sun Nov 22, 12 pm)
- [ ] Map, inputs and the prediction engine, with tests
- [ ] Live shared "searched" areas across phones
- [ ] Sightings update the map
- [ ] Police hand-off sheet
- [ ] Works offline after the first visit
- [ ] English, Spanish, French, Chinese, Japanese
- [ ] One-tap Demo button

## After the core works (still required)
- [ ] Benchmark: FindThem vs. volunteers searching on their own

*Details: `PLAN.md` (full plan), `INTERFACES.md` (screen ↔ engine contract), `CommitHistory.md` (every decision and commit).*
