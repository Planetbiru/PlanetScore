# PlanetScore

PlanetScore is a browser-based MIDI to sheet music renderer. It parses a MIDI file, converts it to MusicXML, and displays the result as responsive SVG notation with an optional PDF preview and download.

> **Note:** This project was created to support score rendering on [Planetbiru Composer](https://composer.planetbiru.com).

The project runs as a static web application. No build process or server-side component is required.

## Features

- Parse Standard MIDI files (`.mid` and `.midi`) in the browser.
- Convert MIDI events to MusicXML 4.0 Partwise format.
- Render MusicXML as scalable SVG sheet music.
- Generate a multi-page PDF score using jsPDF.
- Select one or more MIDI tracks or channels.
- Preserve tempo, time signature, key signature, and lyric metadata.
- Split wide note ranges into multiple staves when `autoSplit` is enabled, with a **minimum-range floor** to protect narrow melodic parts.
- Detect overlapping voices and split them onto separate staves by default; this can be disabled with `autoSplitOnOverlap: false`.
- Gate lyrics to the correct channel so they are only rendered when the melody channel is present.
- Support percussion notation on MIDI channel 10.
- Optionally transpose bass-program notes up an octave during MIDI-to-MusicXML conversion.
- Fill rhythmic gaps with rests and split complex durations into tied notes.
- Optionally snap note positions and durations to a musical grid.
- Handle clef-specific notation correctly (treble, bass, and alto clefs) for both ledger lines and key signatures.
- Select clefs based on pitch-range overflow, with different auto-clef controls in the SVG and PDF renderers.
- Synchronize the SVG score with playback using a playhead, active-note highlighting, and optional auto-scroll.
- Support an SVG comment overlay with callbacks for host-managed persistence.

## Getting Started

1. Open `index.html` in a modern web browser.
2. Choose a MIDI file with the file picker.
3. Select the tracks or channels to display.
4. Adjust the available score options, such as staff splitting or snapping.
5. View the generated MusicXML and SVG score.
6. Generate and download the PDF score when needed.

For local development, serve the project directory with any static HTTP server if your browser restricts local file access. For example:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

## MIDI Player Integration

The rendered score can be integrated with a MIDI player so the notation stays synchronized with playback. The SVG renderer exposes a moving playhead and active note highlighting that are driven by the current MIDI tick, allowing the score to follow the player in real time.

This is useful for applications such as karaoke-style practice, guided learning, or performance visualization. The score can update the playhead position, scroll the current system into view, and highlight currently active notes while the MIDI track is playing.

Example flow:

```js
player.on('onPlaying', (tick) => {
    const pos = midi.header.tickToPosition(tick);
    const measure = Math.floor(player.tickToMeasure(tick));

    renderer.updatePlayhead(tick, pos, scoreContainer.parentNode, {
        scroll: true,
        scrollOffset: -20
    });

    renderer.highlightActiveNotes(tick, measure, {
        highlight: true
    });
});
```

This makes the score and MIDI player work as a single synchronized playback experience without reloading the score when the player time changes.

## Processing Pipeline

```text
MIDI file
   |
   v
MidiParser
   |
   v
MidiToMusicXML
   |
   +--> MusicXMLSVGRenderer --> SVG score preview
   |
   +--> MusicXMLPDFRenderer --> PDF preview/download
```

## JavaScript API

### Parse MIDI

```js
const parsed = MidiParser.parse(arrayBuffer, {
	normalize: false,
	forceUpdateEvents: true
});
```

`MidiParser.parse()` returns MIDI header data, tracks, notes, lyrics, controller events, pitch bends, and instrument metadata. Set `normalize` to shift the first note to tick 0. Set `forceUpdateEvents` to move initial setup events to tick 0.

### Convert MIDI to MusicXML

```js
const converter = new MidiToMusicXML();
const musicXML = converter.convert(arrayBuffer, {
	title: 'My Score',
	creator: 'Composer',
	selectedChannels: [0, 1],
	lyricChannelId: 4,
	autoSplit: true,
	splitThreshold: 24,
	minSplitRange: 30,
	snapPosition: 0.125,
	snapDuration: 0.125
});
```

Supported conversion options include:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `string` | `"Song Title"` | Score title. |
| `creator` | `string` | `"Composer Name"` | Composer or creator name. |
| `divisions` | `number` | `4` | Divisions per quarter note in the generated MusicXML. |
| `selectedChannels` | `number[]` | `null` | MIDI channels to render. If omitted, all channels are rendered. |
| `selectedTracks` | `number \| number[]` | `null` | Track index (or indices) to render (legacy). Resolves to that track's channels. Meta tracks are always preserved. |
| `normalize` | `boolean` | `true` | Shift event timing so the earliest note starts at tick 0. |
| `forceUpdateEvents` | `boolean` | `true` | Move supported setup events that precede a channel's first note to tick 0. |
| `lyricChannelId` | `number \| null` | `null` | 1-indexed MIDI channel that carries the lyrics (e.g. `4` = channel index 3). If the channel is absent from the rendered score, lyrics are disabled entirely. |
| `autoSplit` | `boolean` | `false` | Automatically split channels with a wide note range. |
| `splitThreshold` | `number` | `24` | Primary threshold (semitones) for automatic split. Lowered to `14` automatically for piano (program 0–7). |
| `minSplitRange` | `number` | `30` | Hard floor (semitones). Parts with a smaller range are **never** auto-split, regardless of `splitThreshold`. Set to `0` to disable the floor. |
| `splitPoint` | `number \| null` | `null` | MIDI note used to force a two-staff split on the first non-drum channel. |
| `splitPoints` | `number[] \| null` | `null` | Two MIDI notes used to force a three-staff split on the first non-drum channel (e.g. `[71, 59]`). Takes precedence over `splitPoint`. |
| `autoSplitOnOverlap` | `boolean` | `true` | Split a channel when multiple simultaneous voices are detected. Set to `false` to disable. |
| `overlapToleranceRatio` | `number` | `1/32` | Overlap tolerance as a fraction of PPQ; small overlaps within this window are treated as legato. |
| `muteChannels` | `number[]` | `[]` | Channels excluded from the rendered score. |
| `transpose` | `number` | `0` | Semitone offset. Drum channel (9) is never transposed. |
| `transposeBass` | `boolean` | `false` | Add 12 semitones to notes played with programs listed in `transposeBassInstruments`. |
| `transposeBassInstruments` | `number[]` | `[32, 33, 34, 35, 36, 37, 38, 39]` | GM program numbers (0-indexed) recognized for the additional bass octave. |
| `useRestFilling` | `boolean` | `true` | Fill gaps with rests to complete each measure rhythmically. |
| `snapPosition` | `number \| null` | `null` | Snap note onsets to note fractions, such as `0.125` for eighth notes. |
| `snapDuration` | `number \| null` | `null` | Snap note durations to note fractions. |

The converter defaults to `normalize: true` and `forceUpdateEvents: true`, unlike direct calls to `MidiParser.parse()`, which default both options to `false`. Meta-only tracks are retained during track selection so tempo and time-signature information remains available; lyric rendering still depends on a lyric channel being present in the score.

Bass transposition is program-aware and evaluated per note using the active Program Change at that note's tick. MIDI channel 10 (index 9) is never transposed. The SVG and PDF renderers do not apply instrument-specific transposition; see [manual.md](manual.md#bass-instrument-transposition) for details.

#### `splitThreshold` vs `minSplitRange`

These parameters control range-based splitting when `autoSplit` is enabled. Both conditions must pass for range-based splitting:

1. `range >= minSplitRange` — **hard floor**. Parts below this are never auto-split.
2. `range >= splitThreshold` — **primary threshold**. Adjusted per instrument (`14` for piano, otherwise the user value).

| Parameter | Role | Overridable? |
| --- | --- | --- |
| `splitThreshold` | Preference — "split if the range is at least this wide". Lowered automatically for piano. | Yes, by instrument program. |
| `minSplitRange` | Hard floor — "do NOT split if the range is smaller than this". Evaluated first. | No. |

**Example** with `splitThreshold: 24`, `minSplitRange: 30`:

| Part | Program | Range (semitones) | Result |
| --- | --- | --- | --- |
| Flute melody | 73 | 20 | 1 staff |
| Flute melody | 73 | 28 | 1 staff (fails floor 30) |
| Flute melody | 73 | 32 | 2 staves |
| Piano simple | 0 | 18 | 1 staff (fails floor 30) |
| Piano medium | 0 | 32 | 2 staves |
| Organ large | 16 | 50 | 3 staves |
| Drum kit | — | — | 1 staff (always) |

Overlap-based splitting is independent of these range thresholds and remains enabled unless `autoSplitOnOverlap: false`. Setting `minSplitRange: 0` removes the floor only for range-based splitting.

### Render SVG

```js
const renderer = new MusicXMLSVGRenderer('score-container', {
    staffSpacing: 80,
    partSpacing: 80,
	systemSpacing: 80,
	autoDetectMobile: true
});

renderer.render(musicXML);
```

The SVG renderer supports responsive layouts, beams, ties, slurs, articulations, grand-staff braces, an interactive playhead, active-note highlighting, and comments. Use `updatePlayhead()` to move the playhead and optionally scroll the score during playback; use `highlightActiveNotes()` to highlight currently sounding notes.

The constructor accepts a container element ID or an `HTMLElement`. Its optional configuration properties are:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `staffSpacing` | `number` | `80` | Vertical gap between staves within the same part, in SVG units. |
| `partSpacing` | `number` | `80` | Additional vertical gap between different parts, in SVG units. |
| `systemSpacing` | `number` | `80` | Vertical gap between successive systems, in SVG units. |
| `forceMobile` | `boolean` | `false` | Forces the mobile layout regardless of viewport size. |
| `autoDetectMobile` | `boolean` | `true` | Automatically selects the mobile layout for a narrow viewport. |
| `paperBg` | `string` | `'#ffffff'` | SVG background color. Use `'transparent'` to inherit the CSS background. |
| `lyricFontSize` | `number` | `11` | Base font size for lyric text, in pixels. |
| `lyricFontFamily` | `string` | `'sans-serif'` | CSS font family used for lyric text. |
| `stemDirectionThreshold` | `number \| null` | `null` | Overrides the automatic stem-direction threshold. `null` uses the clef-specific default. |
| `autoClef` | `boolean` | `true` | Enables automatic clef selection based on each staff's pitch range. |
| `allowAltoClef` | `boolean` | `false` | Accepted for compatibility; currently does not affect SVG auto-clef selection. |
| `clefGtoFThreshold` | `number` | `4` | Accepted clef-selection threshold; currently unused by SVG, which uses a fixed overflow threshold of 4 diatonic steps. |
| `clefFtoGThreshold` | `number` | `-4` | Accepted clef-selection threshold; currently unused by SVG, which uses a fixed overflow threshold of 4 diatonic steps. |
| `debugAutoClef` | `boolean` | `false` | Enables diagnostic logging during automatic clef selection. |
| `comments` | `object[]` | `[]` | Initial comments to display. Each comment should include its tick, text, color, author, track ID, and unique ID. |
| `commentsVisible` | `boolean` | `true` | Shows the comment overlay on the first render when enabled. |
| `commentMode` | `boolean` | `false` | Enables comment interactions such as creating, editing, and dragging comments. |
| `commentAuthor` | `string \| number \| null` | `null` | Current user's ID, used for ownership and edit-permission checks. |
| `commentTrackFilter` | `Set<number> \| number \| null` | `null` | Restricts visible comments to the specified MIDI track or tracks. |
| `commentUserFilter` | `string \| number \| null` | `null` | Restricts visible comments to a single author. |
| `onCreateRequest` | `function \| null` | `null` | Callback with `(tick, midiTrackId, clientX, clientY)` when the user requests a comment on an empty score area. |
| `onEditRequest` | `function \| null` | `null` | Callback with `(comment, event)` when the user selects an editable comment. |
| `onMoveRequest` | `function \| null` | `null` | Callback with `(comment, newTick, newMidiTrackId)` when the user finishes dragging a comment. |
| `onError` | `function \| null` | `null` | Error callback with `(error, action, comment?)` when a comment callback fails. |
| `canEdit` | `function \| null` | `null` | Custom permission callback with `(comment, currentAuthor)`, returning whether the comment can be edited. By default, only its author can edit it. |
| `midiTrackIdByPartIndex` | `(number \| null)[] \| null` | `null` | Maps each MusicXML part index to its MIDI track ID for track-aware comment placement. |

SVG auto-clef preserves the MusicXML clef unless the pitch range overflows the staff by at least four diatonic steps, then switches toward the greater overflow. It does not automatically choose alto clef. The PDF renderer uses configurable `clefMinOverflow` and can consider alto clef when `allowAltoClef: true`.

#### Clef-Aware Notation

Ledger lines and key signatures are rendered with correct staff positions for treble (G), bass (F), and alto (C) clefs.

- **Ledger lines** are drawn only for notes that fall outside the staff range. Any ledger line that would overlap with one of the five staff lines is automatically skipped. Staff range is clef-aware.
- **Key signatures** use the correct diatonic positions for each clef. Alto clef uses the viola positions: `F4 C4 G4 D4 A3 E4 B3` for sharps and `B3 E4 A3 D4 G3 C4 F3` for flats.

### Render PDF

```js
const pdfRenderer = new MusicXMLPDFRenderer({
    orientation: 'landscape',
    paperSize: 'a4',
    showPageNumbers: true
});
pdfRenderer.render(musicXML);
pdfRenderer.save('my-score.pdf');
```

The PDF renderer creates a vector-based, multi-page score. It requires the jsPDF browser library, which is loaded from CDN by `index.html`. Clef-aware ledger lines and key signatures are shared with the SVG renderer. Configure page setup, layout, and export options in its constructor; `save()` downloads the rendered score.

Available constructor options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `orientation` | `string` | `'portrait'` | Page orientation: `'portrait'` or `'landscape'`. Other values use portrait. |
| `paperSize` | `string \| number[]` | `'a4'` | jsPDF paper format (for example, `'letter'` or `'a3'`) or custom `[width, height]` dimensions in points. |
| `format` | `string \| number[]` | `undefined` | Alias for `paperSize`; ignored when `paperSize` is provided. |
| `scale` | `number` | `0.8` | Global multiplier for spacing, lyric offset, stem length, and lyric font size. It does not scale margins or measure widths. |
| `margin` | `number` | `40` | Default margin in points for all page edges unless overridden per side. |
| `marginTop` | `number` | `margin` | Top margin for the first page, in points. |
| `marginRight` | `number` | `margin` | Right page margin, in points. |
| `marginBottom` | `number` | `margin` | Bottom page margin, in points. |
| `marginLeft` | `number` | `margin` | Left page margin, in points. |
| `marginTopOtherPages` | `number` | `marginTop + 12` | Top margin on pages after the first, in points. |
| `staffSpacing` | `number` | `80` | Gap between staves in the same part. Multiplied by `scale`. |
| `partSpacing` | `number` | `80` | Gap between different parts. Multiplied by `scale`. |
| `systemSpacing` | `number` | `80` | Gap between successive systems. Multiplied by `scale`. |
| `lyricYOffset` | `number` | `60` | Distance from the staff to the lyric baseline. Multiplied by `scale`. |
| `stemLength` | `number` | `24` | Minimum note stem length. Multiplied by `scale`. |
| `lyricFontSize` | `number` | `10` | Lyric font size. Multiplied by `scale` when drawn. |
| `lyricFontFamily` | `string` | `'sans-serif'` | Lyric font family: `'sans-serif'`, `'serif'`, or `'monospace'`, mapped to a jsPDF-safe font. |
| `minMeasureWidth` | `number` | `150` | Minimum measure width in points. |
| `idealMeasureWidth` | `number \| null` | `null` | Preferred measure width in points; defaults internally to `200` with lyrics and `220` without. |
| `maxMeasuresPerLine` | `number \| null` | `null` | Maximum measures per system; otherwise derived from page dimensions and lyric presence. |
| `firstSystemGap` | `number` | `20` | Extra vertical space in points between the title block and first system. |
| `autoClef` | `boolean` | `true` | Enables automatic clef selection based on each staff's pitch range. |
| `allowAltoClef` | `boolean` | `false` | Allows alto clef to be selected by the auto-clef logic. |
| `clefMinOverflow` | `number` | `4` | Diatonic overflow required before changing from the source clef. |
| `debugAutoClef` | `boolean` | `false` | Enables diagnostic logging during clef selection. |
| `stemDirectionThreshold` | `number` | `7` | Diatonic threshold for automatic stem-direction flipping. |
| `selectedChannels` | `number[] \| null` | `null` | MIDI channel indices used with `selectedTrack` to identify a single-part render. |
| `selectedTrack` | `number[] \| null` | `null` | MIDI track indices used with `selectedChannels` to identify a single-part render. |
| `compressSilentMeasure` | `boolean` | `false` | Merges consecutive silent measures into a multi-measure rest for single-part scores. |
| `showPageNumbers` | `boolean` | `true` | Shows an `N of M` footer at the bottom-right of each page. |
| `pageNumberColor` | `number[]` | `[100, 116, 139]` | RGB color for page-number text. |
| `pageNumberMarginBottom` | `number` | `18` | Distance in points from the bottom edge to the page-number baseline. |

### Playback Mute vs. Score Mute

The `muteChannels` option affects the **rendered score** — notes from the listed channels are removed from the MusicXML.

Playback mute is applied separately at the audio layer (via the `TimidityPlayer` integration) and does not affect which notes are in the rendered score. In the vocal training app, playback mute is applied with `applyMuteToPlayer()`. A part can be silenced during practice while remaining visible; use score filters such as `selectedChannels` or `muteChannels` when the notation itself should change.

## Project Structure

| File | Purpose |
| --- | --- |
| `index.html` | Browser demo and user interface. |
| `MidiParser.js` | MIDI binary parser. |
| `MidiToMusicXML.js` | MIDI-to-MusicXML conversion logic. |
| `MusicXMLSVGRenderer.js` | MusicXML-to-SVG renderer. |
| `MusicXMLPDFRenderer.js` | MusicXML-to-PDF renderer. |
| `style.css` | Styles for the standalone page. |
| `manual.md` | Extended API and implementation documentation. |
| `*.min.js` | Minified distribution copies of the JavaScript libraries. |

## Dependencies

The core parser, converter, and SVG renderer use plain browser JavaScript. PDF generation uses [jsPDF](https://github.com/parallax/jsPDF), loaded from the CDN reference in `index.html`.

## Browser Support

Use a current version of Chrome, Edge, Firefox, or Safari with support for ES6 JavaScript, `ArrayBuffer`, the File API, SVG, and Blob URLs.

## License

This project is licensed under the **MIT License**.