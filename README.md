# World Model Experiment

Gaze-driven story panel in a 3D/VR view. Each story section can be backed by a **World Labs Marble** generated world (Gaussian splat). Until worlds are generated, procedural ocean/desert backgrounds are used.

## Run

```bash
cp .env.example .env
# put your key in .env → WLT_API_KEY=wlt_...
npm install
npm run dev
```

Open `http://127.0.0.1:5174/`.

## How World Labs maps to the story

| Story section | Scene id | What happens |
|---------------|----------|--------------|
| **I. The Storm** | `ocean` | API generates a stormy-ocean Marble world from the text prompt in `src/worldlabs/prompts.js` |
| **II. The Desert** | `desert` | API generates a desert Marble world from its prompt |

Flow:

1. **Generate** — `POST /marble/v1/worlds:generate` with that section’s text prompt  
2. **Poll** — wait until the operation is `done` (~5 min, uses credits)  
3. **Store** — save `world_id`, SPZ URL, thumbnail, semantics into `localStorage` (+ optional `worlds-cache.json`)  
4. **Show** — when gaze hits that section, load/show the SPZ with **SparkJS** instead of the procedural mesh background  

Gaze still switches sections the same way; only the *background world* changes source.

## Generate & store

1. Get an API key: [platform.worldlabs.ai/api-keys](https://platform.worldlabs.ai/api-keys) (needs [API credits](https://platform.worldlabs.ai/billing))
2. Either:
   - put `WLT_API_KEY=wlt_...` in `.env` and restart Vite, **or**
   - paste the key in the HUD field (session only)
3. Click **Generate worlds** (runs both sections sequentially)
4. Click **Save cache** to download `worlds-cache.json` — drop it in `public/` so reloads skip regeneration

The Vite proxy forwards `/api/worldlabs/*` → `https://api.worldlabs.ai/marble/v1/*` and injects your key so it is not hardcoded in client bundles.

## VR / IWER

Desktop VR uses Meta’s IWER + DevUI (Quest Pro profile with gaze).

1. **ENTER VR**
2. Left-click to look, WASD to move, aim the orange reticle at a story section

## Desktop controls

- Drag empty space to orbit; scroll zoom; right-drag pan
- **Mouse as eye**: hover Storm / Desert to switch worlds
