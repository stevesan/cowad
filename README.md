CoWAD stands for **Co**llaborative **WAD** editor. The goal is to be an in-browser DOOM level editor where multiple people can work on the same level in real-time, like Google Docs.

It's mostly AI-coded with Claude Code. I'm releasing this as GPL because I assume much of the training data that makes this possible was from exisiting DOOM level editors, such as [Ultimate Doom Builder](https://github.com/UltimateDoomBuilder/UltimateDoomBuilder) and [Eureka](https://github.com/ioan-chera/eureka-editor), which are GPL. I'm not a lawyer, but to me that makes this project a "derived work", and thus I think it's right to make this GPL as well.

## Development setup

1. Install dependencies: `npm install`
2. Start the dev server: `npm run dev`

## Playtesting with the launcher server

A local launcher server lets you playtest your map directly from the editor with one click.

1. Start the launcher:
   ```
   node launcher/server.js
   ```
   For the first run, it will ask for paths to your source port and IWADs.
   These paths are saved to `launcher/config.json`. Run with `--config` to reconfigure.

2. Click the **Play** button in the editor toolbar. The launcher will:
   - Receive the WAD from the editor
   - Detect whether it's a DOOM 1 or DOOM 2 map (based on map lump names)
   - Launch your source port with the correct IWAD
