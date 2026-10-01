# Changelog

All notable changes to PlanetScore are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

