# cli-dispatch demo video

Source of `videos/demo-{en,tr}.mp4` and `assets/demo{,-tr}.gif`, built with [Remotion](https://www.remotion.dev).
Every terminal line in the video is real output, captured in the `sandbox-harness` container.

1. Capture (inside the container, as the user with the CLIs logged in): `bash ../capture.sh` —
   writes `/tmp/cap/*.cmd` / `*.out`. Copy that folder out (`docker cp sandbox-harness:/tmp/cap .`).
2. Build the data file (see the Turkish note below for the second folder) → `src/captures.ts`.
3. Preview: `npm i && npx remotion studio` (compositions `Demo` = English, `DemoTr` = Turkish).
4. Render both languages: `./render.sh` → `videos/demo-en.mp4`, `videos/demo-tr.mp4`,
   `assets/demo.gif` and `assets/demo-tr.gif`.

The Turkish video re-uses every capture except the two scenes where a person types a prompt
(`ask` and delegating by asking Claude); those come from `../capture-tr.sh`, run the same way.
Step 2 then takes both folders: `python3 ../gen-captures.py <cap-dir> <cap-tr-dir>`.

If your default npm registry is private, run npm with `npm_config_registry=https://registry.npmjs.org/`.
