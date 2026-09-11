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
    -   `autoSplit: true`: Automatically splits a channel into two staves if its note range exceeds a `splitThreshold`.
    -   `splitPoint`: A specific MIDI note number (e.g., `60` for Middle C) to force a two-stave split.
    -   `splitPoints`: An array of two MIDI note numbers (e.g., `[71, 59]`) to force a three-stave split (e.g., for organ).
-   **Drum Notation**: Provides special handling for percussion on MIDI channel 10, mapping drum notes to standard drum notation visuals (e.g., 'x' noteheads).
-   **Lyric Integration**: Attaches lyrics to notes based on their timing. Lyrics are placed on the first staff (or the lyric carrier channel), creating rests if necessary to hold the text.
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

| Option | Type | Description |
|---|---|---|
| `title` | string | The title of the song. |
| `creator` | string | The name of the composer. |
| `selectedChannels` | number[] | Array of MIDI channel numbers (0–15) to render. If not set, all channels are rendered. Meta tracks are always preserved. |
| `selectedTrack` | number | Single track index (legacy). Internally resolves to that track's channels. |
| `autoSplit` | boolean | Enables automatic channel splitting. |
| `splitPoint` | number | Forces a two-stave split at the given MIDI note. |
| `splitPoints` | array | Forces a three-stave split. |
| `snapPosition` | number \| null | Snaps note onsets to the nearest multiple of this value (in note-fractions). |
| `snapDuration` | number \| null | Snaps note durations to the nearest multiple of this value (in note-fractions). |

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

## Integration Notes

### Selecting Tracks in the UI

The HTML demo exposes a multi-track selector. It works as follows:

1.  `MidiParser.parse()` is called once when the MIDI file is loaded.
2.  Tracks with **no note events** (meta tracks) are filtered out of the UI list, but remain in the parsed data so their meta events are preserved.
3.  Each visible track remembers its original `channels` array.
4.  When the user selects one or more tracks, the UI collects all unique channels from those tracks and sends them to `MidiToMusicXML.convert()` via the `selectedChannels` option.
5.  `MidiToMusicXML` filters notes per channel while keeping meta tracks intact, ensuring lyrics and tempo markings still appear.

### Auto-Split

`autoSplit: true` enables automatic staff splitting based on note range. Combine with `splitPoint` or `splitPoints` for manual control.

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

