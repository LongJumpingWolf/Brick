# Brick

Image-occlusion cramming app. Local-only (localStorage + IndexedDB) —
no backend, no build step, deploys as a plain static site.

Wall/Brick file manager (borrowed from Kardex's folder/deck tree shape)
plus an image occlusion editor deliberately modeled on **Anki's actual
Image Occlusion editor**: Select / Rectangle / Ellipse tools, drag to
draw, drag a shape's body to move it, drag a corner handle to resize
it, "Hide All, Guess One" / "Hide One, Guess One" review modes, and
the same Header / Back Extra fields Anki's IO note type ships with.

## File map

```
index.html                  shell — all screens + overlays live here
css/
  tokens.css                 colors, shadows, texture, focus ring
  components.css              brick buttons, modals, tile menu
  layout.css                  app shell, top bar, tile grid
  preview.css                  brick preview screen
  occlusion-editor.css        toolbar, shapes, resize handles
  study.css                   study screen, timer bar
js/
  storage.js                  IndexedDB image store (hash-deduped) + localStorage tree/log
  scheduler.js                 SM-2-style spaced repetition
  tree.js                      Wall/Brick CRUD, kebab menu, drag-drop, search, keyboard nav
  occlusion-editor.js         the shape editor — the newest/riskiest file, kept isolated
  study.js                     preview + study/review loop
  app.js                       shared shell helpers + boot (loaded LAST)
test/
  smoketest.js                 headless integration test — see below
vercel.json                    static hosting config
package.json                    dev-only test deps + scripts
```

Each file is scoped to one concern on purpose — if you need to change
how shapes resize, that's entirely inside `occlusion-editor.js`, and
nothing else needs to be touched. Files are loaded as plain `<script>`
tags (no bundler, no build step), so **script order in `index.html`
matters**: `storage.js` and `scheduler.js` first (no dependencies),
then `tree.js` / `occlusion-editor.js` / `study.js` (depend on storage
+ scheduler), then `app.js` last (calls the `init...()` function each
of the other files exports).

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
real `index.html` and all six real `js/*.js` files — via actual
`<script>` elements, not `eval()`, so it accurately exercises the same
cross-file scope-sharing the app relies on in a real browser — then
drives the full loop: create a Wall, open the occlusion editor, draw a
rectangle and an ellipse, move and resize a shape via its handles,
generate cards, study them, grade them, and confirm a triple-timeout
auto-tags a card Tough. 53 assertions, all currently passing.

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
