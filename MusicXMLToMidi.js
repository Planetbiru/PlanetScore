/**
 * MusicXMLToMidi converts a MusicXML 4.0 Partwise document into a valid
 * Standard MIDI File (SMF) byte array.
 *
 * The converter walks every <part> measure-by-measure, accumulates note
 * start/duration in a canonical PPQ grid, handles <backup>/<forward> for
 * multi-voice measures, resolves ties (merging tied segments into a single
 * note), maps pitch/alter/octave to MIDI note numbers, translates
 * <midi-instrument> metadata to channels & programs, and finally emits a
 * format-0 (single part) or format-1 (multipart) MIDI file.
 *
 * Supported MusicXML features:
 *   - <attributes>: divisions, time, key, clef (ignored), staves (ignored)
 *   - <note>: pitch, unpitched (percussion), rest, chord, grace, tie,
 *             tied, duration, voice, staff, lyric, notations/dynamics
 *   - <backup> / <forward>
 *   - <direction>: sound tempo, metronome, dynamics
 *   - <sound>: tempo, dynamics
 *   - <midi-instrument>: midi-channel, midi-program, midi-unpitched
 *
 * Works in browsers (DOMParser) and Node.js (@xmldom/xmldom).
 *
 * @author Kamshory (counterpart to MidiToMusicXML)
 */
class MusicXMLToMidi {

    constructor() {
        this.parsed = null;
        this.midiBytes = null;
    }

    /**
     * Converts a MusicXML partwise string into a Standard MIDI File.
     *
     * @param {string} xmlString   - Complete MusicXML 4.0 partwise document.
     * @param {Object} [options={}]
     * @param {number}  [options.ppq=480]              - MIDI Pulses Per Quarter note.
     * @param {number}  [options.defaultTempo=120]     - Fallback tempo if none found.
     * @param {number}  [options.defaultVelocity=80]   - Fallback velocity (0-127).
     * @param {boolean} [options.includeLyrics=false]  - Emit <lyric> as MIDI lyric meta.
     * @param {boolean} [options.format1=true]         - Force format 1 even for single part.
     * @returns {Uint8Array} Raw MIDI file bytes (MThd … tracks …).
     *
     * @throws {Error} If XML cannot be parsed, or is not score-partwise.
     *
     * @example
     * const conv = new MusicXMLToMidi();
     * const bytes = conv.convert(xmlString, { ppq: 960, includeLyrics: true });
     * fs.writeFileSync('output.mid', Buffer.from(bytes));
     */
    convert(xmlString, options = {}) {
        const opts = Object.assign({
            ppq: 512,
            defaultTempo: 120,
            defaultVelocity: 80,
            includeLyrics: true,          // default true for round-trip
            lyricMetaType: 0x05,          // 0x05 | 0x01 | 'both'
            lyricVerse: null,             // null = take all verses; number = specific verse
            format1: true,
        }, options);

        const doc = this._parseXML(xmlString);
        const root = doc.documentElement;

        if (!root || root.tagName !== 'score-partwise') {
            throw new Error('Only <score-partwise> MusicXML is supported');
        }

        const partInfo   = this._buildPartInfo(root);
        const globalTempos = [];
        const tracks     = [];

        const partEls = this._getDirectChildren(root, 'part');
        for (let i = 0; i < partEls.length; i++) {
            const partEl = partEls[i];
            const partId = partEl.getAttribute('id');
            const info   = partInfo[partId] || this._defaultPartInfo(i);
            const events = this._processPart(partEl, info, opts, globalTempos);
            tracks.push({ partId, info, events });
        }

        if (tracks.length === 0) {
            throw new Error('No <part> elements found');
        }

        this.parsed    = { tracks, partInfo, globalTempos };
        this.midiBytes = this._buildMidiFile(tracks, globalTempos, opts);
        return this.midiBytes;
    }

    // ---------------------------------------------------------------- getters

    getMidiBytes() { return this.midiBytes; }
    getParsed()    { return this.parsed; }

    /**
     * Channel (0-based) used for each rendered part, in document order.
     * @returns {Array<number|null>}
     */
    getMidiChannel() {
        return (this.parsed?.tracks || []).map(t => t.info.channel ?? null);
    }

    /**
     * Track index (0-based) each part was written to. For format 0, all parts
     * map to track 0. For format 1, part i → track i + 1.
     * @returns {Array<number>}
     */
    getMidiTrackId() {
        const tracks = this.parsed?.tracks || [];
        const multi  = tracks.length > 1 || this.parsed?.format1;
        return tracks.map((_, i) => (multi ? i + 1 : 0));
    }

    /**
     * Browser convenience: trigger a download of the last generated MIDI.
     */
    downloadMidi(filename = 'output.mid') {
        if (!this.midiBytes) return;
        const blob = new Blob([this.midiBytes], { type: 'audio/midi' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ---------------------------------------------------------------- XML I/O

    _parseXML(xmlString) {
        if (typeof DOMParser !== 'undefined') {
            const doc = new DOMParser().parseFromString(xmlString, 'application/xml');
            const err = doc.querySelector && doc.querySelector('parsererror');
            if (err) throw new Error('XML parse error: ' + err.textContent);
            return doc;
        }
        let Parser;
        try { Parser = require('@xmldom/xmldom').DOMParser; }
        catch (_) { Parser = require('xmldom').DOMParser; }
        return new Parser().parseFromString(xmlString, 'application/xml');
    }

    _getDirectChildren(el, tagName) {
        const out = [];
        const ch = el.childNodes;
        for (let i = 0; i < ch.length; i++) {
            if (ch[i].nodeType === 1 && ch[i].tagName === tagName) out.push(ch[i]);
        }
        return out;
    }

    _getFirstChild(el, tagName) {
        const ch = el.childNodes;
        for (let i = 0; i < ch.length; i++) {
            if (ch[i].nodeType === 1 && ch[i].tagName === tagName) return ch[i];
        }
        return null;
    }

    _getTextContent(el) {
        if (!el) return '';
        return (el.textContent || '').trim();
    }

    _getChildText(el, tagName) {
        return this._getTextContent(this._getFirstChild(el, tagName));
    }

    _getAttr(el, name, defaultValue = null) {
        if (!el) return defaultValue;
        const v = el.getAttribute(name);
        return v === null || v === '' ? defaultValue : v;
    }

    // ------------------------------------------------------------- part info

    _buildPartInfo(root) {
        const partList = this._getFirstChild(root, 'part-list');
        if (!partList) return {};

        const info = {};
        for (const sp of this._getDirectChildren(partList, 'score-part')) {
            const id     = sp.getAttribute('id');
            const nameEl = this._getFirstChild(sp, 'part-name');
            const name   = this._getTextContent(nameEl);

            let channel = null;
            let program = 0;
            const instrumentMap = {};

            for (const mi of this._getDirectChildren(sp, 'midi-instrument')) {
                const instId = mi.getAttribute('id');
                const chEl   = this._getFirstChild(mi, 'midi-channel');
                const prEl   = this._getFirstChild(mi, 'midi-program');
                const upEl   = this._getFirstChild(mi, 'midi-unpitched');

                if (chEl && channel === null) {
                    const n = parseInt(this._getTextContent(chEl), 10);
                    if (!isNaN(n)) channel = n - 1;           // → 0-based
                }
                if (prEl && program === 0) {
                    const n = parseInt(this._getTextContent(prEl), 10);
                    if (!isNaN(n)) program = Math.max(0, n - 1);
                }
                if (upEl && instId) {
                    const n = parseInt(this._getTextContent(upEl), 10);
                    if (!isNaN(n)) instrumentMap[instId] = n - 1;
                }
            }

            if (channel === null && /drum|percussion/i.test(name)) channel = 9;

            info[id] = { name, channel, program, instrumentMap, isDrum: channel === 9 };
        }
        return info;
    }

    _defaultPartInfo(index) {
        let ch = index;
        if (ch >= 9) ch += 1;
        if (ch >= 16) ch = ch % 16;
        return { name: 'Part ' + (index + 1), channel: ch, program: 0, instrumentMap: {}, isDrum: ch === 9 };
    }

    // ----------------------------------------------------------- part → events

    _processPart(partEl, info, opts, globalTempos) {
        const events = [];
        const ppq = opts.ppq;

        let currentTick = 0;   // canonical PPQ ticks
        let divisions   = 1;   // MusicXML divisions per quarter

        const state = { velocity: opts.defaultVelocity };
        const lastNoteStart = new Map();   // voice_staff → tick
        const openTies      = new Map();   // tieKey     → event index

        const measures = this._getDirectChildren(partEl, 'measure');
        for (const measure of measures) {
            const children = Array.from(measure.childNodes).filter(n => n.nodeType === 1);
            for (const child of children) {
                switch (child.tagName) {
                    case 'attributes': {
                        const divEl = this._getFirstChild(child, 'divisions');
                        if (divEl) {
                            const d = parseInt(this._getTextContent(divEl), 10);
                            if (d > 0) divisions = d;
                        }
                        const timeEl = this._getFirstChild(child, 'time');
                        if (timeEl) this._emitTimeSignature(events, currentTick, timeEl);

                        const keyEl = this._getFirstChild(child, 'key');
                        if (keyEl) this._emitKeySignature(events, currentTick, keyEl);
                        break;
                    }
                    case 'note': {
                        currentTick = this._processNote(child, events, currentTick, {
                            ppq, divisions, channel: info.channel,
                            info, opts, state, lastNoteStart, openTies
                        });
                        break;
                    }
                    case 'backup': {
                        const dur = parseInt(this._getChildText(child, 'duration'), 10) || 0;
                        currentTick -= Math.round(dur * ppq / divisions);
                        break;
                    }
                    case 'forward': {
                        const dur = parseInt(this._getChildText(child, 'duration'), 10) || 0;
                        currentTick += Math.round(dur * ppq / divisions);
                        break;
                    }
                    case 'direction': {
                        this._processDirection(child, events, currentTick, state, globalTempos);
                        break;
                    }
                    case 'sound': {
                        this._processSound(child, globalTempos, currentTick);
                        break;
                    }
                }
            }
        }

        // Prefix program change (channel resolved later if still null)
        if (info.channel !== null && info.channel >= 0 && info.channel < 16) {
            events.unshift({
                tick: 0, type: 'programChange',
                channel: info.channel, program: info.program || 0
            });
        }

        return events;
    }

    _processDirection(dirEl, events, tick, state, globalTempos) {
        const dirType = this._getFirstChild(dirEl, 'direction-type');
        if (dirType) {
            // Metronome tempo
            const metro = this._getFirstChild(dirType, 'metronome');
            if (metro) {
                const pm = parseFloat(this._getChildText(metro, 'per-minute'));
                if (!isNaN(pm) && pm > 0) globalTempos.push({ tick, bpm: pm });
            }
            // Dynamics
            const dyn = this._getFirstChild(dirType, 'dynamics');
            if (dyn && dyn.childNodes) {
                for (let i = 0; i < dyn.childNodes.length; i++) {
                    if (dyn.childNodes[i].nodeType === 1) {
                        state.velocity = this._dynamicToVelocity(dyn.childNodes[i].nodeName);
                        break;
                    }
                }
            }
        }
        // <sound> nested inside direction
        const sound = this._getFirstChild(dirEl, 'sound');
        if (sound) this._processSound(sound, globalTempos, tick);
    }

    _processSound(soundEl, globalTempos, tick) {
        const tempo = this._getAttr(soundEl, 'tempo');
        if (tempo !== null) {
            const bpm = parseFloat(tempo);
            if (!isNaN(bpm) && bpm > 0) globalTempos.push({ tick, bpm });
        }
    }

    _processNote(noteEl, events, currentTick, ctx) {
        const { ppq, divisions, channel, info, opts, state, lastNoteStart, openTies } = ctx;

        const isChord = !!this._getFirstChild(noteEl, 'chord');
        const isRest  = !!this._getFirstChild(noteEl, 'rest');
        const isGrace = !!this._getFirstChild(noteEl, 'grace');

        const durDivs  = parseInt(this._getChildText(noteEl, 'duration'), 10) || 0;
        const durTicks = Math.round(durDivs * ppq / divisions);

        const voice = this._getChildText(noteEl, 'voice') || '1';
        const staff = this._getChildText(noteEl, 'staff') || '1';
        const voiceStaffKey = voice + '_' + staff;

        const startTick = isChord ? (lastNoteStart.get(voiceStaffKey) ?? currentTick) : currentTick;

        // ==== FIX 1: emit lyric SEBELUM rest/grace early-return ====
        // MidiToMusicXML menempelkan lyric ke note DAN rest; skip chord & grace.
        if (opts.includeLyrics && !isChord && !isGrace) {
            this._emitLyric(noteEl, events, startTick, opts);
        }

        if (isGrace) {
            if (!isChord) { lastNoteStart.set(voiceStaffKey, startTick); return currentTick; }
            return currentTick;
        }

        if (isRest) {
            if (!isChord) { lastNoteStart.set(voiceStaffKey, startTick); return currentTick + durTicks; }
            return currentTick;
        }

        // ---- pitch resolution ----
        let pitch = null;
        const pitchEl = this._getFirstChild(noteEl, 'pitch');
        if (pitchEl) {
            pitch = this._pitchToMidi(
                this._getChildText(pitchEl, 'step'),
                this._getChildText(pitchEl, 'octave'),
                this._getChildText(pitchEl, 'alter')
            );
        } else {
            const unpitchedEl = this._getFirstChild(noteEl, 'unpitched');
            if (unpitchedEl) {
                const instEl = this._getFirstChild(noteEl, 'instrument');
                const instId = instEl ? instEl.getAttribute('id') : null;
                if (instId && info.instrumentMap[instId] !== undefined) {
                    pitch = info.instrumentMap[instId];
                } else {
                    pitch = this._unpitchedToMidi(
                        this._getChildText(unpitchedEl, 'display-step'),
                        this._getChildText(unpitchedEl, 'display-octave')
                    );
                }
            }
        }
        if (pitch === null) {
            if (!isChord) { lastNoteStart.set(voiceStaffKey, startTick); return currentTick + durTicks; }
            return currentTick;
        }

        // ---- tie detection ----
        const tieTypes = this._getTieTypes(noteEl);
        const tieKey   = `${channel}_${pitch}_${voice}_${staff}`;

        if (tieTypes.stop && openTies.has(tieKey)) {
            const prevIdx = openTies.get(tieKey);
            events[prevIdx].duration = (startTick + durTicks) - events[prevIdx].tick;
            if (!tieTypes.start) openTies.delete(tieKey);
            if (!isChord) { lastNoteStart.set(voiceStaffKey, startTick); return currentTick + durTicks; }
            return currentTick;
        }

        // ---- velocity ----
        let velocity = state.velocity;

        const velEl = this._getFirstChild(noteEl, 'velocity');
        if (velEl) {
            const v = parseInt(this._getTextContent(velEl), 10);
            if (!isNaN(v)) velocity = v;
        }

        // ==== FIX 2: baca <dynamics>NUM</dynamics> langsung di <note> ====
        const noteDynEl = this._getFirstChild(noteEl, 'dynamics');
        if (noteDynEl) {
            const raw = this._getTextContent(noteDynEl);
            const num = parseInt(raw, 10);
            if (!isNaN(num) && num > 0) {
                // MidiToMusicXML: dynamics = round(vel/127 * vol/127 * expr/127 * 100)
                // Inverse kasar (asumsi vol=100, expr=127): vel ≈ num * 127 * 1.27 / 100
                velocity = Math.max(1, Math.min(127, Math.round(num * 127 / 100)));
            } else {
                // Format standar <notations><dynamics><mf/></dynamics>
                const child = noteDynEl.childNodes;
                for (let i = 0; i < child.length; i++) {
                    if (child[i].nodeType === 1) {
                        velocity = this._dynamicToVelocity(child[i].nodeName);
                        break;
                    }
                }
            }
        }

        // ---- emit note ----
        const eventIdx = events.length;
        events.push({
            tick: startTick, type: 'note',
            channel, pitch,
            velocity: Math.max(1, Math.min(127, velocity)),
            duration: Math.max(0, durTicks)
        });

        if (tieTypes.start) openTies.set(tieKey, eventIdx);

        if (!isChord) { lastNoteStart.set(voiceStaffKey, startTick); return currentTick + durTicks; }
        return currentTick;
    }

    /**
     * Emit semua <lyric> pada note/rest sebagai meta event MIDI 0x05.
     * Mendukung multi-verse via `opts.lyricVerse` (1-based) dan
     * `opts.lyricMetaType` (0x05 = Lyric, 0x01 = Text, 'both').
     */
    _emitLyric(noteEl, events, tick, opts) {
        const lyricEls = [];
        const children = noteEl.childNodes;
        for (let i = 0; i < children.length; i++) {
            if (children[i].nodeType === 1 && children[i].tagName === 'lyric') {
                lyricEls.push(children[i]);
            }
        }
        if (lyricEls.length === 0) return;

        const metaTypes = opts.lyricMetaType === 'both'
            ? [0x05, 0x01]
            : [opts.lyricMetaType ?? 0x05];

        for (const lyricEl of lyricEls) {
            if (opts.lyricVerse != null) {
                const num = parseInt(lyricEl.getAttribute('number') || '1', 10);
                if (num !== opts.lyricVerse) continue;
            }
            const textEl = this._getFirstChild(lyricEl, 'text');
            if (!textEl) continue;
            const text = this._getTextContent(textEl);
            if (!text) continue;

            for (const mt of metaTypes) {
                events.push({
                    tick, type: 'meta',
                    metaType: mt,
                    data: this._stringToBytes(text)
                });
            }
        }
    }

    _getTieTypes(noteEl) {
        let start = false, stop = false;
        const collect = (tag) => {
            if (!noteEl.getElementsByTagName) return;
            const list = noteEl.getElementsByTagName(tag);
            for (let i = 0; i < list.length; i++) {
                const t = list[i].getAttribute('type');
                if (t === 'start' || t === 'continue') start = true;
                if (t === 'stop'    || t === 'continue') stop  = true;
            }
        };
        collect('tie');
        collect('tied');
        return { start, stop };
    }

    _pitchToMidi(step, octave, alter) {
        const semis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
        const oct = parseInt(octave, 10);
        const alt = alter ? parseInt(alter, 10) : 0;
        const v = (oct + 1) * 12 + (semis[step] ?? 0) + alt;
        return Math.max(0, Math.min(127, v));
    }

    _unpitchedToMidi(displayStep, displayOctave) {
        if (!displayStep) return 38; // Acoustic Snare default
        const semis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
        const oct = parseInt(displayOctave, 10) || 4;
        return Math.max(0, Math.min(127, (oct + 1) * 12 + (semis[displayStep] ?? 0)));
    }

    _dynamicToVelocity(name) {
        const map = {
            pppp: 8, ppp: 20, pp: 33, p: 49, mp: 64,
            mf: 80, f: 96, ff: 112, fff: 120, ffff: 127,
            sf: 100, sfz: 100, fp: 72
        };
        return map[(name || '').toLowerCase()] || 80;
    }

    _emitTimeSignature(events, tick, timeEl) {
        const beatsText = this._getChildText(timeEl, 'beats') || '4';
        let beats = 4;
        if (beatsText.includes('+')) {
            beats = beatsText.split('+').reduce((s, x) => s + (parseInt(x, 10) || 0), 0);
        } else {
            beats = parseInt(beatsText, 10) || 4;
        }
        const beatType = parseInt(this._getChildText(timeEl, 'beat-type'), 10) || 4;
        const dd = Math.max(0, Math.round(Math.log2(beatType)));

        events.push({
            tick, type: 'meta', metaType: 0x58,
            data: [beats & 0xFF, dd & 0xFF, 24, 8]
        });
    }

    _emitKeySignature(events, tick, keyEl) {
        const fifths = parseInt(this._getChildText(keyEl, 'fifths'), 10) || 0;
        const mode   = this._getChildText(keyEl, 'mode') || 'major';
        events.push({
            tick, type: 'meta', metaType: 0x59,
            data: [fifths & 0xFF, mode === 'minor' ? 1 : 0]
        });
    }

    _stringToBytes(str) {
        const bytes = [];
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            if (c < 0x80) bytes.push(c);
            else if (c < 0x800) {
                bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
            } else {
                bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
            }
        }
        return bytes;
    }

    // -------------------------------------------------------- MIDI file build

    _buildMidiFile(tracks, globalTempos, opts) {
        // Resolve default channels for parts that lacked one.
        const used = new Set();
        for (const t of tracks) {
            if (Number.isInteger(t.info.channel) && t.info.channel >= 0 && t.info.channel < 16) {
                used.add(t.info.channel);
            }
        }
        for (const t of tracks) {
            if (!Number.isInteger(t.info.channel) || t.info.channel < 0 || t.info.channel >= 16) {
                let ch = 0;
                while (used.has(ch) && ch < 16) ch++;
                if (ch === 9) ch = 10;
                if (ch >= 16) ch = 0;
                t.info.channel = ch;
                used.add(ch);
                for (const ev of t.events) if (ev.channel !== undefined) ev.channel = ch;
                if (!t.events.some(e => e.type === 'programChange')) {
                    t.events.unshift({ tick: 0, type: 'programChange', channel: ch, program: t.info.program || 0 });
                }
            }
        }

        const isMulti = tracks.length > 1 || (opts.format1 && tracks.length === 1);

        if (!isMulti) {
            // Format 0 — a single merged track.
            const all = [];
            for (const t of tracks) all.push(...t.events);
            this._appendTempos(all, globalTempos, opts.defaultTempo);
            const track = this._buildTrackChunk(all);
            return this._concatBytes([
                this._buildHeader(0, 1, opts.ppq),
                track
            ]);
        }

        // Format 1 — conductor + one track per part.
        const conductor = [];
        const seen = new Set();
        for (const t of tracks) {
            for (const ev of t.events) {
                if (ev.type === 'meta' && (ev.metaType === 0x58 || ev.metaType === 0x59)) {
                    const key = ev.metaType + '@' + ev.tick + ':' + ev.data.join(',');
                    if (!seen.has(key)) { seen.add(key); conductor.push({ ...ev }); }
                }
            }
        }
        this._appendTempos(conductor, globalTempos, opts.defaultTempo);

        const chunks = [this._buildTrackChunk(conductor)];

        for (const t of tracks) {
            const evs = t.events.filter(ev =>
                !(ev.type === 'meta' && (ev.metaType === 0x58 || ev.metaType === 0x59))
            );
            if (t.info.name) {
                evs.unshift({ tick: 0, type: 'meta', metaType: 0x03, data: this._stringToBytes(t.info.name) });
            }
            chunks.push(this._buildTrackChunk(evs));
        }

        return this._concatBytes([
            this._buildHeader(1, chunks.length, opts.ppq),
            ...chunks
        ]);
    }

    _appendTempos(events, globalTempos, defaultTempo) {
        const hasTempo = () => events.some(e => e.type === 'meta' && e.metaType === 0x51);
        if (globalTempos.length === 0) {
            const mspq = Math.round(60000000 / defaultTempo);
            events.push({
                tick: 0, type: 'meta', metaType: 0x51,
                data: [(mspq >> 16) & 0xFF, (mspq >> 8) & 0xFF, mspq & 0xFF]
            });
            return;
        }
        const seenTicks = new Set();
        for (const t of globalTempos) {
            if (seenTicks.has(t.tick)) continue;
            seenTicks.add(t.tick);
            const mspq = Math.round(60000000 / t.bpm);
            events.push({
                tick: t.tick, type: 'meta', metaType: 0x51,
                data: [(mspq >> 16) & 0xFF, (mspq >> 8) & 0xFF, mspq & 0xFF]
            });
        }
        if (!hasTempo()) {
            const mspq = Math.round(60000000 / defaultTempo);
            events.push({
                tick: 0, type: 'meta', metaType: 0x51,
                data: [(mspq >> 16) & 0xFF, (mspq >> 8) & 0xFF, mspq & 0xFF]
            });
        }
    }

    _buildHeader(format, numTracks, ppq) {
        return [
            0x4D, 0x54, 0x68, 0x64,           // MThd
            0x00, 0x00, 0x00, 0x06,           // length 6
            (format >> 8) & 0xFF, format & 0xFF,
            (numTracks >> 8) & 0xFF, numTracks & 0xFF,
            (ppq >> 8) & 0xFF, ppq & 0xFF
        ];
    }

    _buildTrackChunk(events) {
        // Expand each note event into NoteOn + NoteOff.
        const exp = [];
        for (const ev of events) {
            if (ev.type === 'note') {
                exp.push({
                    tick: ev.tick, type: 'noteOn',
                    channel: ev.channel, pitch: ev.pitch, velocity: ev.velocity
                });
                if (ev.duration > 0) {
                    exp.push({
                        tick: ev.tick + ev.duration, type: 'noteOff',
                        channel: ev.channel, pitch: ev.pitch, velocity: 0
                    });
                }
            } else {
                exp.push(ev);
            }
        }

        const order = { meta: 0, programChange: 1, controlChange: 2, noteOff: 3, noteOn: 4 };
        exp.sort((a, b) => {
            if (a.tick !== b.tick) return a.tick - b.tick;
            return (order[a.type] ?? 5) - (order[b.type] ?? 5);
        });

        const data = [];
        let lastTick = 0;
        for (const ev of exp) {
            const delta = ev.tick - lastTick;
            if (delta < 0) continue;
            data.push(...this._writeVarLen(delta));
            lastTick = ev.tick;

            switch (ev.type) {
                case 'noteOn':
                    data.push(0x90 | (ev.channel & 0x0F), ev.pitch & 0x7F, ev.velocity & 0x7F);
                    break;
                case 'noteOff':
                    data.push(0x80 | (ev.channel & 0x0F), ev.pitch & 0x7F, 0x00);
                    break;
                case 'programChange':
                    data.push(0xC0 | (ev.channel & 0x0F), ev.program & 0x7F);
                    break;
                case 'controlChange':
                    data.push(0xB0 | (ev.channel & 0x0F), ev.controller & 0x7F, ev.value & 0x7F);
                    break;
                case 'meta':
                    data.push(0xFF, ev.metaType & 0x7F);
                    data.push(...this._writeVarLen(ev.data.length));
                    data.push(...ev.data);
                    break;
            }
        }

        data.push(0x00, 0xFF, 0x2F, 0x00); // End Of Track

        const len = data.length;
        return [
            0x4D, 0x54, 0x72, 0x6B, // MTrk
            (len >> 24) & 0xFF, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF,
            ...data
        ];
    }

    _writeVarLen(value) {
        const bytes = [value & 0x7F];
        while ((value >>= 7) > 0) {
            bytes.unshift((value & 0x7F) | 0x80);
        }
        return bytes;
    }

    _concatBytes(arrays) {
        const total = arrays.reduce((s, a) => s + a.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const a of arrays) { out.set(a, off); off += a.length; }
        return out;
    }
}

// Export for Node.js and Browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MusicXMLToMidi;
} else {
    window.MusicXMLToMidi = MusicXMLToMidi;
}
