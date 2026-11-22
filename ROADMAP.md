# FindThem roadmap

Ideas for after EvoHacks II, for the pitch and for whoever picks this up next. **None of these are built.** Where part of an idea already exists, the "Already in the app" line says exactly what, so it's clear where the line is. No placeholder code or fake buttons exist for any of this.

## Future Plans (not yet built)

### Prevention device or app
A native phone app or wearable (GPS watch, tracker tag) for the person with dementia, with background location and an alert to the caregiver when they leave a "safe zone" around home. This needs a native app, because websites can't reliably track location in the background.

### Live group search, the full version
Everyone on a search gets accounts, assigned search zones, and coordination tools beyond what a shared link gives.
- **Already in the app:** one shared live map per search link; searched areas, sightings and messages sync between phones; each searcher is offered the next best area with a walking route.
- **Not built:** accounts and roles; one person assigning zones to specific people; seeing where every searcher is right now; push notifications; private messages.

### Better predictions from real data
Tune and check the simulation against real search-and-rescue case records, instead of numbers taken from a few published studies.
- Includes an **open dataset**: with a family's consent, an anonymous record of where and when a person was found is added, so predictions improve over time.

### More behavior factors
- Weather and temperature.
- Time of day: "sundowning" makes evening wandering more likely and more dangerous.
- Hills and terrain.
- Barriers such as fences, freeways and rivers that walkers shouldn't cross.
- The chance they got on a bus or drove a car.

### A full caregiver profile
Photo, physical description, usual clothing, medical needs, and life history (former homes, old workplaces, daily routines, and where they were found before) that the prediction can use.
- **Already in the app:** up to 3 familiar places per search, and a saved home area for offline use.
- **Not built:** a saved profile, photos, descriptions, medical details, and past-wandering history.

### Working with authorities
Export the search area for police and search-and-rescue teams as GPX or KML files, and help with filing a Silver Alert.
- **Already in the app:** a plain-text hand-off sheet (timeline, areas searched and how well, sightings, most likely places with coordinates, live link) to copy or print.
- **Not built:** GPX/KML export, a printable map, and Silver Alert help.

### Nearby volunteer alerts
Opt-in notifications to people near the last-seen point, asking them to check their street, yard or doorbell camera.

### Full offline maps
Switch to a map tile provider that allows downloading tiles ahead of time, so the whole map works with no signal. (OpenStreetMap's tile rules don't allow bulk downloads; today the app saves only tiles you have looked at, plus the street data for saved areas.)

### Accessibility, the full version
- **Already in the app:** five languages, big tap targets, high contrast, labels for screen readers on the main controls.
- **Not built:** a large-text mode, a full screen-reader and keyboard check of every screen, and checks of the translations by native speakers.

### Privacy and security
Encryption for medical and location data, clear consent controls for families, and deleting a search when it's over.
- **Already in the app:** searches can only be opened with a long random link; events can only be added, never changed; the AI key never touches the website.
- **Not built:** accounts, encryption, automatic expiry and deletion of old searches, and consent screens.

### Search tools from the game plan we didn't get to
- **"No one here" clues:** "the camera on Oak St saw nobody" lowers that street.
- **Coverage from searchers' GPS trails** instead of typed minutes, with lower detection at night.
- **Doorbell-camera list:** homes along the likeliest routes whose cameras a neighbor could check.
- **Drill mode:** a practice run so a family rehearses once before they need it.
