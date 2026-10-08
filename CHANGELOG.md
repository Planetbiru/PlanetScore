# Changelog

All notable changes to PlanetScore are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.2] - 2026-10-08

Second tagged release. Focused on **multi-tempo rendering**, **automatic
voice separation for overlapping notes**, and a **round of file-name and
playback-UI correctness fixes** across the converter, both renderers, and
the composer's export/playback layer.

### Added

- **`MidiToMusicXML`: overlap-based staff splitting.** A new option
  `autoSplitOnOverlap` (default `false`) promotes a channel to two or three
  staves whenever its notes overlap in time beyond a single voice — for
  example, a sustained bass note under a moving melody, or a piano part
  with legato inner voices. The engine separates voices greedily, keeping
  every chord-group on a single staff and prioritizing higher pitches for
  the top staff. `overlapToleranceRatio` (default `1/32` of PPQ) controls
  the legato tolerance so sloppy MIDI timing does not trigger spurious
  splits.
- **`MidiToMusicXML`: voice-count estimation.** New public helpers
  `hasOverlappingNotes()`, `countVoices()`, and `assignNotesToStaves()` on
  the converter, reusable by hosts that want to display staff-split
  diagnostics before committing to a conversion.
- **SVG & PDF: multiple tempo changes per measure.** Both renderers now
  iterate every `<direction>` that carries a tempo (not just the first one),
  so MusicXML documents that place more than one `<metronome>` inside the
  same measure — a common pattern when a MIDI file emits both a redundant
  120 BPM at tick 0 and a real tempo a few ticks later — render all of them.
  Overlapping tempo markings are staggered horizontally to avoid visual
  collisions.
- **SVG & PDF: `<offset>` support for tempo.** Tempo markings now honor the
  `<offset>` element inside `<direction>`, positioning each tempo glyph at
  the correct beat instead of always anchoring it to the start of the
  measure.
- **SVG & PDF: beat-unit glyph mapping for tempo.** Tempo markings now
  choose the correct note glyph (`𝅝`, `𝅗𝅥`, `♩`, `♪`, `𝅘𝅥𝅯`) from
  `<beat-unit>` and render augmentation dots via `<beat-unit-dot>`. Prior
  versions always displayed a quarter-note symbol.
- **`MusicXMLSVGRenderer`: engine-side tempo comments.** The renderer now
  documents, in the class JSDoc, that tempo is read from **part 0** of the
  MusicXML — a deliberate convention matching `MidiToMusicXML`'s emission
  policy.

### Fixed

- **`MidiToMusicXML`: tie continuation lost its target staff.** When a note
  was tied across a barline, the continuation re-derived the staff from the
  pitch instead of inheriting the staff used by the tie's starting note.
  After enabling staff splits, this caused the second half of a tie to jump
  to a different staff mid-phrase. The staff is now stored alongside the
  tie in `tieContinue` and reused verbatim.
- **`MidiToMusicXML`: `tieInfo` was referenced outside its scope.** The
  fallback path for placing a note without an assigned staff referenced a
  `tieInfo` variable that only existed inside the tie-continuation block,
  producing a `ReferenceError` during conversion when `autoSplitOnOverlap`
  was enabled. The fallback now delegates to `determineStaffForNote()`.
- **`MidiToMusicXML`: `autoSplitOnOverlap` never actually ran.** The option
  was declared with a default of `false`, and the overlap-detection block
  was nested inside `if (opts.autoSplit)` — so overlap-based splits were
  silently skipped even when the caller explicitly enabled the feature. The
  two code paths are now independent.
- **`MidiToMusicXML`: chord tones split across staves.** The staff
  assignment algorithm grouped notes by onset tick before deciding a staff,
  but the pre-computed `channelNoteStaffMap` was never populated, so every
  note fell back to the range-based `determineStaffForNote()`. Chord tones
  could therefore land on different staves. The map is now populated with
  the output of `assignNotesToStaves()`, which keeps every chord-group
  together.
- **SVG & PDF: tempo changes in the middle of a system were dropped.** The
  PDF renderer emitted tempo markings inside the `isSystemStart` block, so
  any tempo change that fell on a measure that was not the first of its
  system was ignored. Tempo rendering has been moved into the per-measure
  loop, and both renderers now check every measure.
- **SVG & PDF: only the first tempo in a measure was rendered.**
  `querySelector("metronome")` returns a single node. Both renderers now use
  `querySelectorAll("direction")` and read every tempo-bearing direction.
- **Composer: song could not be replayed after it ended.** The `onEnded`
  handler called `player.stop()` *after* the player had already stopped
  itself, which reset the player into a state that rejected the next
  `load()` call. The result was that the Play button did nothing until the
  user pressed Stop first. The `stop()` call has been removed from
  `onEnded`, and the Play handler now reloads the MIDI explicitly before
  playback when the previous playback ended naturally.
- **Composer: Play handler was Promise-unsafe.** `player.load(...).then(...)`
  assumed `load()` always returned a Promise. On player implementations
  where `load()` is synchronous, `.then` was either missing or called on
  `undefined`, silently breaking replay. The handler now detects whether
  `load()` returned a thenable and falls back to a `setTimeout(..., 0)`
  when it did not.
- **Composer: `sanitizeFileName` was defined twice.** Two definitions
  existed in the same file, with different behaviors. The second one
  (hoisted) silently won, leaving the first as dead code. The duplicate has
  been removed.
- **Composer: `sanitizeFileName` could return an empty string.** Inputs
  consisting entirely of illegal characters (e.g. `":::"`) produced an
  empty result, causing downloads named `.zip`, `.musicxml`, and
  `.pdf` — hidden files on Linux and macOS. The helper now returns
  `"Untitled"` when the cleaned result would be empty.
- **Composer: MusicXML, DAWProject, and individual-PDF exports bypassed
  sanitization.** The XML and DAWProject download links, and the per-track
  `trackName` segment of individual PDF filenames, were not passed through
  `sanitizeFileName`. A track named `"Piano/Bass"` could therefore create
  nested folders once the exported files were zipped by the user. All
  download filenames and ZIP entries now go through the shared sanitizer.
- **Composer: PDF song-title input was ignored.** The `pdf-song-title` field
  in the export modal was populated on open but never read on submit; the
  download filename fell back to `currentTrackName`. The submit handler now
  reads the modal's value first.

### Changed

- **PDF: tempo rendering location.** The tempo-marking block has been
  relocated out of the system-start branch into the per-measure rendering
  pass. This is a behavioral change for scores whose tempo changes fall on
  non-system-start measures: those markings now render (previously they did
  not).
- **`MusicXMLSVGRenderer`: JSDoc coverage.** The constructor documentation
  now describes every supported option, including the comment-overlay
  system, `midiTrackIdByPartIndex` mapping, stem-direction override, and
  auto-clef controls.
- **`MusicXMLPDFRenderer`: JSDoc coverage.** The constructor documentation
  now describes the complete option surface, including `scale`, per-side
  margins, measure-width controls, page-number styling, and the
  `liricYOffset` spelling caveat.
- **`MidiToMusicXML`: JSDoc coverage.** `convert()` now documents the full
  six-stage pipeline, every public option (metadata, track/channel
  selection, transposition, parsing, snapping, staff splitting, layout, and
  lyrics), and includes a runnable example.

### Notes

- The **overlap-based split** feature is opt-in. To enable it, pass
  `autoSplitOnOverlap: true` to `MidiToMusicXML.convert()`. It is
  independent of the existing `autoSplit` (range-based) option; both can
  be enabled at once, and the larger of the two staff counts wins.
- The **multiple-tempo-per-measure** rendering affects the visual output
  only when the MusicXML source actually contains more than one tempo
  direction in the same measure. Scores produced by `MidiToMusicXML` from
  a well-formed MIDI file will not normally contain such duplicates; the
  fix is primarily for third-party MusicXML, hand-edited scores, and MIDI
  files with redundant initial tempo events.
- The `liricYOffset` option name (with the misspelling) is preserved for
  backward compatibility with existing callers. New code should prefer
  `lyricYOffset`, which will be added in a future release as an alias.

## [0.0.1] - 2026-10-01

First tagged release. Consolidates the initial public API, the MIDI → MusicXML → SVG/PDF pipeline, and a round of correctness fixes across the parser, the SVG renderer, and the PDF renderer.

### Added

- **PDF: Tempo marking rendering.** The PDF renderer now reads `<metronome>` elements from MusicXML and draws tempo markings (beat-unit glyph + `= BPM`) above the staff. Rendering is performed inside the system-start block so the drawing context (page, position, and jsPDF state) is always valid — this avoids the earlier issue where tempo markings were drawn into the wrong page buffer.
- **PDF: Global scale option.** A new `scale` option (default `0.8`) uniformly scales the whole score — line spacing, staff spacing, noteheads, clefs, accidentals, ledger lines, beams, flags, lyrics, chord symbols, tempo, and font sizes — while keeping the paper size fixed at A4. This makes it possible to fit a denser score on the same page without changing the output format.
- **PDF: Extended chord-kind mapping.** Chord symbols now support a wider range of `<kind>` values, including `diminished` (`dim`), `augmented` (`aug`), `suspended-fourth` (`sus4`), `suspended-second` (`sus2`), `half-diminished` (`m7b5`), `major-sixth` (`6`), `minor-sixth` (`m6`), and double accidentals (`##`, `bb`) on the chord root.
- **PDF: Automatic note-flag orientation.** Note flags (eighth, 16th, 32nd) are now drawn with their base anchored exactly at the tip of the stem, so the stem visually tapers to a sharp point instead of ending in a blunt block. Double flags are placed closer to the first flag for a cleaner look.
- **SVG & PDF: Chord / harmony parsing rewrite.** `<harmony>` elements are now parsed sequentially through the measure, correctly accounting for `<note>`, `<forward>`, and `<backup>` events, plus mid-measure `<divisions>` changes. Chord symbols are matched to note columns using a divisions-relative tolerance instead of a fixed `2`-tick window.

### Fixed

- **SVG & PDF: Chord symbols were not rendered at the correct position.** Previously, `<offset>` inside `<harmony>` was treated as an absolute onset from the start of the measure. Since MusicXML defines `<offset>` as *relative to the current musical position*, chords placed mid-measure were either drawn at the wrong beat or dropped entirely. Both renderers now compute the correct onset by walking the measure sequentially.
- **PDF: Block chords (stacked notes) were not rendered.** A bug in the note-iteration loop stored the *end position* of the base note in `lastBaseDiv` instead of its *onset*. As a result, every chord tone after the first one received a wrong onset, fell into a different column, and was never stacked. All notes of a chord now share the same onset and render as a proper chord.
- **PDF: Columns were grouped using a chord detection that relied on `note.node`.** Column grouping now uses the parsed `onsetDiv` directly, which is correct for rests, chord tones, and split-duration tied notes.
- **PDF: Note stems ignored the global scale.** `setLineWidth(1.4)` for stems was hard-coded in both `drawNoteColumn` and `renderBeamGroup`, so after enabling `scale: 0.8` the stems remained at full thickness and looked disproportionately heavy. Stem width is now multiplied by `GLOBAL_SCALE` in both locations.
- **PDF: Note flags used a fixed size regardless of scale.** `drawStemFlag` now derives its scale from `GLOBAL_SCALE`, so eighth/sixteenth flags shrink with the rest of the notation.
- **PDF: Ledger lines were too wide relative to scaled notes.** Ledger line width and horizontal half-width are now scaled by `GLOBAL_SCALE`.
- **MIDI Parser: unwanted leading-silence trimming.** The parser no longer trims silence at the beginning of the track unless explicitly requested via the `normalize` option. Previously it could shift the first note to tick 0 even when the caller did not ask for it, silently discarding the intended pickup or rest.

### Changed

- **PDF: Note type / dot resolution is meter-aware.** `getNoteTypeAndDots()` chooses note values relative to the current meter (`beatType`), so dotted values are produced for 3/4 (dotted half) and 4/4 (dotted quarter, dotted half) instead of defaulting to the closest abstract fraction.
- **PDF: Chord-symbol matching tolerance** is now `max(4, divisions / 4)` ticks, so quantization differences between notation software and the renderer no longer cause a chord to be missed.
- **PDF: Tempo placement.** Tempo is now read from the *original* measure node (via `partMeasureMap`), not from the (possibly compressed) render-list entry, so tempo survives multi-measure-rest compression.

### Notes

- Chord and tempo rendering in the **SVG renderer** were fixed in the same release; the SVG renderer shares the corrected harmony parsing strategy with the PDF renderer.
- The bundled `Tenggelam.mid` sample exercises chord, tempo, and multi-staff layouts and is a good smoke test for this release.
