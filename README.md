# Recipe Cards

A personal cook-mode web app. It imports recipes that the `recipe-cards` Claude agent has already turned into step cards, then walks you through them one card at a time, with a timer ready on any step that needs one.

- **No backend.** Recipes and your place in a recipe stay on each device, in IndexedDB.
- **Works offline.** It's an installable PWA, hosted free on GitHub Pages.
- **Never fetches recipe sites, calls an AI or holds an API key.** All the conversion happens in the agent.

Live at **https://ngerver1.github.io/Recipe/** once it's set up (below).

## Getting a recipe in

1. Give Claude a recipe link. The `recipe-cards` skill replies with JSON.
2. Copy the reply. Extra text around the JSON is fine.
3. In the app, tap **Import → Paste**. On the iPad, tap the **Paste** bubble that Safari shows.
4. Check the preview, then tap **Save** or **Cook now**.

The importer also accepts:

- a `.json` file (**Open file**, or drag and drop on a computer);
- JSON inside a ```` ```json ```` fence;
- several recipes at once (an array, or several fenced blocks);
- a backup file.

It refuses a recipe only when it's unusable: no title, no steps, a step without text, or a newer format version. Anything else imports with a plain-English warning, such as “Step s4 uses 'basl', which isn't in the ingredient list.”

## Setting it up (one time)

You need to do these yourself, in order.

### 1. Turn on GitHub Pages

1. Open https://github.com/ngerver1/Recipe/settings/pages.
2. Under **Build and deployment → Source**, choose **GitHub Actions**. There's nothing else to fill in.

### 2. Put the app on `main`

The app is built on the branch `claude/recipe-cards-build-spec-6vojo2`. Pages publishes from `main` only.

1. Open a pull request from that branch into `main`.
2. Merge it.

### 3. Wait for it to publish

1. Open the **Actions** tab.
2. Wait for the **Test and deploy** run on `main` to go green. It takes about a minute.
3. The app is then at https://ngerver1.github.io/Recipe/.

If the run went red because Pages wasn't turned on yet, do step 1, then open the failed run and choose **Re-run all jobs**.

### 4. Install it on the iPad

1. Open https://ngerver1.github.io/Recipe/ in **Safari**. It has to be Safari: other browsers on iPad can't add web apps to the Home Screen.
2. Tap **Share** (the square with an arrow, top right), then **Add to Home Screen**.
3. If you see **Open as Web App**, leave it on. Tap **Add**.
4. Open **Recipes** from the Home Screen and import your recipes **there**.

The Home Screen app keeps its own storage, separate from Safari tabs. Recipes imported in a Safari tab won't show up in the Home Screen app, and the other way round.

### 5. Install it on the Pixel

1. Open https://ngerver1.github.io/Recipe/ in **Chrome**.
2. Tap **⋮ → Add to Home screen → Install**. Chrome may also offer an **Install app** banner.
3. Open **Recipes** from the Home screen or the app drawer.

### 6. Check sound and the screen on each device

1. Open **Settings → Test the chime**. You should hear a two-tone chime, and the Pixel should vibrate.
2. Open the iPad's **Settings → Display & Brightness → Auto-Lock** and set it to **2 minutes** for this test.
3. Start cooking any recipe and leave the iPad alone for 3 minutes.
4. Check the screen stayed on:
   - **If it did:** you're done. **Settings → Keep the screen on** shows *Screen Wake Lock*.
   - **If it dimmed:** set **Settings → Keep the screen on** to **Video fallback** and try again.

### 7. Keep a backup

Recipes live only on each device, and Safari can clear website data that hasn't been used for a while.

1. Every so often, open **Settings → Backup**.
   - **iPad:** tap **Share backup…** and choose **Save to Files**.
   - **Pixel:** tap **Download backup**.
2. To restore, or to copy your recipes to the other device, tap **Restore from backup** and pick that file. Restoring never deletes anything.

## Cooking

**Before you start** shows the recipe with tick-boxes for gathering ingredients. **Start cooking** also switches sound on: iPad Safari needs a tap before it will play anything.

**Cook mode layout:**

- **Landscape:** three cards in a row. Previous step (dimmed), current step (large), next step.
- **Portrait:** the previous and next steps collapse to single lines above and below the current one.

**Moving through the steps:**

- **Done** marks the step finished and moves on.
- **Undo** shows for 5 seconds after each Done.
- Tap the previous or next card to move without changing anything. Swiping works too.
- **Steps** lists every step. Tap one to jump there, or tick it.
- **Ingredients** shows the full list with ticks.

**Timers:**

- A step with a timer shows it ready to start. Adjust it with **−1 min** and **+1 min**, or tap the time to type minutes (`7`, `7.5` or `7:30`).
- Running timers sit in the tray under the header, with pause, **+1 min** and cancel.
- **+ Timer** adds a quick timer that isn't tied to a step.
- Several timers can run at once, and Done doesn't stop them.

**When a timer ends:**

- A full-width banner shows (“Rice is done”) and the chime repeats until you tap **Stop** or **+1 min**.
- The sound stops after 2 minutes, but the banner keeps flashing.
- The Pixel vibrates.

**Background and sleep:**

- Timers work from saved end times, so they stay right through sleep, reloads and switching apps.
- A web app can't ring reliably in the background. When you come back, anything that finished meanwhile rings and says how long ago.
- The screen is kept on in Before you start, in cook mode and whenever a timer is running, which covers the background problem.

**Leaving and coming back:**

- Your place and timers are saved continuously, so closing the app resumes exactly where you were.
- **Exit** returns to the Library, which shows a **Resume cooking** banner.

**Updates:** a new version of the app never reloads itself mid-cook. The Library shows **Update now** when one is ready.

## The import format

The agent writes the format and the app reads it. It's version 1, described by:

- `src/core/schema.ts`: the single source of truth, a zod schema. It drives validation and the TypeScript types.
- `public/recipe-cards.v1.schema.json`: generated from the zod schema with `npm run schema`, and published at https://ngerver1.github.io/Recipe/recipe-cards.v1.schema.json. CI fails if it falls out of date.
- `examples/`: example recipes, also used as test fixtures:
  - `green-curry.json`: the example from the spec.
  - `pressure-cooker-beef-stew.json`: the sample recipe offered in an empty Library.
  - `sunday-roast.json`: sections, overlapping background timers, timer ranges, and ingredients without quantities.
  - `overnight-loaf.json`: a yield instead of servings, timers measured in hours, steps without `uses`, and unknown fields.

Quantities arrive already metric and are shown as given. The only change is tidier display:

| Stored as | Shown as |
| --- | --- |
| 0.5 tsp | ½ tsp |
| 1500 g | 1.5 kg |
| 2000 ml | 2 L |
| no quantity | the name only |

## Development

```sh
npm install
npm run dev        # http://localhost:5173/Recipe/
npm test           # unit tests for the core
npm run build      # type-check and build to dist/
npm run schema     # regenerate public/recipe-cards.v1.schema.json after changing schema.ts
```

- **Stack:** TypeScript, React, Vite, `vite-plugin-pwa` (Workbox), zod, `idb` and Vitest.
- **Routing:** hash routes, because GitHub Pages can't serve a single-page app's deep links.
- **Sound:** the chime is made with Web Audio, so there's no sound file.

### Layout

| Folder | What's in it |
| --- | --- |
| `src/core/` | Pure functions with unit tests: parsing and forgiving paste, validation, cook session (Done, Undo, jumping, resuming), timers, quantity formatting, dedupe, search, backup |
| `src/data/` | IndexedDB |
| `src/state/` | The app store: recipes and the cook session, saved on every change |
| `src/platform/` | Wake lock with its video fallback, the chime and vibration, per-device preferences |
| `src/ui/` | Screens and components |

### Ready for later

These aren't in v1, but the data model is ready for them:

- **Servings scaler:** ingredient and `uses` quantities are numeric, so scaling the ingredient list and the “You'll need” chips is a small change. Quantities written inside step text would need the agent to mark them, which means a format change.
- **Voice control:** cook-mode actions are plain functions (`markDone`, `goToStep`, `startStepTimer`), so commands like “done”, “next” and “start timer” can call them.
- **Sync, editing and the Android share target:** none of these need a schema change.
