# Sightline

A small isometric puzzle game about perspective. Turn the camera until two far-apart ledges line up on screen, and they become one path.

<p align="center">
  <img src="docs/align.gif" alt="The camera turns until two separate ledges line up, then Pip walks straight across the gap" width="600">
</p>

## How it plays

Pip walks on the tops of blocks. The world is real 3D, but **whatever lines up on screen is walkable**: turn the camera until two tops meet, and Pip can step across, even if they're metres apart in depth.

Every level adds one new idea on top of the last, and nothing tells you what it is. Work it out by looking.

<p align="center">
  <img src="docs/lantern.gif" alt="Pip pushes a gold lantern block off a ledge; it drops onto a pillar drawn below it on screen, then the camera turns and the lantern becomes a bridge to the goal" width="480">
</p>

<p align="center">
  <img src="docs/level03.png" alt="Garden Stairs" width="24%">
  <img src="docs/level07.png" alt="Moon Gate" width="24%">
  <img src="docs/level09.png" alt="Rising Stacks" width="24%">
  <img src="docs/level12.png" alt="Night Lanterns" width="24%">
</p>

13 levels across four small worlds.

## Controls

| Action | Keys |
|---|---|
| Walk | <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> |
| Turn the camera | Hold <kbd>Q</kbd> / <kbd>E</kbd>, or drag with the right mouse button |
| Zoom | Mouse wheel |
| Undo / Restart | <kbd>Z</kbd> / <kbd>R</kbd> |
| Next level (after a win) | <kbd>Space</kbd> or <kbd>Enter</kbd> |
| Pause / Back | <kbd>Esc</kbd> |

Release the camera near one of the snap angles and it settles there. That's when edges line up.

## Run it locally

Needs [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

It's a plain static site, so any static host works. On Vercel, import the repo and keep the defaults (Vite is detected automatically).

## Built with

- [Three.js](https://threejs.org) for the scene, with an orthographic camera at the true isometric pitch.
- [Vite](https://vitejs.dev) for the dev server and build.
- The Web Audio API for all music and sound, synthesised live, with no audio files.

What counts as "lined up" comes from ray-casting each top face toward the camera, checked against a GPU picking pass so the rules match exactly what's drawn.
