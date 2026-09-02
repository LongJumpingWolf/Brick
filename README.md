# Brick

Image-occlusion cramming app, plus Basic and Cloze card types. Local-only
(localStorage + IndexedDB) — no backend, no build step, deploys as a
plain static site.

Wall/Brick file manager (borrowed from Kardex's folder/deck tree shape)
plus a card editor with three tabs. Walls (folders) render with an
actual brick-pattern texture and Bricks (decks) get a visible physical
border — a Wall is meant to look like it's built from many bricks, a
Brick like one distinct object, so which is which is obvious without
reading the label. The page itself disables pinch/double-tap zoom.
Each tile's kebab (⋮) menu button gets a backing chip tinted the right
direction for its own tile — light-tinted on dark Brick tiles, dark-
tinted on light Wall tiles — checked with actual WCAG contrast math,
not eyeballed (5.2:1 and 10.2:1 respectively for the dots themselves).

- **Image Occlusion** — modeled on Anki's actual editor: Select /
  Rectangle / Ellipse tools, drag to draw, drag a shape's body to move
  it, drag a corner handle to resize it, "Hide All, Guess One" / "Hide
  One, Guess One" review modes, Header / Back Extra fields. In Hide-All
  mode, the specific shape a given card tests gets its own color even
  while hidden, so you know where to focus without the answer being
  given away — plain Anki doesn't distinguish that, everything hidden
  looks identical there.
- **Basic** — front/back, with a bold/italic/underline/highlight
  toolbar. Stage several cards before naming the brick.
- **Cloze** — `[[bracket]]` syntax with a live front/back preview,
  same staging flow as Basic.

## File map

```
index.html                  shell — all screens + overlays live here
favicon.ico                  multi-resolution (16/32/48) — browsers check this path directly
site.webmanifest            PWA/home-screen manifest
icons/
  brick-master.svg           the source — same logo geometry as the topbar
                             mark, scaled up onto a real white background
  favicon-*.png, apple-touch-icon*.png, android-chrome-*.png,
  icon-*.png, mstile-*.png    the full generated set, every standard
                             size a browser/OS actually asks for
css/
  tokens.css                 colors, shadows, texture, focus ring
  components.css              brick buttons, modals, tile menu, shared
                               text-formatting classes (.highlight,
                               .cloze-blank, .cloze-answer)
  layout.css                  app shell, top bar, tile grid, responsive width
  preview.css                  brick preview screen
  occlusion-editor.css        toolbar, shapes, resize handles
  card-types.css               card-type tabs, format toolbar, staged
                               card list, cloze live preview
  study.css                   study screen, timer bar, text-mode card
  settings.css                 Settings screen, recycle bin rows, export picker
js/
  storage.js                  IndexedDB image store (hash-deduped) + localStorage
                               tree/log/trash/ImgBB-key persistence
  scheduler.js                 SM-2-style spaced repetition
  text-format.js               bold/italic/underline/highlight + cloze
                               front/back parsing — shared by the editor
                               preview and study rendering
  tree.js                      Wall/Brick CRUD, kebab menu, drag-drop, search,
                               keyboard nav, recycle-bin operations
  occlusion-editor.js         the shape editor (Occlusion tab only)
  basic-cloze.js                Basic/Cloze tabs — staging + generation
  study.js                     preview + study/review loop, all 3 card types
  import-export.js             bundle build/parse — selective export,
                               fresh-ID import merge
  backup-folder.js              File System Access API — on-disk mirror
                               of the whole tree, one folder per Wall,
                               one file per Brick, kept in sync automatically
  settings.js                   Settings screen UI: recycle bin list,
                               export picker, import handling, ImgBB key form
  imgbb-backup.js               pending-image detection, the mandatory
                               batched-upload runner, progress modal
  app.js                       shared shell helpers + boot (loaded LAST)
test/
  smoketest.js                 headless integration test — see below
vercel.json                    static hosting config
package.json                    dev-only test deps + scripts
```

Each file is scoped to one concern on purpose — if you need to change
how shapes resize, that's entirely inside `occlusion-editor.js`; if you
need to change how Basic cards stage, that's entirely inside
`basic-cloze.js`; if you need to change the export bundle format,
that's entirely inside `import-export.js`. Files are loaded as plain
`<script>` tags (no bundler, no build step), so **script order in
`index.html` matters**: `storage.js`, `scheduler.js`, `text-format.js`
first (no dependencies on the others), then `tree.js` /
`occlusion-editor.js` / `basic-cloze.js` / `study.js` /
`import-export.js` / `backup-folder.js` / `settings.js` / `imgbb-backup.js` (depend on
those three), then `app.js` last (calls the `init...()` function each
of the other files
exports).

## Run it locally

No build step — just serve the folder:

```bash
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000`.

## Run the tests

```bash
npm install
npm test
```

This runs a headless-browser (jsdom) integration test that loads the
real `index.html` and all eleven real `js/*.js` files — via actual
`<script>` elements, not `eval()`, so it accurately exercises the same
cross-file scope-sharing the app relies on in a real browser — then
drives the full loop: create a Wall, open the occlusion editor, draw a
rectangle and an ellipse, move and resize a shape via its handles,
generate cards, study them, grade them, confirm a triple-timeout
auto-tags a card Tough, confirm the active-mask color distinction in
Hide All mode, stage and create Basic cards (with formatting), stage
and create Cloze cards (with correct front/back parsing), confirm an
Again-graded card requeues within the same session, confirm Space bar
reveals then grades Good, confirm the label tab sits outside the mask
border, confirm mixing Cloze/Basic/Occlusion cards into one brick
across tab switches — nothing finalizes early — confirm Cement Mode
filters bricks to only their cemented cards without touching the Wall
structure, confirm Hints persist as a session-wide toggle across
cards, delete a Wall and confirm it lands in the Recycle Bin (not
gone), restore it, permanently purge it, empty the bin, open the
Export picker and confirm the cascading folder-checkbox selection
actually produces a subset bundle containing only the referenced
image (not every image in the app), run a full export → import
round-trip confirming every imported node and card gets a genuinely
fresh id with no collision against the original, pause a session and
resume it across a simulated `pagehide`/`visibilitychange` (hard tab
close, phone locking), run the full ImgBB batch backup end to end with
a mocked network (real batching, a deliberately-failing image that
gets retried then correctly reported, no re-nagging on a simple
re-save), and confirm a second touch mid-draw cancels the gesture and
confirms a second touch mid-draw cancels the gesture cleanly (and, as
of this fix, that it does NOT attempt to drive scrolling manually —
the tool that once caught the scroll call now confirms it's never
made),
confirm zoom is disabled, confirm Wall/Brick tiles render with their
distinct textures, confirm the Done screen's brick wall actually lays
bricks in sequence, shows its text only after finishing, loops, and
clears its timers on exit, and confirm the ImgBB progress counter
shows the real final result rather than a stale mid-upload snapshot (a
real bug caught from an actual screenshot: it said "All 1 images
backed up" right next to a contradictory "0 / 1"), and re-checks for
any uncaught JS error across the ENTIRE run at the very end — not just
early on, which is exactly the gap that let a genuinely missing
variable declaration (`activePointers`/`twoFingerScrollRef` were only
ever assigned, never declared with `let`) go unnoticed for a while,
confirms the occlusion spotlight window renders on both the question
and answer screens (sized correctly around the active mask, exactly
one instance, gone entirely on non-occlusion cards), confirms it's
using the sharp box-shadow-window technique at the chosen strength
rather than the earlier soft radial-gradient, and confirms both a
Wall and a Brick tile's kebab button exist to check contrast against.
confirms both a Wall and a Brick tile's kebab button exist to check
contrast against, and — after a direct challenge on whether Rename,
Move, Duplicate, and deleting a staged card actually had real
coverage (they didn't) — confirms Rename actually persists, Move
correctly excludes the item's current parent from the destination
list and updates the real tree (not just the view), Duplicate gives
every card a genuinely fresh id so editing one copy can never affect
the other, deleting a staged card removes the correct one by index
(not just any one), and the new Cloze `[[ ]]` button both inserts an
empty pair with the cursor between them and wraps a real selection
correctly.
correctly, and hand-authors a bundle following ONLY the documentation
in "Import file format" below (not app-generated) to confirm that
format is actually accurate against the real import code, not just
described from memory.
correctly, and hand-authors a bundle following ONLY the documentation
in "Import file format" below (not app-generated) to confirm that
format is actually accurate against the real import code, not just
described from memory — plus a real adversarial battery: feeds the
actual reproduced XSS payload through the real import path and
confirms it's neutralized in the saved data itself (not just at
render time) and never fires in the rendered DOM, malformed JSON,
valid-JSON-wrong-shape, unknown card types mixed in with real ones,
occlusion cards with no valid masks, a bogus `activeMaskId`, null
names, and a 50,000-character field, confirming each is handled
gracefully rather than crashing or corrupting the tree.
gracefully rather than crashing or corrupting the tree, and — the
highest-stakes part of the suite — the rolling backup ring buffer
(caps at 5, correctly time-gated so rapid saves don't each create
one), `loadTree()`'s corruption recovery tested directly against both
the "backup available" and genuine "no backup at all" cases, a
simulated save failure showing the mandatory warning exactly once per
session, manual restore-from-backup in Settings actually changing and
persisting the live tree, and — the most rigorous test in the whole
file — a genuine second boot in a fresh JSDOM instance with corrupted
data pre-seeded before any script runs, proving the full recovery
pipeline works end-to-end rather than just the isolated function, and
— the largest single addition — the Linked Backup Folder feature
against a real mock of the File System Access API (jsdom has zero
support for it, confirmed directly), covering the actual on-disk
folder/file mirroring, that a mirrored file is genuinely self-
contained by feeding it back through the real import path, the dirty-
check correctly skipping unchanged re-syncs, same-name collision
handling, confirming deleted-in-app content's mirror file is
deliberately left alone rather than auto-removed, permission lapsing
being refused rather than silently mishandled, and `pagehide` alone
triggering a real sync with no explicit call, plus confirming the
companion-extension download button is a real link (not JS-only)
pointing at a stable path, and — since that button's whole point is
avoiding a silent placeholder — confirming the file actually at that
path is the real extension (manifest, background, background-core,
popup all present) and not the placeholder anymore, plus real
Trash-move coverage for the in-page sync: a deleted Brick's file
actually leaves its original location, lands in a flat `Trash/`
folder with a deletion timestamp in its name, still holds its real
original content, and deleting the same name a second time coexists
with the first trashed copy rather than overwriting it, and true
per-file reconciliation for the in-page sync too: a forced resync
with nothing genuinely different reports every file as unchanged and
makes zero actual write() calls (confirmed at the filesystem-call
level, not just the reported label), a mixed change (one edit, one
new Brick) correctly produces one update and one create in the same
sync, and the read-only Sync Preview makes zero writes of its own —
confirmed by running a real sync immediately after and finding the
same pending change still there. Also added a watchdog timeout to
this suite for the same reason described in the Companion Extension
section below.
468 assertions, all
currently passing.

This process has caught real bugs more than once, including one this
session: tiles were rendered as `<button class="tile">` with a nested
`<button class="tile-kebab">` inside — invalid HTML, since a button
can't contain another button — which meant the kebab dropdown menu had
never actually been exercised by any earlier test run. Fixed by making
the tile wrapper a `<div role="button">` instead.

## Database / environment variables

**None needed to deploy.** Everything lives in the browser's own
localStorage and IndexedDB by default — no Supabase, no serverless
function required. You can deploy this to Vercel with zero environment
variables set and it works fully.

**Deploying a new version of the code never touches anyone's stored
data.** Vercel (or wherever this is hosted) only serves the HTML/CSS/
JS files themselves — deploying a new build replaces those files on
the server, full stop. It has no access to, and no effect on,
anything already sitting in a person's browser's localStorage or
IndexedDB. The actual risk in an update isn't the deploy itself, it's
a **future code change** that assumes a data shape older saved data
doesn't have — see "Data Safety" below for what happens if that ever
causes saved data to look unreadable: it's recovered automatically
from a backup rather than silently discarded, which didn't used to be
true and was fixed specifically because of that risk.

The one **optional** exception: Settings → Image Hosting lets you add
an ImgBB API key to back up occlusion images to the cloud as you add
them. This is a client-only, no-relay implementation — the key is used
directly from the browser (visible in outgoing network requests) since
there's no server in this static build to keep it private. Fine for a
personal key on a personal deployment; don't paste in a shared/team
key. If you want a properly private setup, that's a real addition —
wiring up Supabase (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) for the
tree/review-log data, plus an `api/upload-image.js` serverless relay to
ImgBB (`IMGBB_API_KEY` kept server-side), same pattern Kardex already
uses. Say the word and I'll build that as its own piece of work.

## Study session behavior

- **A sharp spotlight follows the focused mask, on both the question
  and answer screens.** Everything except the mask a card is actually
  testing dims behind a hard-edged box-shadow window (not a
  radial-gradient — that read as a vague, brushed blend when
  prototyped; a real box-shadow spotlight gives a clean, immediate
  cutout instead). It's present from the moment a question appears
  (while the box is still hachure-filled) through to the answer, not
  something that only switches on after tapping reveal. On top of
  that: non-focused revealed masks mute to a flat grey pill and pick
  up a light blur (real depth-of-field, not just lower opacity); the
  focused label pops in with a small overshoot-bounce and a slow
  looping glow keeps it prominent rather than going flat right after
  reveal. Before this, every revealed label got the exact same
  amber-dark pill regardless of whether it was the one being tested —
  nothing pulled the eye to the actual focus.
- **Again/Good buttons are fixed to the viewport.** No more scrolling
  down to reach them past a tall occlusion image or long card text —
  they float above the content, accounting for notched-phone safe
  areas at the bottom.

- **Cement Mode.** Toggled via the logo dropdown in the topbar (click
  "BRICK." to open it) or `C` on the Wall screen — the Wall itself
  doesn't change at all, every folder and brick is still there and
  navigable, but tiles show a cemented count instead of the usual
  new/due breakdown, and starting a brick while Cement Mode is on
  studies ONLY its cemented cards (regardless of SM-2 due-ness). A
  brick with zero cemented cards is visually dimmed and shows a "no
  cemented cards" message rather than silently starting an empty
  session. Turning it on also applies a real theme — cools the whole
  background, re-colors Brick tiles toward the same concrete greys as
  the cinder-block icon itself, and swaps the topbar logo and wordmark
  from "BRICK." to "CEMENT." — unmistakable at a glance that you're in
  the filtered view. The dropdown only opens on the Wall screen;
  offering it next to the Study screen's own per-card Cement button
  (same icon, different meaning) read as two confusing near-duplicate
  rows.
- **Done screen: an animated brick wall.** A 3-row running-bond wall
  lays itself in brick by brick, "You are bricked!" fades in once it's
  fully built, holds a beat, then resets and loops — for as long as
  you're actually looking at the Done screen. Leaving it (either
  button) explicitly clears every pending timer so the loop doesn't
  keep firing invisibly in the background afterward.
- **Paused sessions survive closing the app, on purpose or by accident.**
  Every card transition snapshots a resumable checkpoint (deck, card
  order, position, score, hints state) to localStorage. Hitting Back
  mid-session is treated as a pause, not an abandonment — reopening
  that brick's preview offers Resume (exact card) or Start Fresh. For
  closures that skip buttons entirely — a hard tab close, a crash, a
  phone locking mid-review — both `pagehide` and `visibilitychange`
  independently re-save the same checkpoint, since mobile browsers
  routinely skip `beforeunload` altogether. Only one paused session
  exists at a time; starting a different brick supersedes it; finishing
  a session (resumed or fresh) clears the checkpoint.
- **"Again" requeues the card in the same session.** SM-2 marking a
  missed card "due now" only matters for a future session — within
  the one you're actually running, a card graded Again reappears a few
  cards later so you get another shot at it before the session ends,
  rather than just vanishing until you manually restart the deck.
- **Cement (bookmark).** Press the Cement button or hit `C` while
  reviewing to bookmark a card — this also logs it as Again and
  requeues it, same mechanism as above, so a cemented card comes back
  before the session ends. Pressing `C` again on a card you'd already
  cemented (on a later revisit) un-bookmarks it without forcing a
  second miss — you just stay on the card and can grade normally.
- **Hints, occlusion cards only, session-wide toggle.** Each drawn
  shape can carry an optional hint, separate from its label (the label
  is the answer, shown only on reveal; the hint is a clue, shown on
  request while still hidden). Press the Hints button or hit `H` and it
  stays ON for the rest of the session — every following occlusion card
  with a hint shows it automatically, with no need to press `H` again
  per card. Press `H` again to turn it back off for the rest of the
  session. Overlaid directly on the occluded region in high-contrast
  white-on-dark so it stays readable regardless of the hatch pattern
  underneath. The hint only ever applies to the ONE shape the card is
  actually testing — in Hide All mode every shape looks hidden
  identically, but Hints won't leak clues for shapes the card isn't
  asking about. The toggle resets to off at the start of each new
  study session — it doesn't carry over between separate sessions.
- **Space bar** does double duty: reveals the card when it's hidden,
  and grades Good when it's already revealed — one key covers the
  whole rhythm of a review.
- **Mixed card types in one brick.** Nothing finalizes a brick the
  moment you add a card. Occlusion's "Add these shapes to brick" and
  Basic/Cloze's "Add card to brick" all feed one shared staged pile —
  switch tabs freely, add a cloze card, then an occlusion image, then
  a basic card, all before naming the brick and hitting the single
  "Create brick" button. A live counter near that button shows how
  many cards are staged across all three tabs combined.

## Editor behavior

- **Cloze `[[ ]]` toolbar button.** No selection: inserts an empty
  `[[]]` pair with the cursor sitting between them, ready to type. A
  real text selection: wraps exactly that text in brackets and keeps
  it selected — same behavior the existing B/I/U/H buttons already
  have, just with an asymmetric open/close pair instead of a single
  shared marker. Fixed a real bug found while building this: none of
  the Cloze pane's toolbar buttons refreshed the live preview after
  use — `wrapSelection`/`wrapSelectionPair` set `.value` directly,
  which doesn't fire a native `input` event, so the preview quietly
  went stale after every click. Now explicit.
- **Hint field auto-focuses after drawing.** Finish dragging out a
  rectangle or ellipse and the cursor jumps straight into that shape's
  hint field in the list below — a PowerPoint-style "just placed a text
  box, start typing" flow, without the added complexity/fragility of
  making the canvas shape itself directly editable in place.
- **A second finger cancels a draw in progress, cleanly.** The drawing
  stage disables native touch gestures (`touch-action:none`) so a
  single finger never fights the browser's own pan while
  drawing/moving/resizing a shape. If a second finger lands mid-gesture
  — say it rests near the image while you're drawing — the
  single-finger action is cancelled outright rather than left
  half-finished. An earlier version also tried to manually reimplement
  two-finger scrolling on top of this (computing scroll deltas from the
  two fingers' average movement), but that fought the browser's own
  native touch/scroll handling whenever the second finger didn't land
  precisely on the stage, causing a visible flicker. Removed for good
  rather than patched — while actively touching the stage, scrolling
  just isn't available, the same unsurprising limitation most
  drawing/annotation surfaces have; lift your finger and scroll from
  anywhere else on the page.

## Settings

Gear icon in the top bar.

- **Import / Export.** Export opens a picker showing every Wall and
  Brick with checkboxes — check individual Bricks, or check a whole
  Wall to cascade-select everything inside it (folder checkboxes go
  indeterminate when only some of their contents are selected, so a
  partial pick is visible at a glance). Everything's checked by
  default, so exporting "the entire thing" is just leaving it alone
  and hitting Download. The exported `.json` only embeds images that
  the selected Bricks actually reference, not your whole image
  library. Import merges a `.json` back in under whichever Wall you
  currently have open, with every node and card given a **fresh id** —
  re-importing the same file twice, or importing into the same account
  it came from, can never collide with or silently overwrite anything.
  See "Import file format" below if you want to hand-author files
  externally rather than only ever round-tripping Brick's own exports.
- **Data Safety.** Read this section if you care about not losing your
  library — the short version: **Export is the only real backup**,
  everything else here is a same-browser safety net for accidents, not
  a substitute for it.
  - **Automatic rolling backups.** Every save snapshots the *previous*
    on-disk state first (time-gated to once per 5 minutes, so it
    doesn't fire on every keystroke) — up to 5 kept at a time, oldest
    dropped as new ones come in. Restorable manually from
    Settings → Data Safety, or used automatically if the primary data
    turns out to be unreadable.
  - **Corrupted data is never silently discarded.** Before this
    existed, if the saved tree was ever unreadable for any reason, the
    app would silently reset to the demo content with zero warning —
    a real bug, not hypothetical, found and fixed while building this.
    Now: on load, if the primary data won't parse or doesn't have the
    right shape, it automatically recovers from the most recent valid
    backup and shows an unmissable notice explaining exactly what
    happened and when the backup was taken (not dismissable via
    Escape). If there's no usable backup either, it says so plainly
    instead of pretending nothing went wrong — and the original
    unreadable data is kept in a separate key rather than being
    thrown away outright, in case something is still recoverable from
    it by hand.
  - **A failed save is loud, not silent.** Also a real, found-and-fixed
    bug: saves were failing silently on storage-full and similar
    errors, so someone could keep working for a while genuinely
    believing everything was saved. Now a failed save opens a
    mandatory (non-Escape-dismissable) warning immediately, with a
    direct path to export a backup on the spot. It only interrupts
    once per session, not on every subsequent failure, so a run of bad
    luck doesn't turn into an unusable wall of modals.
  - **What this can't protect against:** the browser's storage being
    cleared entirely — by the person, by the OS, by uninstalling the
    browser, by switching devices. No in-browser safety net can help
    with that; only an exported `.json` file living somewhere else
    can. Export periodically, especially before anything that touches
    browser storage broadly (clearing cache, OS updates, etc.).
- **Recycle Bin.** Deleting a Wall or Brick (kebab menu or the Delete
  hotkey) no longer destroys it outright — it moves to the bin, full
  contents intact, listed with Restore and Delete Forever per item,
  plus an Empty Recycle Bin button. Restore puts it back where it came
  from, or at the top level if that Wall no longer exists.
- **Companion Extension.** A browser extension, not the in-page File
  System Access version below — `chrome.downloads` permission is
  granted once at install and doesn't have the periodic
  re-confirmation FSA applies to a directory handle. Loaded unpacked
  via Developer Mode, not published — this is a personal tool. Lives
  in `js/extension-bridge.js` (Brick's side — `window.__brickBridge`,
  a small, explicitly versioned API: `isReady()`, `getTreeSummary()`,
  `getMirrorPlan()`) plus a separate `brick-extension/` project (not
  part of this app's own deploy) containing the actual extension:
  - `background-core.js` — the real sync decision logic (which tab,
    dirty-check, retry/failure handling), deliberately written against
    a plain `api` object instead of calling `chrome.*` directly, so
    it's fully testable under plain Node — `node
    test/background-core.test.js`, no browser needed. Covers the worst
    cases (no tab open, the bridge missing or not ready yet, a version
    mismatch attempted anyway rather than refused outright, one file
    failing without aborting the rest of the batch, the fingerprint
    deliberately NOT persisted after a partial failure so a real
    pending change can't get wrongly skipped next time, overlapping
    syncs refused rather than left to race), real sync-with-Trash
    behavior matching the in-page version — a removed file gets its
    content downloaded fresh to `Trash/` (there's no "move" in this
    API, only download-new + `chrome.downloads.removeFile()` on the
    original — which is why the full content of every synced file,
    not just its path, has to be persisted between runs, not only the
    path list) — and true per-file reconciliation: a genuinely
    unchanged file makes zero download() calls (confirmed at the
    actual call level), verified inside one sync where one file is
    unchanged, one updated, and one brand new all at once, each
    getting its own independent, correct decision rather than one
    verdict for the whole batch. 40 assertions total.
    Also worth noting honestly: writing these tests surfaced a real,
    separate bug in the test *harness* itself — an earlier test's mock
    silently hung on an unresolved promise partway through, which
    doesn't crash a Node script, it just leaves the async test runner
    permanently suspended while the process still exits with code 0
    the moment nothing else is scheduled — indistinguishable from
    success unless you notice assertions are quietly missing from the
    output. Fixed the specific test, and added a watchdog timeout to
    both this suite and Brick's own that turns any future version of
    that same mistake into a loud, unambiguous failure instead.
    Also found and fixed a second real bug while adding per-file
    comparison: every Brick export carries a fresh `exportedAt:
    Date.now()`, so two exports of the exact same unchanged content
    produced different JSON strings purely from when each happened to
    run — meaning "unchanged" could never actually be detected until
    that one volatile field was normalized out before comparing.
  - `background.js` — wires that logic to real `chrome.*` calls:
    `chrome.scripting.executeScript(..., { world: 'MAIN' })` to read
    `window.__brickBridge` directly from the Brick tab (content
    scripts run in an isolated JS world and can't see page globals —
    this sidesteps that without a persistent injected script or a
    postMessage relay), `chrome.downloads.download()` with a `data:`
    URL to actually write each file, `chrome.alarms` for the timer
    (survives service-worker restarts, unlike a plain `setInterval`
    would in Manifest V3).
  - `close-signal.js` — a persistent content script (everything else
    is on-demand injection) whose only job is telling the background
    "this tab might be closing" via `visibilitychange`/`pagehide`, as
    early as realistically possible. This is what makes closing the
    *whole browser* — not just the Brick tab — trigger a sync, even
    when Brick is sitting in a background tab at the time, since every
    open tab runs its normal hide/unload lifecycle during shutdown,
    not only the focused one. Genuinely best-effort, not a guarantee —
    once a tab is truly gone, there's nothing left to inject into, so
    it's a real race against page teardown, and that's said plainly in
    the extension's own README rather than implied to be more reliable
    than it is. Also said plainly: this one piece isn't unit-tested —
    there's no real decision logic to extract (two DOM events firing
    one fixed message), and the part that actually matters (does the
    background receive it before the page dies) is real browser
    page-lifecycle behavior no test harness here can simulate.
  - The Settings screen's "Download Companion Extension" button
    downloads the real thing now — points at
    `downloads/brick-companion-extension.zip` inside this project;
    dropping a newer version there is a file swap, no code change.
  - **Whether the Linked Backup Folder section below stays now that
    the extension is real hasn't been decided** — noted here
    explicitly rather than assumed either way.
- **Linked Backup Folder.** The closest thing to a real answer to
  "what if I just forget to export" — a genuine, live, on-disk mirror
  of the whole Wall/Brick tree, kept in sync automatically. Desktop
  Chrome/Edge/Opera only (the File System Access API this needs
  doesn't exist in Firefox, Safari, or on any mobile browser — the
  section hides itself with a plain explanation on unsupported
  browsers rather than showing broken controls).
  - **One real folder per Wall, one real `.json` file per Brick** —
    not a single giant export blob. Each file is a complete,
    self-contained single-Brick export on its own (same shape
    `buildExportBundle()` already produces for a normal selective
    export), so any one of them can be individually re-imported later
    without this feature being involved at all — verified directly: a
    mirrored file, fed straight back into the real import path in
    testing, imports correctly on its own.
  - **Syncs on a timer (every 5 minutes) AND on `pagehide`/tab-hide** —
    deliberately both, not one or the other: a timer alone misses "the
    tab got closed a minute after the last sync"; close-events alone
    miss "left it open for hours, then the browser crashed before ever
    formally closing". A cheap dirty-check (compare against the tree
    state at the last successful sync) means firing often costs
    nothing when nothing's actually changed — confirmed directly: a
    forced re-sync with no real change makes zero writes.
  - **Same-named Bricks in the same Wall get disambiguated** (`Name
    (2).json`) rather than one silently overwriting the other.
  - **Real sync, with a Trash — not silent accumulation.** Deleting a
    Brick in the app moves its mirrored file into a flat `Trash/`
    folder at the backup root, rather than either leaving it stale
    where it was or actually discarding it. Each trashed file's name
    is its original path folded flat plus a deletion timestamp, so
    deleting → recreating → deleting the same name again can never
    silently overwrite an earlier trashed copy — verified directly:
    doing exactly that leaves both trashed copies sitting side by
    side, each holding its own distinct original content. Mirrors the
    app's own Recycle Bin — gone from where it was, fully recoverable
    until you go and empty `Trash/` yourself.
  - Re-granting permission (if the browser ever revokes it, e.g. after
    being closed a while) requires an actual click — browsers require
    a real user gesture for that, so it can never happen silently, no
    matter how automatic the rest of the sync is. A "Reconnect" button
    appears in place of the normal controls when this is needed.

## Import file format

The whole bundle is one JSON object with two top-level keys —
`version` and `exportedAt` are read on export but not actually checked
on import, so they're optional if you're hand-authoring a file
(`validateBundle()` only requires `tree` and `images` to be present
and shaped correctly). Everything below is taken directly from the
real implementation (`js/import-export.js`), not paraphrased.

**Every field is now validated and sanitized on the way in — this
wasn't always true.** An audit found a real, working HTML-injection
bug: a mask's `x`/`y`/`w`/`h` coordinates were concatenated raw into a
`style="left:...%"` attribute string with no type-checking. A
non-numeric value like `0%;"><img src=x onerror="...">` genuinely
broke out of the attribute and executed — confirmed by direct
reproduction, not theoretical. Fixed two ways: `study.js` now coerces
every coordinate through a `safePct()` helper before it ever reaches a
template string (defense at the point of use), and `importBundle()`
now runs every incoming node through a real sanitizer — bad numbers
coerce to safe values, unrecognized card `type`s get dropped instead
of silently corrupting a card, occlusion cards with no valid masks get
dropped entirely, a bogus `activeMaskId` falls back to the first real
mask, missing/`null` names get sensible fallbacks — before anything
reaches the saved tree, not just at render time. So: hand-authoring a
file that doesn't perfectly match the shapes below won't corrupt your
library or execute anything; it'll just get cleaned up or dropped.

```json
{
  "version": 1,
  "exportedAt": 1735689600000,
  "tree": {
    "type": "folder",
    "name": "Brick Export",
    "children": [ /* Wall and/or Brick nodes, see shapes below */ ]
  },
  "images": {
    "<hash>": {
      "dataUrl": "data:image/png;base64,....",
      "mimeType": "image/png",
      "w": 600,
      "h": 400
    }
  }
}
```

**Rules that actually matter:**
- The **outer** `tree` object itself must have `"type": "folder"` — this
  is what `validateBundle()` checks. Its own `name`/`id` are ignored on
  import (only `children` gets used); call it whatever you want.
- Every node under `children` needs a **fresh, unique `id` string** —
  Brick's own IDs look like `id_xxxxxxxxxxxxxxxx`, but any unique
  string works; import doesn't validate the format, only that fields
  exist where expected. **Don't reuse an id from your existing tree** —
  import doesn't currently deduplicate incoming ids against what's
  already there the way Duplicate does for its own internal clones.
- Every image a Brick card references via `imgHash` **must have a
  matching entry in `images`** — import stores every image in `images`
  into IndexedDB *before* touching the tree, specifically so a card
  can never end up pointing at a hash that doesn't exist yet. An
  occlusion card with an `imgHash` that isn't in `images` will import
  without crashing, but the study screen will show a broken/empty
  image for it.
- `dataUrl` must be a real `data:` URI (`data:<mimeType>;base64,...`).
  SVG works fine (`data:image/svg+xml;base64,...`), same as the
  built-in demo image.

**Wall (folder) node:**
```json
{ "type": "folder", "name": "My Wall", "children": [ /* nested Wall/Brick nodes */ ] }
```

**Brick (deck) node:**
```json
{
  "type": "deck",
  "name": "My Brick",
  "createdAt": 1735689600000,
  "cards": [ /* card objects, see the three shapes below — can mix types freely in one deck */ ]
}
```
`createdAt` is a plain epoch-ms number; not read for anything besides
display, so it's safe to omit or leave stale.

**Occlusion card:**
```json
{
  "type": "occlusion",
  "imgHash": "a-hash-key-matching-one-in-images",
  "imgW": 600,
  "imgH": 400,
  "mode": "hide-all",
  "activeMaskId": "mask-1",
  "header": "",
  "backExtra": "",
  "timeouts": 0,
  "tough": false,
  "masks": [
    { "id": "mask-1", "shape": "rect", "x": 20, "y": 15, "w": 18, "h": 10, "label": "Nucleus", "hint": "" },
    { "id": "mask-2", "shape": "ellipse", "x": 45, "y": 30, "w": 12, "h": 12, "label": "Nucleolus", "hint": "" }
  ]
}
```
- `mode` is `"hide-all"` (every mask hidden until reveal, this card
  tests `activeMaskId` specifically) or `"hide-one"` (only
  `activeMaskId` is ever hidden, the rest already show their labels).
- **All the Brick's masks live once on `masks`, shared across every
  card generated from that image** — a real image with 5 labeled
  regions typically produces 5 occlusion cards, each with the *same*
  `masks` array but a *different* `activeMaskId` picking out which one
  that particular card tests. Duplicating the full `masks` array per
  card (rather than trying to dedupe it) is what the real export
  format does, so match that if hand-authoring.
- `activeMaskId` must match the `id` of one of the entries in `masks`
  for the card to make sense — it isn't validated on import, but a
  study session for a card whose `activeMaskId` doesn't resolve to a
  real mask won't have anything sensible to highlight or test.
- `shape` is `"rect"` or `"ellipse"`. `x`/`y`/`w`/`h` are all
  **percentages of the image (0–100), not pixels** — `x`/`y` is the
  top-left corner, `w`/`h` the size.
- `hint` is optional, shown on request while a mask is still hidden;
  leave it `""` if you don't want one.

**Basic card:**
```json
{ "type": "basic", "front": "What is the capital of France?", "back": "Paris", "timeouts": 0, "tough": false }
```
`front`/`back` support the same inline markdown-ish formatting the
editor's B/I/U/H buttons produce: `**bold**`, `*italic*`, `__underline__`,
`==highlight==`.

**Cloze card:**
```json
{ "type": "cloze", "text": "The [[median]] nerve is compressed in carpal tunnel syndrome.", "timeouts": 0, "tough": false }
```
Exactly one field, `text`, with the hidden term wrapped in
`[[double brackets]]` — same syntax the editor's own `[[ ]]` button
produces. Only ever wrap one term per card; the parser blanks whatever
sits inside the first bracket pair it finds.

**Fields every card type shares**, all optional on import (default to
sensible values if omitted): `id` (gets replaced with a fresh one
regardless, per the note above), `timeouts` (integer, defaults
effectively to 0), `tough` (boolean, defaults to false). None of these
affect anything on first import — they only matter after actual study
sessions start writing to the separate review log.

- **Image Hosting (ImgBB).** Off by default — see the Database section
  above for what turning it on actually means and the tradeoff involved.
  Adding a key for the first time triggers a **mandatory batch backup**
  of every image you already have locally that's never been uploaded —
  a non-dismissable progress modal (no Escape, no click-away) walks
  through them in small batches with real pauses between each one.
  ImgBB doesn't publish any official numeric rate limit — not requests
  per minute, not per hour, nothing — so rather than guess at a real
  ceiling, the defaults are deliberately conservative: 5 images per
  batch, a 2-second pause between images within a batch, a full
  60-second pause between batches, and up to 2 retries per image
  (respecting a `Retry-After` header if the server sends one) before
  giving up on that one and moving on. A small badge on the Settings
  icon in the topbar surfaces when there are unbacked images and no key
  is set yet, without nagging via a popup. Anything that fails after
  retries stays visible in the status text and can be retried later
  with an explicit "Retry pending backups" button — re-saving an
  already-set key does *not* re-trigger the mandatory modal on its own,
  since that would mean getting blocked by it on every single visit to
  Settings if one image is persistently failing.

## Deploy

### First commit

```bash
git init
git add .
git commit -m "Initial commit: Brick — image occlusion cramming app"
```

### Push to GitHub

```bash
git remote add origin https://github.com/<your-username>/brick.git
git branch -M main
git push -u origin main
```

### Deploy to Vercel

Either connect the GitHub repo in the Vercel dashboard (Import Project
→ it auto-detects this as a static site, no config needed beyond the
included `vercel.json`), or via the CLI:

```bash
npm i -g vercel
vercel
```

## What's deliberately scoped out vs. real Anki

Anki's Image Occlusion editor also has a **Polygon** tool, a **Text**
tool, per-shape color, and shape grouping (drag-select multiple shapes
at once). None of that is here — Select, Rectangle, and Ellipse cover
the large majority of real occlusion use (labeled diagrams, histology
regions, gross-specimen structures), and cutting the rest kept the
pointer-event state machine (draw / select / move / resize) small
enough to actually get right and cover with tests, rather than
exhaustive and buggy. Polygon in particular is a meaningfully bigger
feature (arbitrary point count, insert/delete vertices) — worth adding
later as its own scoped piece of work, not bolted on here.

Also not here yet, inherited from earlier design decisions in this
project:

- **No cloud sync.** Everything lives in this browser's localStorage/
  IndexedDB only. Kardex's image pipeline (which this reuses the
  *shape* of — hash-dedup, compress-then-store) also mirrors to ImgBB
  via a Vercel serverless relay; that layer isn't wired up here since
  there's no multi-device requirement stated yet. Adding it back would
  mean an `api/upload-image.js` function plus an `imageUrlMap` synced
  alongside the tree, same pattern as Kardex.
- **Not true FSRS.** `scheduler.js` is SM-2-shaped (ease/interval/reps
  from a review log), same as Kardex. Flagging this every time it's
  relevant since the "FSRS" name has come up before in this project's
  history without the app underneath actually being FSRS.
- **No trash/undo.** Delete is immediate (after a confirm prompt).
