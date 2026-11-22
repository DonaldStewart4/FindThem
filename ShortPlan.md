# FindThem in 2 minutes

**A phone app for the first hour after a person with dementia goes missing. It tells family and neighbors where to look first, gives each searcher a route, keeps everyone talking on one live map, and updates as places come up empty.**

## Why
- 6 in 10 people with dementia wander at least once.
- About half of those not found within 24 hours are seriously hurt or die (Alzheimer's Association).
- Families search with no plan and no record of who looked where. Search teams know where people end up; families don't.

## Who it's for
- The caregiver, family and neighbors who start searching **before police or search-and-rescue arrive**.
- On a phone, stressed, outside, maybe with weak signal. Demo area: **Fremont, CA**; it works anywhere.

## What it does
1. **Call 911 first.** The banner is always on screen.
2. **Check the house and yard.** A 2-minute checklist.
3. **Enter what you know.** Where and when they were last seen, which way they went, how well they walk, and familiar places.
4. **See the map.** Red / orange / yellow likely areas (1 in 4, 1 in 2, 4 in 5) and the top 3 places to check first.
5. **Share the link.** Each searcher gets up to 3 ranked routes with warnings; a route someone took isn't offered again. Everyone sees the others as green dots.
6. **Talk and report.**
   - A shared message feed.
   - A report box: type or speak "saw him by the lake 10 min ago"; it becomes a sighting once you confirm it. Unsure fields are left empty and marked. A voice bot reads the form back (English).
7. **Update as you go.** Searched routes, sightings, corrections and every 5 minutes that pass shift the map for everyone.
8. **Found, or hand off to police.** One button ends the search for everyone. One tap gives a sheet of what was searched, what was seen, and what's left.

## How it works (lightly)
- The starting map: statistics on where people with dementia are found, laid over the real ground (streets, buildings, water, parks from OpenStreetMap), plus simulated "walkers" for what statistics can't say: a direction, a familiar place, a sighting.
- It is for "this many minutes since last seen", and says how likely the person is already off the map.
- Each area searched with no luck drops and the rest rise (Bayesian search theory). Routes update with it.
- Water and drainage near the likely area are flagged: look from the bank, don't go in. Woods and brush: check from the path.
- The database and every phone check each event against the same rules.
- The prediction runs on the phone. Online: the shared record, messages, searcher positions and Jev's report reading (word rules fill in when Jev can't).

## What it is NOT
- **Not a replacement for 911**, police or search-and-rescue.
- **Not a guarantee.** It's a guide to focus the search.
- Not a chatbot. AI (Jev) only fills in a report form you confirm, and never sets the probabilities.
- Not a tracker, GPS watch or wander alarm for the person, and not connected to cameras.
- Not a missing-persons network. One person, one hour, one map.
- Doesn't send volunteers into water or dense brush; those are flagged for professionals.

## Team
- **BenStew:** screen, hosting and the engine, built with Claude Code.
- **Nathan:** tests, debugging, speed, tuning Jev; on Nov 22 the engine rewrite, the search planner, event integrity and the report box's safety layer (with Claude Code).
- **Jev** isn't a person: it's TypeSafe's AI model, used only to fill in report forms.

## Must work by the deadline (Sun Nov 22, 12 pm)
- [x] Map, inputs and the prediction engine, with tests
- [x] Live shared map with searched areas
- [x] Routes for each searcher
- [x] Sightings update the map
- [x] Messaging between searchers
- [x] Voice/text report box (Jev once its key is in; word rules until then)
- [x] Share link
- [x] Police hand-off sheet
- [x] Works offline after the first visit
- [x] English, Spanish, French, Chinese, Japanese
- [x] One-tap Demo button

## After the core works (still required)
- [x] Benchmark vs. volunteers on their own (graded on a walker model not its own: 40% vs. 19% found after 1,500 searcher-minutes; ring sweep 28%)
- [x] The map tested on 60 untuned start points (median 0.99 km² searched; rings 1.30; first engine 2.54)
- [x] Report box on 150 unseen reports: Jev 85% of fields right, 3 dangerous; backup reader 76%, 7
- [x] 161 real cases as a held-out check
- [ ] Ben: publish the new Firebase rules, redeploy the proxy, try it on phones (`UPDATESBYNATE.md`)

*Details: `PLAN.md` (full plan), `INTERFACES.md` (screen ↔ engine contract), `CommitHistory.md` (every decision and commit), `bench/prior-report.md` (how good the map is).*
