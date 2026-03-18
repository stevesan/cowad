CoWad stands for *Co*llaborative *WAD* editor. The goal is to be an in-browser DOOM level editor where multiple people can work on the same level in real-time, like Google Docs.

So far, it is 100% vibe-coded with Claude Code and Opus 4.6. I'm doing this as a fun side-project to explore the limits of vibe coding.

I'm releasing this as GPL because I assume much of the training data that makes this possible was from exisiting DOOM level editors, such as [Ultimate Doom Builder](https://github.com/UltimateDoomBuilder/UltimateDoomBuilder) and [Eureka](https://github.com/ioan-chera/eureka-editor), which are GPL. I'm not a lawyer, but to me that makes this project a "derived work", and thus I think it's right to make this GPL as well.

## Setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and fill in your Firebase project values
3. Start the dev server: `npm run dev`

## Playtesting with the Launcher

A local launcher server lets you playtest your map directly from the editor with one click.

1. Start the launcher (first run will prompt for configuration):
   ```
   node launcher/server.js
   ```
   It will ask for:
   - Path to your DOOM source port executable (e.g. GZDoom)
   - Path to your DOOM 1 IWAD (`doom.wad`)
   - Path to your DOOM 2 IWAD (`doom2.wad`)

   These paths are saved to `launcher/config.json`. Run with `--config` to reconfigure.

2. Click the **Play** button in the editor toolbar. The launcher will:
   - Build and receive the WAD from the editor
   - Detect whether it's a DOOM 1 or DOOM 2 map (based on map lump names)
   - Launch your source port with the correct IWAD
