# Project Documentation

This document provides a comprehensive overview of the JavaScript classes used in this MIDI to Music Score rendering project. The project consists of three main components:

1.  `MidiParser.js`: Decodes binary MIDI files.
2.  `MidiToMusicXML.js`: Converts parsed MIDI data into MusicXML format.
3.  `MusicXMLSVGRenderer.js` & `MusicXMLPDFRenderer.js`: Renders MusicXML into visual sheet music (SVG and PDF).

---

## MidiParser.js

`MidiParser` is a utility class responsible for reading a binary MIDI file (`.mid`) and decoding it into a structured JavaScript object.

### Key Features

-   **Binary Parsing**: Reads `ArrayBuffer` data from a MIDI file.
-   **Header and Track Decoding**: Parses the MIDI header (`MThd`) and all track chunks (`MTrk`).
-   **Event Handling**: Decodes various MIDI events, including:
    -   Note On / Note Off (and Note On with velocity 0).
    -   Program Change (instrument selection).
    -   Controller Changes (volume, pan, bank select, etc.).
    -   Meta Events (tempo, time signature, key signature, track name, lyrics).
-   **Track Metadata**: Every track exposes a `channels` array — a list of MIDI channels used in that track. This is used by the UI to map track selections to channels.
-   **Meta Track Identification**: Tracks that contain no note events (only meta events like lyrics, tempo, or time signature) are considered *meta tracks*. They are preserved by `MidiToMusicXML` even when specific channels are selected.
-   **Normalization**: Optionally shifts all event timings so that the first note in the score starts at tick 0, removing any initial silence.
-   **Event Reordering (`forceUpdateEvents`)**: Moves setup events (e.g., Program Change, Volume, Pan, Reverb, Bank Select, Pitch Bend) that occur before the first note to tick 0, ensuring the correct initial state.

### Main Method

#### `static parse(buffer, options = {})`

This is the primary static method used to parse a MIDI file.

-   **`buffer`**: An `ArrayBuffer` containing the binary MIDI data.
-   **`options`**: An optional configuration object.
    -   `normalize` (boolean): If `true`, the entire timeline is shifted so the first note event occurs at tick 0. Defaults to `false`.
    -   `forceUpdateEvents` (boolean): If `true`, initial setup events (like Program Change) that occur before the first note are moved to tick 0 to ensure they are applied correctly.

### Return Value

Returns an object with the following structure:

```
{
  header: { ppq, tempos, timeSignatures, keySignatures, maxTicks, ... },
  tracks: [
    {
      name: "Track Name",
      meta: [...],
      notes: [ { midi, ticks, durationTicks, velocity, channel, instrument } ],
      lyrics: [ { ticks, text } ],
      controllers: [ { ticks, controller, value, channel } ],
      pitchBends: [ { ticks, value, channel } ],
      startTick: number,
      channels: [0, 1, ...]   // list of MIDI channels used in this track
    },
    ...
  ],
  instruments: { 0: [0], 3: [40], ... }  // program numbers per channel
}
```

---

## MidiToMusicXML.js

`MidiToMusicXML` converts the structured data from `MidiParser` into a valid MusicXML 4.0 Partwise string. It handles the musical logic of creating a score from raw MIDI events.

### Key Features

-   **Part Generation**: Maps active MIDI channels to MusicXML `<score-part>` elements, automatically assigning instrument names.
-   **Channel Selection**: Supports rendering a subset of channels via the `selectedChannels` option (array). Meta tracks (lyrics, tempo, time signature) are **always preserved** so that lyrics and tempo markings still appear on the rendered score.
-   **Track Selection (legacy)**: Supports `selectedTracks` (single integer) for backward compatibility, which internally resolves to a set of channels.
-   **Automatic Staff Splitting**: Can split a single MIDI channel with a wide note range (like a piano track) into multiple staves.
    -   `autoSplit: true`: Automatically splits a channel into two or three staves if its note range exceeds the relevant thresholds.
    -   `splitThreshold`: Primary threshold (in semitones) that determines whether a part *should* be split. Defaults to `24` (2 octaves). For piano-family instruments (program 0–7), the effective threshold is automatically lowered to `14` (~1.2 octaves) since piano parts benefit from a grand staff earlier.
    -   `minSplitRange`: **Hard floor** (in semitones) that prevents a part from being split, regardless of the `splitThreshold`. Defaults to `30` (2.5 octaves). This is useful for vocal melodies in the 2–2.5 octave range — they remain on a single staff even though the piano-adjusted `splitThreshold` would otherwise trigger a split.
    -   `splitPoint`: A specific MIDI note number (e.g., `60` for Middle C) to force a two-stave split (bypasses both thresholds).
    -   `splitPoints`: An array of two MIDI note numbers (e.g., `[71, 59]`) to force a three-stave split (e.g., for organ). Bypasses both thresholds.
-   **Drum Notation**: Provides special handling for percussion on MIDI channel 10, mapping drum notes to standard drum notation visuals (e.g., 'x' noteheads).
-   **Lyric Integration**: Attaches lyrics to notes based on their timing. Lyrics are placed on the first staff (or the lyric carrier channel), creating rests if necessary to hold the text.
    -   `lyricChannelId` (1-indexed MIDI channel, e.g. `4`): the channel that carries the lyrics. If the channel is not present in the rendered score, lyrics are **disabled entirely** (no fallback to a different channel). This prevents lyrics from being accidentally attached to non-melody parts.
-   **Rest Filling**: Automatically fills gaps in the music with rests to ensure all measures are rhythmically complete.
-   **Note Duration Splitting**: Breaks down non-standard note durations into a series of tied, representable notes (e.g., a duration of 7 is split into a half note tied to a dotted quarter note).
-   **Snapping (optional)**:
    -   `snapPosition` (number, in note-fractions, e.g. `0.125` for 1/8): snaps every note onset to the nearest multiple of this value.
    -   `snapDuration` (number, in note-fractions): snaps every note duration to the nearest multiple of this value.
    -   If both are `null` (default), no snapping is applied.

### Main Method

#### `convert(midiBuffer, options = {})`

This is the main entry point for the conversion process.

-   **`midiBuffer`**: An `ArrayBuffer` or `Buffer` containing the MIDI file data.
-   **`options`**: An optional configuration object.

| Option | Type | Default | Description |
|---|---|---|---|
| `title` | string | `"Song Title"` | The title of the song. |
| `creator` | string | `"Composer Name"` | The name of the composer. |
| `divisions` | number | `4` | Divisions per quarter note in the generated MusicXML. |
| `selectedChannels` | number[] \| null | `null` | Array of MIDI channel numbers (0–15) to render. If not set, all channels are rendered. Meta tracks are always preserved. |
| `selectedTracks` | number \| number[] | `null` | Track index (or indices) to render (legacy). Internally resolves to that track's channels. Meta tracks (with no notes) are always preserved. |
| `lyricChannelId` | number \| null | `null` | 1-indexed MIDI channel that carries the lyrics (e.g. `4` = channel index 3). If the channel is absent from the rendered score, lyrics are disabled. |
| `autoSplit` | boolean | `false` | Enables automatic channel splitting based on note range. |
| `splitThreshold` | number | `24` | Primary threshold (semitones) for automatic split. Lowered to `14` automatically for piano (program 0–7). |
| `minSplitRange` | number | `30` | Hard floor (semitones). Parts with a smaller range are **never** auto-split. Set to `0` to disable the floor. |
| `splitPoint` | number \| null | `null` | Forces a two-stave split at the given MIDI note. |
| `splitPoints` | array \| null | `null` | Forces a three-stave split (e.g. `[71, 59]`). |
| `muteChannels` | number[] | `[]` | Channels to exclude from the rendered score. |
| `transpose` | number | `0` | Semitone offset. Drum channel (9) is never transposed. |
| `useRestFilling` | boolean | `true` | Fill rhythmic gaps with rests. |
| `snapPosition` | number \| null | `null` | Snaps note onsets to the nearest multiple of this value (in note-fractions). |
| `snapDuration` | number \| null | `null` | Snaps note durations to the nearest multiple of this value (in note-fractions). |

#### `splitThreshold` vs `minSplitRange` — When to Use Which

| Parameter | Role | Behavior |
|---|---|---|
| `splitThreshold` | *Preference* — "split if range is at least this wide" | Adjusted per instrument (piano gets 14). |
| `minSplitRange` | *Hard floor* — "do NOT split if range is smaller than this" | Absolute — no exceptions. Evaluated **first**. |

Both conditions must pass for a part to be auto-split. `minSplitRange` is a **gate**; `splitThreshold` is the **decision** once the gate is passed.

Example scenarios with `splitThreshold: 24`, `minSplitRange: 30`:

| Part | Program | Range (semitones) | Threshold applied | Result |
|---|---|---|---|---|
| Flute melody | 73 | 20 | 24 | 1 staff |
| Flute melody | 73 | 28 | 24 | 1 staff (fails floor 30) |
| Flute melody | 73 | 32 | 24 | 2 staves |
| Piano simple | 0 | 18 | 14 | 1 staff (fails floor 30) |
| Piano medium | 0 | 32 | 14 | 2 staves |
| Organ large | 16 | 50 | 48 | 3 staves |
| Drum kit | — | — | — | 1 staff (always) |

To disable the floor (legacy behavior), set `minSplitRange: 0`.

---

## MusicXMLSVGRenderer.js

`MusicXMLSVGRenderer` is a high-precision class for rendering MusicXML data into an SVG format, suitable for display on a web page.

### Key Features

-   **MusicXML to SVG**: Renders a MusicXML string into a scalable vector graphic (SVG).
-   **Responsive Layout**: Automatically adjusts the number of measures per line based on viewport size or the presence of lyrics.
-   **Configurable Layout**: Allows customization of spacing via constructor options.
-   **Advanced Notation**: Renders complex musical elements like beams, ties, slurs, articulations, and grand staff braces.
-   **Interactive Highlighting**: Supports highlighting notes for features like a play-along playhead.
-   **Smart Tie Handling**:
    -   Ties within the same system are drawn as a single Bezier curve.
    -   Ties across system boundaries are drawn as two half-curves ending and starting exactly at the system barlines.
    -   Tie columns are shifted slightly to avoid overlapping with adjacent notes (especially when a note and a tie start at the same onset).
-   **Multi-Level Beams**:
    -   Beams are grouped by beat index so notes in different beats are never beamed together.
    -   Secondary (16th) and tertiary (32nd) beams are drawn only across notes that require them.
    -   Half and quarter notes are never beamed with neighbors.
-   **Ledger Lines**: Ledger lines are drawn only for notes that fall outside the staff range. Lines that would overlap with the 5 staff lines are automatically skipped. The staff range is clef-aware (treble `2..10`, bass `-10..-2`, alto `-4..4` in diatonic index).
-   **Auto-Clef Selection**: Automatically picks the most suitable clef (treble G / bass F / alto C) for each staff based on the pitch distribution across the entire part. Prevents "hanging" melodies that sit far below the treble staff from colliding with the lyric row.

### Main Methods

#### `constructor(containerId, options = {})`

Initializes the SVG renderer.

-   **`containerId`**: The ID of the HTML element where the SVG score will be rendered.
-   **`options`**: An optional configuration object.
    -   `staffSpacing` (number): The vertical gap between staves within a single part. Defaults to `90`.
    -   `partSpacing` (number): The additional vertical gap between different musical parts. Defaults to `65`.
    -   `systemSpacing` (number): The vertical gap between musical systems. Defaults to `80`.
    -   `forceMobile` (boolean): Forces mobile rendering mode. Defaults to `false`.
    -   `autoDetectMobile` (boolean): Auto-detects mobile viewport. Defaults to `true`.

#### `render(xmlText)`

The main method that parses and renders the MusicXML string.

-   **`xmlText`**: A string containing the MusicXML data.

#### `updatePlayhead(tick, pos, scrollContainer, scoreOptions = {})`

Updates the position of a visual playhead line on the score and handles auto-scrolling.

#### `highlightActiveNotes(tick, measureNumber, scoreOptions)`

Highlights the note groups whose `data-start-tick`/`data-end-tick` range includes the given tick. Used by the playback playhead to highlight the currently-sounding notes.

### Auto-Clef Selection

When a melody is written with a treble clef in the source MIDI but its pitches lean low, the notes end up far below the staff and can overlap with the lyric row. Auto-clef solves this by analyzing the actual pitch content of every staff before rendering and choosing the clef whose vertical center is closest to the weighted average pitch.

**Algorithm** (executed once, before the first system is drawn):

1.  Iterate over every `<note>` in every measure of every part.
2.  For each staff, compute:
    -   `minDiatonic` / `maxDiatonic` — lowest and highest diatonic index.
    -   `avgDiatonic` — duration-weighted average pitch. Long notes contribute more than short ones, so a single high note doesn't skew the decision.
3.  Compare `avgDiatonic` with the center of each candidate clef:
    -   Treble (G): center at B4 → diatonic `6`
    -   Alto (C): center at C4 → diatonic `0`
    -   Bass (F): center at D3 → diatonic `-6`
4.  Pick the clef whose center is nearest to `avgDiatonic`.

**Modes**:

| Mode | Options | Behaviour |
|---|---|---|
| Default | `autoClef: true` (default), `allowAltoClef: false` | Two-way swap between treble and bass, using a configurable threshold around middle C. |
| Alto allowed | `autoClef: true`, `allowAltoClef: true` | Three-way choice between G / C / F. Useful for viola, trombone, or any part that sits comfortably around middle C. |
| Disabled | `autoClef: false` | Clef is taken verbatim from the MusicXML. Behaviour identical to previous versions. |

**Threshold tuning**: In two-way mode, the swap points are controlled by:

-   `clefGtoFThreshold` (default `4`, equivalent to G4) — a part is switched G → F if its weighted average pitch falls **below** this diatonic index.
-   `clefFtoGThreshold` (default `-4`, equivalent to F3) — a part is switched F → G if its weighted average pitch falls **above** this diatonic index.

Lower values (e.g. `0` = middle C) make the swap conservative; higher values (e.g. `6` = B4) make it aggressive. When `allowAltoClef` is enabled, these thresholds are ignored and the closest-center rule is used instead.

**Interaction with explicit clef changes**: If the MusicXML explicitly changes clef mid-piece (e.g. a passage written in a different register), the auto-clef only overrides the *first* measure's clef. Subsequent explicit clef changes are respected. This is enforced by the `_clefAutoApplied` flag set on each `staffState` entry.

### Additional Constructor Options

Beyond the spacing controls documented above, the SVG constructor also accepts:

| Option | Type | Default | Description |
|---|---|---|---|
| `autoClef` | boolean | `true` | Enable automatic clef selection per staff. |
| `allowAltoClef` | boolean | `false` | When `autoClef` is on, allow alto clef (C) to be selected for mid-range parts. |
| `clefGtoFThreshold` | number | `4` | Diatonic index below which a G-clef part is switched to F. |
| `clefFtoGThreshold` | number | `-4` | Diatonic index above which an F-clef part is switched to G. |
| `debugAutoClef` | boolean | `false` | Log each staff's auto-clef decision (`avgDiatonic`, `min`, `max`, original and chosen clef) to the browser console. |
| `lyricFontSize` | number | `11` | Font size for lyric text. |
| `lyricFontFamily` | string | `'sans-serif'` | Generic family applied to lyric text. |

### Auto-Clef Helper Methods

These methods are used internally when `autoClef` is enabled and are not normally called directly, but are documented here for maintainability.

#### `applyAutoClefToStaffState(partStaffMap, partMeasureMap, staffState)`

Analyzes each staff's pitch content and writes the selected clef into `staffState[staffId].clef`. Also sets `staffState[staffId]._clefAutoApplied = true` so that the first measure's explicit clef does not overwrite the automatic choice. When `debugAutoClef` is enabled, prints a one-line summary per staff to the console.

#### `analyzeStaffPitchRanges(partStaffMap, partMeasureMap)`

Walks every measure of every part and returns a per-staff summary:

```js
{
  1: { minDiatonic: -3, maxDiatonic: 12, avgDiatonic: 4.7, hasNotes: true, noteCount: 128 },
  2: { minDiatonic: -12, maxDiatonic: -2, avgDiatonic: -7.1, hasNotes: true, noteCount: 96 },
  ...
}

---

## MusicXMLPDFRenderer.js

`MusicXMLPDFRenderer` adapts the rendering logic to generate a multi-page PDF document using the `jsPDF` library.

### Key Features

-   **MusicXML to PDF**: Renders a complete musical score from a MusicXML string into a downloadable PDF file.
-   **Multi-Page Layout**: Automatically handles page breaks and system layout across multiple pages.
-   **Vector Rendering**: Draws all musical symbols as vector graphics for high-quality, scalable output.
-   **Smart Tie Handling**:
    -   Ties within the same system are drawn as a single Bezier curve.
    -   Ties across page boundaries are **skipped** if the target position exceeds the page boundaries (prevents dangling ties at the end of the last page).
    -   `activeTies` is always cleaned up after use so that unresolved ties never leak to the next page.
-   **Multi-Level Beams**:
    -   Mirrors the SVG renderer's beaming logic (beat-based grouping, multi-level beams, no beaming for half notes).
    -   Beamed notes have their flags removed; unbeamed notes keep their flags.
-   **Stem Alignment**:
    -   When notes are beamed, the stems are aligned to the beam vector, ensuring clean and consistent engraving.
    -   Stems are drawn directly from the notehead to the beam, avoiding double-line artifacts.
-   **Ledger Lines**: Same rule as the SVG renderer — ledger lines that would overlap staff lines are skipped. Staff range is clef-aware.
-   **Key Signature per Clef**: Uses proper diatonic positions for treble, bass, and alto clefs (alto clef positions are `F4 C4 G4 D4 A3 E4 B3` for sharps, `B3 E4 A3 D4 G3 C4 F3` for flats).
-   **Auto-Clef Selection**: Automatically picks the most suitable clef (treble G / bass F / alto C) for each staff based on the pitch distribution across the entire part. Prevents "hanging" melodies that sit far below the treble staff from colliding with the lyric line.

### Main Methods

#### `constructor(options = {})`

Initializes the PDF renderer.

-   **`options`**: An optional configuration object with the same spacing controls as the SVG renderer (`staffSpacing`, `partSpacing`, `systemSpacing`).

#### `render(xmlText)`

The main method that parses the MusicXML and draws it onto the internal PDF document.

-   **`xmlText`**: A string containing the MusicXML data.

#### `save(filename = 'music-score.pdf')`

Saves the generated PDF and triggers a browser download.

-   **`filename`**: The desired name for the downloaded PDF file.


### Auto-Clef Selection

When a melody is written with a treble clef in the source MIDI but its pitches lean low, the notes end up far below the staff and can overlap with the lyric row. Auto-clef solves this by analyzing the actual pitch content of every staff before rendering and choosing the clef whose vertical center is closest to the weighted average pitch.

**Algorithm** (executed once, before the first system is drawn):

1.  Iterate over every `<note>` in every measure of every part.
2.  For each staff, compute:
    -   `minDiatonic` / `maxDiatonic` — lowest and highest diatonic index.
    -   `avgDiatonic` — duration-weighted average pitch. Long notes contribute more than short ones, so a single high note doesn't skew the decision.
3.  Compare `avgDiatonic` with the center of each candidate clef:
    -   Treble (G): center at B4 → diatonic `6`
    -   Alto (C): center at C4 → diatonic `0`
    -   Bass (F): center at D3 → diatonic `-6`
4.  Pick the clef whose center is nearest to `avgDiatonic`.

**Modes**:

| Mode | Options | Behaviour |
|---|---|---|
| Default | `autoClef: true` (default), `allowAltoClef: false` | Two-way swap between treble and bass, using middle C as the threshold. The clef is only changed if the average falls on the wrong side of middle C, so parts that already fit their original clef are left alone. |
| Alto allowed | `autoClef: true`, `allowAltoClef: true` | Three-way choice between G / C / F. Useful for viola, trombone, or any part that sits comfortably around middle C. |
| Disabled | `autoClef: false` | Clef is taken verbatim from the MusicXML. Behaviour identical to previous versions. |

**Interaction with explicit clef changes**: If the MusicXML explicitly changes clef mid-piece (e.g. a passage written in a different register), the auto-clef only overrides the *first* measure's clef. Subsequent explicit clef changes are respected. This is enforced by the `_clefAutoApplied` flag set on each `staffState` entry.

### Additional Constructor Options

Beyond the spacing controls shared with the SVG renderer, the PDF constructor also accepts:

| Option | Type | Default | Description |
|---|---|---|---|
| `autoClef` | boolean | `true` | Enable automatic clef selection per staff. |
| `allowAltoClef` | boolean | `false` | When `autoClef` is on, allow alto clef (C) to be selected for mid-range parts. |
| `compressSilentMeasure` | boolean | `false` | Collapse consecutive silent measures into a multi-measure rest. |
| `showPageNumbers` | boolean | `true` | Draw "N of M" in the bottom-right corner of each page. |
| `pageNumberColor` | number[] | `[100, 116, 139]` | RGB color of the page-number text. |
| `pageNumberMarginBottom` | number | `18` | Distance from the bottom page edge to the page-number baseline. |
| `lyricFontSize` | number | `10` | Font size for lyric text. |
| `lyricFontFamily` | string | `'sans-serif'` | Generic family (`sans-serif`, `serif`, `monospace`) mapped to a jsPDF-safe font. |
| `stemLength` | number | `24` | Minimum stem length. |
| `firstSystemGap` | number | (unset) | Extra gap between the metadata block and the first system. |
| `margin` | number | `40` | Legacy single margin, applied to all four sides unless overridden. |
| `marginTop` / `marginRight` / `marginBottom` / `marginLeft` | number | `margin` | Per-side margin. |
| `marginTopOtherPages` | number | `marginTop + 12` | Top margin for pages after the first (after the title block disappears). |

### Auto-Clef Helper Methods

These methods are used internally when `autoClef` is enabled and are not normally called directly, but are documented here for maintainability.

#### `applyAutoClefToStaffState(partStaffMap, partMeasureMap, staffState)`

Analyzes each staff's pitch content and writes the selected clef into `staffState[staffId].clef`. Also sets `staffState[staffId]._clefAutoApplied = true` so that the first measure's explicit clef does not overwrite the automatic choice.

#### `analyzeStaffPitchRanges(partStaffMap, partMeasureMap)`

Walks every measure of every part and returns a per-staff summary:

```js
{
  1: { minDiatonic: -3, maxDiatonic: 12, avgDiatonic: 4.7, hasNotes: true, noteCount: 128 },
  2: { minDiatonic: -12, maxDiatonic: -2, avgDiatonic: -7.1, hasNotes: true, noteCount: 96 },
  ...
}

---

## MIDI Player Integration

The SVG renderer exposes two features designed to synchronize with a MIDI player: a **moving playhead** and **active note highlighting**. Both are driven by a single argument — the current playback tick — so integration is straightforward regardless of the player library.

### Playhead Visualization

The playhead is a vertical red line drawn on top of the score, showing exactly where the music is currently playing.

#### How It Works

1.  When `updatePlayhead()` is called, the renderer looks up the currently active measure via `g[data-measure-number="N"]`.
2.  From that measure, it finds the enclosing system (`g[data-system-number]`) to get the system's `x`, `y`, `width`, and `height` attributes.
3.  It computes the horizontal position by interpolating between the measure's start and end:

    ```
    xPos = systemX + measureX + progress * measureWidth
    ```

    where `progress = tickInMeasure / ticksPerMeasure` (clamped to `0..1`).
4.  The playhead line spans vertically from just above the top staff line to just below the bottom staff line, with a small padding.
5.  The line is always re-appended to the SVG root so it stays above all other elements.

#### Auto-Scroll

When a `scrollContainer` and `scoreOptions.scroll` are provided, the renderer computes the pixel offset of the current system and calls `scrollContainer.scrollTo()` with a smooth behavior. A `scrollOffset` option lets you fine-tune the vertical positioning (e.g., leave some blank space above).

The first system (`data-system-number="1"`) is treated specially: the scroll offset is forced to `0` so the score always starts fully visible at the beginning of playback.

#### Method Signature

```js
renderer.updatePlayhead(tick, position, scrollContainer, scoreOptions);
```

| Argument | Type | Description |
|---|---|---|
| `tick` | number | Current MIDI tick from the player. |
| `position` | object | `{ measure, tickInMeasure, ticksPerMeasure }`. |
| `scrollContainer` | HTMLElement \| null | Scrollable wrapper around the SVG (for auto-scroll). |
| `scoreOptions` | object | Same object used by `highlightActiveNotes`. Recognized keys: `scroll` (boolean), `scrollOffset` (number). |

The `position` object is usually produced by `midi.header.tickToPosition(tick)` — the `MidiParser` header already exposes a compatible API.

#### Example

```js
player.on('onPlaying', (tick, elapsedSec) => {
    const pos = midi.header.tickToPosition(tick);
    renderer.updatePlayhead(tick, pos, scoreContainer.parentNode, {
        scroll: true,
        scrollOffset: -20
    });
});
```

### Active Note Highlighting

`highlightActiveNotes()` adds a `.highlight` class to every note group (`g.music-notation`) whose tick range contains the current tick. A pre-injected stylesheet recolors note heads, stems, beams, ties, rests, accidentals, and lyrics to a distinct red (`#dc2626`) while highlighted, so the effect is impossible to miss.

#### How It Works

1.  Every note group and rest group is annotated during rendering with:
    -   `data-start-tick` — the tick when the note starts.
    -   `data-end-tick` — the tick when the note ends.
    -   `class="music-notation"` — the selector used for highlighting.
2.  On each call, the method:
    -   Clears `.highlight` from all previously highlighted elements.
    -   Selects a search scope (the whole SVG root, or only the current and previous system for performance).
    -   Adds `.highlight` to any element whose `[start, end)` range contains the tick.
3.  Because the search is limited to the current and previous system when `measureNumber` is provided, the per-frame cost stays low even on long scores.

#### Highlight CSS

The renderer injects a `<style>` tag once in the constructor with rules for every SVG element that can appear inside a note group:

```css
.highlight .note-head            { fill: #dc2626 !important; }
.highlight .note-stem            { stroke: #dc2626 !important; }
.highlight .note-beam            { stroke: #dc2626 !important; }
.highlight .note-flag path       { fill: #dc2626 !important; }
.highlight .tie-curve            { fill: #dc2626 !important; }
.highlight .rest-symbol          { fill: #dc2626 !important; }
.highlight .rest-line            { stroke: #dc2626 !important; }
.highlight .accidental-symbol    { fill: #dc2626 !important; }
.highlight text                  { fill: #dc2626 !important; }
```

#### Method Signature

```js
renderer.highlightActiveNotes(tick, measureNumber, scoreOptions);
```

| Argument | Type | Description |
|---|---|---|
| `tick` | number | Current MIDI tick from the player. |
| `measureNumber` | number \| null | If provided, restricts the search to the current and previous system. Pass `null` to search the entire score (slower on long pieces). |
| `scoreOptions` | object | Recognized key: `highlight` (boolean). If `false`, the method returns immediately without doing anything. |

#### Example

```js
const measure = Math.floor(player.tickToMeasure(tick));

renderer.highlightActiveNotes(tick, measure, {
    highlight: true
});
```

### Combining Both Features

The two features are independent, but in practice they are called together inside the player's tick callback:

```js
function updateScoreDisplay(tick) {
    const pos = midi.header.tickToPosition(tick);
    const measure = Math.floor(player.tickToMeasure(tick));

    renderer.updatePlayhead(tick, pos, scoreContainer.parentNode, scoreOptions);
    renderer.highlightActiveNotes(tick, measure, scoreOptions);
}
```

### Toggling the Features

Both are controlled through the `scoreOptions` object passed to `render()` and to the two methods:

```js
const scoreOptions = {
    playhead:  true,   // reserved for future use
    highlight: true,   // enable note highlighting
    scroll:    true,   // enable auto-scroll during playback
    scrollOffset: 0    // pixels to add to the auto-scroll target
};
```

Setting `highlight: false` disables highlighting entirely. Setting `scroll: false` disables auto-scroll while keeping the playhead visible.

### Ticks Are Relative to the Rendered Score

The `tick` values used by the playhead and highlighting are the same values used during conversion. If the score is re-rendered with a different `selectedTracks`, `transpose`, or `muteChannels`, the tick base stays the same (the underlying MIDI timeline is unchanged) — only the note layout changes. This means the player can keep ticking without needing to be reloaded when the user re-filters the score.

If the score is re-rendered due to a different `transpose` value, the note positions change but the `data-start-tick`/`data-end-tick` attributes remain tied to the same musical events, so highlighting stays accurate.

### Pausing, Seeking, and Stopping

The renderer does not manage playback state. It only reacts to whatever tick the caller provides. To handle pause/seek/stop:

-   **Pause**: Stop calling `updatePlayhead` / `highlightActiveNotes`. The playhead stays where it was last drawn.
-   **Seek**: Call both methods with the new tick — they will jump the playhead and refresh the highlight.
-   **Stop**: Call `updatePlayhead(0, pos, ...)` and `highlightActiveNotes(0, 0, ...)` to reset the visual state to the beginning.

### Performance Notes

-   `highlightActiveNotes()` uses `querySelectorAll('g.music-notation')` and iterates in a scoped subtree when `measureNumber` is supplied. For scores with hundreds of measures, always pass a measure number.
-   `updatePlayhead()` triggers a single attribute update per call (four attributes on one `<line>`). It is safe to call every animation frame.
-   The auto-scroll uses `scrollTo({ behavior: 'smooth' })`. On low-end devices this can cause jank if called every frame; consider throttling to ~30 Hz or calling it only when the system changes (compare `activeSystem.dataset.systemNumber` to the previous value).

---

## Integration Notes

### Selecting Tracks in the UI

The HTML demo exposes a multi-track selector. It works as follows:

1.  `MidiParser.parse()` is called once when the MIDI file is loaded.
2.  Tracks with **no note events** (meta tracks) are filtered out of the UI list, but remain in the parsed data so their meta events are preserved.
3.  Each visible track remembers its original `channels` array.
4.  When the user selects one or more tracks, the UI collects all unique channels from those tracks and sends them to `convert()` via the `selectedChannels` option.
5.  `MidiToMusicXML` filters notes per channel while keeping meta tracks intact, ensuring lyrics and tempo markings still appear.

### Auto-Split

`autoSplit: true` enables automatic staff splitting based on note range. The decision uses two conditions that must both pass:

1.  `range >= minSplitRange` — hard floor (default `30` semitones ≈ 2.5 octaves).
2.  `range >= threshold` — primary threshold (`splitThreshold`, or `14` for piano programs).

Parts that fail the floor are never auto-split, even if their `splitThreshold` would otherwise trigger a split. Combine with `splitPoint` or `splitPoints` for manual override.

### Lyric Channel Gating

When `lyricChannelId` is set (e.g. `4`), lyrics are rendered **only** if the channel is present in the final score. If the channel is not active in the current selection, lyrics are disabled entirely. This prevents lyrics from being attached to non-melody parts when the user is viewing only accompaniment tracks.

### Snap Options

`snapPosition` and `snapDuration` are useful when the source MIDI data has slightly off-grid timings. Both use **note-fractions**:

| Value | Meaning |
|---|---|
| `0.25` | 1/4 note |
| `0.125` | 1/8 note |
| `0.0625` | 1/16 note |

Example:

```js
const converter = new MidiToMusicXML();
converter.convert(buffer, {
    snapPosition: 0.125,
    snapDuration: 0.125
});
```

### Mute Channels vs. Playback Mute

**Mute is a playback-only concept.** It does not affect the rendered score in any way.

-   **Playback mute** silences one or more MIDI channels at the audio layer (libtimidity). The notes remain visible in the score — only their sound is suppressed during playback.
-   **The score always renders all active channels**, regardless of any mute state. This is intentional: the user can silence a part while practicing (e.g., muting the vocal line to sing along) without losing the visual reference of that part.

In the vocal training app, playback mute is applied via `applyMuteToPlayer(mutedChannels)`, which forwards the list of muted channels to the player. The `MusicXMLSVGRenderer` and `MusicXMLPDFRenderer` never see this list, and the underlying MusicXML is not regenerated.

If you need to **remove** a channel from the rendered score entirely (e.g., to produce a piano-only lead sheet), use the `selectedChannels` option instead:

```js
// Render only channels 0 and 1 in the score
const converter = new MidiToMusicXML();
converter.convert(buffer, {
    selectedChannels: [0, 1]
});
```

To summarize:

| Concept | Affects Score? | Affects Playback? | Mechanism |
| --- | --- | --- | --- |
| Playback mute | No | Yes | Audio layer (libtimidity) |
| `selectedChannels` | Yes | No (unless player is reloaded) | Score generation (MusicXML) |

### Auto-Clef for Hanging Melodies

Melodies that are notated in treble clef but sit mostly below the staff (common in pop vocals, baritone leads, and bass-heavy arrangements) can push the note heads down into the lyric row. Both `MusicXMLSVGRenderer` and `MusicXMLPDFRenderer` support the same auto-clef behaviour so the on-screen and printed scores stay consistent.

Default behaviour is on:

```js
const renderer = new MusicXMLSVGRenderer('score-container', {
    // ...other options...
    // autoClef: true is the default — nothing to add here
});
```

To disable per render (e.g. when the user explicitly wants the original clef preserved):

```js
new MusicXMLSVGRenderer('score-container', {
    // ...other options...
    autoClef: false
});
```

To allow the alto clef as a third candidate (useful for viola or trombone parts):

```js
new MusicXMLSVGRenderer('score-container', {
    // ...other options...
    autoClef: true,
    allowAltoClef: true
});
```

To tune the treble ↔ bass swap point:

```js
new MusicXMLSVGRenderer('score-container', {
    // ...other options...
    autoClef: true,
    allowAltoClef: false,
    clefGtoFThreshold: 6   // aggressive: anything below B4 is switched to bass
});
```

The decision is made once at the start of `render()` and applies to the whole part. Mid-piece clef changes that are explicitly encoded in the MusicXML are respected — only the initial clef is overridden.


## Compact PDF Export

When exporting a ZIP of per-track PDFs, three settings keep the archive small:

- `pdfRenderer.doc.compress = true` — deflates every PDF stream. Set this before calling `render()` so that jsPDF compresses the content on the first `output()` call.

- `pdfRenderer.doc.setProperties({ title: '', subject: '', author: '', keywords: '', creator: '' })` — strips repeated metadata that otherwise bloats each file with the same title/composer string.

- `zip.generateAsync({ compression: 'DEFLATE', compressionOptions: { level: 9 } })` — applies maximum deflate at the ZIP layer. JSZip's default is STORE (no compression), so this is the single most impactful change.

Combined, these typically reduce the archive size by 45–65% compared to the default export.


## Comment System (SVG Renderer)

The SVG renderer includes a built-in comment layer that lets users attach text notes to any tick position on the score. Comments are rendered natively as SVG elements inside a dedicated overlay group, so they participate in the same coordinate system as the score and remain correctly positioned across re-renders, viewport resizes, and layout changes.

The comment system is **transport-agnostic**: the renderer never talks to a server. Instead, it exposes a set of callbacks that the host application implements to persist changes. This keeps the renderer independent of your backend.

---

### Overview

- **Native rendering** — comments are drawn as `<g class="comment-indicator">` elements inside `<g id="comments-overlay">`, appended to the SVG root after the last system.
- **Tick-anchored** — each comment stores a MIDI tick. Its on-screen position is derived from the tick using the same DOM-driven conversion as the playhead.
- **Collision-aware** — when two comments would overlap, the later one is automatically stacked above the earlier one, so every comment remains clickable.
- **Multi-user ready** — comments record an `author` ID and a `color`. Only the author can edit or delete their own comment by default.
- **Track-aware** — comments can be filtered by MIDI track, with optional global comments that appear on every track.
- **Per-user filtering** — the host can display only comments from a specific user.
- **Non-destructive toggling** — show/hide and mode changes do not rebuild the overlay.

---

### Data Model

Each comment is a plain object with the following fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | number \| string | yes | Unique identifier (usually `track_comment_id` from the server). |
| `midiTrackId` | number | yes | MIDI track the comment belongs to. Use `-1` (or `null`) for a *global* comment that appears on every track. |
| `tick` | number | yes | MIDI tick position. Uses the same tick base as the rendered score. |
| `comment` | string | yes | The comment text (plain text only). |
| `author` | number \| string | yes | ID of the user who created the comment. |
| `color` | string | yes | Background color of the callout (e.g. `'#dc2626'`). Choose per-user so different users are visually distinguishable. |
| `authorName` | string | no | Display name — used only for tooltips or dialogs. |
| `isFromClient` | boolean | no | Semantic flag indicating whether the comment came from a client (vs. a composer). Used by custom `canEdit` policies. |

The `id` may be provided as either `id` or `track_comment_id` — the renderer normalizes both.

---

### Constructor Properties

The comment system adds the following instance properties to `MusicXMLSVGRenderer`:

| Property | Type | Default | Description |
|---|---|---|---|
| `comments` | Array | `[]` | Currently rendered comments. |
| `commentsVisible` | boolean | `true` | Whether the overlay is displayed. |
| `commentMode` | boolean | `false` | Whether comments are interactive (drag, click, create). |
| `commentAuthor` | string \| number \| null | `null` | ID of the logged-in user. |
| `commentTrackFilter` | number \| null | `null` | Currently active MIDI track. `null` = all tracks. |
| `commentUserFilter` | string \| number \| null | `null` | Show only comments from this user. `null` = all users. |
| `commentCallbacks` | Object | `{}` | Callback registry (see below). |

---

### Main Methods

#### `setComments(comments)`

Replaces the entire comment list and rebuilds the overlay.

```js
renderer.setComments([
    { id: 1, midiTrackId: 2, tick: 960, comment: 'Ba',  author: 'client-1', color: '#dc2626' },
    { id: 2, midiTrackId: 2, tick: 1920, comment: 'nga', author: 'client-2', color: '#0f766e' }
]);
```

#### `addComment(comment)`

Adds a comment, or replaces an existing one with the same `id`. Rebuilds the overlay.

#### `updateComment(id, changes)`

Merges `changes` into the comment with the given `id`. Rebuilds the overlay.

```js
renderer.updateComment(2, { tick: 2400, comment: 'nga (revised)' });
```

#### `removeComment(id)`

Removes a comment by ID. Rebuilds the overlay.

---

### Visibility & Mode

#### `showComments()` / `hideComments()`

Toggle visibility without rebuilding the overlay.

```js
renderer.showComments();
renderer.hideComments();
```

#### `setCommentMode(on)`

Enables or disables interaction. When `on = true`, the overlay is shown and dragging / clicking / creating is enabled. When `on = false`, the overlay is hidden and cursors are reset to `default`.

```js
renderer.setCommentMode(true);
```

> **Note:** `setCommentMode` does not trigger a full rebuild. It only updates the overlay's `display` and refreshes each icon's cursor. If you need to change the visible set of comments, use `setCommentTrackFilter` or `setCommentUserFilter` instead.

---

### Identity

#### `setCommentAuthor(id)`

Tells the renderer who is currently logged in. This is used by `canEditComment()` to decide which comments can be edited.

```js
renderer.setCommentAuthor('client-1');
```

Pass `null` to reset — in that case, no comment is editable unless a custom `canEdit` policy is provided.

#### `isMyComment(comment)`

Returns `true` if the comment was created by the current `commentAuthor`. Used internally to add the `is-mine` CSS class (see styling section).

---

### Filtering

#### `setCommentTrackFilter(midiTrackId)`

Show only comments for one or more specific MIDI tracks.

- Accepts a single track ID (`number`), an array of IDs (`Array<number>`), or `null`.

-  Comments with `midiTrackId === -1` (global) are always visible.

```js
// Show comments for MIDI track 3 (and global comments)
renderer.setCommentTrackFilter(3);

// Show comments for MIDI tracks 2, 3, and 5 (plus global comments)
renderer.setCommentTrackFilter([2, 3, 5]);

// Show comments from every track
renderer.setCommentTrackFilter(null);
```

#### `setCommentUserFilter(userId)`

Show only comments authored by a specific user.

```js
renderer.setCommentUserFilter('client-1');   // only client-1's comments
renderer.setCommentUserFilter(null);          // everyone
```

Both setters trigger a rebuild because they change which icons are drawn.

---

### Callback Setters

Callbacks are registered individually for clarity. Every setter returns `this`, so calls can be chained.

| Method | Callback signature | Called when |
|---|---|---|
| `setOnCreateRequest(fn)` | `(tick, midiTrackId, clientX, clientY) => void` | User clicks an empty area in comment mode. |
| `setOnEditRequest(fn)` | `(comment, event) => void` | User clicks an editable comment. |
| `setOnMoveRequest(fn)` | `(comment, newTick) => void` | User finishes dragging a comment. |
| `setOnCommentError(fn)` | `(err, action, comment?) => void` | A callback throws an exception. |
| `setCanEditComment(fn)` | `(comment, currentAuthor) => boolean` | Before rendering any comment, to determine editability. |

The batch setter `setCommentCallbacks({...})` is still available if you prefer to pass all callbacks at once.

```js
renderer.setCommentCallbacks({
    onCreateRequest: handleCreate,
    onEditRequest:   handleEdit,
    onMoveRequest:   handleMove
});
```

#### Default `canEdit` policy

If no custom policy is set, `canEditComment()` returns `true` only when `comment.author === commentAuthor`. This is the correct behaviour for multi-user scenarios where each user can only edit their own comments.

For more complex policies (e.g., "composer may delete client comments"), override via `setCanEditComment`:

```js
renderer.setCanEditComment((comment, me) => {
    if (MY_ROLE === 'composer' && comment.isFromClient) return true;
    return String(comment.author) === String(me);
});
```

---

### Coordinate Conversion

Two public methods expose the tick ↔ pixel mapping. They are used internally by the comment system, but are useful for building custom UI.

#### `tickToCoordinates(tick)`

Returns the SVG coordinates of a tick position.

```js
const coords = renderer.tickToCoordinates(960);
// → { x, y, systemNumber, measureNumber, progress }
```

#### `coordinatesToTick(x, y)`

Converts SVG coordinates back to a tick.

```js
const tick = renderer.coordinatesToTick(450, 180);
```

Both methods operate in the SVG's internal coordinate system (viewBox space). They are exact inverses of each other, so a roundtrip is lossless modulo integer rounding on the tick.

---

### Interaction Behaviour

#### Creating a comment

When `commentMode` is `true`, clicking anywhere on the score that is **not** a comment triggers `onCreateRequest`. The renderer passes the tick and the client coordinates so your UI can position a dialog:

```js
renderer.setOnCreateRequest(async (tick, midiTrackId, clientX, clientY) => {
    const text = await openInputDialog({ tick, clientX, clientY });
    if (!text) return;

    const res = await fetch('api/comment.php', { method: 'POST', body: JSON.stringify({ ... }) })
        .then(r => r.json());

    if (res.success) {
        renderer.addComment({
            id: res.track_comment_id,
            midiTrackId,
            tick,
            comment: text,
            author: MY_USER_ID,
            color: MY_COLOR
        });
    }
});
```

#### Editing a comment

Clicking an editable comment triggers `onEditRequest`. The renderer does **not** provide a built-in edit dialog — you implement one and call `updateComment` / `removeComment` after the server responds.

```js
renderer.setOnEditRequest((comment, event) => {
    openEditDialog({
        comment,
        onSave: async (newText) => {
            await fetch('api/comment.php', {
                method: 'PUT',
                body: JSON.stringify({ track_comment_id: comment.id, content: newText })
            });
            renderer.updateComment(comment.id, { comment: newText });
        },
        onDelete: async () => {
            await fetch('api/comment.php', {
                method: 'DELETE',
                body: JSON.stringify({ track_comment_id: comment.id })
            });
            renderer.removeComment(comment.id);
        }
    });
});
```

#### Moving a comment

Dragging a comment updates its visual position in real time. On mouse/touch release, `onMoveRequest` is called with the new tick.

```js
renderer.setOnMoveRequest(async (comment, newTick) => {
    const oldTick = comment.tick;
    try {
        const res = await fetch('api/comment.php', {
            method: 'PUT',
            body: JSON.stringify({ track_comment_id: comment.id, tick: newTick })
        }).then(r => r.json());
        if (!res.success) throw new Error(res.error);
        renderer.updateComment(comment.id, { tick: newTick });
    } catch {
        renderer.updateComment(comment.id, { tick: oldTick });
    }
});
```

If you don't provide `onMoveRequest`, dragging is a no-op — the icon snaps back to its rendered position on the next rebuild.

#### Collision stacking

When two comments would overlap, the renderer pushes the later one up by one box height (plus a small gap) and re-checks. This repeats until a free vertical slot is found or a maximum number of attempts is reached. The stacking is entirely visual: the stored `tick` is unchanged.

---

### Styling

The renderer adds the class `comment-indicator` to every icon. If the comment belongs to the current `commentAuthor`, the class `is-mine` is also added. You can use this for visual distinction:

```css
.comment-indicator.is-mine rect {
    stroke: #ffffff;
    stroke-width: 2;
}
.comment-indicator.is-mine {
    filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.4));
}
```

The background color of the callout is set per-comment via the `color` field — this is how different users are visually distinguished. Choose a deterministic color function on the server or client:

```js
function colorFor(authorId) {
    let hash = 0;
    for (const ch of String(authorId)) hash = ch.charCodeAt(0) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash % 360)}, 65%, 45%)`;
}
```

---

### Complete Integration Example

```js
// --- Setup ---
const renderer = new MusicXMLSVGRenderer('score-content', scoreOptions);

renderer.setCommentAuthor(CURRENT_USER_ID);
renderer.setCommentTrackFilter(currentMidiTrackId());
renderer.setCommentMode(true);

// --- Callbacks ---
renderer
    .setOnCreateRequest(async (tick, midiTrackId, clientX, clientY) => {
        const text = await openInputDialog({ tick, clientX, clientY });
        if (!text) return;
        const res = await postComment({ trackId: TRACK_ID, midiTrackId, tick, text });
        if (res.success) {
            renderer.addComment({
                id: res.track_comment_id,
                midiTrackId,
                tick,
                comment: text,
                author: CURRENT_USER_ID,
                color: colorFor(CURRENT_USER_ID)
            });
        }
    })
    .setOnEditRequest((comment, event) => {
        openEditDialog({
            comment,
            onSave: async (newText) => {
                await putComment(comment.id, { content: newText });
                renderer.updateComment(comment.id, { comment: newText });
            },
            onDelete: async () => {
                await deleteComment(comment.id);
                renderer.removeComment(comment.id);
            }
        });
    })
    .setOnMoveRequest(async (comment, newTick) => {
        const oldTick = comment.tick;
        try {
            await putComment(comment.id, { tick: newTick });
            renderer.updateComment(comment.id, { tick: newTick });
        } catch {
            renderer.updateComment(comment.id, { tick: oldTick });
        }
    })
    .setOnCommentError((err, action, comment) => {
        console.error(`[comment:${action}]`, err, comment);
        showToast('Komentar gagal diproses');
    });

// --- Load comments ---
const { comments } = await fetch(`api/comment.php?track_id=${TRACK_ID}`).then(r => r.json());
renderer.setComments(comments.map(normalizeComment));

// --- React to track change ---
document.getElementById('track-select').addEventListener('change', (e) => {
    const v = e.target.value;
    renderer.setCommentTrackFilter(v === '' ? null : parseInt(v, 10));
});
```

---

### Complete Workflow

```
User clicks empty area
     │
     └─► onCreateRequest(tick, midiTrackId, x, y)
              ├─ Open input dialog
              ├─ POST to server
              └─ renderer.addComment({...})
                       └─ New icon appears at the tick position

User drags a comment
     │
     └─► onMoveRequest(comment, newTick)
              ├─ PUT to server
              └─ renderer.updateComment(id, { tick: newTick })

User clicks a comment
     │
     └─► onEditRequest(comment, event)
              ├─ Open edit dialog
              ├─ Save  → PUT + renderer.updateComment(id, { comment })
              └─ Delete → DELETE + renderer.removeComment(id)

User changes track
     │
     └─► renderer.setCommentTrackFilter(newTrackId)
              └─ Overlay re-renders with only the matching comments

User switches login
     │
     └─► renderer.setCommentAuthor(newUserId)
              └─ Cursors and is-mine classes refresh — no rebuild
```

### Callback Setters

Callbacks are registered **individually** rather than through a single configuration object. Every setter returns `this`, so calls can be chained. Passing `null` (or omitting the argument) removes the callback.

| Method | Callback signature | Called when |
|---|---|---|
| `setOnCreateRequest(fn)` | `(tick, midiTrackId, clientX, clientY) => void` | User clicks an empty area in comment mode. |
| `setOnEditRequest(fn)` | `(comment, event) => void` | User clicks an editable comment. |
| `setOnMoveRequest(fn)` | `(comment, newTick, newMidiTrackId) => void` | User finishes dragging a comment. |
| `setOnCommentError(fn)` | `(err, action, comment?) => void` | A callback throws an exception. |
| `setCanEditComment(fn)` | `(comment, currentAuthor) => boolean` | Before rendering any comment, to determine editability. |

#### Why individual setters?

- **Granular** — register only the callbacks your app actually handles. The others default to `null` and are simply ignored at runtime.
- **Chainable** — every setter returns `this`, so you can wire up the whole comment pipeline in one expression.
- **Updatable** — call a setter at any time to replace just that one callback, without touching the others.
- **Removable** — pass `null` to clear a single callback.

#### Registering callbacks

```js
const renderer = new MusicXMLSVGRenderer('score-content', scoreOptions);

renderer.setCommentAuthor(CURRENT_USER_ID);
renderer.setCommentMode(true);

renderer.setOnCreateRequest((tick, midiTrackId, clientX, clientY) => {
    // open input dialog and POST to server
});

renderer.setOnEditRequest((comment, event) => {
    // open edit dialog (Save / Delete)
});

renderer.setOnMoveRequest((comment, newTick, newMidiTrackId) => {
    // PUT new tick and new MIDI track ID to server
});
```

#### Chaining

Because every setter returns `this`, the same setup can be written as a fluent chain:

```js
renderer
    .setCommentAuthor(CURRENT_USER_ID)
    .setCommentTrackFilter(currentMidiTrackId())
    .setCommentMode(true)
    .setOnCreateRequest(handleCreate)
    .setOnEditRequest(handleEdit)
    .setOnMoveRequest(handleMove)
    .setOnCommentError(handleError)
    .setCanEditComment(myCanEditPolicy);
```

#### Replacing a callback

Call the setter again with a new function. The other callbacks are untouched:

```js
// Initial handler
renderer.setOnCreateRequest(handleCreateV1);

// Later — replace only this one
renderer.setOnCreateRequest(handleCreateV2);
```

#### Removing a callback

Pass `null` to unregister:

```js
renderer.setOnEditRequest(null);      // disable edit dialogs
renderer.setOnMoveRequest(null);      // disable dragging
renderer.setOnCommentError(null);     // stop receiving error reports
```

When a callback is `null`, the corresponding action becomes a silent no-op. For example:

- With `onCreateRequest = null`, clicking an empty area in comment mode does nothing.
- With `onEditRequest = null`, clicking an editable comment does nothing.
- With `onMoveRequest = null`, dragging still moves the icon visually during the drag, but no tick is submitted — the icon snaps back to its rendered position on the next rebuild.

#### Optional: batch setter

If you prefer to register several callbacks at once, the batch setter is still available. It merges the given keys into the existing registry — callbacks not mentioned are left as they are.

```js
renderer.setCommentCallbacks({
    onCreateRequest: handleCreate,
    onEditRequest:   handleEdit,
    onMoveRequest:   handleMove
});
```

You can freely mix individual and batch registration. Individual setters are the recommended style because they keep the intent of each call explicit.

---

### Notes and Caveats

- **Ticks are relative to the rendered score.** The `tick` values used by the comment system are the same values written to `data-start-tick` / `data-end-tick` during rendering. If the score is re-rendered with a different `selectedTracks`, `transpose`, or `muteChannels`, the tick base is unchanged — comment positions remain valid.
- **Comments are not persisted by the renderer.** Every mutation (create / edit / delete / move) must be sent to your server via the callbacks. The renderer only keeps a local in-memory copy for display.
- **Do not rebuild the overlay on every mouse move.** During a drag, only the icon's `transform` attribute is updated. The overlay rebuild happens only on `setComments`, `addComment`, `updateComment`, `removeComment`, and filter changes.
- **Mobile support.** Drag uses both `mousedown`/`mousemove` and `touchstart`/`touchmove`. Call `e.preventDefault()` is handled internally — no extra configuration is needed.
- **`commentMode` vs. `commentsVisible`.** `commentMode` controls whether interactions are allowed; `commentsVisible` controls whether the overlay is drawn at all. They are usually set together via `setCommentMode`, but `showComments` / `hideComments` can toggle visibility independently.
- **Overlay ordering.** The comment overlay is appended to the SVG root after all systems, and the playhead is re-appended to the top on every `updatePlayhead` call. As a result, the playhead may draw over comments. If you want comments to always sit above the playhead, wrap the playhead and comment layer in separate groups and manage `z`-order via DOM position instead.
```