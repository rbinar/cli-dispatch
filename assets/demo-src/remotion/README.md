# cli-dispatch demo video

Source of `assets/demo.gif` and `assets/demo.mp4`, built with [Remotion](https://www.remotion.dev).
Every terminal line in the video is real output, captured in the `sandbox-harness` container.

1. Capture (inside the container, as the user with the CLIs logged in): `bash ../capture.sh` —
   writes `/tmp/cap/*.cmd` / `*.out`. Copy that folder out (`docker cp sandbox-harness:/tmp/cap .`).
2. Build the data file: `python3 ../gen-captures.py <cap-dir>` → `src/captures.ts`.
3. Preview: `npm i && npx remotion studio`.
4. Render:

```bash
npx remotion render Demo out/demo.mp4 --codec=h264 --crf=20
# GIF: one global palette, with the accent colours forced in so ticks stay green
ffmpeg -f lavfi -i "color=c=0x8cc98f:s=480x540" -f lavfi -i "color=c=0xd97757:s=240x540" \
  -f lavfi -i "color=c=0xe5806f:s=240x540" -filter_complex "[0][1][2]hstack=3" -frames:v 1 swatch.png
ffmpeg -i out/demo.mp4 -loop 1 -t 6 -i swatch.png -filter_complex \
  "[0]fps=10,scale=960:-1:flags=lanczos,setsar=1[v];[1]fps=10,scale=960:540,setsar=1,format=yuv420p[s];[v][s]concat=n=2:v=1,palettegen=max_colors=128:stats_mode=full" pal.png
ffmpeg -i out/demo.mp4 -i pal.png -lavfi \
  "fps=10,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle" out/demo.gif
cp out/demo.mp4 out/demo.gif ../../
```

If your default npm registry is private, run npm with `npm_config_registry=https://registry.npmjs.org/`.
