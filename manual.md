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
-   **Track Selection (legacy)**: Supports `selectedTrack` (single integer) for backward compatibility, which internally resolves to a set of channels.
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

#### `static convert(midiBuffer, options = {})`

This is the main entry point for the conversion process.

-   **`midiBuffer`**: An `ArrayBuffer` or `Buffer` containing the MIDI file data.
-   **`options`**: An optional configuration object.

| Option | Type | Default | Description |
|---|---|---|---|
| `title` | string | `"Song Title"` | The title of the song. |
| `creator` | string | `"Composer Name"` | The name of the composer. |
| `divisions` | number | `4` | Divisions per quarter note in the generated MusicXML. |
| `selectedChannels` | number[] \| null | `null` | Array of MIDI channel numbers (0–15) to render. If not set, all channels are rendered. Meta tracks are always preserved. |
| `selectedTrack` | number \| number[] | `null` | Track index (or indices) to render (legacy). Internally resolves to that track's channels. Meta tracks (with no notes) are always preserved. |
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

The `tick` values used by the playhead and highlighting are the same values used during conversion. If the score is re-rendered with a different `selectedTrack`, `transpose`, or `muteChannels`, the tick base stays the same (the underlying MIDI timeline is unchanged) — only the note layout changes. This means the player can keep ticking without needing to be reloaded when the user re-filters the score.

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
4.  When the user selects one or more tracks, the UI collects all unique channels from those tracks and sends them to `MidiToMusicXML.convert()` via the `selectedChannels` option.
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
MidiToMusicXML.convert(buffer, {
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
MidiToMusicXML.convert(buffer, {
    selectedChannels: [0, 1]
});
```

To summarize:

| Concept | Affects Score? | Affects Playback? | Mechanism |
| --- | --- | --- | --- |
| Playback mute | No | Yes | Audio layer (libtimidity) |
| `selectedChannels` | Yes | No (unless player is reloaded) | Score generation (MusicXML) |
