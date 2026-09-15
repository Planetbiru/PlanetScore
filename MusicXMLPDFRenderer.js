/**
 * Planetbiru MusicXML PDF Renderer
 * 
 * This class adapts the layout and drawing logic from MusicXMLSVGRenderer
 * to generate a multi-page PDF document using the jsPDF library.
 * 
 * @author Gemini Code Assist
 * @dependency jsPDF
 */
class MusicXMLPDFRenderer {
    /**
     * Creates a PDF renderer instance configured for MusicXML layout export.
     *
     * @param {Object} [options={}] Renderer settings.
     * @param {number} [options.staffSpacing=80] Vertical spacing between staff lines.
     * @param {number} [options.partSpacing=80] Gap between musical parts.
     * @param {number} [options.systemSpacing=80] Gap between systems.
     */
    constructor(options = {}) {
        this.doc = new window.jspdf.jsPDF({
            orientation: 'portrait',
            unit: 'pt',
            format: 'a4'
        });

        this.PAGE_WIDTH = this.doc.internal.pageSize.getWidth();
        this.PAGE_HEIGHT = this.doc.internal.pageSize.getHeight();
        this.MARGIN = 40;

        this.baseLineSpacing = 8;
        this.baseStaffSpacing = options.staffSpacing ?? 80;
        this.staffSpacing = this.baseStaffSpacing;
        this.partSpacing = options.partSpacing ?? 80;
        this.systemSpacing = options.systemSpacing ?? 80;
        this.measuresPerLine = 3;
        this.liricYOffset = 60;

        this.engraverColor = [15, 23, 42];
        this.staffLineColor = [71, 85, 105];
        this.lightLineColor = [203, 213, 225];
        this.subtitleColor = [100, 116, 139];

        this.stepOffsets = { 'C': 0, 'D': 1, 'E': 2, 'F': 3, 'G': 4, 'A': 5, 'B': 6 };

        this.doc.setFont('helvetica', 'normal');
        this.FONT_SANS_SERIF = 'helvetica';
        this.FONT_SERIF = 'times';
    }

    /**
     * Renders MusicXML content into a multi-page PDF score.
     *
     * @param {string} xmlText MusicXML source text to render.
     * @returns {void}
     * @throws {Error} If the MusicXML content is missing or malformed.
     */
    render(xmlText) {
        if (!xmlText || typeof xmlText !== 'string') {
            throw new Error("No MusicXML data provided.");
        }

        const scale = 1.0;
        this.lineSpacing = this.baseLineSpacing * scale;
        this.staffSpacing = this.baseStaffSpacing * scale;

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "application/xml");

        const parserError = xmlDoc.querySelector("parsererror");
        if (parserError) {
            throw new Error("Invalid MusicXML structure: " + parserError.textContent);
        }

        const parts = Array.from(xmlDoc.querySelectorAll("part"));
        if (parts.length === 0) return;

        const partMeasures = parts.map(p => Array.from(p.querySelectorAll("measure")));
        const partMeasureMap = partMeasures.map(mList => {
            const map = new Map();
            mList.forEach(measureNode => {
                const measureNumber = parseInt(measureNode.getAttribute("number") || "1", 10) || 1;
                map.set(measureNumber, measureNode);
            });
            return map;
        });

        const maxMeasureNumber = Math.max(1, ...partMeasures.flatMap(mList => mList.map(m => parseInt(m.getAttribute("number") || "1", 10) || 1)));
        const totalMeasures = maxMeasureNumber;

        const partStaffMap = [];
        let totalSystemStaves = 0;
        parts.forEach((partNode, pIdx) => {
            const firstM = partMeasures[pIdx][0];
            let numStaves = 1;
            if (firstM) {
                const stavesNode = firstM.querySelector("attributes staves");
                if (stavesNode) numStaves = parseInt(stavesNode.textContent) || 1;
            }
            partStaffMap.push({
                partIndex: pIdx,
                partNode: partNode,
                numStaves: numStaves,
                startStaffId: totalSystemStaves + 1
            });
            totalSystemStaves += numStaves;
        });

        const hasLyrics = xmlDoc.querySelector("lyric") !== null;
        // Hitung measures per line berdasarkan lebar halaman
        const availableWidth = this.PAGE_WIDTH - (this.MARGIN * 2) - 60; // 60 = space untuk clef+key+time
        const MIN_MEASURE_WIDTH = 150;
        const IDEAL_MEASURE_WIDTH = hasLyrics ? 200 : 220;
        let mpl = Math.floor(availableWidth / IDEAL_MEASURE_WIDTH);
        mpl = Math.max(1, Math.min(mpl, hasLyrics ? 3 : 4));
        this.measuresPerLine = mpl;

        let calculatedStaffSystemHeight = 0;
        const staffHeight = 4 * this.lineSpacing;
        for (let i = 0; i < partStaffMap.length; i++) {
            const pInfo = partStaffMap[i];
            calculatedStaffSystemHeight += pInfo.numStaves * staffHeight;
            calculatedStaffSystemHeight += Math.max(0, pInfo.numStaves - 1) * this.staffSpacing * scale;
            if (i < partStaffMap.length - 1) {
                calculatedStaffSystemHeight += this.partSpacing * scale;
            }
        }
        if (totalSystemStaves === 0) calculatedStaffSystemHeight = staffHeight;

        const lyricPadding = hasLyrics ? (this.liricYOffset + 20) * scale : 0;
        this.rowSpacing = calculatedStaffSystemHeight + lyricPadding + this.systemSpacing * scale;

        const songTitle = xmlDoc.querySelector("work-title")?.textContent || "Untitled Score";
        const composer = xmlDoc.querySelector("creator[type='composer']")?.textContent || "";
        const partName = parts.length === 1 ? (xmlDoc.querySelector("part-name")?.textContent || "Score") : "Full Score";

        const partDetails = {};
        partStaffMap.forEach(pInfo => {
            const partId = pInfo.partNode.getAttribute('id');
            const partListEntry = xmlDoc.querySelector(`part-list score-part[id="${partId}"]`);
            const name = partListEntry?.querySelector('part-name')?.textContent || `Part ${pInfo.partIndex + 1}`;
            const abbr = partListEntry?.querySelector('part-abbreviation')?.textContent || name.substring(0, 4);
            partDetails[pInfo.partIndex] = { name, abbr };
        });

        let currentY = this.MARGIN + 20;

        // Judul (center)
        this.drawText(
            this.PAGE_WIDTH / 2,
            currentY,
            songTitle,
            22,
            this.engraverColor,
            "center",
            true,
            this.FONT_SERIF
        );

        // ============================================================
        // Baseline bersama untuk Composer (kanan) dan Part Name (kiri)
        // ============================================================
        currentY += 15;
        const metadataY = currentY;

        // Composer (kanan)
        if (composer) {
            this.drawText(
                this.PAGE_WIDTH - this.MARGIN,
                metadataY,
                composer,
                11,
                this.engraverColor,
                "right",
                false,
                this.FONT_SANS_SERIF
            );
        }

        // Part Name / Instrument (kiri)
        this.drawText(
            this.MARGIN,
            metadataY,
            partName,
            12,
            this.subtitleColor,
            "left",
            true,
            this.FONT_SANS_SERIF
        );

        // Geser currentY ke posisi berikutnya (sebelum sistem pertama)
        currentY += 7;   // sisa 7 untuk mencapai total +22 dari judul

        currentY += 80;
        const leftMargin = this.MARGIN + 45;
        const rightMargin = this.MARGIN;
        const systemStartX = this.MARGIN;
        const usableWidth = this.PAGE_WIDTH - leftMargin - rightMargin;
        const measureWidth = Math.max(220, usableWidth / this.measuresPerLine);

        let currentX = leftMargin;

        const staffState = {};
        for (let s = 1; s <= totalSystemStaves; s++) {
            staffState[s] = { clef: "G", fifths: 0, beats: 4, beatType: 4, timeSymbol: null, divisions: 4 };
        }

        const activeTies = {};

        for (let measureIdx = 0; measureIdx < totalMeasures; measureIdx++) {
            const isSystemStart = (measureIdx % this.measuresPerLine === 0);

            partStaffMap.forEach(pInfo => {
                const mNode = partMeasureMap[pInfo.partIndex].get(measureIdx + 1);
                if (!mNode) return;
                const attrNode = mNode.querySelector("attributes");
                if (attrNode) {
                    const divVal = parseInt(attrNode.querySelector("divisions")?.textContent || "4");
                    const fifthsVal = parseInt(attrNode.querySelector("key fifths")?.textContent || "0");
                    const timeNode = attrNode.querySelector("time");
                    for (let s = 0; s < pInfo.numStaves; s++) {
                        const staffId = pInfo.startStaffId + s;
                        if (staffState[staffId]) {
                            staffState[staffId].divisions = divVal;
                            staffState[staffId].fifths = fifthsVal;
                            if (timeNode) {
                                staffState[staffId].beats = parseInt(timeNode.querySelector("beats")?.textContent || "4");
                                staffState[staffId].beatType = parseInt(timeNode.querySelector("beat-type")?.textContent || "4");
                                staffState[staffId].timeSymbol = timeNode.getAttribute("symbol");
                            }
                        }
                    }
                    attrNode.querySelectorAll("clef").forEach(clefNode => {
                        const clefNum = parseInt(clefNode.getAttribute("number") || "1");
                        const sign = clefNode.querySelector("sign")?.textContent;
                        const staffId = pInfo.startStaffId + (clefNum - 1);
                        if (staffState[staffId] && sign) staffState[staffId].clef = sign;
                    });
                }
            });

            if (isSystemStart) {
                if (measureIdx > 0) {
                    if (currentY + this.rowSpacing > this.PAGE_HEIGHT - this.MARGIN) {
                        this.doc.addPage();
                        currentY = this.MARGIN;
                    } else {
                        currentY += this.rowSpacing;
                    }
                }
                currentX = leftMargin;
            }

            if (isSystemStart) {
                const remainingMeasuresInSystem = Math.min(this.measuresPerLine, totalMeasures - measureIdx);
                const systemRowWidth = (leftMargin - systemStartX) + (remainingMeasuresInSystem * measureWidth);

                if (isSystemStart) {
                    // ... (system start logic)
                    currentX = leftMargin;
                }

                // ============================================================
                // PERBAIKAN: Set posisi barline untuk measure ini
                // ============================================================
                this.currentMeasureStartX = currentX;
                this.currentMeasureRightX = currentX + measureWidth

                this.drawSystemStartLine(systemStartX, currentY, calculatedStaffSystemHeight);

                let currentStaffYOffset = 0;
                let previousPartIndex = -1;
                for (let s = 1; s <= totalSystemStaves; s++) {
                    const pInfo = partStaffMap.find(p => s >= p.startStaffId && s < p.startStaffId + p.numStaves);
                    if (!pInfo) continue;

                    const localStaff = (s - pInfo.startStaffId) + 1;
                    if (pInfo.partIndex !== previousPartIndex && previousPartIndex !== -1) {
                        currentStaffYOffset += this.partSpacing * scale;
                    }
                    const sY = currentY + currentStaffYOffset;

                    this.drawStaffLines(systemStartX, sY, systemRowWidth);
                    this.drawBarLine(leftMargin, sY, false, staffHeight);

                    const state = staffState[s];
                    const clefX = systemStartX + 5;
                    this.drawClef(state.clef, clefX, sY);

                    const keySigX = clefX + 20;
                    this.drawKeySignature(keySigX, sY, state.fifths, state.clef);

                    const timeSigX = keySigX + 6;
                    this.drawTimeSignature(timeSigX, sY, state.beats, state.beatType, state.timeSymbol);

                    const textX = systemStartX - 16;
                    const textY = sY + (4.05 * this.lineSpacing);
                    const textContent = partDetails[pInfo.partIndex].abbr;
                    this.drawText(textX, textY, textContent, 9, this.engraverColor, "left", false, this.FONT_SANS_SERIF, 90);

                    currentStaffYOffset += (4 * this.lineSpacing);
                    if (localStaff < pInfo.numStaves) {
                        currentStaffYOffset += this.staffSpacing * scale;
                    }
                    previousPartIndex = pInfo.partIndex;
                }

                let braceYOffset = 0;
                partStaffMap.forEach((pInfo, index) => {
                    const partHeight = pInfo.numStaves * (4 * this.lineSpacing) + Math.max(0, pInfo.numStaves - 1) * this.staffSpacing * scale;
                    if (pInfo.numStaves >= 2) {
                        const braceTopY = currentY + braceYOffset;
                        const braceBottomY = braceTopY + partHeight;
                        this.drawGrandStaffBrace(systemStartX - 4, braceTopY, braceBottomY);
                    }
                    braceYOffset += partHeight + (index < partStaffMap.length - 1 ? this.partSpacing * scale : 0);
                });

                this.drawText(systemStartX, currentY - 14, `${measureIdx + 1}`, 10, this.subtitleColor, "left", true, this.FONT_SANS_SERIF);
            }

            const isLastMeasureInScore = (measureIdx === totalMeasures - 1);
            let rightBarOffset = 0;
            let rightPrevPart = -1;
            for (let s = 1; s <= totalSystemStaves; s++) {
                const pInfo = partStaffMap.find(p => s >= p.startStaffId && s < (p.startStaffId + p.numStaves));
                if (!pInfo) continue;
                if (pInfo.partIndex !== rightPrevPart && rightPrevPart !== -1) {
                    rightBarOffset += this.partSpacing * scale;
                }
                const sY = currentY + rightBarOffset;
                this.drawBarLine(currentX + measureWidth, sY, isLastMeasureInScore, staffHeight);
                rightBarOffset += (4 * this.lineSpacing);
                const localStaff = (s - pInfo.startStaffId) + 1;
                if (localStaff < pInfo.numStaves) {
                    rightBarOffset += this.staffSpacing * scale;
                }
                rightPrevPart = pInfo.partIndex;
            }

            let currentStaffYOffset = 0;
            let previousPartIndex = -1;
            for (let s = 1; s <= totalSystemStaves; s++) {
                const pInfo = partStaffMap.find(p => s >= p.startStaffId && s < p.startStaffId + p.numStaves);
                let channelId = -1;
                if (pInfo) {
                    const partId = pInfo.partNode.getAttribute('id');
                    const partListEntry = xmlDoc.querySelector(`part-list score-part[id="${partId}"]`);
                    const midiChannelNode = partListEntry?.querySelector('midi-instrument midi-channel');
                    if (midiChannelNode) channelId = parseInt(midiChannelNode.textContent, 10);
                }
                if (!pInfo) continue;

                const localStaff = (s - pInfo.startStaffId) + 1;
                if (pInfo.partIndex !== previousPartIndex && previousPartIndex !== -1) {
                    currentStaffYOffset += this.partSpacing * scale;
                }
                const sY = currentY + currentStaffYOffset;

                const state = staffState[s];
                const mNode = partMeasureMap[pInfo.partIndex].get(measureIdx + 1);
                if (!mNode) continue;

                let measureDuration = state.beats * state.divisions;
                let currentDiv = 0;
                let lastBaseDiv = 0;
                const allNotesInMeasure = [];
                const currentStaffDivisions = state.divisions;

                mNode.querySelectorAll("note").forEach(originalNoteNode => {
                    const noteStaff = parseInt(originalNoteNode.querySelector("staff")?.textContent || "1", 10);
                    if (noteStaff !== localStaff) return;

                    const isChord = originalNoteNode.querySelector("chord") !== null;
                    const isRest = originalNoteNode.querySelector("rest") !== null;
                    let originalDuration = parseInt(originalNoteNode.querySelector("duration")?.textContent || "0", 10);
                    let lyricText = originalNoteNode.querySelector("lyric text")?.textContent;

                    let originalTieStart = false;
                    let originalTieStop = false;
                    originalNoteNode.querySelectorAll("tie, tied").forEach(t => {
                        const type = t.getAttribute("type");
                        if (type === "start") originalTieStart = true;
                        if (type === "stop") originalTieStop = true;
                    });

                    let pieces = [originalDuration];
                    if (!isRest && originalDuration > 0 && !MusicXMLPDFRenderer.isStandardDuration(originalDuration, currentStaffDivisions)) {
                        pieces = MusicXMLPDFRenderer.splitDurationIntoRepresentablePieces(originalDuration, currentStaffDivisions);
                    }

                    let pieceCurrentDiv = isChord ? lastBaseDiv : currentDiv;

                    pieces.forEach((pieceDuration, pIdx) => {
                        const isFirstPiece = (pIdx === 0);
                        const isLastPiece = (pIdx === pieces.length - 1);

                        let pieceTieStart = false;
                        let pieceTieStop = false;

                        if (pieces.length > 1) {
                            if (isFirstPiece) {
                                pieceTieStart = true;
                                pieceTieStop = originalTieStop;
                            } else if (isLastPiece) {
                                pieceTieStart = originalTieStart;
                                pieceTieStop = true;
                            } else {
                                pieceTieStart = true;
                                pieceTieStop = true;
                            }
                        } else {
                            pieceTieStart = originalTieStart;
                            pieceTieStop = originalTieStop;
                        }

                        const noteData = {
                            isRest: isRest,
                            staff: s,
                            step: originalNoteNode.querySelector("pitch step, unpitched display-step")?.textContent || "C",
                            octave: parseInt(originalNoteNode.querySelector("pitch octave, unpitched display-octave")?.textContent || "4", 10),
                            alter: parseInt(originalNoteNode.querySelector("pitch alter")?.textContent || "0", 10),
                            accidental: originalNoteNode.querySelector("accidental")?.textContent,
                            type: MusicXMLPDFRenderer.getNoteType(pieceDuration, currentStaffDivisions),
                            notehead: originalNoteNode.querySelector("notehead")?.textContent,
                            dots: MusicXMLPDFRenderer.getDotCount(pieceDuration, currentStaffDivisions),
                            lyric: isFirstPiece ? lyricText : null,
                            onsetDiv: pieceCurrentDiv,
                            duration: pieceDuration,
                            tieStart: pieceTieStart,
                            tieStop: pieceTieStop,
                            divisions: currentStaffDivisions,
                            beatType: state.beatType || 4
                        };
                        allNotesInMeasure.push(noteData);

                        if (!isChord) {
                            pieceCurrentDiv += pieceDuration;
                        }
                    });

                    if (!isChord) {
                        currentDiv = pieceCurrentDiv;
                    }
                    lastBaseDiv = currentDiv;
                });

                const totalMeasureDivs = Math.max(measureDuration, currentDiv, 1);

                // Isi measure kosong dengan rest
                if (allNotesInMeasure.length === 0) {
                    allNotesInMeasure.push({
                        isRest: true,
                        staff: s,
                        step: "C",
                        octave: 4,
                        alter: 0,
                        accidental: null,
                        type: MusicXMLPDFRenderer.getNoteType(measureDuration, currentStaffDivisions),
                        notehead: null,
                        dots: 0,
                        lyric: null,
                        onsetDiv: 0,
                        duration: measureDuration,
                        tieStart: false,
                        tieStop: false,
                        divisions: currentStaffDivisions,
                        beatType: state.beatType || 4
                    });
                } else {
                    const firstOnset = Math.min(...allNotesInMeasure.map(note => note.onsetDiv || 0));
                    if (firstOnset > 0) {
                        allNotesInMeasure.unshift({
                            isRest: true,
                            staff: s,
                            step: "C",
                            octave: 4,
                            alter: 0,
                            accidental: null,
                            type: MusicXMLPDFRenderer.getNoteType(firstOnset, currentStaffDivisions),
                            notehead: null,
                            dots: 0,
                            lyric: null,
                            onsetDiv: 0,
                            duration: firstOnset,
                            tieStart: false,
                            tieStop: false,
                            divisions: currentStaffDivisions,
                            beatType: state.beatType || 4
                        });
                    }
                }

                // ============================================================
                // PENGELOMPOKAN KOLOM (sama dengan SVG Renderer)
                // ============================================================
                const columnsByOnset = {};
                allNotesInMeasure.forEach(note => {
                    const key = note.tieStart ? `${note.onsetDiv}-tie` : `${note.onsetDiv}`;
                    if (!columnsByOnset[key]) columnsByOnset[key] = [];
                    columnsByOnset[key].push(note);
                });

                const sortedKeys = Object.keys(columnsByOnset).sort((a, b) => {
                    const aOnset = parseInt(a);
                    const bOnset = parseInt(b);
                    if (aOnset !== bOnset) return aOnset - bOnset;
                    if (a.includes('tie') && !b.includes('tie')) return 1;
                    if (!a.includes('tie') && b.includes('tie')) return -1;
                    return 0;
                });

                let lastX = 0;
                const allColumns = [];

                sortedKeys.forEach(key => {
                    const onset = parseInt(key) || 0;
                    const colNotes = columnsByOnset[key];
                    const ratio = onset / totalMeasureDivs;
                    const padding = 8;
                    const xRange = measureWidth - padding * 2;
                    let colX = currentX + padding + ratio * xRange;

                    const hasTieStart = colNotes.some(n => n.tieStart);
                    const hasTieStop = colNotes.some(n => n.tieStop);
                    const isChord = colNotes.length > 1;

                    // Tie stop: geser ke kiri
                    if (hasTieStop && !hasTieStart && !isChord && allColumns.length > 0) {
                        colX -= 16;
                    }

                    // Tie + non-tie di posisi yang sama: geser tie
                    const hasNonTie = colNotes.some(n => !n.tieStart && !n.tieStop);
                    if (hasTieStart && hasNonTie) {
                        colX -= 14;
                    }

                    // Pastikan tidak tumpang tindih
                    if (colX <= lastX + 5) {
                        colX = lastX + 12;
                    }
                    lastX = colX;

                    allColumns.push({
                        key: key,
                        onset: onset,
                        colX: colX,
                        colNotes: colNotes,
                        hasTieStart: hasTieStart,
                        hasTieStop: hasTieStop,
                        isChord: isChord
                    });
                });

                // Pass kedua: deteksi tumpang tindih antar kolom
                for (let i = 0; i < allColumns.length - 1; i++) {
                    const current = allColumns[i];
                    const next = allColumns[i + 1];
                    if (next.colX - current.colX < 12) {
                        if (current.hasTieStart && !current.hasTieStop) {
                            current.colX -= 6;
                        }
                        if (next.hasTieStart && !next.hasTieStop) {
                            next.colX -= 6;
                        }
                        if (current.hasTieStart && next.hasTieStart) {
                            current.colX -= 4;
                            next.colX += 4;
                        }
                    }
                }

                // Gambar semua kolom
                const renderedStems = [];
                allColumns.forEach(col => {
                    const stemData = this.drawNoteColumn(
                        col.colX,
                        sY,
                        col.colNotes,
                        state.clef,
                        activeTies,
                        channelId
                    );
                    if (stemData && stemData.isBeamable) {
                        renderedStems.push(stemData);
                    }
                });

                // Render beams
                this.drawBeams(renderedStems);

                currentStaffYOffset += (4 * this.lineSpacing);
                if (localStaff < pInfo.numStaves) {
                    currentStaffYOffset += this.staffSpacing * scale;
                }
                previousPartIndex = pInfo.partIndex;
            }

            currentX += measureWidth;
        }
    }

    /**
     * Saves the generated PDF to the browser download stream.
     *
     * @param {string} [filename='music-score.pdf'] Output file name.
     * @returns {void}
     */
    save(filename = 'music-score.pdf') {
        this.doc.save(filename);
    }

    // ============================================================
    // DRAWING PRIMITIVES
    // ============================================================

    /**
     * Draws the five staff lines for a given staff and width.
     *
     * @param {number} x Starting x-coordinate for the staff.
     * @param {number} y Starting y-coordinate for the staff.
     * @param {number} width Total width of the staff.
     * @returns {void}
     */
    drawStaffLines(x, y, width) {
        this.doc.setDrawColor(...this.staffLineColor);
        this.doc.setLineWidth(0.7);
        for (let i = 0; i < 5; i++) {
            const lineY = y + i * this.lineSpacing;
            this.doc.line(x, lineY, x + width, lineY);
        }

        // === BARU: simpan batas kiri/kanan sistem untuk tie antar-sistem ===
        this.currentSystemLeftX  = x;
        this.currentSystemRightX = x + width;
    }

    /**
     * Draws the left boundary line for a score system.
     *
     * @param {number} x X-position of the boundary.
     * @param {number} y Top y-position of the system.
     * @param {number} totalSystemHeight Total vertical height of the system.
     * @returns {void}
     */
    drawSystemStartLine(x, y, totalSystemHeight) {
        this.doc.setDrawColor(...this.engraverColor);
        this.doc.setLineWidth(1.3);
        this.doc.line(x, y, x, y + totalSystemHeight);
    }

    /**
     * Draws a grand-staff brace between two staff groups.
     *
     * @param {number} x X-position for the brace.
     * @param {number} topY Top y-coordinate of the brace.
     * @param {number} bottomY Bottom y-coordinate of the brace.
     * @returns {void}
     */
    drawGrandStaffBrace(x, topY, bottomY) {
        const height = bottomY - topY;
        const midY = topY + height / 2;
        const depth = 12;

        const d = `M ${x} ${topY} 
            C ${x - depth * 0.8} ${topY + height * 0.1}, ${x - depth * 0.8} ${midY - height * 0.1}, ${x - depth} ${midY} 
            C ${x - depth * 0.8} ${midY + height * 0.1}, ${x - depth * 0.8} ${bottomY - height * 0.1}, ${x} ${bottomY} 
            C ${x - depth * 0.6} ${bottomY - height * 0.05}, ${x - depth * 0.6} ${midY + height * 0.05}, ${x - depth * 0.9} ${midY} 
            C ${x - depth * 0.6} ${midY - height * 0.05}, ${x - depth * 0.6} ${topY + height * 0.05}, ${x} ${topY} Z`;
        this.doc.setFillColor(...this.engraverColor);
        this.drawSVGPath(d, 0, 0, 1, 1, true, 'none');
    }

    /**
     * Draws a measure barline, including the final barline style when needed.
     *
     * @param {number} x X-position of the barline.
     * @param {number} y Top y-position of the staff.
     * @param {boolean} isFinalEnd Whether this is the final ending barline.
     * @param {number} totalSystemHeight Total staff height for the system.
     * @returns {void}
     */
    drawBarLine(x, y, isFinalEnd, totalSystemHeight) {
        this.doc.setDrawColor(...this.staffLineColor);
        if (isFinalEnd) {
            this.doc.setLineWidth(1.1);
            this.doc.line(x - 5, y, x - 5, y + totalSystemHeight);
            this.doc.setLineWidth(3.5);
            this.doc.line(x, y, x, y + totalSystemHeight);
        } else {
            this.doc.setLineWidth(1.2);
            this.doc.line(x, y, x, y + totalSystemHeight);
        }
    }

    /**
     * Draws the correct clef symbol for a staff.
     *
     * @param {string} clefSign Clef type such as G, F, or C.
     * @param {number} x X-position for the clef.
     * @param {number} y Top y-position of the staff.
     * @returns {void}
     */
    drawClef(clefSign, x, y) {
        if (clefSign === "F") {
            this.drawBassClef(x, y);
        } else if (clefSign === "C") {
            this.drawAltoClef(x, y);
        } else {
            this.drawTrebleClef(x, y);
        }
    }

    /**
     * Draws a treble clef using a vector path.
     *
     * @param {number} x X-position for the treble clef.
     * @param {number} y Top y-position of the staff.
     * @returns {void}
     */
    drawTrebleClef(x, y) {
        const scale = 0.75;
        const treblePathData = "M165 177q-24 30-26 60-2 34 19 64 23 32 57 34h21l4 23q3 15 2 26-1 15-9 24-9 10-23 9-6 0-11-3l10-5q9-7 10-19 0-12-6-21-8-9-20-10t-22 9q-7 10-9 22-1 19 14 31 13 11 31 12a52 52 0 0 0 34-9q17-13 18-31 1-15-2-34l-4-29q17-5 28-20 12-15 13-36 3-25-12-46a51 51 0 0 0-46-23l-5-36q20-16 32-42 12-24 14-53 0-17-5-41-7-31-22-33-6 0-12 6a89 89 0 0 0-25 37 167 167 0 0 0-3 89q-31 29-45 45m98 97c0 12-5 31-13 36l-9-63q21 6 22 27m-41-169q1-18 9-37 10-22 16-22h3c5 0 10 2 9 15q-1 17-13 35-10 15-22 25-3-7-2-16m-6 76 3 27q-14 6-23 18-12 13-13 30-1 18 8 31 4 7 12 13c7 5 16 5 18 2q0-4-8-15-4-5-4-13 1-18 16-25l9 70-16 1q-22-2-39-19a48 48 0 0 1-16-38q3-42 53-82";
        const adjustedX = x - (16 * scale);
        const adjustedY = y + (6 * scale);
        const tx = adjustedX - 10 * scale;
        const ty = adjustedY - 24 * scale;
        const sx = 0.2075 * scale * 0.8;
        const sy = 0.2075 * scale * 0.8;
        this.doc.setFillColor(...this.engraverColor);
        this.drawSVGPath(treblePathData, tx, ty, sx, sy, true);
    }

    /**
     * Draws a bass clef using a vector path and two dots.
     *
     * @param {number} x X-position for the bass clef.
     * @param {number} y Top y-position of the staff.
     * @returns {void}
     */
    drawBassClef(x, y) {
        const scale = 0.8;
        const bassPathData = "M205 23c-67 0-107 39-118 77-11 39 3 77 17 98h1a64 64 0 0 0 52 26 64 64 0 0 0 64-64 64 64 0 0 0-64-64 64 64 0 0 0-50 24l3-18c10-33 34-61 95-61 60 0 94 64 92 153-1 80-12 128-60 171q-72 65-180 107c-13 5-1 19 7 16 73-28 145-53 196-98 51-46 96-87 96-198 1-97-44-169-151-169";
        const adjustedX = x - (11 * scale);
        const tx = adjustedX + (2.5 * scale);
        const ty = y - 1.5 * scale;
        const sx = 0.09 * scale;
        const sy = 0.09 * scale;
        this.doc.setFillColor(...this.engraverColor);
        this.drawSVGPath(bassPathData, tx, ty, sx, sy, true);

        const dotAdjustedX = adjustedX + (22 * scale);
        const dotAdjustedY = y - (5 * scale);
        const dotX = dotAdjustedX + (17 * scale);
        const r = 1.5 * scale;
        this.drawCircle(dotX, dotAdjustedY + (1 * this.lineSpacing), r, this.engraverColor);
        this.drawCircle(dotX, dotAdjustedY + (2 * this.lineSpacing), r, this.engraverColor);
    }

    /**
     * Draws an alto clef using a vector path.
     *
     * @param {number} x X-position for the alto clef.
     * @param {number} y Top y-position of the staff.
     * @returns {void}
     */
    drawAltoClef(x, y) {
        const scaleFactor = 1.0;
        const staffHeight = 4 * this.lineSpacing;
        const nativeClefHeight = 2362;
        const clefScale = staffHeight / nativeClefHeight * scaleFactor;
        const pathData = "M0 2362L0 56L0 5L266 5L266 2311L266 2362L0 2362zM400 2362L400 56L400 5L485 5L485 1160C527 1138 570 1093 612 1022C655 952 691 878 719 799C747 720 762 662 764 624C777 708 798 775 826 826C855 876 886 912 922 934C958 955 993 966 1029 966C1118 955 1174 915 1198 834C1222 764 1234 665 1234 548C1234 495 1233 447 1230 405C1227 363 1221 320 1210 277C1200 234 1183 195 1159 161C1134 127 1102 103 1062 91C1026 81 990 76 955 76C923 76 896 82 875 93C853 104 841 121 839 141C844 159 856 180 877 205C898 229 912 248 920 260C928 272 932 289 932 312C932 353 918 387 890 415C862 443 825 458 778 458C732 458 694 441 666 408C638 374 623 334 621 289C625 228 647 175 686 131C726 88 775 55 834 33C893 11 952 0 1012 0C1080 0 1145 12 1207 36C1270 60 1326 96 1374 142C1423 189 1462 246 1490 314C1518 381 1532 458 1532 543C1532 661 1510 759 1467 836C1423 914 1367 972 1299 1008C1230 1044 1157 1064 1080 1066C1000 1061 933 1043 880 1012L774 1184L880 1355C953 1325 1025 1310 1095 1310C1184 1310 1261 1336 1328 1386C1394 1437 1445 1502 1480 1583C1514 1664 1532 1747 1532 1833C1532 1927 1511 2015 1469 2096C1427 2177 1368 2241 1292 2290C1215 2338 1128 2362 1029 2362C914 2357 818 2330 741 2280C664 2231 626 2157 626 2060C630 2013 647 1977 677 1950C707 1922 739 1908 774 1905C816 1905 854 1920 887 1950C920 1979 937 2016 937 2060C937 2077 933 2093 925 2108C917 2122 906 2139 890 2159C874 2178 863 2192 857 2201C851 2211 846 2222 844 2236C844 2254 855 2269 878 2281C900 2293 929 2300 964 2303C1074 2298 1147 2251 1184 2164C1220 2075 1238 1966 1238 1833C1238 1718 1225 1617 1199 1531C1173 1444 1117 1401 1029 1401C951 1401 891 1434 849 1502C807 1569 780 1648 768 1739C755 1662 735 1588 706 1517C677 1445 644 1382 605 1328C568 1275 527 1232 485 1202L485 2362L400 2362z";
        const tx = x - (9.5 * clefScale);
        const ty = y;
        this.doc.setFillColor(...this.engraverColor);
        this.drawSVGPath(pathData, tx, ty, clefScale, clefScale, true);
    }

    /**
     * Draws a filled or outlined circle.
     *
     * @param {number} cx Circle center x-coordinate.
     * @param {number} cy Circle center y-coordinate.
     * @param {number} r Radius of the circle.
     * @param {number[]} color RGB color array.
     * @param {string} [style='F'] Fill or stroke style.
     * @returns {void}
     */
    drawCircle(cx, cy, r, color, style = 'F') {
        this.doc.setFillColor(...color);
        this.doc.circle(cx, cy, r, style);
    }

    /**
     * Draws the time signature for the staff.
     *
     * @param {number} x X-position of the time signature.
     * @param {number} y Top y-position of the staff.
     * @param {number} beats Number of beats in the measure.
     * @param {number} beatType Beat unit value.
     * @param {string|null} [symbol=null] Optional time-symbol style such as common or cut.
     * @returns {void}
     */
    drawTimeSignature(x, y, beats, beatType, symbol = null) {
        if (symbol === "common") {
            this.drawText(x, y + 24, "C", 24, this.engraverColor, "center", true, this.FONT_SERIF);
        } else if (symbol === "cut") {
            this.drawText(x, y + 2 * this.lineSpacing, "C", 24, this.engraverColor, "center", true, this.FONT_SERIF);
            this.doc.setDrawColor(...this.engraverColor);
            this.doc.setLineWidth(1.5);
            this.doc.line(x, y + 10, x, y + 38);
        } else {
            const topY = y + 1.85 * this.lineSpacing;
            const bottomY = y + 3.5 * this.lineSpacing;
            this.drawText(x + 6.5, topY, `${beats}`, 16, this.engraverColor, "center", true, this.FONT_SERIF);
            this.drawText(x + 6.5, bottomY, `${beatType}`, 16, this.engraverColor, "center", true, this.FONT_SERIF);
        }
    }

    /**
     * Draws the key signature according to the staff clef and sharp/flat count.
     *
     * @param {number} x X-position for the signature.
     * @param {number} y Top y-position of the staff.
     * @param {number} fifths Number of accidentals in the key signature.
     * @param {string} clefType Clef name: G, F, or C.
     * @returns {number} The horizontal width consumed by the signature.
     */
    drawKeySignature(x, y, fifths, clefType) {
        if (!fifths || fifths === 0) return 0;

        const count = Math.abs(fifths);

        // Posisi standar key signature per clef (diatonic index)
        const trebleSharps = [10, 7, 11, 8, 5, 9, 6];      // F5 C5 G5 D5 A4 E5 B4
        const trebleFlats  = [6, 9, 5, 8, 4, 7, 3];        // B4 E5 A4 D5 G4 C5 F4
        const bassSharps   = [-4, -7, -3, -6, -9, -5, -8]; // F3 C3 G3 D3 A2 E3 B2
        const bassFlats    = [-8, -5, -9, -6, -10, -7, -11]; // B2 E3 A2 D3 G2 C3 F2
        const altoSharps   = [3, 0, 4, 1, -2, 2, -1];      // F4 C4 G4 D4 A3 E4 B3
        const altoFlats    = [-1, 2, -2, 1, -3, 0, -4];    // B3 E4 A3 D4 G3 C4 F3

        let positions;
        if (clefType === "F") {
            positions = fifths > 0 ? bassSharps : bassFlats;
        } else if (clefType === "C") {
            positions = fifths > 0 ? altoSharps : altoFlats;
        } else {
            positions = fifths > 0 ? trebleSharps : trebleFlats;
        }

        for (let i = 0; i < Math.min(count, positions.length); i++) {
            const diatonic = positions[i];
            const symY = this.getNoteY(diatonic, y, clefType);
            const symX = x + i * 8.5;
            if (fifths > 0) {
                this.drawSharp(symX, symY);
            } else {
                this.drawFlat(symX, symY);
            }
        }

        return count * 9;
    }

    /**
     * Draws a sharp accident symbol.
     *
     * @param {number} x X-position for the symbol.
     * @param {number} y Y-position for the symbol.
     * @returns {void}
     */
    drawSharp(x, y) {
        const scale = 0.6;
        const paths = [
            "M1.2 0 L1.6 0 L1.6 10 L1.2 10 Z",
            "M3.0 0 L3.4 0 L3.4 10 L3.0 10 Z",
            "M0 3.5 L5 2.5 L5 3.0 L0 4.0 Z",
            "M0 6.5 L5 5.5 L5 6.0 L0 7.0 Z"
        ];
        const tx = x + 7 * scale;
        const ty = y - 8.5 * scale;
        const sx = 2.2 * scale * 0.8;
        const sy = 2.2 * scale * 0.8;

        paths.forEach(d => {
            this.doc.setFillColor(...this.engraverColor);
            this.drawSVGPath(d, tx, ty, sx, sy, true);
        });
    }

    /**
     * Draws a flat accident symbol.
     *
     * @param {number} x X-position for the symbol.
     * @param {number} y Y-position for the symbol.
     * @returns {void}
     */
    drawFlat(x, y) {
        const scale = 0.8;
        const d = "M 1.2 0 L 1.6 0 L 1.6 9 C 4.8 9 4.8 18 1.6 18 L 1.2 18 Z";
        const tx = x + 3.15 * scale;
        const ty = y - 30.35 * scale;
        const sx = 2.25 * scale;
        const sy = 2.25 * scale;
        this.doc.setFillColor(...this.engraverColor);
        this.drawSVGPath(d, tx, ty, sx, sy, true);
    }

    /**
     * Draws a natural accident symbol.
     *
     * @param {number} x X-position for the symbol.
     * @param {number} y Y-position for the symbol.
     * @returns {void}
     */
    drawNatural(x, y) {
        const scale = 0.8;
        const d = "M 1 0 L 1.4 0 L 1.4 10 L 1 10 Z M 3 0 L 3.4 0 L 3.4 10 L 3 10 Z M 1 3 L 3.4 3 L 3.4 3.5 L 1 3.5 Z M 1 6.5 L 3.4 6.5 L 3.4 7 L 1 7 Z";
        const tx = x + 4.5 * scale;
        const ty = y - 10.5 * scale;
        const sx = 2.25 * scale;
        const sy = 2.25 * scale;
        this.doc.setFillColor(...this.engraverColor);
        this.drawSVGPath(d, tx, ty, sx, sy, true);
    }

    // ============================================================
    // DRAW NOTE COLUMN (mengembalikan stem data untuk beaming)
    // ============================================================
    /**
     * Draws a note column, including rest handling, accidentals, ties, and stem metadata.
     *
     * @param {number} x X-position of the note column.
     * @param {number} y Top y-position of the staff.
     * @param {Array<Object>} notes Array of note objects belonging to the same column.
     * @param {string} clefType Current clef type.
     * @param {Object} activeTies Map of active tie objects keyed by pitch.
     * @param {number} [channelId=-1] MIDI channel id used to determine drum-like notehead styling.
     * @returns {Object|null} Stem and beaming metadata for the column, or null for rests.
     */
    drawNoteColumn(x, y, notes, clefType, activeTies, channelId = -1) {
        const rests = notes.filter(n => n.isRest);
        if (rests.length > 0) {
            const restNote = rests[0];
            this.drawRestSymbol(x, y, restNote.type, this.engraverColor);
            if (restNote.dots > 0) {
                for (let i = 0; i < restNote.dots; i++) {
                    this.drawDot(x + 15 + (i * 8), y + 2 * this.lineSpacing, this.engraverColor);
                }
            }
            if (restNote.lyric) {
                this.drawText(x, y + this.liricYOffset, restNote.lyric, 10, this.engraverColor, "center", false, this.FONT_SANS_SERIF);
            }
            return null;
        }

        const calculatedNotes = notes.map(note => {
            const diatonic = this.getDiatonicIndex(note.step, note.octave);
            const noteY = this.getNoteY(diatonic, y, clefType);
            return { ...note, diatonic, y: noteY };
        });

        calculatedNotes.sort((a, b) => a.diatonic - b.diatonic);

        const lowestNote = calculatedNotes[0];
        const highestNote = calculatedNotes[calculatedNotes.length - 1];

        const avgDiatonic = calculatedNotes.reduce((sum, n) => sum + n.diatonic, 0) / calculatedNotes.length;
        const middleDiatonic = clefType === "F" ? -6 : 6;
        const stemDown = avgDiatonic >= middleDiatonic;

        // Ledger lines dulu
        calculatedNotes.forEach(note => {
            this.drawLedgerLines(x, y, note.diatonic, clefType);
        });

        // Gambar note head, accidental, dots, lyric, tie
        calculatedNotes.forEach(note => {
            const isHollow = note.type === "whole" || note.type === "half";
            this.drawNotehead(x, note.y, this.engraverColor, isHollow, note.notehead, channelId);

            if (note.dots > 0) {
                for (let i = 0; i < note.dots; i++) {
                    this.drawDot(x + 8 + (i * 8), note.y, this.engraverColor);
                }
            }

            if (note.accidental === "natural") {
                this.drawNatural(x - 14, note.y);
            } else if (note.alter === 1) {
                this.drawSharp(x - 14, note.y);
            } else if (note.alter === -1) {
                this.drawFlat(x - 14, note.y);
            }

            if (note.lyric) {
                this.drawText(x, y + this.liricYOffset, note.lyric, 10, this.engraverColor, "center", false, this.FONT_SANS_SERIF);
            }

            // Tie
            const { tieStart, tieStop } = note;
            const pitchKey = `${note.step}${note.alter}${note.octave}${note.staff}`;

            if (tieStop && activeTies[pitchKey]) {
                const prev = activeTies[pitchKey];
                const yOffset = (stemDown ? -8 : 8);
                const sy1 = prev.y + yOffset;
                const sy2 = note.y + yOffset;

                const isCrossSystem = (x <= prev.x) || (Math.abs(prev.y - note.y) > 50);
                const thickness = 3.3;
                const span = Math.abs(x - prev.x);
                const curveHeight = Math.min(22, Math.max(8, span * 0.35));

                if (isCrossSystem) {
                    const currentPage = this.doc.getCurrentPageInfo().pageNumber;
                    const prevPage    = prev.pageNumber;

                    // ============================================================
                    // SEGMEN 1 — digambar di HALAMAN SEBELUMNYA
                    // ============================================================
                    if (prevPage !== undefined && prevPage !== currentPage) {
                        this.doc.setPage(prevPage);
                    }

                    // Pakai systemRightX yang disimpan saat tieStart, bukan this.currentSystemRightX
                    // (nilai ini sudah ditimpa oleh drawStaffLines sistem baru)
                    const systemRightX = prev.systemRightX ?? (prev.x + 22);
                    const endX1 = systemRightX;
                    const cx1   = (prev.x + endX1) / 2;
                    const cy1   = sy1 + (stemDown ? -curveHeight : curveHeight);

                    const d1 = `M ${prev.x} ${sy1} Q ${cx1} ${cy1} ${endX1} ${sy1} ` +
                            `Q ${cx1} ${cy1 - (stemDown ? -thickness : thickness)} ${prev.x} ${sy1} Z`;
                    this.doc.setFillColor(...this.engraverColor);
                    this.drawSVGPath(d1, 0, 0, 1, 1, true, 'none');

                    // Kembali ke halaman sekarang
                    if (prevPage !== undefined && prevPage !== currentPage) {
                        this.doc.setPage(currentPage);
                    }

                    // ============================================================
                    // SEGMEN 2 — digambar di HALAMAN SEKARANG
                    // ============================================================
                    const systemLeftX = this.currentSystemLeftX ?? (x - 40);
                    const startX2 = systemLeftX;
                    const cx2 = (startX2 + x) / 2;
                    const cy2 = sy2 + (stemDown ? -curveHeight : curveHeight);

                    const d2 = `M ${startX2} ${sy2} Q ${cx2} ${cy2} ${x} ${sy2} ` +
                            `Q ${cx2} ${cy2 - (stemDown ? -thickness : thickness)} ${startX2} ${sy2} Z`;
                    this.doc.setFillColor(...this.engraverColor);
                    this.drawSVGPath(d2, 0, 0, 1, 1, true, 'none');
                } else {
                    const cx = (prev.x + x) / 2;
                    const cy = ((sy1 + sy2) / 2) + (stemDown ? -curveHeight : curveHeight);

                    const d = `M ${prev.x} ${sy1} Q ${cx} ${cy} ${x} ${sy2} ` +
                            `Q ${cx} ${cy - (stemDown ? -thickness : thickness)} ${prev.x} ${sy1} Z`;
                    this.doc.setFillColor(...this.engraverColor);
                    this.drawSVGPath(d, 0, 0, 1, 1, true, 'none');
                }
            }

            if (tieStart) {
                activeTies[pitchKey] = { 
                    x: x, 
                    y: note.y,
                    pageNumber:    this.doc.getCurrentPageInfo().pageNumber,
                    systemRightX:  this.currentSystemRightX  // <-- simpan untuk segmen 1 di sistem berikutnya
                };
            }

        });

        // Stem & flag
        const firstNoteType = calculatedNotes[0].type;
        let stemX = x;
        let stemStartY = y;
        let stemEndY = y;
        const isBeamable = firstNoteType === "eighth" || firstNoteType === "16th" || firstNoteType === "32nd";

        if (firstNoteType !== "whole") {
            const stemLength = 28;
            const noteheadRx = 7.0 * 0.8;      // ≈ 5.6
            const stemOffset = noteheadRx * 0.85; // ≈ 4.76
            stemX = stemDown ? x - stemOffset : x + stemOffset;
            stemStartY = stemDown ? highestNote.y + 0.5 : lowestNote.y - 0.5;
            stemEndY = stemDown ? lowestNote.y + stemLength : highestNote.y - stemLength;

            this.doc.setDrawColor(...this.engraverColor);
            this.doc.setLineWidth(1.4);
            this.doc.line(stemX, stemStartY, stemX, stemEndY);
            // JANGAN gambar flag di sini — biarkan beaming yang memutuskan
        }

        const beatDurationDivs = Math.max(1, (notes[0].divisions || 4) * (4 / (notes[0].beatType || 4)));

        return {
            x: x,
            stemX: stemX,
            stemStartY: stemStartY,
            stemEndY: stemEndY,
            stemDown: stemDown,
            type: firstNoteType,
            isBeamable: isBeamable,
            beatIndex: Math.floor(lowestNote.onsetDiv / beatDurationDivs),
            beatDurationDivs: beatDurationDivs,
            divisions: notes[0].divisions
            // flagElement DIHAPUS — tidak dipakai lagi
        };
    }

    // ============================================================
    // BEAMING
    // ============================================================
    /**
     * Groups stems into beamed note clusters and renders beams for each group.
     *
     * @param {Array<Object>} stems Stem metadata objects produced by note columns.
     * @returns {void}
     */
    drawBeams(stems) {
        if (!stems || stems.length < 2) {
            // Tidak ada group, gambar flag untuk semua note
            stems.forEach(s => this.drawFlagForStem(s));
            return;
        }

        let i = 0;
        while (i < stems.length) {
            if (!stems[i].isBeamable || stems[i].type === 'half') {
                i++;
                continue;
            }

            let currentGroup = [stems[i]];
            let j = i + 1;
            while (j < stems.length && stems[j].isBeamable) {
                if (stems[j].type === 'half') break;
                if (stems[j].beatIndex !== stems[i].beatIndex) break;
                if (stems[j].stemDown !== stems[i].stemDown) break;
                currentGroup.push(stems[j]);
                j++;
            }

            if (currentGroup.length > 1) {
                this.renderBeamGroup(currentGroup);
                currentGroup.forEach(s => { s._beamed = true; });
            }
            i = j;
        }

        // Gambar flag HANYA untuk note yang TIDAK di-beam
        stems.forEach(s => {
            if (!s._beamed) {
                this.drawFlagForStem(s);
            }
        });
    }

    /**
     * Draws a flag on a stem for a non-beamed note.
     *
     * @param {Object} s Stem metadata for the note.
     * @returns {void}
     */
    drawFlagForStem(s) {
        if (!s.isBeamable) return;
        const isDouble = s.type === "16th" || s.type === "32nd";
        this.drawStemFlag(s.stemX, s.stemEndY, s.stemDown, isDouble);
    }

    /**
     * Draws a grouped beam for a connected set of note stems.
     *
     * @param {Array<Object>} group Stem metadata objects in one beam group.
     * @returns {void}
     */
    renderBeamGroup(group) {
        const first = group[0];
        const last = group[group.length - 1];

        // HAPUS bagian ini:
        // group.forEach(s => {
        //     if (s.flagElement && s.flagElement.parentNode) {
        //         s.flagElement.parentNode.removeChild(s.flagElement);
        //     }
        // });

        let beamOffset = 0.7;

        let x1 = first.stemX;
        let y1 = first.stemEndY;
        let x2 = last.stemX;
        let y2 = last.stemEndY;

        const dx = x2 - x1;
        const dy = y2 - y1;

        // Align intermediate stems — redraw stem sampai beam
        if (dx > 0) {
            group.forEach(s => {
                const ratio = (s.stemX - x1) / dx;
                const alignedY = y1 + ratio * dy;
                s.stemEndY = alignedY;
                this.doc.setDrawColor(...this.engraverColor);
                this.doc.setLineWidth(1.4);
                this.doc.line(s.stemX, s.stemStartY, s.stemX, alignedY);
            });
        }

        // Tentukan beam level
        let maxBeamLevel = 1;
        group.forEach(s => {
            if (s.type === "16th" || s.type === "32nd") maxBeamLevel = Math.max(maxBeamLevel, 2);
            if (s.type === "32nd") maxBeamLevel = Math.max(maxBeamLevel, 3);
        });

        const getBeamCount = (type) => {
            switch (type) {
                case '32nd': return 3;
                case '16th': return 2;
                case 'eighth': return 1;
                case 'quarter': return 1;
                case 'half': return 1;
                default: return 1;
            }
        };

        // Primary beam
        if(x1 < x2) {
            x1 = x1 - beamOffset;
            x2 = x2 + beamOffset;
        } else {
            x1 = x1 + beamOffset;
            x2 = x2 - beamOffset;
        }
        this.doc.setDrawColor(...this.engraverColor);
        this.doc.setLineWidth(3.5);
        this.doc.line(x1, y1, x2, y2);

        // Secondary beam
        if (maxBeamLevel >= 2) {
            const offset = (first.stemDown ? -5 : 5);
            const beam2Notes = group.filter(s => getBeamCount(s.type) >= 2);
            if (beam2Notes.length > 0) {
                const firstBeam2 = beam2Notes[0];
                const lastBeam2 = beam2Notes[beam2Notes.length - 1];

                if(firstBeam2.stemX < lastBeam2.stemX) {
                    firstBeam2.stemX = firstBeam2.stemX - beamOffset;
                    lastBeam2.stemX = lastBeam2.stemX + beamOffset;
                } else {
                    firstBeam2.stemX = firstBeam2.stemX + beamOffset;
                    lastBeam2.stemX = lastBeam2.stemX - beamOffset;
                }

                this.doc.setLineWidth(3.0);
                this.doc.line(
                    firstBeam2.stemX, firstBeam2.stemEndY + offset,
                    lastBeam2.stemX, lastBeam2.stemEndY + offset
                );
            }
        }

        // Tertiary beam (32nd)
        if (maxBeamLevel >= 3) {
            const offset3 = (first.stemDown ? -10 : 10);
            const beam3Notes = group.filter(s => getBeamCount(s.type) >= 3);
            if (beam3Notes.length > 0) {
                const firstBeam3 = beam3Notes[0];
                const lastBeam3 = beam3Notes[beam3Notes.length - 1];

                if(firstBeam3.stemX < lastBeam3.stemX) {
                    firstBeam3.stemX = firstBeam3.stemX - beamOffset;
                    lastBeam3.stemX = lastBeam3.stemX + beamOffset;
                } else {
                    firstBeam3.stemX = firstBeam3.stemX + beamOffset;
                    lastBeam3.stemX = lastBeam3.stemX - beamOffset;
                }

                this.doc.setLineWidth(3.0);
                this.doc.line(
                    firstBeam3.stemX, firstBeam3.stemEndY + offset3,
                    lastBeam3.stemX, lastBeam3.stemEndY + offset3
                );
            }
        }
    }

    /**
     * Draws a single stem flag for note durations such as eighth or sixteenth notes.
     *
     * @param {number} x X-position of the flag anchor.
     * @param {number} y Y-position of the flag anchor.
     * @param {boolean} isDown Whether the stem is oriented downward.
     * @param {boolean} isDouble Whether a double flag should be rendered.
     * @returns {void}
     */
    drawStemFlag(x, y, isDown, isDouble) {
        const scale = 1.0;
        const flagPathUp = "M -0.112 3.631 C -0.112 0 -0.3031 0 0 0 C 0.28 0.1911 0 0 0 0 C 0.42 0.6879 0.512 0.7834 0.531 0.898 C 1.4 2.8 1.4 2.8 2.327 4.051 C 4.028 5.943 4.525 7.071 4.525 8.581 C 4.506 9.994 3.263 13.014 2.996 12.899 C 3.378 11.829 3.913 10.682 4.047 9.727 C 4.219 8.561 3.741 6.879 1.831 5.16 C 0.779 4.294 0 4.2 -0.112 3.631 Z";
        const flagPathDown = "M -0.112 -3.631 C -0.112 0 -0.3031 0 0 0 C 0.28 -0.1911 0 0 0 0 C 0.42 -0.6879 0.512 -0.7834 0.531 -0.898 C 1.4 -2.8 1.4 -2.8 2.327 -4.051 C 4.028 -5.943 4.525 -7.071 4.525 -8.581 C 4.506 -9.994 3.263 -13.014 2.996 -12.899 C 3.378 -11.829 3.913 -10.682 4.047 -9.727 C 4.219 -8.561 3.741 -6.879 1.831 -5.16 C 0.779 -4.294 0 -4.2 -0.112 -3.631 Z";

        const path = isDown ? flagPathDown : flagPathUp;
        const sx = 1.6 * scale;
        const sy = 1.2 * scale;

        this.drawSVGPath(path, x, y, sx, sy, true);

        if (isDouble) {
            const yOffset = (isDown ? -8 : 8) * scale;
            this.drawSVGPath(path, x, y + yOffset, sx, sy, true);
        }
    }

    /**
     * Draws a notehead, including percussion x-noteheads when relevant.
     *
     * @param {number} cx Center x-coordinate of the notehead.
     * @param {number} cy Center y-coordinate of the notehead.
     * @param {number[]} color RGB color array to use.
     * @param {boolean} isHollow Whether the notehead should be open.
     * @param {string} [noteheadType='normal'] Type of notehead.
     * @param {number} [channelId=-1] MIDI channel used for percussion-specific rendering.
     * @returns {void}
     */
    drawNotehead(cx, cy, color, isHollow, noteheadType = 'normal', channelId = -1) {
        const scale = 0.8;
        const rx = 7.0 * scale;
        const ry = 4.4 * scale;
        const strokeWidth = 2.0 * scale;
        const xOffset = 0;

        if (channelId === 10 && noteheadType === 'x') {
            const size = 8 * scale;
            this.doc.setDrawColor(...color);
            this.doc.setLineWidth(1.8 * scale);
            this.doc.line(cx - size / 2 + xOffset, cy - size / 2, cx + size / 2, cy + size / 2);
            this.doc.line(cx - size / 2 + xOffset, cy + size / 2, cx + size / 2, cy - size / 2);
            return;
        }

        this.doc.setFillColor(...color);
        this.doc.setDrawColor(...color);

        if (isHollow) {
            this.doc.setLineWidth(strokeWidth);
            this.drawSVGEllipse(cx + xOffset, cy, rx - strokeWidth / 2, ry - strokeWidth / 2, false, 'solid', -15);
        } else {
            this.drawSVGEllipse(cx + xOffset, cy, rx, ry, true, 'solid', -15);
        }
    }

    /**
     * Draws an ellipse using PDF path commands.
     *
     * @param {number} cx Center x-coordinate.
     * @param {number} cy Center y-coordinate.
     * @param {number} rx Horizontal radius.
     * @param {number} ry Vertical radius.
     * @param {boolean} fill Whether the ellipse should be filled.
     * @param {string|boolean} stroke Stroke mode.
     * @param {number} [angle=0] Rotation angle in degrees.
     * @returns {void}
     */
    drawSVGEllipse(cx, cy, rx, ry, fill, stroke, angle) {
        const k = this.doc.internal.scaleFactor;
        const h = this.doc.internal.pageSize.height;
        const magic = 0.552284749831;
        const ox = rx * magic;
        const oy = ry * magic;

        const angleRad = (angle || 0) * (Math.PI / 180);
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);

        const transformPoint = (x, y) => {
            const rotatedX = x * cosA - y * sinA;
            const rotatedY = x * sinA + y * cosA;
            const finalX = cx + rotatedX;
            const finalY = cy + rotatedY;
            return `${(finalX * k).toFixed(3)} ${((h - finalY) * k).toFixed(3)}`;
        };

        const segments = [
            { p1: [rx, oy], p2: [ox, ry], p3: [0, ry] },
            { p1: [-ox, ry], p2: [-rx, oy], p3: [-rx, 0] },
            { p1: [-rx, -oy], p2: [-ox, -ry], p3: [0, -ry] },
            { p1: [ox, -ry], p2: [rx, -oy], p3: [rx, 0] }
        ];

        let pdfCmds = `${transformPoint(rx, 0)} m `;
        segments.forEach(seg => {
            pdfCmds += `${transformPoint(...seg.p1)} ${transformPoint(...seg.p2)} ${transformPoint(...seg.p3)} c `;
        });

        const op = fill ? 'f*' : 'S';
        this.doc.internal.write(pdfCmds + op);
    }

    /**
     * Draws ledger lines for notes outside the main staff range.
     *
     * @param {number} x X-position of the notehead.
     * @param {number} y Staff starting y-position.
     * @param {number} diatonic Diatonic pitch index of the note.
     * @param {string} clefType Current clef name.
     * @returns {void}
     */
    drawLedgerLines(x, y, diatonic, clefType) {
        let lineMin, lineMax;
        if (clefType === "F") {
            // Bass: G2 (-10) .. A3 (-2)
            lineMin = -10;
            lineMax = -2;
        } else if (clefType === "C") {
            // Alto: F3 (-4) .. G4 (4)
            lineMin = -4;
            lineMax = 4;
        } else {
            // Treble: E4 (2) .. F5 (10)
            lineMin = 2;
            lineMax = 10;
        }

        if (diatonic < lineMin) {
            for (let d = lineMin - 2; d >= diatonic; d -= 2) {
                const lineY = this.getNoteY(d, y, clefType);
                this.drawHorizontalLedger(x, lineY);
            }
        } else if (diatonic > lineMax) {
            for (let d = lineMax + 2; d <= diatonic; d += 2) {
                const lineY = this.getNoteY(d, y, clefType);
                this.drawHorizontalLedger(x, lineY);
            }
        }
    }

    /**
     * Draws one horizontal ledger line.
     *
     * @param {number} x X-position center for the ledger line.
     * @param {number} lineY Y-position of the ledger line.
     * @returns {void}
     */
    drawHorizontalLedger(x, lineY) {
        this.doc.setDrawColor(...this.engraverColor);
        this.doc.setLineWidth(0.9);
        this.doc.line(x - 11, lineY, x + 11, lineY);
    }

    /**
     * Draws a dot for dotted note values.
     *
     * @param {number} x X-position of the dot.
     * @param {number} y Y-position of the dot.
     * @param {number[]} color RGB color array.
     * @returns {void}
     */
    drawDot(x, y, color) {
        this.drawCircle(x, y, 1.5, color, 'F');
    }

    /**
     * Draws a rest symbol matching the note duration.
     *
     * @param {number} x X-position for the rest.
     * @param {number} y Top y-position of the staff.
     * @param {string} type Rest type such as whole, half, quarter, eighth, 16th, or 32nd.
     * @param {number[]} color RGB color array.
     * @returns {void}
     */
    drawRestSymbol(x, y, type, color) {
        this.doc.setFillColor(...color);
        const w = 12;
        const h = 4;
        switch (type) {
            case 'whole':
                this.doc.rect(x - 4, y + 1 * this.lineSpacing, w, h, 'F');
                break;
            case 'half':
                this.doc.rect(x - 4, y + 2 * this.lineSpacing, w, h, 'F');
                break;
            case 'quarter': {
                const qPath = "M349 372c-14-12-44-43-65-102-21-58 25-95 50-114q12-7-1-21L219 9c-13-17-30-7-20 7 120 171-35 197-35 197s17 44 97 115c-84-22-139 40-97 104 41 64 120 78 127 80s18-4 7-11c-26-17-79-61-54-93 34-42 84-23 97-17 22 11 31-1 8-19";
                const qTx = x - 8;
                const qTy = y + 5;
                const qScale = 0.045;
                this.doc.setFillColor(...color);
                this.drawSVGPath(qPath, qTx, qTy, qScale, qScale, true);
                break;
            }
            case 'eighth': {
                const ePath = "M 1.098 0 C 0.578 0.098 0.18 0.457 0 0.953 C -0.039 1.113 -0.039 1.152 -0.039 1.371 C -0.039 1.672 -0.02 1.832 0.121 2.07 C 0.32 2.469 0.738 2.789 1.215 2.906 C 1.715 3.047 3 3.153 4 2.153 L 4.941 0.598 C 4.844 0.477 4.645 0.438 4.523 0.535 C 4.484 0.574 4.422 0.656 4.383 0.715 C 4.203 1.016 3.746 1.551 3.508 1.75 C 3.289 1.93 3.168 1.949 2.969 1.871 C 2.789 1.773 2.73 1.672 2.609 1.133 C 2.492 0.598 2.352 0.355 2.051 0.156 C 1.773 -0.023 1.414 -0.082 1.098 0 z";
                const eTx = x + 1.5;
                const eTy = y + 11;
                const eScale = 2.2;
                this.doc.setFillColor(...color);
                this.doc.setDrawColor(...color);
                this.doc.setLineWidth(1.5);
                this.doc.line(x + 12, y + 10, x + 8, y + 35);
                this.drawSVGPath(ePath, eTx, eTy, eScale, eScale, true);
                break;
            }
            case '16th':
            case '32nd': {
                const hPath = "M 1.098 0 C 0.578 0.098 0.18 0.457 0 0.953 C -0.039 1.113 -0.039 1.152 -0.039 1.371 C -0.039 1.672 -0.02 1.832 0.121 2.07 C 0.32 2.469 0.738 2.789 1.215 2.906 C 1.715 3.047 3 3.153 4 2.153 L 4.941 0.598 C 4.844 0.477 4.645 0.438 4.523 0.535 C 4.484 0.574 4.422 0.656 4.383 0.715 C 4.203 1.016 3.746 1.551 3.508 1.75 C 3.289 1.93 3.168 1.949 2.969 1.871 C 2.789 1.773 2.73 1.672 2.609 1.133 C 2.492 0.598 2.352 0.355 2.051 0.156 C 1.773 -0.023 1.414 -0.082 1.098 0 z";
                const hScale = 2.2;
                this.doc.setFillColor(...color);
                this.doc.setDrawColor(...color);
                this.doc.setLineWidth(1.5);
                this.doc.line(x + 12, y + 10, x + 8, y + 35);
                this.drawSVGPath(hPath, x + 1.5, y + 11, hScale, hScale, true);
                if (type === '16th' || type === '32nd') {
                    this.drawSVGPath(hPath, x - 0.5, y + 19, hScale, hScale, true);
                }
                break;
            }
        }
    }

    /**
     * Converts a pitch step and octave into a diatonic staff index.
     *
     * @param {string} step Pitch letter such as C, D, E, etc.
     * @param {number} octave Octave number.
     * @returns {number} Diatonic index relative to middle C.
     */
    getDiatonicIndex(step, octave) {
        const offset = this.stepOffsets[step] !== undefined ? this.stepOffsets[step] : 0;
        const oct = typeof octave === "number" && !isNaN(octave) ? octave : 4;
        return (oct - 4) * 7 + offset;
    }

    /**
     * Computes the vertical y-position for a note on a given clef.
     *
     * @param {number} diatonic Diatonic pitch index.
     * @param {number} startY Staff starting y-position.
     * @param {string} clefType Current clef name.
     * @returns {number} Y-coordinate for the note.
     */
    getNoteY(diatonic, startY, clefType) {
        const ls = this.lineSpacing / 2;
        if (clefType === "F") {
            return startY - (diatonic + 2) * ls;
        } else if (clefType === "C") {
            return startY + (4 - diatonic) * ls;       // ✅ hapus * 2
        } else {
            return startY + (10 - diatonic) * ls;
        }
    }

    /**
     * Draws a text label using the configured PDF font settings.
     *
     * @param {number} x X-position of the text.
     * @param {number} y Y-position of the text.
     * @param {string} text Text content to display.
     * @param {number} size Font size.
     * @param {number[]} color RGB color array.
     * @param {string} [align='left'] Horizontal alignment.
     * @param {boolean} [isBold=false] Whether the font should be bold.
     * @param {string} [font=this.FONT_SANS_SERIF] Font family name.
     * @param {number} [rotation=0] Rotation in degrees.
     * @returns {void}
     */
    drawText(x, y, text, size, color, align = "left", isBold = false, font = this.FONT_SANS_SERIF, rotation = 0) {
        this.doc.setFont(font, isBold ? 'bold' : 'normal');
        this.doc.setFontSize(size);
        this.doc.setTextColor(...color);
        this.doc.text(text || "", x, y, { align: align, angle: rotation });
    }

    // ============================================================
    // SVG PATH PARSER → jsPDF
    // ============================================================
    /**
     * Converts an SVG elliptical arc to a sequence of cubic Bézier segments.
     *
     * @param {number} x1 Start x-coordinate.
     * @param {number} y1 Start y-coordinate.
     * @param {number} rx X-radius of the ellipse.
     * @param {number} ry Y-radius of the ellipse.
     * @param {number} angle Rotation angle in degrees.
     * @param {boolean|number} largeArcFlag Whether the large arc flag is set.
     * @param {boolean|number} sweepFlag Whether the sweep flag is set.
     * @param {number} x2 End x-coordinate.
     * @param {number} y2 End y-coordinate.
     * @returns {Array<Array<number>>} Cubic-bezier control points for the arc.
     */
    arcToCubicBezier(x1, y1, rx, ry, angle, largeArcFlag, sweepFlag, x2, y2) {
        if (rx === 0 || ry === 0) return [];
        rx = Math.abs(rx);
        ry = Math.abs(ry);
        const phi = angle * Math.PI / 180;
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);
        const dx = (x1 - x2) / 2.0;
        const dy = (y1 - y2) / 2.0;
        let x1p = cosPhi * dx + sinPhi * dy;
        let y1p = -sinPhi * dx + cosPhi * dy;
        let prx = rx * rx;
        let pry = ry * ry;
        let px1p = x1p * x1p;
        let py1p = y1p * y1p;
        let radiiCheck = px1p / prx + py1p / pry;
        if (radiiCheck > 1) {
            rx = Math.sqrt(radiiCheck) * rx;
            ry = Math.sqrt(radiiCheck) * ry;
            prx = rx * rx;
            pry = ry * ry;
        }
        const sign = (largeArcFlag === sweepFlag) ? -1 : 1;
        let sq = ((prx * pry) - (prx * py1p) - (pry * px1p)) / ((prx * py1p) + (pry * px1p));
        sq = Math.max(0, sq);
        const coef = sign * Math.sqrt(sq);
        const cxp = coef * ((rx * y1p) / ry);
        const cyp = coef * (-(ry * x1p) / rx);
        const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2.0;
        const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2.0;
        const ux = (x1p - cxp) / rx;
        const uy = (y1p - cyp) / ry;
        const vx = (-x1p - cxp) / rx;
        const vy = (-cyp - y1p) / ry;
        let theta1 = Math.atan2(uy, ux);
        let dot = ux * vx + uy * vy;
        let len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
        dot = Math.max(-1.0, Math.min(1.0, dot / len));
        let dTheta = Math.acos(dot);
        if ((ux * vy - uy * vx) < 0) dTheta = -dTheta;
        if (sweepFlag === 0 && dTheta > 0) dTheta -= 2.0 * Math.PI;
        else if (sweepFlag === 1 && dTheta < 0) dTheta += 2.0 * Math.PI;
        const segments = Math.ceil(Math.abs(dTheta) / (Math.PI / 2.0));
        const curves = [];
        let theta = theta1;
        const delta = dTheta / segments;
        for (let s = 0; s < segments; s++) {
            const t = theta;
            theta += delta;
            const cosT = Math.cos(t);
            const sinT = Math.sin(t);
            const cosTheta = Math.cos(theta);
            const sinTheta = Math.sin(theta);
            const sx = cosPhi * rx * cosT - sinPhi * ry * sinT + cx;
            const sy = sinPhi * rx * cosT + cosPhi * ry * sinT + cy;
            const ex = cosPhi * rx * cosTheta - sinPhi * ry * sinTheta + cx;
            const ey = sinPhi * rx * cosTheta + cosPhi * ry * sinTheta + cy;
            const alpha = Math.sin(delta) * (Math.sqrt(4.0 + 3.0 * Math.tan(delta / 2.0) ** 2) - 1.0) / 3.0;
            const dxT = -cosPhi * rx * sinT - sinPhi * ry * cosT;
            const dyT = -sinPhi * rx * sinT + cosPhi * ry * cosT;
            const dxTheta = -cosPhi * rx * sinTheta - sinPhi * ry * cosTheta;
            const dyTheta = -sinPhi * rx * sinTheta + cosPhi * ry * cosTheta;
            const cp1x = sx + alpha * dxT;
            const cp1y = sy + alpha * dyT;
            const cp2x = ex - alpha * dxTheta;
            const cp2y = ey - alpha * dyTheta;
            curves.push([cp1x, cp1y, cp2x, cp2y, ex, ey]);
        }
        return curves;
    }

    /**
     * Parses an SVG path string and draws it into the PDF canvas.
     *
     * @param {string} pathStr SVG path definition.
     * @param {number} xOffset Horizontal translation.
     * @param {number} yOffset Vertical translation.
     * @param {number} scaleX X scale factor.
     * @param {number} scaleY Y scale factor.
     * @param {boolean} [fill=true] Whether to fill the path.
     * @param {string|boolean} [stroke='solid'] Stroke mode.
     * @param {number} [rotation=0] Rotation angle in degrees.
     * @returns {void}
     */
    drawSVGPath(pathStr, xOffset, yOffset, scaleX, scaleY, fill = true, stroke = 'solid', rotation = 0) {
        const tokens = pathStr.match(/[a-zA-Z]|-?\d*\.?\d+/g) || [];
        const k = this.doc.internal.scaleFactor;
        const h = this.doc.internal.pageSize.height;
        let pdfCmds = "";
        let i = 0;
        const count = tokens.length;
        let currentX = 0, currentY = 0;
        let cmd = 'M';
        let lastQcpX = 0, lastQcpY = 0;
        let lastC2X = 0, lastC2Y = 0;
        let lastCmdWasQ = false;
        const angleRad = rotation * (Math.PI / 180);
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);

        const xy = (px, py) => {
            const scaledX = px * scaleX;
            const scaledY = py * scaleY;
            const tx = xOffset + (scaledX * cosA - scaledY * sinA);
            const ty = yOffset + (scaledX * sinA + scaledY * cosA);
            return `${(tx * k).toFixed(3)} ${((h - ty) * k).toFixed(3)}`;
        };

        while (i < count) {
            let token = tokens[i];
            if (/[MLCQHVZTAmlcqhvztas]/i.test(token)) {
                cmd = token;
                i++;
            }
            if (i >= count && !/[Zz]/.test(cmd)) break;

            let isQ = false;
            switch (cmd) {
                case 'M': currentX = +tokens[i++]; currentY = +tokens[i++]; pdfCmds += `${xy(currentX, currentY)} m `; break;
                case 'm': currentX += +tokens[i++]; currentY += +tokens[i++]; pdfCmds += `${xy(currentX, currentY)} m `; break;
                case 'L': currentX = +tokens[i++]; currentY = +tokens[i++]; pdfCmds += `${xy(currentX, currentY)} l `; break;
                case 'l': currentX += +tokens[i++]; currentY += +tokens[i++]; pdfCmds += `${xy(currentX, currentY)} l `; break;
                case 'H': currentX = +tokens[i++]; pdfCmds += `${xy(currentX, currentY)} l `; break;
                case 'h': currentX += +tokens[i++]; pdfCmds += `${xy(currentX, currentY)} l `; break;
                case 'V': currentY = +tokens[i++]; pdfCmds += `${xy(currentX, currentY)} l `; break;
                case 'v': currentY += +tokens[i++]; pdfCmds += `${xy(currentX, currentY)} l `; break;
                case 'C': {
                    const [x1, y1, x2, y2, x3, y3] = tokens.slice(i, i + 6).map(Number); i += 6;
                    pdfCmds += `${xy(x1, y1)} ${xy(x2, y2)} ${xy(x3, y3)} c `;
                    lastC2X = x2; lastC2Y = y2; currentX = x3; currentY = y3;
                    break;
                }
                case 'c': {
                    const [dx1, dy1, dx2, dy2, dx3, dy3] = tokens.slice(i, i + 6).map(Number); i += 6;
                    const [x1, y1, x2, y2, x3, y3] = [currentX + dx1, currentY + dy1, currentX + dx2, currentY + dy2, currentX + dx3, currentY + dy3];
                    pdfCmds += `${xy(x1, y1)} ${xy(x2, y2)} ${xy(x3, y3)} c `;
                    lastC2X = x2; lastC2Y = y2; currentX = x3; currentY = y3;
                    break;
                }
                case 'S': {
                    const [x2, y2, x3, y3] = tokens.slice(i, i + 4).map(Number); i += 4;
                    const x1 = 2 * currentX - lastC2X; const y1 = 2 * currentY - lastC2Y;
                    pdfCmds += `${xy(x1, y1)} ${xy(x2, y2)} ${xy(x3, y3)} c `;
                    lastC2X = x2; lastC2Y = y2; currentX = x3; currentY = y3;
                    break;
                }
                case 's': {
                    const [dx2, dy2, dx3, dy3] = tokens.slice(i, i + 4).map(Number); i += 4;
                    const x1 = 2 * currentX - lastC2X; const y1 = 2 * currentY - lastC2Y;
                    const x2 = currentX + dx2; const y2 = currentY + dy2; const x3 = currentX + dx3; const y3 = currentY + dy3;
                    pdfCmds += `${xy(x1, y1)} ${xy(x2, y2)} ${xy(x3, y3)} c `;
                    lastC2X = x2; lastC2Y = y2; currentX = x3; currentY = y3;
                    break;
                }
                case 'Q': {
                    const [x1, y1, x2, y2] = tokens.slice(i, i + 4).map(Number); i += 4;
                    const cx1 = currentX + 2 / 3 * (x1 - currentX); const cy1 = currentY + 2 / 3 * (y1 - currentY);
                    const cx2 = x2 + 2 / 3 * (x1 - x2); const cy2 = y2 + 2 / 3 * (y1 - y2);
                    pdfCmds += `${xy(cx1, cy1)} ${xy(cx2, cy2)} ${xy(x2, y2)} c `;
                    currentX = x2; currentY = y2; lastQcpX = x1; lastQcpY = y1; isQ = true;
                    break;
                }
                case 'q': {
                    const [dx1, dy1, dx2, dy2] = tokens.slice(i, i + 4).map(Number); i += 4;
                    const x1 = currentX + dx1; const y1 = currentY + dy1; const x2 = currentX + dx2; const y2 = currentY + dy2;
                    const cx1 = currentX + 2 / 3 * (x1 - currentX); const cy1 = currentY + 2 / 3 * (y1 - currentY);
                    const cx2 = x2 + 2 / 3 * (x1 - x2); const cy2 = y2 + 2 / 3 * (y1 - y2);
                    pdfCmds += `${xy(cx1, cy1)} ${xy(cx2, cy2)} ${xy(x2, y2)} c `;
                    currentX = x2; currentY = y2; lastQcpX = x1; lastQcpY = y1; isQ = true;
                    break;
                }
                case 'T': {
                    const x2 = +tokens[i++]; const y2 = +tokens[i++];
                    const x1 = lastCmdWasQ ? (2 * currentX - lastQcpX) : currentX;
                    const y1 = lastCmdWasQ ? (2 * currentY - lastQcpY) : currentY;
                    const cx1 = currentX + 2 / 3 * (x1 - currentX);
                    const cy1 = currentY + 2 / 3 * (y1 - currentY);
                    const cx2 = x2 + 2 / 3 * (x1 - x2);
                    const cy2 = y2 + 2 / 3 * (y1 - y2);
                    pdfCmds += `${xy(cx1, cy1)} ${xy(cx2, cy2)} ${xy(x2, y2)} c `;
                    lastQcpX = x1; lastQcpY = y1; isQ = true; currentX = x2; currentY = y2;
                    break;
                }
                case 't': {
                    const dx2 = +tokens[i++]; const dy2 = +tokens[i++];
                    const x1 = lastCmdWasQ ? (2 * currentX - lastQcpX) : currentX;
                    const y1 = lastCmdWasQ ? (2 * currentY - lastQcpY) : currentY;
                    const x2 = currentX + dx2; const y2 = currentY + dy2;
                    const cx1 = currentX + 2 / 3 * (x1 - currentX);
                    const cy1 = currentY + 2 / 3 * (y1 - currentY);
                    const cx2 = x2 + 2 / 3 * (x1 - x2);
                    const cy2 = y2 + 2 / 3 * (y1 - y2);
                    pdfCmds += `${xy(cx1, cy1)} ${xy(cx2, cy2)} ${xy(x2, y2)} c `;
                    lastQcpX = x1; lastQcpY = y1; isQ = true; currentX = x2; currentY = y2;
                    break;
                }
                case 'A': {
                    const rx = parseFloat(tokens[i++]);
                    const ry = i < tokens.length ? parseFloat(tokens[i++]) : rx;
                    const angle = i < tokens.length ? parseFloat(tokens[i++]) : 0.0;
                    const largeArcFlag = i < tokens.length ? parseInt(tokens[i++]) : 0;
                    const sweepFlag = i < tokens.length ? parseInt(tokens[i++]) : 0;
                    const x2 = i < tokens.length ? parseFloat(tokens[i++]) : currentX;
                    const y2 = i < tokens.length ? parseFloat(tokens[i++]) : currentY;
                    const curves = this.arcToCubicBezier(currentX, currentY, rx, ry, angle, largeArcFlag, sweepFlag, x2, y2);
                    curves.forEach(c => {
                        pdfCmds += `${xy(c[0], c[1])} ${xy(c[2], c[3])} ${xy(c[4], c[5])} c `;
                    });
                    currentX = x2;
                    currentY = y2;
                    break;
                }
                case 'a': {
                    const rx = parseFloat(tokens[i++]);
                    const ry = i < tokens.length ? parseFloat(tokens[i++]) : rx;
                    const angle = i < tokens.length ? parseFloat(tokens[i++]) : 0.0;
                    const largeArcFlag = i < tokens.length ? parseInt(tokens[i++]) : 0;
                    const sweepFlag = i < tokens.length ? parseInt(tokens[i++]) : 0;
                    const dx = i < tokens.length ? parseFloat(tokens[i++]) : 0.0;
                    const dy = i < tokens.length ? parseFloat(tokens[i++]) : 0.0;
                    const x2 = currentX + dx;
                    const y2 = currentY + dy;
                    const curves = this.arcToCubicBezier(currentX, currentY, rx, ry, angle, largeArcFlag, sweepFlag, x2, y2);
                    curves.forEach(c => {
                        pdfCmds += `${xy(c[0], c[1])} ${xy(c[2], c[3])} ${xy(c[4], c[5])} c `;
                    });
                    currentX = x2;
                    currentY = y2;
                    break;
                }
                case 'Z':
                case 'z':
                    pdfCmds += "h ";
                    break;
            }
            lastCmdWasQ = isQ;
            if (!isQ) {
                lastC2X = currentX;
                lastC2Y = currentY;
            }
        }

        let op;
        if (stroke === 'none') {
            op = fill ? " f* " : "";
        } else if (stroke === 'solid' || stroke === true) {
            op = fill ? " f* " : " S ";
        } else if (stroke === 'B') {
            op = " B ";
        } else {
            op = fill ? " f* " : " S ";
        }

        this.doc.internal.write(pdfCmds + op);
    }

    // ============================================================
    // STATIC HELPERS
    // ============================================================
    static NOTE_TYPE_VALUES = [
        { name: 'maxima', val: 8 }, { name: 'long', val: 4 }, { name: 'breve', val: 2 },
        { name: 'whole', val: 1 }, { name: 'half', val: 0.5 }, { name: 'quarter', val: 0.25 },
        { name: 'eighth', val: 0.125 }, { name: '16th', val: 0.0625 }, { name: '32nd', val: 0.03125 },
        { name: '64th', val: 0.015625 }, { name: '128th', val: 0.0078125 }
    ];

    /**
     * Maps a musical duration into the closest note type name.
     *
     * @param {number} duration Duration value in ticks.
     * @param {number} divisions Divisions per quarter note.
     * @returns {string} Equivalent note type label.
     */
    static getNoteType(duration, divisions) {
        if (divisions <= 0 || duration <= 0) return '128th';
        const value = duration / (4 * divisions);
        for (const type of this.NOTE_TYPE_VALUES) {
            if (value >= type.val - 0.0001) {
                return type.name;
            }
        }
        return '128th';
    }

    /**
     * Determines whether a duration is already a standard MusicXML note value.
     *
     * @param {number} duration Duration value in ticks.
     * @param {number} divisions Divisions per quarter note.
     * @returns {boolean} True if the duration is standard or dotted-standard.
     */
    static isStandardDuration(duration, divisions) {
        if (duration <= 0 || divisions <= 0) return false;
        const value = duration / (4 * divisions);
        for (const type of this.NOTE_TYPE_VALUES) {
            const baseDuration = type.val;
            if (Math.abs(value - baseDuration) < 0.001 ||
                Math.abs(value - baseDuration * 1.5) < 0.001) {
                return true;
            }
        }
        return false;
    }

    /**
     * Splits a non-standard duration into representable note values.
     *
     * @param {number} duration Duration value in ticks.
     * @param {number} divisions Divisions per quarter note.
     * @returns {number[]} Array of representable duration chunks.
     */
    static splitDurationIntoRepresentablePieces(duration, divisions) {
        const pieces = [];
        let remaining = duration;
        const epsilon = 0.01;

        const value = duration / (4 * divisions);
        const fractionalPart = value - Math.floor(value);
        if (Math.abs(fractionalPart - 0.75) < 0.001 && value >= 1) {
            let wholeUnits = Math.floor(value);
            for (const type of this.NOTE_TYPE_VALUES) {
                while (wholeUnits >= type.val && Number.isInteger(type.val)) {
                    pieces.push(Math.round(type.val * 4 * divisions));
                    wholeUnits -= type.val;
                }
            }
            pieces.push(Math.round(0.75 * 4 * divisions));
            return pieces;
        }

        while (remaining > epsilon) {
            let bestPieceDuration = 0;
            for (const type of this.NOTE_TYPE_VALUES) {
                const baseDurationDivs = type.val * 4 * divisions;
                const dottedFactors = [1.5, 1.0];
                for (const factor of dottedFactors) {
                    const candidateDuration = Math.round(baseDurationDivs * factor);
                    if (candidateDuration > 0 && candidateDuration <= remaining + epsilon && candidateDuration > bestPieceDuration) {
                        bestPieceDuration = candidateDuration;
                    }
                }
            }
            if (bestPieceDuration > 0) {
                pieces.push(bestPieceDuration);
                remaining -= bestPieceDuration;
            } else {
                break;
            }
        }
        return pieces;
    }

    /**
     * Counts how many dots should be applied to a note value.
     *
     * @param {number} duration Duration value in ticks.
     * @param {number} divisions Divisions per quarter note.
     * @returns {number} Number of dots required for the duration.
     */
    static getDotCount(duration, divisions) {
        if (duration <= 0 || divisions <= 0) return 0;
        const value = duration / (4 * divisions);
        const noteType = this.getNoteType(duration, divisions);
        const type = this.NOTE_TYPE_VALUES.find(item => item.name === noteType);
        if (!type) return 0;
        return Math.abs(value - type.val * 1.5) < 0.001 ? 1 : 0;
    }
}

window.MusicXMLPDFRenderer = MusicXMLPDFRenderer;