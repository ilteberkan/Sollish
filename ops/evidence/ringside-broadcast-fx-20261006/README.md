# Combat Club broadcast layer, 6 Oct 2026 (local dev server, not deployed)

- Source: `apps/web/components/boxing-broadcast-fx.ts`, wiring in `boxing-sparring-scene.tsx`, rim lights in `boxing-arena.ts`. Presentation only; `?fx=0` disables it, `?cast=classic` restores the old cast.
- Replay: knockdowns and stoppages replay stored, already simulated states (60 ticks before to 80 after the blow, 0.45x), with two camera angles, letterbox and a badge. It stops as soon as the bout resumes.
- Frame time, headless Chromium with ANGLE/Metal on an M2, 1280x720, 15 s of bout (seed 7): p50 16.7 ms and p95 16.8 ms with the effects, the same without them. Adaptive quality stayed "high".
- Checks: `ringside-sparring.spec.ts` 10/10 against `next dev` on :3000; web unit 92/92; typecheck clean. Not run against the OpenNext production build or a physical phone.
- Frames: `replay-sheet.jpg` (four replay frames), `fx-call-0.jpg` (counter call-out), `fx-live.jpg`.
