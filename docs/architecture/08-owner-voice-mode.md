# 08 — Owner Voice Mode («اسمع الصفحة»)

> **Decision:** Owner Voice Mode is a **concise domain-summary narrator**, not a
> generic screen scraper and not an AI assistant. It exists so the primary
> user — an older, non-technical owner with weaker eyesight — can press **one
> large button** next to a page heading and hear a short, purposeful Arabic
> summary of *what matters* on that screen, without reading dense screens or
> navigating many pages.

## Why it exists

- The owner should not have to read dense tables or hunt through tabs.
- The owner should not need training: «اسمع الصفحة» → «إيقاف القراءة» →
  «إعادة القراءة», plus a three-option speed (أبطأ / عادي / أسرع).
- Only screens that have a genuinely useful spoken summary get a button.
  Screens with nothing worth saying (login, settings) never show a fake
  control.

## What it is NOT

- **Not a screen scraper.** Summaries are built from structured domain data
  (events, readiness, quotations) via deterministic pure functions in
  `src/features/ownerVoice/screenSummary.ts`. The DOM is never read.
- **Not an AI assistant.** No LLM, no invented sentences, no business data
  sent anywhere. A given input always produces the same Arabic summary.
- **Not a chatbot.** One button, one narration, no conversation loop.
- **Not a replacement for accessibility.** It *supplements* proper
  accessibility (semantic headings, labels, focus, RTL, contrast, large
  typography) — it cannot substitute for it.

## Architecture

```
src/features/ownerVoice/
├── engine.ts             # Browser-native TTS engine (the ONLY speechSynthesis user)
├── useOwnerVoice.ts      # React hook: state, speak/stop/replay/setRate
├── OwnerVoiceButton.tsx  # The one obvious control (null summary ⇒ no button)
├── screenSummary.ts      # Deterministic Arabic builders + number/time/money helpers
└── testDoubles.ts        # Fake SpeechSynthesis for tests (no real audio)
```

Each supported screen passes its own semantic data to a builder and renders
one `<OwnerVoiceButton summary={...} />`:

| Screen | Builder |
| --- | --- |
| Home / owner dashboard | `buildHomeVoiceSummary` |
| Events list | `buildEventsListVoiceSummary` |
| Event workspace (ملخص) | `buildEventVoiceSummary` |
| Event workspace (التسعير) | `buildQuoteVoiceSummary` |

Target narration length is **15–35 seconds**; builders deliberately omit
menus, technical IDs, decorative labels, and unnecessary form controls.

## Privacy boundary

- **No network TTS in V1.** Speech is produced by the browser's native
  `speechSynthesis`; no text leaves the device.
- **No business data is logged** by the voice layer, and summaries never
  include internal notes or supplier-confidential data.
- **No automatic speech.** Nothing speaks on page load or after any state
  change; the owner must explicitly press the button. (There is no reliable
  way to detect a system screen reader, so the safer guarantee is: never
  auto-speak, and never announce the narration via `aria-live` — which would
  double-announce for screen-reader users.)

## Permission behavior

Voice output obeys **exactly the same role permissions as the visual UI**:

- The data passed to the builders comes from the same org-scoped, RLS-gated
  queries the screen already renders (including the operational views that
  strip cost columns for non-cost roles).
- `buildQuoteVoiceSummary` takes an explicit `canReadCost` flag: expected
  cost and profit are **never** spoken when the current role cannot see them
  on screen, even if values were passed to the builder (defense in depth).
- Home and event summaries never include cost/profit at all; the quotation
  summary is the only place commercial figures can appear.

## Fallback behavior

- **No `speechSynthesis` (unsupported browser):** the engine reports
  `supported === false`, the button renders disabled with
  «القراءة الصوتية غير مدعومة», and nothing is spoken. The rest of the app
  is unaffected.
- **Voice preference:** Omani Arabic (`ar-OM`) → Gulf Arabic
  (`ar-SA`/`ar-AE`/`ar-BH`/`ar-QA`/`ar-KW`/`ar-YE`) → any other Arabic →
  platform default. Voices that load asynchronously are re-picked on
  `voiceschanged`.
- **No Arabic voice at all:** the utterance still plays with locale `ar-OM`
  on the default voice; the feature never throws or fails because of it.
- **Chrome long-utterance pause:** a resume pacer nudges `speechSynthesis`
  every 10s while speaking so 15–35s summaries play through.

## Future TTS / cloud option

If a premium Arabic voice is required later, swap the engine seam in
`engine.ts` for a cloud TTS adapter behind the same `OwnerVoiceEngine`
interface. Requirements for that future slice: explicit opt-in, a paid-API
budget guard, no data retention, and an equivalent permission model. This
slice intentionally does **not** add that dependency.

## Accessibility review (affected screens)

- Semantic headings: `h1` on Home, Events list, and Event workspace; page
  regions use the app's existing landmarks.
- The voice control is a real `<button>` with an Arabic accessible name that
  changes with its action («اسمع الصفحة» / «إيقاف القراءة» / «إعادة
  القراءة»); it is keyboard reachable and uses the app's `:focus-visible`
  outline.
- No `aria-live` region announces the narration (avoids conflicting audio
  with system screen readers); state is conveyed by label + icon + text,
  never by color alone.
- RTL: the app root is `dir="rtl" lang="ar"`; all new strings are Arabic.
- Typography/touch: the button is `min-h-14` with `text-lg` (large tap target
  and readable text), full-width on small screens and inline on desktop.
- Known limitation: while a system screen reader is active, pressing the
  button plays both the narration and the (brief) label change of the focused
  control. There is no reliable browser API to detect a screen reader; the
  product choice is a manual button (never auto-speech) and no `aria-live`.
- No real audio-device testing was performed in this slice; behavior is
  verified with mocked `SpeechSynthesis` APIs only.

## Tests

`screenSummary.test.ts` — Arabic formatting, plural/number handling, no cost
leakage, role-aware commercial summary, event with no issues / staff shortage
/ equipment shortage, cancelled events, determinism.
`engine.test.ts` — unsupported synthesis, speak/stop/replay, rapid-press
non-overlap, voice preference, rate presets, resume pacer, async voice load.
`useOwnerVoice.test.tsx` — no automatic speech on mount, unmount stops speech.
`OwnerVoiceButton.test.tsx` — no button without a summary, speak→stop→replay
flow, double-press non-overlap, speed presets, unsupported state.

All tests mock `SpeechSynthesis`; none depend on real audio playback.
