# Brick

Image-occlusion cramming app, plus Basic and Cloze card types. Local-only
(localStorage + IndexedDB) — no backend, no build step, deploys as a
plain static site.

Wall/Brick file manager (borrowed from Kardex's folder/deck tree shape)
plus a card editor with three tabs:

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
css/
  tokens.css                 colors, shadows, texture, focus ring
  components.css              brick buttons, modals, tile menu, shared
                               text-formatting classes (.highlight,
                               .cloze-blank, .cloze-answer)
  layout.css                  app shell, top bar, tile grid
  preview.css                  brick preview screen
  occlusion-editor.css        toolbar, shapes, resize handles
  card-types.css               card-type tabs, format toolbar, staged
                               card list, cloze live preview
  study.css                   study screen, timer bar, text-mode card
js/
  storage.js                  IndexedDB image store (hash-deduped) + localStorage tree/log
  scheduler.js                 SM-2-style spaced repetition
  text-format.js               bold/italic/underline/highlight + cloze
                               front/back parsing — shared by the editor
                               preview and study rendering
  tree.js                      Wall/Brick CRUD, kebab menu, drag-drop, search, keyboard nav
  occlusion-editor.js         the shape editor (Occlusion tab only)
  basic-cloze.js                Basic/Cloze tabs — staging + generation
  study.js                     preview + study/review loop, all 3 card types
  app.js                       shared shell helpers + boot (loaded LAST)
test/
  smoketest.js                 headless integration test — see below
vercel.json                    static hosting config
package.json                    dev-only test deps + scripts
```

Each file is scoped to one concern on purpose — if you need to change
how shapes resize, that's entirely inside `occlusion-editor.js`; if you
need to change how Basic cards stage, that's entirely inside
`basic-cloze.js`; neither touches the other. Files are loaded as plain
`<script>` tags (no bundler, no build step), so **script order in
`index.html` matters**: `storage.js`, `scheduler.js`, `text-format.js`
first (no dependencies on the others), then `tree.js` /
`occlusion-editor.js` / `basic-cloze.js` / `study.js` (depend on those
three), then `app.js` last (calls the `init...()` function each of the
other files exports).

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
real `index.html` and all eight real `js/*.js` files — via actual
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
border, and confirm mixing Cloze/Basic/Occlusion cards into one brick
across tab switches — nothing finalizes early. 120+ assertions, all
currently passing.

## Database / environment variables

**None needed right now.** Everything lives in the browser's own
localStorage and IndexedDB — there's no Supabase, no serverless
function, no API key of any kind in this build. You can deploy this to
Vercel exactly as-is with zero environment variables set.

If you later want cross-device cloud sync (so a brick made on your
laptop shows up on your phone), that's a real addition, not a flag to
flip — it would mean wiring up Supabase (SUPABASE_URL,
SUPABASE_ANON_KEY as env vars) for the tree/review-log data, plus an
api/upload-image.js serverless relay to ImgBB (IMGBB_API_KEY) for
the images, same pattern Kardex already uses. Say the word and I'll
build that as its own piece of work.

## Study session behavior

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
- **Hints, occlusion cards only.** Each drawn shape can carry an
  optional hint, separate from its label (the label is the answer,
  shown only on reveal; the hint is a clue, shown on request while
  still hidden). Press the Hints button or hit `H` to reveal it,
  overlaid directly on the occluded region in high-contrast white-on-
  dark so it stays readable regardless of the hatch pattern underneath.
  The hint only ever applies to the ONE shape the card is actually
  testing — in Hide All mode every shape looks hidden identically, but
  Hints won't leak clues for shapes the card isn't asking about.
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

- **Hint field auto-focuses after drawing.** Finish dragging out a
  rectangle or ellipse and the cursor jumps straight into that shape's
  hint field in the list below — a PowerPoint-style "just placed a text
  box, start typing" flow, without the added complexity/fragility of
  making the canvas shape itself directly editable in place.

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
