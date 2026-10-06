#!/usr/bin/env bash
# Renders the demo in both languages: videos/demo-{en,tr}.mp4 and assets/demo{,-tr}.gif.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=../../..
mkdir -p out "$ROOT/videos"
# One global GIF palette, with the accent colours forced in so ticks stay green.
ffmpeg -v error -y -f lavfi -i "color=c=0x8cc98f:s=480x540" -f lavfi -i "color=c=0xd97757:s=240x540" \
  -f lavfi -i "color=c=0xe5806f:s=240x540" -filter_complex "[0][1][2]hstack=3" -frames:v 1 out/swatch.png
for lang in en tr; do
  id=Demo; [ "$lang" = tr ] && id=DemoTr
  npx remotion render "$id" "out/demo-$lang.mp4" --codec=h264 --crf=20 --log=error
  ffmpeg -v error -y -i "out/demo-$lang.mp4" -loop 1 -t 6 -i out/swatch.png -filter_complex \
    "[0]fps=10,scale=960:-1:flags=lanczos,setsar=1[v];[1]fps=10,scale=960:540,setsar=1,format=yuv420p[s];[v][s]concat=n=2:v=1,palettegen=max_colors=128:stats_mode=full" "out/pal-$lang.png"
  ffmpeg -v error -y -i "out/demo-$lang.mp4" -i "out/pal-$lang.png" -lavfi \
    "fps=10,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle" "out/demo-$lang.gif"
  cp "out/demo-$lang.mp4" "$ROOT/videos/demo-$lang.mp4"
done
cp out/demo-en.gif "$ROOT/assets/demo.gif"
cp out/demo-tr.gif "$ROOT/assets/demo-tr.gif"
ls -la "$ROOT/videos" "$ROOT/assets"/demo*.gif
