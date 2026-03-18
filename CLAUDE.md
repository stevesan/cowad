# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CoWad is a collaborative, real-time DOOM level editor that runs in the browser. Multiple users can edit DOOM maps simultaneously (Google Docs-style) via Firebase Realtime Database. It exports standard WAD files playable in DOOM source ports. Licensed under GPL v3.

## Commands

- `npm run dev` — Start Vite dev server (port 5173)
- `npm run build` — Type-check then bundle with Vite
- `npm run typecheck` — TypeScript type-check only (no emit)
- `npm test` — Run Playwright E2E tests (requires dev server; playwright.config.js auto-starts it)

No linter is configured.

## Environment Setup

Copy `.env.example` to `.env` and fill in the 7 Firebase config values (VITE_FIREBASE_*). The app will show an alert if any are missing.

## Architecture

### Data Flow

All map mutations flow through Firebase Realtime Database, which is the source of truth. Local `MapData` (in `src/state/appState.ts`) mirrors Firebase collections via real-time listeners in `src/sync/firebaseSync.ts`. The undo/redo system (`src/history/undoRedo.ts`) records Firebase path snapshots (before/after) and replays them.

### Core Data Model (`src/types.ts`)

The map consists of 5 collections stored as `Map<string, Entity>`: **vertices**, **linedefs**, **sidedefs**, **sectors**, and **things**. This mirrors the DOOM WAD format. Linedefs connect two vertices and reference front/back sidedefs; sidedefs reference a sector. Sectors are defined implicitly by their boundary linedefs (extracted via cycle-finding).

### Key Modules

- **`src/map/mapActions.ts`** — Core editing: `createSectorFromPolygon()`, `splitSector()`, `deleteSelected()`, `splitLinedefAtPoint()`. These are the main mutation functions.
- **`src/geometry/cycleFinder.ts`** — Extracts boundary loops (outer + holes) from a sector's linedefs. Critical for sector operations.
- **`src/geometry/hitTest.ts`** — Spatial queries: nearest vertex/linedef/thing, point-in-polygon, line intersection detection.
- **`src/canvas/renderer.ts`** — Canvas 2D drawing of grid, sectors, linedefs, vertices, things, and preview polygon.
- **`src/canvas/transforms.ts`** — World↔screen coordinate conversion, grid snapping.
- **`src/ui/canvasInput.ts`** — Mouse/keyboard event handling dispatched by active tool mode.
- **`src/export/wadExport.ts`** — Binary WAD file export.
- **`src/config/constants.ts`** — DOOM thing type definitions, colors, grid settings.

### Drawing Tool Workflow

Click places vertices (snapping to grid or existing vertices). A chain of vertices is visualized as a preview. When the chain closes a loop or connects to an existing sector boundary, the system auto-detects whether to create a new sector or split an existing one. Geometry validation prevents improper edge intersections.

### Testing

Playwright E2E tests in `tests/drawing.test.js` use a Firebase mock (`window.__FIREBASE_MOCK__`) that provides an in-memory implementation, allowing tests to run without a real Firebase backend.
