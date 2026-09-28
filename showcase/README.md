# Speak: showcase-video

10 sekunder, 1:1 (1080×1080, 30 fps), svensk text. Tre scener: diktering, möte blir text, slut.

- `speak-showcase-1x1.mp4` med musik, `speak-showcase-1x1-utan-ljud.mp4` utan ljud.
- 4K (2160×2160): `speak-showcase-1x1-4k.mp4` och `speak-showcase-1x1-4k-utan-ljud.mp4`. Bygg med `SCALE=2 OUT=frames4k node shoot.js all`.
- Alla namn och företag i videon är påhittade.

## Bygga om

Källan ligger i `src/`. Den behöver `icon-art.js` (från appens `src/main/icon-art.js`), `signature.png` (appens `assets/signature.png`)
och TeX Gyre Heros (`texgyreheros-regular.otf`, `texgyreheros-bold.otf`) i samma mapp. Heros ersätter Helvetica Neue där den saknas.

1. `node build.js` skriver `video.html`, där `render(t)` ritar bilden vid tiden t.
2. `node shoot.js all` tar 300 bilder med Playwright till `frames/`.
3. `python3 music.py` skriver `music.wav` (kräver numpy).
4. ffmpeg: `ffmpeg -framerate 30 -i frames/f%04d.png -i music.wav -c:v libx264 -crf 16 -pix_fmt yuv420p -c:a aac -t 10 speak-showcase-1x1.mp4`

## Bilder

Fem stillbilder i `bilder/`, 4K: tre fyrkantiga (2160×2160) och två liggande (3840×2160). Bygg med `node src/stills.js bilder` (samma filer bredvid som ovan).

## Loopar

Fyra sömlösa loopar i `loopar/`, var och en som MP4 (2160×2160, 25 fps, utan ljud) och GIF (1080×1080, 64 gråtoner):
`lyssnar` (2,4 s), `skriver` (3,2 s), `ljud` (4 s) och `mote` (6,4 s). Bygg med `SCALE=2 node src/loops.js lframes`, sedan ffmpeg per mapp.
