# FindThem in 2 minutes

**A phone app for the first hour after a person with dementia goes missing. It tells family and neighbors where to look first, gives each searcher a route, keeps everyone talking on one live map, and updates as places come up empty.**

## Why
- 6 in 10 people with dementia wander at least once.
- About half of those not found within 24 hours are seriously hurt or die (Alzheimer's Association).
- Families search with no plan and no record of who looked where. Search teams know where people usually end up; families don't.

## Who it's for
- The caregiver, family and neighbors who start searching **before police or search-and-rescue arrive**.
- On a phone, stressed, outside, maybe with weak signal.
- Demo area: **Fremont, CA**. It works anywhere.

## What it does
1. **Call 911 first.** The banner is always on screen.
2. **Check the house and yard.** A 2-minute checklist.
3. **Enter what you know.** Where and when they were last seen, which way they went, how well they walk, and familiar places.
4. **See the map.** A heatmap and the top 3 places to check first, e.g. "Creek 130 ft off Main St".
5. **Share the link.** Each searcher who joins gets an area and a walking route.
6. **Talk and report.**
   - A shared message feed.
   - A report box: type or speak "saw him by the lake 10 min ago" and it becomes a sighting on the map once you confirm it.
7. **Update as you go.** Searched routes and sightings shift the map for everyone.
8. **Hand off to police.** One tap gives a sheet of what was searched, what was seen, and what's left.

## How it works (lightly)
- Thousands of simulated "walkers" move along real streets the way research says people with dementia do: straight until stuck, usually within a mile, often just off the road in a creek or brush.
- Where they end up becomes the starting map, built from public sources (search-and-rescue statistics, OpenStreetMap).
- Each area searched with no luck drops on the map and the rest rise (Bayesian search theory). Routes update with it.
- The prediction runs on the phone. Only the shared record, messages and report parsing are online.

## What it is NOT
- **Not a replacement for 911**, police or search-and-rescue.
- **Not a guarantee.** It's a guide to focus the search.
- Not a chatbot. AI only turns a messy report into data you confirm, and never sets the probabilities.
- Not a tracker, GPS watch or wander alarm.
- Not connected to cameras.
- Not a missing-persons network. One person, one hour, one map.
- Doesn't send volunteers into water or dense brush; those are flagged for professionals.

## Team
- **BenStew:** screen and hosting.
- **Jev:** engine, hand-written.
- **Nathan:** tests, debugging, speed.

## Must work by the deadline (Sun Nov 22, 12 pm)
- [ ] Map, inputs and the prediction engine, with tests
- [ ] Live shared map with searched areas
- [ ] Routes for each searcher
- [ ] Sightings update the map
- [x] Messaging between searchers
- [x] Voice/text report box
- [x] Share link
- [x] Police hand-off sheet
- [x] Works offline after the first visit
- [ ] English, Spanish, French, Chinese, Japanese
- [ ] One-tap Demo button

## After the core works (still required)
- [ ] Benchmark: FindThem vs. volunteers searching on their own

*Details: `PLAN.md` (full plan), `INTERFACES.md` (screen ↔ engine contract), `CommitHistory.md` (every decision and commit).*
