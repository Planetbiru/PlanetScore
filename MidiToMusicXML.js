/**
 * MidiToMusicXML converts parsed MIDI data (using MidiParser) into a valid MusicXML 4.0 Partwise XML string.
 * It maps active MIDI channels to score parts, handles pitch calculations, drum notations, time signatures,
 * tempo changes, lyrics, dynamics, chords, and automatic rest filling.
 *
 * Compatible with Node.js and browser environments.
 * 
 * @author Antigravity
 */
class MidiToMusicXML {

    /**
     * Converts raw MIDI binary data (ArrayBuffer/Buffer) into a MusicXML string.
     * @param {ArrayBuffer|Buffer} midiBuffer 
     * @param {Object} [options] 
     * @returns {string} MusicXML String
     */
    static convert(midiBuffer, options = {}) {
        // Resolve Buffer to ArrayBuffer for MidiParser
        let buffer = midiBuffer;
        if (typeof Buffer !== 'undefined' && midiBuffer instanceof Buffer) {
            buffer = midiBuffer.buffer.slice(midiBuffer.byteOffset, midiBuffer.byteOffset + midiBuffer.byteLength);
        }

        const opts = Object.assign({
            title: "Song Title",
            creator: "Composer Name",
            divisions: 4,
            selectedChannels: null,
            autoSplit: false, // If true, automatically splits wide-range channels.
            useRestFilling: true,
            normalize: true,
            splitThreshold: 24, // Semitones (2 octaves). 0 to disable.
            splitPoint: null, // e.g., 60 (Middle C). Forces 2-stave split. Overrides splitThreshold.
            splitPoints: null, // e.g., [71, 59]. Forces 3-stave split. Overrides splitPoint.
            minSplitRange: null,
            forceUpdateEvents: true,
            // ============================================================
            // OPSI BARU: Snap Position & Snap Duration
            // ============================================================
            // Nilai dalam pecahan not (contoh: 0.25 = 1/4, 0.125 = 1/8)
            // null = tidak ada snap
            snapPosition: null,   // Snap untuk onset/offset note
            snapDuration: null    // Snap untuk durasi note
        }, options);

        // Parse MIDI binary using the project's MidiParser
        const parsed = MidiParser.parse(buffer, {
            normalize: opts.normalize,
            forceUpdateEvents: opts.forceUpdateEvents
        });
        

        // ============================================================
        // Hitung snap dalam ticks setelah parsed tersedia
        // ============================================================
        const ppq = parsed.header.ppq;

        // snapPosition / snapDuration dalam satuan not (misal 1/8 = 0.125)
        // 1 not penuh = 4 * ppq ticks, jadi 1/8 not = 0.125 * 4 * ppq ticks
        const snapPosTicks = (opts.snapPosition != null && opts.snapPosition > 0)
            ? Math.max(1, Math.round(opts.snapPosition * 4 * ppq))
            : null;
        const snapDurTicks = (opts.snapDuration != null && opts.snapDuration > 0)
            ? Math.max(1, Math.round(opts.snapDuration * 4 * ppq))
            : null;

        opts._snapPositionTicks = snapPosTicks;
        opts._snapDurationTicks = snapDurTicks;

        // If a specific track is requested, keep only that track (ignore others)
        // ============================================================
        // TERAPKAN MUTE CHANNEL (dari client)
        // ============================================================
        if (Array.isArray(opts.muteChannels) && opts.muteChannels.length > 0) {
            const muteSet = new Set(opts.muteChannels);
            parsed.tracks.forEach(track => {
                if (track.notes) {
                    track.notes = track.notes.filter(n => !muteSet.has(n.channel));
                }
                if (track.controllers) {
                    track.controllers = track.controllers.filter(c => !muteSet.has(c.channel));
                }
                if (track.pitchBends) {
                    track.pitchBends = track.pitchBends.filter(pb => !muteSet.has(pb.channel));
                }
            });
        }

        // ============================================================
        // TERAPKAN TRANSPOSE (di level track, sebelum convertParsed)
        // ============================================================
        const transposeOpt = opts.transpose || 0;
        if (transposeOpt !== 0) {
            parsed.tracks.forEach(track => {
                if (!track.notes) return;
                track.notes.forEach(n => {
                    // Skip drum (channel 9)
                    if (n.channel === 9) return;
                    n.midi = Math.max(0, Math.min(127, n.midi + transposeOpt));
                });
            });
        }

        // ============================================================
        // FILTER TRACK — terima number (single) ATAU array (multiple)
        // Meta track (track tanpa note) SELALU dipertahankan.
        // ============================================================
        if (opts.selectedTracks != null) {
            let trackIndices = [];
            if (Array.isArray(opts.selectedTracks)) {
                trackIndices = opts.selectedTracks.filter(
                    i => Number.isInteger(i) && i >= 0 && i < parsed.tracks.length
                );
            } else if (typeof opts.selectedTracks === 'number') {
                const i = opts.selectedTracks;
                if (i >= 0 && i < parsed.tracks.length) trackIndices = [i];
            }

            if (trackIndices.length > 0) {
                const selectedSet = new Set(trackIndices);
                const selectedTracks = parsed.tracks.filter((_, i) => selectedSet.has(i));
                const metaTracks = parsed.tracks.filter((t, i) =>
                    !selectedSet.has(i) && (!t.notes || t.notes.length === 0)
                );
                parsed.tracks = [...selectedTracks, ...metaTracks];
            }
        }

        const activeChannelsInScore = new Set();
        parsed.tracks.forEach(t => {
            if (t.notes) {
                t.notes.forEach(n => activeChannelsInScore.add(n.channel));
            }
        });

        // Determine lyric channel
        // Priority: opts.lyricChannelId (user-specified, 1-indexed MIDI)
        //           opts._lyricChannelId (internal, 0-indexed)
        // Fallback: MIDI channel 4 (index 3), else first active channel
        let lyricChannelId = -1;

        if (opts.lyricChannelId != null) {
            // User-specified, treat as 1-indexed MIDI channel
            const userCh = parseInt(opts.lyricChannelId, 10);
            if (!isNaN(userCh)) {
                const idx = userCh - 1;
                if (activeChannelsInScore.has(idx)) {
                    lyricChannelId = idx;
                } else {
                    // Channel specified but not rendered → disable lyrics
                    lyricChannelId = -1;
                }
            }
        } else {
            // Auto-detect: prefer channel 3 (MIDI ch 4)
            if (activeChannelsInScore.has(3)) {
                lyricChannelId = 3;
            } else if (activeChannelsInScore.size > 0) {
                lyricChannelId = [...activeChannelsInScore].sort((a,b)=>a-b)[0];
            }
        }

        opts._lyricChannelId = lyricChannelId;

        return this.convertParsed(parsed, opts);
    }

    /**
     * Converts parsed MIDI object into a MusicXML string.
     * @param {Object} parsed - Parsed MIDI object from MidiParser
     * @param {Object} opts - Conversion options
     * @returns {string} MusicXML String
     */
    static convertParsed(parsed, opts) {
        const ppq = parsed.header.ppq;
        const divisions = opts.divisions;
        const title = opts.title;

        // 1. Group notes and controllers from all tracks by channel
        const channelNotes = Array.from({ length: 16 }, () => []);
        const ccVolumeMap = Array.from({ length: 16 }, () => ({}));
        const ccExpressionMap = Array.from({ length: 16 }, () => ({}));

        // Collect global lyrics
        const globalLyrics = {};
        parsed.tracks.forEach(track => {
            if (track.notes) {
                track.notes.forEach(n => {
                    channelNotes[n.channel].push(n);
                });
            }
            if (track.lyrics) {
                track.lyrics.forEach(l => {
                    globalLyrics[l.ticks] = l.text;
                });
            }
            if (track.controllers) {
                track.controllers.forEach(c => {
                    if (c.controller === 7) {
                        ccVolumeMap[c.channel][c.ticks] = c.value;
                    } else if (c.controller === 11) {
                        ccExpressionMap[c.channel][c.ticks] = c.value;
                    }
                });
            }
        });

        // Sort notes chronologically
        channelNotes.forEach(notes => {
            notes.sort((a, b) => a.ticks - b.ticks);
        });

        // ============================================================
        // TERAPKAN SNAP PADA SETIAP NOTE
        // ============================================================
        const snapPosTicks = opts._snapPositionTicks;
        const snapDurTicks = opts._snapDurationTicks;

        if (snapPosTicks || snapDurTicks) {
            channelNotes.forEach(notes => {
                notes.forEach(n => {
                    // Snap onset (posisi mulai)
                    if (snapPosTicks) {
                        n.ticks = Math.round(n.ticks / snapPosTicks) * snapPosTicks;
                    }
                    // Snap durasi
                    if (snapDurTicks) {
                        n.durationTicks = Math.round(n.durationTicks / snapDurTicks) * snapDurTicks;
                        // Pastikan durasi minimal 1 tick
                        if (n.durationTicks < 1) n.durationTicks = snapDurTicks;
                    }
                });
            });
        }

        // Determine active channels
        let activeChannels = [];
        if (opts.selectedChannels) {
            activeChannels = opts.selectedChannels;
        } else {
            for (let ch = 0; ch < 16; ch++) {
                if (channelNotes[ch].length > 0) {
                    activeChannels.push(ch);
                }
            }
        }
        activeChannels.sort((a, b) => a - b);


        // Calculate note range per channel for clef assignment
        const channelMinNote = new Array(16).fill(127);
        const channelMaxNote = new Array(16).fill(0);
        activeChannels.forEach(ch => {
            channelNotes[ch].forEach(n => {
                if (n.midi < channelMinNote[ch]) channelMinNote[ch] = n.midi;
                if (n.midi > channelMaxNote[ch]) channelMaxNote[ch] = n.midi;
            });
        });

        // Decide which channels to split into two staves (e.g., for piano)
        const channelStaves = {}; // Maps channel to number of staves
        if (Array.isArray(opts.splitPoints) && opts.splitPoints.length === 2 && activeChannels.length > 0) {
            // Force 3-stave split on the first non-drum channel
            const firstMelodicChannel = activeChannels.find(ch => ch !== 9);
            if (firstMelodicChannel !== undefined) {
                channelStaves[firstMelodicChannel] = 3;
            }
        } else if (opts.splitPoint !== null && typeof opts.splitPoint === 'number' && activeChannels.length > 0) {
            // Force split on the first non-drum channel if splitPoint is set
            const firstMelodicChannel = activeChannels.find(ch => ch !== 9);
            if (firstMelodicChannel !== undefined) {
                channelStaves[firstMelodicChannel] = 2;
            }
        } else if (opts.autoSplit && opts.splitThreshold > 0) {
            const minSplitRange = (opts.minSplitRange != null && opts.minSplitRange >= 0) 
                ? opts.minSplitRange 
                : 30; // default 2.5 octaves
            
            activeChannels.forEach(ch => {
                // Skip drums
                if (ch === 9) return;
                
                const range = channelMaxNote[ch] - channelMinNote[ch];
                
                // ⬇️ Hard floor: part dengan rentang < minSplitRange TIDAK akan displit
                if (range < minSplitRange) return;
                
                const progChanges = parsed.header.channelProgramChanges[ch] || [];
                const initialProgram = progChanges.length > 0 ? progChanges[0].program : 0;
                
                const isPiano = initialProgram >= 0 && initialProgram <= 7;
                const threshold = isPiano ? 14 : opts.splitThreshold;
                const threshold3Stave = 48;

                if (range >= threshold3Stave) {
                    channelStaves[ch] = 3;
                } else if (range >= threshold) {
                    channelStaves[ch] = 2;
                }
            });
        }

        // 2. Identify lyric carrier channel
        let lyricChannelId = (opts._lyricChannelId != null) ? opts._lyricChannelId : -1;

        // Calculate total measures based on max ticks in header or notes
        const maxTicks = parsed.header.maxTicks || 0;
        const lastPosition = parsed.header.tickToPosition(maxTicks);
        const totalMeasures = Math.max(1, lastPosition.measure);

        // Cache time signature segments
        const preparedTimeSignatures = parsed.header.preparedTimeSignatures || [{
            ticks: 0,
            numerator: 4,
            denominator: 4,
            ticksPerMeasure: 4 * ppq,
            measureStart: 1
        }];

        function getTimeSigForMeasure(m) {
            let activeSig = preparedTimeSignatures[0];
            for (let i = 1; i < preparedTimeSignatures.length; i++) {
                if (m >= preparedTimeSignatures[i].measureStart) {
                    activeSig = preparedTimeSignatures[i];
                } else {
                    break;
                }
            }
            return activeSig;
        }

        function getMeasureStartTick(m) {
            const sig = getTimeSigForMeasure(m);
            const measuresInSig = m - sig.measureStart;
            return sig.ticks + measuresInSig * sig.ticksPerMeasure;
        }

        // 3. Build XML Part List
        let xmlPartList = "";
        activeChannels.forEach(ch => {
            const partId = "P" + (ch + 1);
            const progChanges = parsed.header.channelProgramChanges[ch] || [];
            const initialProgram = progChanges.length > 0 ? progChanges[0].program : 0;

            let partName, partAbbr, partSound;

            if (ch === 9) { // Drums (channel 10)
                partName = "Drum Kit";
                partAbbr = "D. Kit";
                partSound = "percussion";

                xmlPartList += `    <score-part id="${partId}">\n`;
                xmlPartList += `      <part-name>${partName}</part-name>\n`;
                xmlPartList += `      <part-abbreviation>${partAbbr}</part-abbreviation>\n`;

                // Add all possible score-instruments for channel 10 drum set mapping
                Object.keys(this.DRUM_SET).forEach(key => {
                    const midiCode = parseInt(key);
                    const drumDetails = this.DRUM_SET[midiCode];
                    const instId = `${partId}-I${midiCode + 1}`;
                    xmlPartList += `      <score-instrument id="${instId}">\n`;
                    xmlPartList += `        <instrument-name>${this.escapeXML(drumDetails[0])}</instrument-name>\n`;
                    if (drumDetails[2]) {
                        xmlPartList += `        <instrument-sound>${drumDetails[2]}</instrument-sound>\n`;
                    }
                    xmlPartList += `      </score-instrument>\n`;
                });

                xmlPartList += `      <midi-device port="1"/>\n`;

                Object.keys(this.DRUM_SET).forEach(key => {
                    const midiCode = parseInt(key);
                    const drumDetails = this.DRUM_SET[midiCode];
                    const instId = `${partId}-I${midiCode + 1}`;
                    xmlPartList += `      <midi-instrument id="${instId}">\n`;
                    xmlPartList += `        <midi-channel>10</midi-channel>\n`;
                    xmlPartList += `        <midi-program>1</midi-program>\n`;
                    xmlPartList += `        <midi-unpitched>${midiCode + 1}</midi-unpitched>\n`;
                    xmlPartList += `        <volume>80</volume>\n`;
                    xmlPartList += `      </midi-instrument>\n`;
                });

                xmlPartList += `    </score-part>\n`;

            } else { // Melodic channels
                let instInfo = this.INSTRUMENT_LIST[initialProgram] || ["Instrument " + (initialProgram + 1), "Instr.", "keyboard.piano"];
                // If the channel is split, it's almost certainly a piano part.
                if (channelStaves[ch] > 1) {
                    instInfo = ['Piano', 'Pno.', 'keyboard.piano.grand'];
                }
                partName = instInfo[0];
                partAbbr = instInfo[1];
                partSound = instInfo[2];

                const instId = `${partId}-I1`;
                xmlPartList += `    <score-part id="${partId}">\n`;
                xmlPartList += `      <part-name>${partName}</part-name>\n`;
                xmlPartList += `      <part-abbreviation>${partAbbr}</part-abbreviation>\n`;
                xmlPartList += `      <score-instrument id="${instId}">\n`;
                xmlPartList += `        <instrument-name>${partName}</instrument-name>\n`;
                xmlPartList += `        <instrument-sound>${partSound}</instrument-sound>\n`;
                xmlPartList += `      </score-instrument>\n`;
                xmlPartList += `      <midi-instrument id="${instId}">\n`;
                xmlPartList += `        <midi-channel>${ch + 1}</midi-channel>\n`;
                xmlPartList += `        <midi-program>${initialProgram + 1}</midi-program>\n`;
                xmlPartList += `        <volume>80</volume>\n`;
                xmlPartList += `      </midi-instrument>\n`;
                xmlPartList += `    </score-part>\n`;
            }
        });

        // Dynamic Controller Lookup Functions
        function getCCValue(map, ch, tick, defValue) {
            const channelMap = map[ch];
            if (!channelMap || Object.keys(channelMap).length === 0) return defValue;
            let lastVal = defValue;
            const ticks = Object.keys(channelMap).map(Number).sort((a, b) => a - b);
            for (let t of ticks) {
                if (t <= tick) {
                    lastVal = channelMap[t];
                } else {
                    break;
                }
            }
            return lastVal;
        }

        // 4. Generate parts scores
        let xmlPartsContent = "";

        activeChannels.forEach(ch => {
            const partId = "P" + (ch + 1);
            xmlPartsContent += `  <part id="${partId}">\n`;

            // Keep track of spilled notes: noteCode -> { remainingTicks, dynamics, staff }
            let tieContinue = {};

            // Initial signature & clef state
            let currentNumerator = 0;
            let currentDenominator = 0;
            let currentFifths = null;
            let currentMode = "";

            for (let m = 1; m <= totalMeasures; m++) {
                const measureStartTick = getMeasureStartTick(m);
                const activeSig = getTimeSigForMeasure(m);
                const measureEndTick = measureStartTick + activeSig.ticksPerMeasure;
                const measureLengthTicks = activeSig.ticksPerMeasure;
                const xmlMeasureLength = (measureLengthTicks * divisions) / ppq;

                xmlPartsContent += `    <measure number="${m}">\n`;

                // Add <attributes> block if needed (always in measure 1, or when signatures change)
                let needAttr = (m === 1);
                let attrContent = "";

                if (m === 1) {
                    attrContent += `        <divisions>${divisions}</divisions>\n`;
                }

                // Key Signature
                // Look for key signatures matching current ticks
                const kSigList = parsed.header.keySignatures || [];
                let activeKSig = { fifths: 0, mode: "major" };
                kSigList.forEach(k => {
                    if (k.ticks <= measureStartTick) {
                        activeKSig = k;
                    }
                });

                if (m === 1 || activeKSig.fifths !== currentFifths || activeKSig.mode !== currentMode) {
                    currentFifths = activeKSig.fifths;
                    currentMode = activeKSig.mode;
                    if (ch !== 9) { // No key signatures for percussion
                        attrContent += `        <key>\n`;
                        attrContent += `          <fifths>${currentFifths}</fifths>\n`;
                        attrContent += `          <mode>${currentMode}</mode>\n`;
                        attrContent += `        </key>\n`;
                        needAttr = true;
                    }
                }

                // Time Signature
                if (m === 1 || activeSig.numerator !== currentNumerator || activeSig.denominator !== currentDenominator) {
                    currentNumerator = activeSig.numerator;
                    currentDenominator = activeSig.denominator;
                    attrContent += `        <time>\n`;
                    attrContent += `          <beats>${currentNumerator}</beats>\n`;
                    attrContent += `          <beat-type>${currentDenominator}</beat-type>\n`;
                    attrContent += `        </time>\n`;
                    needAttr = true;
                }

                // Add staves for split channels
                if (m === 1 && channelStaves[ch] > 1) {
                    attrContent += `        <staves>${channelStaves[ch]}</staves>\n`;
                    needAttr = true;
                }

                // Clef
                if (m === 1) {
                    let clefSign = 'G', clefLine = 2;
                    if (channelStaves[ch] === 3) {
                        // User-requested clefs: G, F, C
                        attrContent += `        <clef number="1"><sign>G</sign><line>2</line></clef>\n`;
                        attrContent += `        <clef number="2"><sign>F</sign><line>4</line></clef>\n`;
                        attrContent += `        <clef number="3"><sign>C</sign><line>3</line></clef>\n`;
                        clefSign = null; // Skip default clef generation
                    } else if (ch === 9) {
                        clefSign = 'percussion';
                        clefLine = null;
                    } else if (channelStaves[ch] === 2) {
                        // For split piano parts, always use G and F clefs.
                        attrContent += `        <clef number="1">\n          <sign>G</sign>\n          <line>2</line>\n        </clef>\n`;
                        attrContent += `        <clef number="2">\n          <sign>F</sign>\n          <line>4</line>\n        </clef>\n`;
                        clefSign = null; // Skip default clef generation below
                    } else {
                        const min = channelMinNote[ch];
                        const max = channelMaxNote[ch];
                        if (min < 48) {
                            clefSign = 'F'; clefLine = 4;
                        } else if (min < 57 && max <= 76 && (min + max) / 2 < 63) {
                            clefSign = 'C'; clefLine = 3;
                        }
                    }
                    if (clefSign) {
                        attrContent += `        <clef>\n`;
                        attrContent += `          <sign>${clefSign}</sign>\n`;
                        if (clefLine !== null) {
                            attrContent += `          <line>${clefLine}</line>\n`;
                        }
                        attrContent += `        </clef>\n`;
                    }
                    needAttr = true;
                }

                if (needAttr) {
                    xmlPartsContent += `      <attributes>\n${attrContent}      </attributes>\n`;
                }

                // Tempo Direction changes (emitted on first active channel or first track)
                if (ch === activeChannels[0]) {
                    const tempos = parsed.header.tempos || [];
                    tempos.forEach(t => {
                        if (t.ticks >= measureStartTick && t.ticks < measureEndTick) {
                            xmlPartsContent += `      <direction placement="above">\n`;
                            xmlPartsContent += `        <direction-type>\n`;
                            xmlPartsContent += `          <metronome>\n`;
                            xmlPartsContent += `            <beat-unit>quarter</beat-unit>\n`;
                            xmlPartsContent += `            <per-minute>${Math.round(t.bpm)}</per-minute>\n`;
                            xmlPartsContent += `          </metronome>\n`;
                            xmlPartsContent += `        </direction-type>\n`;
                            xmlPartsContent += `        <sound tempo="${Math.round(t.bpm)}"/>\n`;
                            xmlPartsContent += `      </direction>\n`;
                        }
                    });
                }

                // Filter notes for this measure
                const notesInMeasure = channelNotes[ch].filter(n => n.ticks >= measureStartTick && n.ticks < measureEndTick);

                // Find lyrics in range for this channel if it's the lyric carrier
                const lyricCarrier = {};
                if (ch === lyricChannelId) {
                    Object.keys(globalLyrics).forEach(tickStr => {
                        const tick = parseInt(tickStr);
                        if (tick >= measureStartTick && tick < measureEndTick) {
                            lyricCarrier[tick] = globalLyrics[tick];
                        }
                    });
                }

                // For split staves, we need to track the end position for each staff independently.
                let staffCursor = {
                    1: 0, // lastNoteXmlEnd for staff 1
                    2: 0, // lastNoteXmlEnd for staff 2
                    3: 0  // lastNoteXmlEnd for staff 3
                };

                // Kumpulkan semua elemen not dan sisipan dalam birama ini sebelum menuliskannya
                const measureElements = [];

                // ============================================================
                // PERBAIKAN 1: Process tied notes with staff awareness
                // ============================================================
                const tieKeys = Object.keys(tieContinue).map(Number);
                if (tieKeys.length > 0) {
                    // Group tie notes by staff
                    const tieByStaff = {};
                    tieKeys.forEach(noteCode => {
                        const tieInfo = tieContinue[noteCode];
                        // Determine staff for this tied note
                        let staff = this.determineStaffForNote(
                            noteCode, 
                            ch, 
                            channelStaves, 
                            opts, 
                            channelMinNote, 
                            channelMaxNote,
                            channelNotes
                        );
                        if (!tieByStaff[staff]) tieByStaff[staff] = [];
                        tieByStaff[staff].push({ noteCode, tieInfo, staff });
                    });

                    // Process each staff independently
                    Object.keys(tieByStaff).forEach(staffKey => {
                        const staff = parseInt(staffKey);
                        const staffNotes = tieByStaff[staff];
                        
                        staffNotes.forEach((item, itemIdx) => {
                            const { noteCode, tieInfo } = item;
                            const remaining = tieInfo.remainingTicks;
                            const continueTicks = Math.min(remaining, measureLengthTicks);
                            let xmlDuration = Math.round((continueTicks * divisions) / ppq);
                            if (xmlDuration <= 0 && continueTicks > 0) xmlDuration = 1;

                            const isStop = (remaining <= measureLengthTicks);
                            const isChordInStaff = (itemIdx > 0);

                            // Fill gap for this specific staff
                            if (opts.useRestFilling && !isChordInStaff) {
                                const gapDivs = staffCursor[staff];
                                if (gapDivs > 0) {
                                    this.generateRests(gapDivs, divisions, ch, partId, staff).forEach(rest => {
                                        measureElements.push({ 
                                            xml: rest.xml, 
                                            staff: staff, 
                                            startDiv: 0, 
                                            durationDivs: rest.durationDivs, 
                                            isChord: false 
                                        });
                                    });
                                    staffCursor[staff] = 0;
                                }
                            }

                            measureElements.push({ 
                                xml: this.generateNoteXML({
                                    isChord: isChordInStaff,
                                    isRest: false,
                                    ch,
                                    partId,
                                    noteCode,
                                    durationDivs: xmlDuration,
                                    divisions,
                                    dynamics: tieInfo.dynamics,
                                    staff: staff,
                                    tieType: isStop ? "stop" : "stop_start",
                                    lyricText: null,
                                    beamType: null
                                }), 
                                staff: staff, 
                                startDiv: 0, 
                                durationDivs: xmlDuration, 
                                isChord: isChordInStaff
                            });

                            if (!isChordInStaff) {
                                staffCursor[staff] = xmlDuration;
                            }

                            if (isStop) {
                                delete tieContinue[noteCode];
                            } else {
                                tieContinue[noteCode].remainingTicks -= continueTicks;
                                tieContinue[noteCode].staff = staff;
                            }
                        });
                    });
                }

                // Process regular notes in this measure
                notesInMeasure.forEach((note, index) => {
                    const offsetTicks = note.ticks - measureStartTick;
                    const xmlStart = Math.round((offsetTicks * divisions) / ppq);

                    const chordTolerance = (ch === 9) ? 10 : 4;

                    // Determine which staff this note belongs to
                    let staff = this.determineStaffForNote(
                        note.midi, 
                        ch, 
                        channelStaves, 
                        opts, 
                        channelMinNote, 
                        channelMaxNote,
                        channelNotes
                    );

                    const isChord = (() => {
                        if (index === 0) return false;

                        return notesInMeasure
                            .slice(0, index)
                            .some(prevNote => {
                                if (Math.abs(prevNote.ticks - note.ticks) >= chordTolerance) return false;

                                let prevStaff = this.determineStaffForNote(
                                    prevNote.midi,
                                    ch,
                                    channelStaves,
                                    opts,
                                    channelMinNote,
                                    channelMaxNote,
                                    channelNotes
                                );

                                return prevStaff === staff;
                            });
                    })();

                    // ============================================================
                    // PERBAIKAN 2: Fill gap with rest for this specific staff ONLY
                    // ============================================================
                    if (opts.useRestFilling && !isChord) {
                        const gapDivs = xmlStart - staffCursor[staff];
                        if (gapDivs > 0) {
                            this.generateRests(gapDivs, divisions, ch, partId, staff).forEach(rest => {
                                measureElements.push({ 
                                    xml: rest.xml, 
                                    staff: staff, 
                                    startDiv: staffCursor[staff], 
                                    durationDivs: rest.durationDivs, 
                                    isChord: false 
                                });
                            });
                            staffCursor[staff] = xmlStart;
                        }
                    }
                    
                    const localEndTicks = offsetTicks + note.durationTicks;

                    let noteDurationTicks = note.durationTicks;
                    let isSpilled = false;

                    // Volume dynamics formula
                    const velocity = Math.round(note.velocity * 127);
                    const volume = getCCValue(ccVolumeMap, ch, note.ticks, 100);
                    const expression = getCCValue(ccExpressionMap, ch, note.ticks, 127);
                    const dynamicsVal = Math.round((velocity / 127) * (volume / 127) * (expression / 127) * 100);

                    if (localEndTicks > measureLengthTicks) {
                        noteDurationTicks = measureLengthTicks - offsetTicks;
                        isSpilled = true;

                        tieContinue[note.midi] = {
                            remainingTicks: note.durationTicks - noteDurationTicks,
                            dynamics: dynamicsVal,
                            staff: staff
                        };
                    }

                    let noteDivs = Math.round((noteDurationTicks * divisions) / ppq);
                    if (noteDivs <= 0 && noteDurationTicks > 0) noteDivs = 1;

                    // Retrieve lyric. Only attach lyric to notes on staff 1.
                    let lyricText = null;
                    if (staff === 1 && lyricCarrier[note.ticks]) {
                        lyricText = lyricCarrier[note.ticks];
                        delete lyricCarrier[note.ticks]; 
                    }

                    // Simple Beam detection
                    let beamType = null;
                    const noteType = this.getNoteType(noteDivs, divisions);
                    const isBeamable = ['eighth', '16th', '32nd', '64th'].includes(noteType);
                    if (isBeamable && !isChord) {
                        const ticksPerBeat = ppq;
                        const beatIndex = Math.floor(offsetTicks / ticksPerBeat);
                        const beatStart = beatIndex * ticksPerBeat;
                        const beatEnd = (beatIndex + 1) * ticksPerBeat;

                        const siblingNotes = notesInMeasure.filter(n => {
                            const off = n.ticks - measureStartTick;
                            return off >= beatStart && off < beatEnd;
                        });

                        if (siblingNotes.length > 1) {
                            const siblingIndex = siblingNotes.indexOf(note);
                            if (siblingIndex === 0) {
                                beamType = "begin";
                            } else if (siblingIndex === siblingNotes.length - 1) {
                                beamType = "end";
                            } else {
                                beamType = "continue";
                            }
                        }
                    }

                    // Split unrepresentable note duration into pieces
                    if (noteDivs > 0) {
                        const notePieces = this.splitIntoRepresentableDurations(noteDivs, divisions);
                        if (notePieces.length > 1) {
                            notePieces.forEach((pieceDivs, pIdx) => {
                                const isFirstPiece = (pIdx === 0);
                                const isLastPiece = (pIdx === notePieces.length - 1);

                                let pieceTie = null;
                                if (isSpilled) {
                                    pieceTie = "start";
                                }

                                if (isFirstPiece) {
                                    pieceTie = "start";
                                } else if (isLastPiece && !isSpilled) {
                                    pieceTie = "stop";
                                } else {
                                    pieceTie = "stop_start";
                                }

                                measureElements.push({ 
                                    xml: this.generateNoteXML({
                                        isChord: isChord && isFirstPiece,
                                        isRest: false,
                                        ch,
                                        partId,
                                        noteCode: note.midi,
                                        durationDivs: pieceDivs,
                                        divisions,
                                        dynamics: dynamicsVal,
                                        staff: staff,
                                        tieType: pieceTie,
                                        lyricText: isFirstPiece ? lyricText : null,
                                        beamType: isFirstPiece ? beamType : null
                                    }), 
                                    staff: staff, 
                                    startDiv: xmlStart, 
                                    durationDivs: pieceDivs, 
                                    isChord: isChord && isFirstPiece 
                                });
                            });
                        } else {
                            measureElements.push({ 
                                xml: this.generateNoteXML({
                                    isChord,
                                    isRest: false,
                                    ch,
                                    partId,
                                    noteCode: note.midi,
                                    durationDivs: noteDivs,
                                    divisions,
                                    dynamics: dynamicsVal,
                                    staff: staff,
                                    tieType: isSpilled ? "start" : null,
                                    lyricText,
                                    beamType
                                }), 
                                staff: staff, 
                                startDiv: xmlStart, 
                                durationDivs: noteDivs, 
                                isChord: isChord 
                            });
                        }
                    }

                    if (!isChord) {
                        staffCursor[staff] = xmlStart + noteDivs;
                    }
                });

                // ============================================================
                // PERBAIKAN 3: Fill end of measure with rests per staff
                // ============================================================
                if (opts.useRestFilling) {
                    const numStaves = channelStaves[ch] || 1;
                    for (let staffIdx = 1; staffIdx <= numStaves; staffIdx++) {
                        if (staffCursor[staffIdx] < xmlMeasureLength) {
                            const startDiv = staffCursor[staffIdx];
                            const remainingDivs = xmlMeasureLength - startDiv;
                            if (remainingDivs > 0) {
                                this.generateRests(remainingDivs, divisions, ch, partId, staffIdx).forEach(rest => {
                                    measureElements.push({ 
                                        xml: rest.xml, 
                                        staff: staffIdx, 
                                        startDiv: startDiv, 
                                        durationDivs: rest.durationDivs, 
                                        isChord: false 
                                    });
                                });
                            }
                        }
                    }
                }

                // Process lyrics after all notes and rests are collected
                if (ch === lyricChannelId && Object.keys(lyricCarrier).length > 0) {
                    Object.keys(lyricCarrier).forEach(tickStr => {
                        const tick = parseInt(tickStr);
                        const lyricDiv = Math.round(((tick - measureStartTick) * divisions) / ppq);
                        const lyricText = lyricCarrier[tick];

                        let elementOnStaff1 = measureElements.find(el => el.staff === 1 && el.startDiv === lyricDiv && !el.isChord);

                        if (elementOnStaff1) {
                            if (!elementOnStaff1.xml.includes('<lyric>')) {
                                elementOnStaff1.xml = elementOnStaff1.xml.replace('</note>', `        <lyric><syllabic>single</syllabic><text>${this.escapeXML(lyricText)}</text></lyric>\n      </note>`);
                            }
                        } else {
                            let nextEventDiv = xmlMeasureLength;
                            measureElements.filter(el => el.staff === 1).forEach(el => {
                                if (el.startDiv > lyricDiv && el.startDiv < nextEventDiv) {
                                    nextEventDiv = el.startDiv;
                                }
                            });
                            const restDuration = Math.max(1, nextEventDiv - lyricDiv);
                            
                            const restPieces = this.splitIntoRepresentableDurations(restDuration, divisions);
                            restPieces.forEach((pieceDivs, pIdx) => {
                                const restXml = this.generateNoteXML({ 
                                    isChord: false, 
                                    isRest: true, 
                                    ch, 
                                    partId, 
                                    noteCode: 0, 
                                    durationDivs: pieceDivs, 
                                    divisions, 
                                    dynamics: 0, 
                                    staff: 1, 
                                    tieType: null, 
                                    lyricText: (pIdx === 0) ? lyricText : null, 
                                    beamType: null 
                                });
                                measureElements.push({ 
                                    xml: restXml, 
                                    staff: 1, 
                                    startDiv: lyricDiv + (pIdx > 0 ? restPieces.slice(0, pIdx).reduce((a, b) => a + b, 0) : 0), 
                                    durationDivs: pieceDivs, 
                                    isChord: false 
                                });
                            });
                        }
                    });
                }

                // Sort elements: staff first, then position, then chord
                measureElements.sort((a, b) => {
                    if (a.staff !== b.staff) return a.staff - b.staff;
                    if (a.startDiv !== b.startDiv) return a.startDiv - b.startDiv;
                    return (a.isChord ? 1 : 0) - (b.isChord ? 1 : 0);
                });
                measureElements.forEach(el => xmlPartsContent += el.xml);

                xmlPartsContent += `    </measure>\n`;
            }
            xmlPartsContent += `  </part>\n`;
        });

        // 5. Construct full MusicXML template
        let xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n`;
        xml += `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n`;
        xml += `<score-partwise version="4.0">\n`;
        xml += `  <work>\n`;
        xml += `    <work-title>${this.escapeXML(title)}</work-title>\n`;
        xml += `  </work>\n`;
        xml += `  <identification>\n`;
        xml += `    <creator type="composer">${this.escapeXML(opts.creator)}</creator>\n`;
        xml += `    <encoding>\n`;
        xml += `      <encoding-date>${new Date().toISOString().split('T')[0]}</encoding-date>\n`;
        xml += `      <software>Planetbiru MusicXML JS</software>\n`;
        xml += `    </encoding>\n`;
        xml += `  </identification>\n`;
        xml += `  <part-list>\n`;
        xml += xmlPartList;
        xml += `  </part-list>\n`;
        xml += xmlPartsContent;
        xml += `</score-partwise>\n`;

        return xml;
    }

    // ============================================================
    // PERBAIKAN 4: New helper method to determine staff for a note
    // ============================================================
    static determineStaffForNote(noteCode, ch, channelStaves, opts, channelMinNote, channelMaxNote, channelNotes) {
        let staff = 1;
        if (channelStaves[ch] === 3) {
            let highSplit, lowSplit;
            if (opts.splitPoints) {
                [highSplit, lowSplit] = opts.splitPoints;
            } else {
                const range = channelMaxNote[ch] - channelMinNote[ch];
                highSplit = channelMinNote[ch] + Math.round(range * 2 / 3);
                lowSplit = channelMinNote[ch] + Math.round(range / 3);
            }
            if (noteCode < lowSplit) staff = 3;
            else if (noteCode < highSplit) staff = 2;
            else staff = 1;
        } else if (channelStaves[ch] === 2) {
            const splitNoteValue = opts.splitPoint !== null ? opts.splitPoint : this.findOptimalSplitPoint(channelNotes[ch]);
            staff = noteCode >= splitNoteValue ? 1 : 2;
        }
        return staff;
    }

    /**
     * Finds an optimal split point for a grand staff part by analyzing note distribution.
     * It looks for a "valley" in the pitch histogram within a reasonable range.
     * @param {Array} notes - The array of note objects for the channel.
     * @returns {number} The MIDI note number for the optimal split point.
     */
    static findOptimalSplitPoint(notes) {
        if (!notes || notes.length === 0) {
            return 60; // Default to Middle C if no notes
        }

        const pitchUsage = new Array(128).fill(0);
        let minPlayedNote = 127;
        let maxPlayedNote = 0;

        notes.forEach(note => {
            pitchUsage[note.midi]++;
            if (note.midi < minPlayedNote) minPlayedNote = note.midi;
            if (note.midi > maxPlayedNote) maxPlayedNote = note.midi;
        });

        // If the range of played notes is too small, a meaningful split might not be possible or necessary.
        // For example, if the range is less than 1.5 octaves, just use the middle of the played range.
        if (maxPlayedNote - minPlayedNote < 18) { // 18 semitones = 1.5 octaves
             return Math.round((minPlayedNote + maxPlayedNote) / 2);
        }

        let bestSplit = Math.round((minPlayedNote + maxPlayedNote) / 2); // Initialize with the middle of the played range
        let minScore = Infinity;

        // Define a search range for the optimal split point.
        // This range should ideally be within the actual played notes to ensure a division occurs.
        // A common range for piano splits is between A2 (MIDI 45) and D#5 (MIDI 75).
        // We'll constrain the search to be within a reasonable piano range AND within the actual played notes.
        const effectiveSearchStart = Math.max(45, minPlayedNote + 6); // At least A2 (MIDI 45), and at least a tritone (6 semitones) above lowest note
        const effectiveSearchEnd = Math.min(75, maxPlayedNote - 6);   // At most D#5 (MIDI 75), and at least a tritone below highest note

        // If the effective search range is invalid (e.g., minPlayedNote is too high or maxPlayedNote too low),
        // fall back to a simpler split (middle of the played range).
        if (effectiveSearchStart >= effectiveSearchEnd) {
            return Math.round((minPlayedNote + maxPlayedNote) / 2);
        }

        for (let p = effectiveSearchStart; p <= effectiveSearchEnd; p++) {
            // The "cost" is the number of notes played at or around the split point.
            // A lower cost means a better (emptier) place to split.
            // We check a small window (e.g., a whole step below, the point itself, and a whole step above).
            const score = pitchUsage[p - 1] + pitchUsage[p] + pitchUsage[p + 1];

            if (score < minScore) {
                minScore = score;
                bestSplit = p;
            }
        }
        return bestSplit;
    }

    /**
     * Generates rests for a given duration, but also splits the rests to attach lyrics at the correct time.
     * This is used for staff 1 of lyric-carrying parts.
     * @param {number} startDiv - The starting position of the gap in divisions.
     * @param {number} durationDivs - The total duration of the gap in divisions.
     * @param {number} divisions - Divisions per quarter note.
     * @param {number} ppq - Pulses per quarter note from MIDI header.
     * @param {number} measureStartTick - The starting tick of the current measure.
     * @param {number} ch - The MIDI channel.
     * @param {string} partId - The MusicXML part ID.
     * @param {Object} lyricCarrier - A map of { tick: lyricText } for the current measure.
     * @returns {string} The generated MusicXML for the rests and lyrics.
     */
    static generateRestsAndLyricsForGap(startDiv, durationDivs, divisions, ppq, measureStartTick, ch, partId, lyricCarrier) {
        let xml = "";
        let localCursor = startDiv;
        const endDiv = startDiv + durationDivs;

        // Find lyrics that start within this gap
        const lyricsInGap = [];
        if (lyricCarrier) {
            for (const tickStr in lyricCarrier) {
                const tick = parseInt(tickStr);
                const lyricDiv = Math.round(((tick - measureStartTick) * divisions) / ppq);
                if (lyricDiv >= startDiv && lyricDiv < endDiv) {
                    lyricsInGap.push({ div: lyricDiv, text: lyricCarrier[tickStr] });
                }
            }
            lyricsInGap.sort((a, b) => a.div - b.div);
        }

        if (lyricsInGap.length === 0) {
            // No lyrics in this gap, generate a simple block of rests
            this.generateRests(durationDivs, divisions, ch, partId).forEach(restXml => {
                xml += restXml.replace('<note>', `<note>\n        <staff>1</staff>`);
            });
            return xml;
        }

        // We have lyrics, so we need to create rests punctuated by lyrics.
        lyricsInGap.forEach(lyricEvent => {
            // 1. Generate rest(s) from current cursor up to the lyric's position
            const preLyricDuration = lyricEvent.div - localCursor;
            if (preLyricDuration > 0) {
                this.generateRests(preLyricDuration, divisions, ch, partId).forEach(restXml => {
                    xml += restXml.replace('<note>', `<note>\n        <staff>1</staff>`);
                });
            }
            localCursor = lyricEvent.div;

            // 2. Find the duration for the rest that will hold the lyric.
            // It lasts until the next lyric or the end of the gap.
            const nextLyric = lyricsInGap.find(l => l.div > lyricEvent.div);
            const nextEventDiv = nextLyric ? nextLyric.div : endDiv;
            const lyricRestDuration = nextEventDiv - localCursor;

            // CRITICAL FIX: Ensure a minimum duration for the rest if lyricRestDuration is 0 or negative,
            // so the lyric has something to attach to. MusicXML durations must be positive.
            const effectiveLyricRestDuration = Math.max(1, lyricRestDuration);

            // Only create a rest if it has a positive duration
            if (lyricRestDuration > 0) {
                // Generate rests for this segment, attaching the lyric to the first one.
                const restPieces = this.splitIntoRepresentableDurations(effectiveLyricRestDuration, divisions);
                restPieces.forEach((pieceDivs, pIdx) => {
                    xml += this.generateNoteXML({ 
                        isChord: false, 
                        isRest: true, 
                        ch, 
                        partId, 
                        noteCode: 0, 
                        durationDivs: pieceDivs, 
                        divisions, 
                        dynamics: 0, 
                        staff: 1, 
                        tieType: null, 
                        lyricText: (pIdx === 0) ? lyricEvent.text : null, 
                        beamType: null 
                    });
                });
                localCursor += lyricRestDuration;
            }
        });

        // 3. Generate any remaining rest at the end of the gap
        const finalRestDuration = endDiv - localCursor;
        if (finalRestDuration > 0) {
            this.generateRests(finalRestDuration, divisions, ch, partId).forEach(restXml => {
                xml += restXml.replace('<note>', `<note>\n        <staff>1</staff>`);
            });
        }

        return xml;
    }

    /**
     * Helper to generate an array of <note> XML strings for a given rest duration.
     */
    // ============================================================
    // PERBAIKAN 5: generateRests now properly uses staff parameter
    // ============================================================
    static generateRests(durationDivs, divisions, ch, partId, staff = 1) {
        const restPieces = this.splitIntoRepresentableDurations(durationDivs, divisions);
        return restPieces.map(restDivs => ({
            xml: this.generateNoteXML({
                isChord: false,
                isRest: true,
                ch,
                partId,
                noteCode: 0,
                durationDivs: restDivs,
                divisions,
                dynamics: 0,
                staff: staff,
                tieType: null,
                lyricText: null,
                beamType: null
            }),
            durationDivs: restDivs
        }));
    }

    /**
     * Helper to create a single MusicXML <note> block
     */
    static generateNoteXML(params) {
        const { isChord, isRest, ch, partId, noteCode, durationDivs, divisions, dynamics, staff, tieType, lyricText, beamType } = params;

        // If staff is not provided, default to 1
        const noteStaff = staff || 1;

        const type = this.getNoteType(durationDivs, divisions);
        const dots = this.getNoteDots(durationDivs, divisions);

        let xml = "      <note>\n";

        if (isChord) {
            xml += "        <chord/>\n";
        }

        if (isRest) {
            xml += "        <rest/>\n";
        } else if (ch === 9) { // Drum percussion mapping
            const visuals = this.getDrumVisuals(noteCode);
            xml += "        <unpitched>\n";
            xml += `          <display-step>${visuals.step}</display-step>\n`;
            xml += `          <display-octave>${visuals.octave}</display-octave>\n`;
            xml += "        </unpitched>\n";
            if (visuals.notehead !== 'normal') {
                xml += `        <notehead>${visuals.notehead}</notehead>\n`;
            }
        } else { // Pitched mapping
            const pitchStr = this.NOTE_LIST[noteCode];
            if (pitchStr) {
                const step = pitchStr.charAt(0);
                const isSharp = pitchStr.includes('s');
                const octave = parseInt(pitchStr.replace(/[^-\d]/g, ''), 10);

                xml += "        <pitch>\n";
                xml += `          <step>${step}</step>\n`;
                if (isSharp) {
                    xml += `          <alter>1</alter>\n`;
                }
                xml += `          <octave>${octave}</octave>\n`;
                xml += "        </pitch>\n";
            }
        }

        xml += `        <duration>${durationDivs}</duration>\n`;
        if (!isRest) {
            xml += `        <instrument id="${partId}-I${ch === 9 ? noteCode + 1 : 1}"/>\n`;
        }
        xml += "        <voice>1</voice>\n";
        xml += `        <type>${type}</type>\n`;

        for (let i = 0; i < dots; i++) {
            xml += "        <dot/>\n";
        }

        // Add staff number if it's a multi-staff part
        // The renderer expects staff 1 to be declared if there are 2 staves.
        if (noteStaff > 0) {
            xml += `        <staff>${noteStaff}</staff>\n`;
        }

        // Add stems for drums and pitched
        if (ch === 9) {
            const visuals = this.getDrumVisuals(noteCode);
            xml += `        <stem>${visuals.stem}</stem>\n`;
            xml += `        <instrument id="${partId}-I${noteCode + 1}"/>\n`;
        } else if (!isRest) {
            // Basic stem direction logic (can be improved by renderer)
            const stemDir = (noteCode >= 72) ? 'down' : 'up';
            xml += `        <stem>${stemDir}</stem>\n`;
        }

        // Tie notations
        if (tieType === "start") {
            xml += `        <tie type="start"/>\n`;
        } else if (tieType === "stop") {
            xml += `        <tie type="stop"/>\n`;
        } else if (tieType === "stop_start") {
            xml += `        <tie type="stop"/>\n`;
            xml += `        <tie type="start"/>\n`;
        }

        // Dynamic volume percentage mapping
        if (!isRest && dynamics > 0) {
            xml += `        <dynamics>${dynamics}</dynamics>\n`;
        }

        // Beam
        if (beamType) {
            xml += `        <beam number="1">${beamType}</beam>\n`;
        }

        // Lyric
        if (lyricText) {
            xml += `        <lyric>\n`;
            xml += `          <syllabic>single</syllabic>\n`;
            xml += `          <text>${this.escapeXML(lyricText)}</text>\n`;
            xml += `        </lyric>\n`;
        }

        // Tie stops/starts
        if (tieType) {
            xml += "        <notations>\n";
            if (tieType === "start") {
                xml += `          <tied type="start"/>\n`;
            } else if (tieType === "stop") {
                xml += `          <tied type="stop"/>\n`;
            } else if (tieType === "stop_start") {
                xml += `          <tied type="stop"/>\n`;
                xml += `          <tied type="start"/>\n`;
            }
            xml += "        </notations>\n";
        }

        xml += "      </note>\n";
        return xml;
    }

    /**
     * Splits non-standard duration in divisions to pieces of standard notation durations.
     */
    static splitIntoRepresentableDurations(duration, divisions) {
        const pieces = [];
        let remaining = duration;
        const epsilon = 0.01; // Toleransi untuk perbandingan float

        // Pra-hitung semua durasi standar yang dapat direpresentasikan dalam divisi
        const standardDurations = [];
        const typeValues = [
            { val: 8 }, { val: 4 }, { val: 2 }, { val: 1 }, { val: 0.5 },
            { val: 0.25 }, { val: 0.125 }, { val: 0.0625 }, { val: 0.03125 },
            { val: 0.015625 }, { val: 0.0078125 }
        ];
        // Sertakan durasi dengan titik (single, double, triple)
        const dottedFactors = [1.875, 1.75, 1.5, 1.0];

        typeValues.forEach(type => {
            dottedFactors.forEach(factor => {
                const dur = Math.round(type.val * 4 * divisions * factor);
                if (dur > 0 && !standardDurations.includes(dur)) {
                    standardDurations.push(dur);
                }
            });
        });
        // Urutkan dari terbesar ke terkecil untuk memastikan kita selalu memilih bagian terbesar yang memungkinkan
        standardDurations.sort((a, b) => b - a);

        while (remaining > epsilon) {
            let foundPiece = 0;
            // Temukan durasi standar terbesar yang pas dengan sisa durasi
            for (const d of standardDurations) {
                if (d <= remaining + epsilon) {
                    foundPiece = d;
                    break;
                }
            }

            if (foundPiece > 0) {
                pieces.push(foundPiece);
                remaining -= foundPiece;
            } else {
                // Jika tidak ada bagian standar yang pas, berarti sisanya terlalu kecil. Akhiri loop.
                if (remaining > epsilon) pieces.push(Math.round(remaining));
                break;
            }
        }
        return pieces;
    }
    
    static getNoteType(duration, divisions) {
        if (divisions <= 0 || duration <= 0) {
            return '1024th';
        }
        const value = duration / (4 * divisions);
        const typeValues = [
            { name: 'maxima', val: 8 },
            { name: 'long', val: 4 },
            { name: 'breve', val: 2 },
            { name: 'whole', val: 1 },
            { name: 'half', val: 0.5 },
            { name: 'quarter', val: 0.25 },
            { name: 'eighth', val: 0.125 },
            { name: '16th', val: 0.0625 },
            { name: '32nd', val: 0.03125 },
            { name: '64th', val: 0.015625 },
            { name: '128th', val: 0.0078125 },
            { name: '256th', val: 0.00390625 },
            { name: '512th', val: 0.001953125 },
            { name: '1024th', val: 0.0009765625 }
        ];
        for (let i = 0; i < typeValues.length; i++) {
            if (value >= typeValues[i].val - 0.0001) {
                return typeValues[i].name;
            }
        }
        return '1024th';
    }

    static getNoteDots(duration, divisions) {
        if (divisions <= 0 || duration <= 0) {
            return 0;
        }
        const value = duration / (4 * divisions);
        const typeValues = [
            { name: 'maxima', val: 8 },
            { name: 'long', val: 4 },
            { name: 'breve', val: 2 },
            { name: 'whole', val: 1 },
            { name: 'half', val: 0.5 },
            { name: 'quarter', val: 0.25 },
            { name: 'eighth', val: 0.125 },
            { name: '16th', val: 0.0625 },
            { name: '32nd', val: 0.03125 },
            { name: '64th', val: 0.015625 },
            { name: '128th', val: 0.0078125 },
            { name: '256th', val: 0.00390625 },
            { name: '512th', val: 0.001953125 },
            { name: '1024th', val: 0.0009765625 }
        ];
        for (let i = 0; i < typeValues.length; i++) {
            const typeVal = typeValues[i].val;
            if (value >= typeVal - 0.0001) {
                const baseDuration = typeVal * 4 * divisions;
                const ratio = duration / baseDuration;
                if (Math.abs(ratio - 1.5) < 0.01) {
                    return 1;
                }
                if (Math.abs(ratio - 1.75) < 0.01) {
                    return 2;
                }
                if (Math.abs(ratio - 1.875) < 0.01) {
                    return 3;
                }
                break;
            }
        }
        return 0;
    }

    static getDrumVisuals(noteCode) {
        let step = 'G', octave = 5, notehead = 'x', stem = 'up';
        switch (noteCode) {
            case 35:
            case 36:
                step = 'F'; octave = 4; notehead = 'normal'; stem = 'down';
                break;
            case 37:
                step = 'C'; octave = 5; notehead = 'x'; stem = 'up';
                break;
            case 38:
                step = 'C'; octave = 5; notehead = 'normal'; stem = 'up';
                break;
            case 40:
                step = 'C'; octave = 5; notehead = 'slash'; stem = 'up';
                break;
            case 39:
                step = 'A'; octave = 5; notehead = 'x'; stem = 'up';
                break;
            case 41:
            case 43:
                step = 'A'; octave = 4; notehead = 'normal'; stem = 'up';
                break;
            case 42:
            case 46:
                step = 'G'; octave = 5; notehead = 'x'; stem = 'up';
                break;
            case 44:
                step = 'D'; octave = 4; notehead = 'x'; stem = 'down';
                break;
            case 45:
            case 47:
                step = 'D'; octave = 5; notehead = 'normal'; stem = 'up';
                break;
            case 48:
            case 50:
                step = 'E'; octave = 5; notehead = 'normal'; stem = 'up';
                break;
            case 49:
            case 57:
                step = 'A'; octave = 5; notehead = 'x'; stem = 'up';
                break;
            case 51:
            case 59:
                step = 'F'; octave = 5; notehead = 'x'; stem = 'up';
                break;
            case 55:
                step = 'G'; octave = 5; notehead = 'x'; stem = 'up';
                break;
            default:
                step = 'G'; octave = 5; notehead = 'x'; stem = 'up';
                break;
        }
        return { step, octave, notehead, stem };
    }

    static escapeXML(str) {
        if (!str) return '';
        return str.toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
}

// NOTE_LIST mapping
MidiToMusicXML.NOTE_LIST = [
    'C-1', 'Cs-1', 'D-1', 'Ds-1', 'E-1', 'F-1', 'Fs-1', 'G-1', 'Gs-1', 'A-1', 'As-1', 'B-1',
    'C0', 'Cs0', 'D0', 'Ds0', 'E0', 'F0', 'Fs0', 'G0', 'Gs0', 'A0', 'As0', 'B0',
    'C1', 'Cs1', 'D1', 'Ds1', 'E1', 'F1', 'Fs1', 'G1', 'Gs1', 'A1', 'As1', 'B1',
    'C2', 'Cs2', 'D2', 'Ds2', 'E2', 'F2', 'Fs2', 'G2', 'Gs2', 'A2', 'As2', 'B2',
    'C3', 'Cs3', 'D3', 'Ds3', 'E3', 'F3', 'Fs3', 'G3', 'Gs3', 'A3', 'As3', 'B3',
    'C4', 'Cs4', 'D4', 'Ds4', 'E4', 'F4', 'Fs4', 'G4', 'Gs4', 'A4', 'As4', 'B4',
    'C5', 'Cs5', 'D5', 'Ds5', 'E5', 'F5', 'Fs5', 'G5', 'Gs5', 'A5', 'As5', 'B5',
    'C6', 'Cs6', 'D6', 'Ds6', 'E6', 'F6', 'Fs6', 'G6', 'Gs6', 'A6', 'As6', 'B6',
    'C7', 'Cs7', 'D7', 'Ds7', 'E7', 'F7', 'Fs7', 'G7', 'Gs7', 'A7', 'As7', 'B7',
    'C8', 'Cs8', 'D8', 'Ds8', 'E8', 'F8', 'Fs8', 'G8', 'Gs8', 'A8', 'As8', 'B8',
    'C9', 'Cs9', 'D9', 'Ds9', 'E9', 'F9', 'Fs9', 'G9', 'Gs9', 'A9', 'As9', 'B9',
    'C10', 'Cs10', 'D10', 'Ds10', 'E10', 'F10', 'Fs10', 'G10'
];

// INSTRUMENT_LIST mapping
MidiToMusicXML.INSTRUMENT_LIST = [
    ['Acoustic Grand Piano', 'Pno.', 'keyboard.piano.grand'],
    ['Bright Acoustic Piano', 'B. Pno.', 'keyboard.piano.upright'],
    ['Electric Grand Piano', 'E. G. Pno.', 'keyboard.piano.electric'],
    ['Honky Tonk Piano', 'H. T. Pno.', 'keyboard.piano.honky-tonk'],
    ['Electric Piano 1 (Rhodes Piano)', 'E. Pno1.', 'keyboard.piano.electric'],
    ['Electric Piano 2 (Chorused Piano)', 'E. Pno2.', 'keyboard.piano.electric'],
    ['Harpsichord', 'Hpsch.', 'keyboard.harpsichord'],
    ['Clavinet', 'Clav.', 'keyboard.clavichord'],
    ['Celesta', 'Cel.', 'keyboard.celesta'],
    ['Glockenspiel', 'Glock.', 'pitched-percussion.glockenspiel'],
    ['Music Box', 'M. Box', 'pitched-percussion.music-box'],
    ['Vibraphone', 'Vib.', 'pitched-percussion.vibraphone'],
    ['Marimba', 'Mar.', 'pitched-percussion.marimba'],
    ['Xylophone', 'Xyl.', 'pitched-percussion.xylophone'],
    ['Tubular Bell', 'Tub. Bell', 'pitched-percussion.tubular-bells'],
    ['Dulcimer (Santur)', 'Dulc.', 'pluck.dulcimer'],
    ['Drawbar Organ (Hammond)', 'Drwb. Org.', 'keyboard.organ.drawbar'],
    ['Percussive Organ', 'Perc. Org.', 'keyboard.organ.percussive'],
    ['Rock Organ', 'R. Org.', 'keyboard.organ.rotary'],
    ['Church Organ', 'Ch. Org.', 'keyboard.organ.pipe'],
    ['Reed Organ', 'Rd. Org.', 'keyboard.organ.pipe'], // Reed organ mapped to pipe
    ['Accordion (French)', 'Acc.', 'keyboard.accordion'],
    ['Harmonica', 'Harm.', 'wind.reed.harmonica'],
    ['Tango Accordion (Bandoneon)', 'Band.', 'keyboard.bandoneon'],
    ['Acoustic Guitar (nylon)', 'A. N. Guit.', 'pluck.guitar.nylon-string'],
    ['Acoustic Guitar (steel)', 'A. S. Guit.', 'pluck.guitar.steel-string'],
    ['Electric Guitar (jazz)', 'J. El. Guit.', 'pluck.guitar.electric'],
    ['Electric Guitar (clean)', 'El. Guit.', 'pluck.guitar.electric'],
    ['Electric Guitar (muted)', 'M. El. Guit.', 'pluck.guitar.electric'],
    ['Overdriven Guitar', 'Ovr. Guit.', 'pluck.guitar.electric'],
    ['Distortion Guitar', 'Dist. Guit.', 'pluck.guitar.electric'],
    ['Guitar Harmonics', 'Guit. Harm.', 'pluck.guitar'],
    ['Acoustic Bass', 'A. Bs.', 'pluck.bass.acoustic'],
    ['Electric Bass (fingered)', 'El. Bs.', 'pluck.bass.electric'],
    ['Electric Bass (picked)', 'B. Guit.', 'pluck.bass.electric'],
    ['Fretless Bass', 'Frtl. Bs.', 'pluck.bass.fretless'],
    ['Slap Bass 1', 'Slp. Bs1.', 'pluck.bass.electric'],
    ['Slap Bass 2', 'Slp. Bs2.', 'pluck.bass.electric'],
    ['Syn Bass 1', 'Syn. Bs1.', 'pluck.bass.synth'],
    ['Syn Bass 2', 'Syn. Bs2.', 'pluck.bass.synth.lead'],
    ['Violin', 'Vln.', 'strings.violin'],
    ['Viola', 'Vla.', 'strings.viola'],
    ['Cello', 'Vc.', 'strings.cello'],
    ['Contrabass', 'Cb.', 'strings.contrabass'],
    ['Tremolo Strings', 'Tr. Str.', 'strings.group'],
    ['Pizzicato Strings', 'Pizz. Str.', 'strings.group'],
    ['Harp', 'Hrp.', 'pluck.harp'],
    ['Timpani', 'Timp.', 'drum.timpani'],
    ['Violins (section)', 'Vlns.', 'strings.group'],
    ['Strings', 'Str.', 'strings.group'],
    ['Synth Strings 1', 'Syn. Str1.', 'strings.group.synth'],
    ['Synth Strings 2', 'Syn. Str2.', 'strings.group.synth'],
    ['Choir Aahs', 'Ch. Aah.', 'voice.vocals'],
    ['Boy Soprano', 'B. S.', 'voice.child'],
    ['Syn Choir', 'Syn. Ch.', 'voice.synth'],
    ['Brass Synthesizer', 'Synth.', 'brass.group.synth'],
    ['Trumpet', 'Tpt.', 'brass.trumpet'],
    ['Trombone', 'Tbn.', 'brass.trombone'],
    ['Tuba', 'Tba.', 'brass.tuba'],
    ['Muted Trumpet', 'M. Tpt.', 'brass.trumpet'],
    ['French Horn', 'Fr. Hn.', 'brass.french-horn'],
    ['Brass Ensemble', 'Brs. Ens.', 'brass.group'],
    ['Syn Brass 1', 'Syn. Brs1.', 'brass.group.synth'],
    ['Syn Brass 2', 'Syn. Brs2.', 'brass.group.synth'],
    ['Soprano Sax', 'Sop. Sax.', 'wind.reed.saxophone.soprano'],
    ['Alto Sax', 'Alt. Sax.', 'wind.reed.saxophone.alto'],
    ['Tenor Sax', 'Ten. Sax.', 'wind.reed.saxophone.tenor'],
    ['Baritone Sax', 'Bar. Sax.', 'wind.reed.saxophone.baritone'],
    ['Oboe', 'Ob.', 'wind.reed.oboe'],
    ['English Horn', 'Eng. Hn.', 'wind.reed.english-horn'],
    ['Bassoon', 'Bsn.', 'wind.reed.bassoon'],
    ['Clarinet', 'Cl.', 'wind.reed.clarinet'],
    ['Piccolo', 'Picc.', 'wind.flutes.flute.piccolo'],
    ['Flute', 'Fl.', 'wind.flutes.flute'],
    ['Recorder', 'Rec.', 'wind.flutes.recorder'],
    ['Pan Flute', 'Pan Fl.', 'wind.flutes.panpipes'],
    ['Bottle Blow', 'Btl. Blw.', 'wind.flutes.blown-bottle'],
    ['Shakuhachi', 'Shak.', 'wind.flutes.shakuhachi'],
    ['Whistle', 'Whis.', 'wind.flutes.whistle'],
    ['Ocarina', 'Ocar.', 'wind.flutes.ocarina'],
    ['Syn Square Wave', 'Sq. Wv.', 'synth.tone.square'],
    ['Syn Saw Wave', 'Saw Wv.', 'synth.tone.sawtooth'],
    ['Syn Calliope', 'Call.', 'wind.flutes.calliope'],
    ['Syn Chiffer', 'Chiff.', 'synth.chiff'],
    ['Syn Charang', 'Char.', 'synth.charang'],
    ['Syn Voice Solo', 'V. Solo', 'voice.synth'],
    ['Syn Fifths Saw', '5th Saw', 'synth.group.fifths'],
    ['Syn Brass and Lead', 'Brs/Lead', 'synth.group'],
    ['Pad Fantasia', 'Fant.', 'synth.pad'],
    ['Pad Warm Pad', 'Warm.', 'synth.pad.warm'],
    ['Pad Polysynth', 'Poly.', 'synth.pad.polysynth'],
    ['Pad Space Vox', 'Spc. Vox', 'synth.pad.choir'],
    ['Pad Bowed Glass', 'Bwd. Gl.', 'synth.pad.bowed'],
    ['Pad Metal', 'Met.', 'synth.pad.metallic'],
    ['Pad Halo', 'Halo', 'synth.pad.halo'],
    ['Pad Sweep', 'Swp.', 'synth.pad.sweep'],
    ['Ice Rain', 'Ice R.', 'synth.effects.rain'],
    ['Soundtrack', 'Sndtrk.', 'synth.effects.soundtrack'],
    ['Crystal', 'Cryst.', 'synth.effects.crystal'],
    ['Atmosphere', 'Atm.', 'synth.effects.atmosphere'],
    ['Brightness', 'Brght.', 'synth.effects.brightness'],
    ['Goblins', 'Gob.', 'synth.effects.goblins'],
    ['Echo Drops', 'Echo.', 'synth.effects.echoes'],
    ['Sci Fi', 'SciFi', 'synth.effects.sci-fi'],
    ['Sitar', 'Sit.', 'pluck.sitar'],
    ['Banjo', 'Bnj.', 'pluck.banjo'],
    ['Shamisen', 'Sham.', 'pluck.shamisen'],
    ['Koto', 'Koto', 'pluck.koto'],
    ['Kalimba', 'Kal.', 'pitched-percussion.kalimba'],
    ['Bag Pipe', 'Bagp.', 'wind.pipes.bagpipes'],
    ['Fiddle', 'Fid.', 'strings.fiddle'],
    ['Shanai', 'Shan.', 'wind.reed.shenai'],
    ['Tinkle Bell', 'Tnk. Bell', 'metal.bells.tinklebell'],
    ['Agogo', 'Agog.', 'metal.bells.agogo'],
    ['Steel Drums', 'St. Drm.', 'metal.steel-drums'],
    ['Woodblock', 'Wblk.', 'wood.wood-block'],
    ['Taiko Drum', 'Taiko', 'drum.taiko'],
    ['Melodic Tom', 'Mel. Tom', 'drum.tom-tom'],
    ['Synth Drum', 'Syn. Drm.', 'drum.tom-tom.synth'],
    ['Reverse Cymbal', 'Rev. Cym.', 'metal.cymbal.reverse'],
    ['Guitar Fret Noise', 'Fret N.', 'effect.guitar-fret'],
    ['Breath Noise', 'Brth. N.', 'effect.breath'],
    ['Seashore', 'Seash.', 'effect.seashore'],
    ['Bird', 'Bird', 'effect.bird.tweet'],
    ['Telephone', 'Tel.', 'effect.telephone-ring'],
    ['Helicopter', 'Heli.', 'effect.helicopter'],
    ['Applause', 'Appl.', 'effect.applause'],
    ['Gunshot', 'Gunsh.', 'effect.gunshot']
];

// DRUM_SET percussion mapping
MidiToMusicXML.DRUM_SET = {
    25: ['Automobile Brake Drums', 'Aut. Brk. Dr.', 'metal.brake-drums'],
    35: ['Acoustic Bass Drum', 'Ac. B. Dr.', 'drum.bass-drum'],
    36: ['Bass Drum 1', 'B. Dr1.', 'drum.bass-drum'],
    37: ['Side Stick', 'Sd. St.', 'drum.side-stick'],
    38: ['Acoustic Snare', 'Ac. Sn.', 'drum.snare-drum'],
    39: ['Hand Clap', 'H. Clap', 'effect.hand-clap'],
    40: ['Electric Snare', 'El. Sn.', 'drum.snare-drum.electric'],
    41: ['Low Floor Tom', 'L. Fl. Tom', 'drum.tom-tom'],
    42: ['Closed Hi-Hat', 'Cl. Hh.', 'metal.hi-hat'],
    43: ['High Floor Tom', 'H. Fl. Tom', 'drum.tom-tom'],
    44: ['Pedal Hi-Hat', 'Pd. Hh.', 'metal.hi-hat'],
    45: ['Low Tom', 'L. Tom', 'drum.tom-tom'],
    46: ['Open Hi-Hat', 'Op. Hh.', 'metal.hi-hat'],
    47: ['Low Mid Tom', 'L. M. Tom', 'drum.tom-tom'],
    48: ['High Mid Tom', 'H. M. Tom', 'drum.tom-tom'],
    49: ['Crash Cymbal 1', 'Cr. Cym1.', 'metal.cymbal.crash'],
    50: ['High Tom', 'H. Tom', 'drum.tom-tom'],
    51: ['Ride Cymbal 1', 'Rd. Cym1.', 'metal.cymbal.ride'],
    52: ['Chinese Cymbal', 'Ch. Cym.', 'metal.cymbal.chinese'],
    53: ['Ride Bell', 'Rd. Bell', 'metal.bells.cowbell'],
    54: ['Tambourine', 'Tamb.', 'drum.tambourine'],
    55: ['Splash Cymbal', 'Spl. Cym.', 'metal.cymbal.splash'],
    56: ['Cowbell', 'Cowb.', 'metal.bells.cowbell'],
    57: ['Crash Cymbal 2', 'Cr. Cym2.', 'metal.cymbal.crash'],
    58: ['Vibraslap', 'Vibr.', 'rattle.vibraslap'],
    59: ['Ride Cymbal 2', 'Rd. Cym2.', 'metal.cymbal.ride'],
    60: ['High Bongo', 'H. Bongo', 'drum.bongo'],
    61: ['Low Bongo', 'L. Bongo', 'drum.bongo'],
    62: ['Mute High Conga', 'M. H. Cga.', 'drum.conga'],
    63: ['Open High Conga', 'Op. H. Cga.', 'drum.conga'],
    64: ['Low Conga', 'L. Cga.', 'drum.conga'],
    65: ['High Timbale', 'H. Timb.', 'drum.timbale'],
    66: ['Low Timbale', 'L. Timb.', 'drum.timbale'],
    67: ['High Agogo', 'H. Agog.', 'metal.bells.agogo'],
    68: ['Low Agogo', 'L. Agog.', 'metal.bells.agogo'],
    69: ['Cabasa', 'Cab.', 'rattle.cabasa'],
    70: ['Maracas', 'Marac.', 'rattle.maraca'],
    71: ['Short Whistle', 'Sh. Whis.', 'effect.whistle'],
    72: ['Long Whistle', 'Lg. Whis.', 'effect.whistle'],
    73: ['Short Guiro', 'Sh. Gui.', 'wood.guiro'],
    74: ['Long Guiro', 'Lg. Gui.', 'wood.guiro'],
    75: ['Claves', 'Clav.', 'wood.claves'],
    76: ['High Wood Block', 'H. Wblk.', 'wood.wood-block'],
    77: ['Low Wood Block', 'L. Wblk.', 'wood.wood-block'],
    78: ['Mute Cuica', 'M. Cuic.', 'drum.cuica'],
    79: ['Open Cuica', 'Op. Cuic.', 'drum.cuica'],
    80: ['Mute Triangle', 'M. Tri.', 'metal.triangle'],
    81: ['Open Triangle', 'Op. Tri.', 'metal.triangle']
};

// Export for Node.js and Browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MidiToMusicXML;
} else {
    window.MidiToMusicXML = MidiToMusicXML;
}