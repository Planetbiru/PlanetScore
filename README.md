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
- Automatically split wide note ranges into multiple staves.
- Support percussion notation on MIDI channel 10.
- Fill rhythmic gaps with rests and split complex durations into tied notes.
- Optionally snap note positions and durations to a musical grid.

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
	autoSplit: true,
	splitPoint: 60,
	snapPosition: 0.125,
	snapDuration: 0.125
});
```

Supported conversion options include:

| Option | Type | Description |
| --- | --- | --- |
| `title` | `string` | Score title. |
| `creator` | `string` | Composer or creator name. |
| `selectedChannels` | `number[]` | MIDI channels to render. If omitted, all channels are rendered. |
| `selectedTrack` | `number` | Legacy single-track selection. |
| `autoSplit` | `boolean` | Automatically split channels with a wide note range. |
| `splitPoint` | `number` | MIDI note used for a two-staff split. |
| `splitPoints` | `number[]` | Two MIDI notes used for a three-staff split. |
| `snapPosition` | `number \| null` | Snap note onsets to note fractions, such as `0.125` for eighth notes. |
| `snapDuration` | `number \| null` | Snap note durations to note fractions. |

Meta-only tracks are retained during conversion so that lyrics, tempo, and time-signature information remains available in the generated score.

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

### Render PDF

```js
const pdfRenderer = new MusicXMLPDFRenderer();
pdfRenderer.render(musicXML);
pdfRenderer.save('my-score.pdf');
```

The PDF renderer creates a vector-based, multi-page score. It requires the jsPDF browser library, which is loaded from CDN by `index.html`.

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

