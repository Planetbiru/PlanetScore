# PlanetScore

PlanetScore is a browser-based MIDI to sheet music renderer. It parses a MIDI file, converts it to MusicXML, and displays the result as responsive SVG notation with an optional PDF preview and download.

The project runs as a static web application. No build process or server-side component is required.

## Features

- Parse Standard MIDI files (`.mid` and `.midi`) in the browser.
- Convert MIDI events to MusicXML 4.0 Partwise format.
- Render MusicXML as scalable SVG sheet music.
- Generate a multi-page PDF score using jsPDF.
- Select one or more MIDI tracks or channels.
- Preserve tempo, time signature, key signature, and lyric metadata.
- Automatically split wide note ranges into multiple staves, with a **minimum-range floor** to protect narrow melodic parts (such as vocals).
- Gate lyrics to the correct channel so they are only rendered when the melody channel is present.
- Support percussion notation on MIDI channel 10.
- Fill rhythmic gaps with rests and split complex durations into tied notes.
- Optionally snap note positions and durations to a musical grid.
- Handle clef-specific notation correctly (treble, bass, and alto clefs) for both ledger lines and key signatures.
- Separate **playback mute** (audio-only) from **score mute** (visual filtering).

## Getting Started

1. Open `index.html` in a modern web browser.
2. Choose a MIDI file with the file picker.
3. Select the tracks or channels to display.
4. Adjust the available score options, such as staff splitting or snapping.
5. View the generated MusicXML and SVG score.
6. Generate and download the PDF score when needed.

The included `Tenggelam.mid` file can be used as a sample input.

For local development, serve the project directory with any static HTTP server if your browser restricts local file access. For example:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

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
const musicXML = MidiToMusicXML.convert(arrayBuffer, {
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
| `selectedTrack` | `number \| number[]` | `null` | Track index (or indices) to render (legacy). Resolves to that track's channels. Meta tracks are always preserved. |
| `lyricChannelId` | `number \| null` | `null` | 1-indexed MIDI channel that carries the lyrics (e.g. `4` = channel index 3). If the channel is absent from the rendered score, lyrics are disabled entirely. |
| `autoSplit` | `boolean` | `false` | Automatically split channels with a wide note range. |
| `splitThreshold` | `number` | `24` | Primary threshold (semitones) for automatic split. Lowered to `14` automatically for piano (program 0–7). |
| `minSplitRange` | `number` | `30` | Hard floor (semitones). Parts with a smaller range are **never** auto-split, regardless of `splitThreshold`. Set to `0` to disable the floor. |
| `splitPoint` | `number \| null` | `null` | MIDI note used for a two-staff split. Bypasses both thresholds. |
| `splitPoints` | `number[] \| null` | `null` | Two MIDI notes used for a three-staff split (e.g. `[71, 59]`). Bypasses both thresholds. |
| `muteChannels` | `number[]` | `[]` | Channels excluded from the rendered score. |
| `transpose` | `number` | `0` | Semitone offset. Drum channel (9) is never transposed. |
| `snapPosition` | `number \| null` | `null` | Snap note onsets to note fractions, such as `0.125` for eighth notes. |
| `snapDuration` | `number \| null` | `null` | Snap note durations to note fractions. |

Meta-only tracks are retained during conversion so that lyrics, tempo, and time-signature information remains available in the generated score.

#### `splitThreshold` vs `minSplitRange`

Two parameters control automatic staff splitting. Both conditions must pass for a part to be auto-split:

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

Setting `minSplitRange: 0` restores the legacy behavior (only `splitThreshold` matters).

### Render SVG

```js
const renderer = new MusicXMLSVGRenderer('score-container', {
	staffSpacing: 90,
	partSpacing: 65,
	systemSpacing: 80,
	autoDetectMobile: true
});

renderer.render(musicXML);
```

The SVG renderer supports responsive layouts, beams, ties, slurs, articulations, grand-staff braces, and an interactive playhead. Use `updatePlayhead()` to move the playhead and optionally scroll the score during playback.

#### Clef-Aware Notation

Ledger lines and key signatures are rendered with correct staff positions for treble (G), bass (F), and alto (C) clefs.

- **Ledger lines** are drawn only for notes that fall outside the staff range. Any ledger line that would overlap with one of the five staff lines is automatically skipped. Staff range is clef-aware.
- **Key signatures** use the correct diatonic positions for each clef. Alto clef uses the viola positions: `F4 C4 G4 D4 A3 E4 B3` for sharps and `B3 E4 A3 D4 G3 C4 F3` for flats.

### Render PDF

```js
const pdfRenderer = new MusicXMLPDFRenderer();
pdfRenderer.render(musicXML);
pdfRenderer.save('my-score.pdf');
```

The PDF renderer creates a vector-based, multi-page score. It requires the jsPDF browser library, which is loaded from CDN by `index.html`. Clef-aware ledger lines and key signatures are shared with the SVG renderer.

### Playback Mute vs. Score Mute

The `muteChannels` option affects the **rendered score** — notes from the listed channels are removed from the MusicXML.

Playback mute is applied separately at the audio layer (via the `TimidityPlayer` integration) and does not affect the rendered score. In the vocal training app, playback mute is applied with `applyMuteToPlayer()`, while the score always renders all channels. This lets a user silence one part during practice without hiding it from view.

## Project Structure

| File | Purpose |
| --- | --- |
| `index.html` | Browser demo and user interface. |
| `MidiParser.js` | MIDI binary parser. |
| `MidiToMusicXML.js` | MIDI-to-MusicXML conversion logic. |
| `MusicXMLSVGRenderer.js` | MusicXML-to-SVG renderer. |
| `MusicXMLPDFRenderer.js` | MusicXML-to-PDF renderer. |
| `style.css` | Styles for the standalone page. |
| `Tenggelam.mid` | Example MIDI file. |
| `manual.md` | Extended API and implementation documentation. |
| `*.min.js` | Minified distribution copies of the JavaScript libraries. |

## Dependencies

The core parser, converter, and SVG renderer use plain browser JavaScript. PDF generation uses [jsPDF](https://github.com/parallax/jsPDF), loaded from the CDN reference in `index.html`.

## Browser Support

Use a current version of Chrome, Edge, Firefox, or Safari with support for ES6 JavaScript, `ArrayBuffer`, the File API, SVG, and Blob URLs.

## License

No license file is currently included in this repository. Add a license before distributing the project outside its intended environment.
