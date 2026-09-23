/**
 * Planetbiru Custom MusicXML SVG Renderer (OSMD-Style Engraver)
 * 
 * A high-precision, elegant vector sheet music renderer that matches the visual
 * standards, layout mechanics, and typography of OpenSheetMusicDisplay (OSMD).
 * 
 * Features:
 * - Multi-part & multi-staff full score rendering (solo, piano, orchestra)
 * - Multi-system responsive measure layout & continuous staff lines
 * - Publication-quality monochrome engraver styling by default (OSMD style)
 * - Optional Pitch Color-Coding toggle mode for music education
 * - Piano Grand Staff curly brace and multi-staff vertical system barlines
 * - Precision vector typography for Clefs (Treble/Bass/Alto), Key Signatures & Time Signatures
 * - Smart stem orientation, sloped multi-note beams (8th/16th/32nd notes) with exact stem endpoint alignment
 * - Vector accidentals (Sharp ♯, Flat ♭, Natural ♮, Double Sharp 𝄪, Double Flat 𝄠)
 * - Vector rests (Whole, Half, Quarter, 8th, 16th, 32nd)
 * - System boundary tie & slur curve handling (no diagonal page crossings)
 * - Articulations (Staccato dots, Accents, Tenuto, Fermatas)
 * - Measure numbers, Tempo markings, Lyrics, and Document Header formatting
 */
class MusicXMLSVGRenderer {
    /**
     * Initializes the MusicXML SVG Renderer.
     * @param {string|HTMLElement} containerId - The ID of the container element or the element itself.
     * @param {Object} [options={}] - Configuration options for the renderer.
     * @param {number} [options.staffSpacing=90] - The vertical gap between staves within a single part (e.g., piano right/left hand).
     * @param {number} [options.partSpacing=65] - The additional vertical gap between different parts (e.g., between piano and vocals).
     * @param {number} [options.systemSpacing=80] - The vertical gap between musical systems.
     * @param {boolean} [options.forceMobile=false] - Force mobile rendering mode, ignoring viewport size.
     * @param {boolean} [options.autoDetectMobile=true] - Automatically detect mobile viewport to adjust layout.
     */
    constructor(containerId, options = {}) {
        this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
        this.svg = null;
        // Options: { forceMobile: boolean, autoDetectMobile: boolean }
        this.forceMobile = !!options.forceMobile;
        this.autoDetectMobile = options.autoDetectMobile !== false; // default true (auto-detect based on viewport)

        // Render Mode: false = OSMD Classic Engraver Monochrome, true = Color-Coded Learning
        this.colorCoded = false;

        // Inject highlight style
        const style = document.createElement('style');
        style.textContent = `
            .highlight text { fill: #dc2626 !important; }
            .highlight .note-head[fill="transparent"] { stroke: #dc2626 !important; fill: transparent !important; }
            .highlight .note-head:not([fill="transparent"]) { fill: #dc2626 !important; stroke: none !important; }
            .highlight .note-head.hat { stroke: #dc2626 !important; }
            .highlight .note-head.hat:not([fill="transparent"]) { stroke: #dc2626 !important; }
            .highlight .rest-symbol { fill: #dc2626 !important; }
            .highlight .rest-line { stroke: #dc2626 !important; }
            .highlight .note-stem { stroke: #dc2626 !important; }
            .highlight .note-beam { stroke: #dc2626 !important; }
            .highlight .note-flag { fill: #dc2626 !important; }
            .highlight .note-flag path { fill: #dc2626 !important; }
            .highlight .tie-curve { fill: #dc2626 !important; }
            .highlight .slur-curve { stroke: #dc2626 !important; }
            .highlight .accidental-symbol { fill: #dc2626 !important; }
            .highlight circle { fill: #dc2626 !important; }
            .highlight .tie-curve { fill: #dc2626 !important; }
            .tie-curve.highlight   { fill: #dc2626 !important; }
            .comment-indicator.is-mine rect { stroke: #ffffff; stroke-width: 1; }
            .comment-indicator.is-mine { filter: drop-shadow(0 0 1px rgba(0,0,0,0.4));}
        `;
        document.head.appendChild(style);

        // Base Layout Metrics
        this.baseLineSpacing = 9.5;
        // System metadata for playhead mapping
        this._systemMetadata = [];
        // Cumulative tick counter (MIDI tick approximation)
        this._cumulativeTick = 0;
        this.baseStaffSpacing = 80; // gap between staves
        this.staffSpacing = options.staffSpacing ?? 80;
        this.partSpacing = options.partSpacing ?? 80;
        this.systemSpacing = options.systemSpacing ?? 80;
        this.baseRowSpacingSingle = 150;
        this.baseRowSpacingDouble = 220;
        this.measuresPerLine = 3;
        this.liricYOffset = 80;
        this.lyricFontSize = options.lyricFontSize ?? 11;
        this.lyricFontFamily = options.lyricFontFamily ?? 'sans-serif';

        // Engraving Color Palette
        this.engraverColor = "#0f172a"; // Solid dark engraver ink
        this.staffLineColor = "#475569"; // Crisp staff line
        this.lightLineColor = "#cbd5e1"; // Measure divider
        this.paperBg = options.paperBg ?? "#ffffff";

        // Educational Pitch Color Palette
        this.pitchColors = {
            'C': '#ef4444', // Red
            'D': '#f97316', // Orange
            'E': '#f59e0b', // Amber/Yellow
            'F': '#10b981', // Green
            'G': '#3b82f6', // Blue
            'A': '#6366f1', // Indigo
            'B': '#a855f7'  // Purple
        };

        this.stepOffsets = { 'C': 0, 'D': 1, 'E': 2, 'F': 3, 'G': 4, 'A': 5, 'B': 6 };
        // === Stem direction ===
        // Ambang batas diatonic (posisi note di staff) saat stem otomatis
        // mengarah ke bawah. Semakin KECIL nilainya, semakin cepat stem berubah
        // ke bawah begitu note mulai naik.
        //
        // Referensi diatonic (treble):
        //   E4 = 2  (garis bawah)
        //   G4 = 4  (garis kedua)
        //   B4 = 6  (garis tengah) ← aturan baku
        //   D5 = 8  (garis keempat)
        //   F5 = 10 (garis atas)
        //   A5 = 12 (ledger pertama di atas staff)
        //
        // Default per clef (dipakai jika option tidak di-set):
        //   Treble: 4  (G4) — stem turun begitu rata-rata mencapai G4
        //   Alto  : 0  (C4) — tepat di garis tengah alto
        //   Bass  : -4 (F3) — satu langkah di bawah garis tengah bass (D3)
        //
        // Set ke null (default) untuk memakai aturan bawaan per clef.
        // Set ke angka lebih kecil (mis. 2 / E4) untuk lebih agresif.
        this.stemDirectionThreshold = options.stemDirectionThreshold ?? 5;

        // === Auto-clef ===
        // Pilih clef (G/F/C) secara otomatis per staff berdasarkan
        // distribusi pitch, untuk mencegah melodi rendah tumpang tindih
        // dengan baris lirik.
        this.autoClef = options.autoClef !== false;
        this.allowAltoClef = options.allowAltoClef === true;

        // Ambang swap clef (diatonic step): C4=0, E4=2, G4=4, B4=6, D3=-6.
        // Semakin tinggi, semakin agresif swap ke bass.
        this.clefGtoFThreshold = options.clefGtoFThreshold ?? 4;
        this.clefFtoGThreshold = options.clefFtoGThreshold ?? -4;

        this.debugAutoClef = options.debugAutoClef === true;


        // ============================================================
        // COMMENT SYSTEM
        // ============================================================
        this.comments = Array.isArray(options.comments) ? options.comments.slice() : [];
        this.commentsVisible = options.commentsVisible !== false;   // default true
        this.commentMode = options.commentMode === true;            // default false
        this.commentAuthor = (options.commentAuthor === undefined) ? null : options.commentAuthor;
        this.commentTrackFilter = (options.commentTrackFilter === undefined) ? null : options.commentTrackFilter;
        this.commentUserFilter = (options.commentUserFilter === undefined) ? null : options.commentUserFilter;
        this.commentCallbacks = {
            onCreateRequest: (typeof options.onCreateRequest === 'function') ? options.onCreateRequest : null,
            onEditRequest:   (typeof options.onEditRequest   === 'function') ? options.onEditRequest   : null,
            onMoveRequest:   (typeof options.onMoveRequest   === 'function') ? options.onMoveRequest   : null,
            onError:         (typeof options.onError         === 'function') ? options.onError         : null,
            canEdit:         (typeof options.canEdit         === 'function') ? options.canEdit         : null
        };
        this._commentsOverlay = null;
        this._commentCreateAttached = false;
        this.midiTrackIdByPartIndex = options.midiTrackIdByPartIndex ?? null;
        
    }

    /**
     * Clears the container and renders the provided MusicXML string into an SVG score.
     * This is the main entry point for rendering sheet music. It parses the XML,
     * calculates layout metrics, and draws all musical elements.
     * @param {string} xmlText 
     */
    render(xmlText) {
        if (!this.container) return;
        // Reset cumulative tick counter for each new render to prevent offset issues.
        this._cumulativeTick = 0;

        this.container.innerHTML = "";

        if (!xmlText || typeof xmlText !== 'string') {
            this.container.innerHTML = "<div style='color:#ef4444; padding:2rem; text-align:center;'>No MusicXML data provided.</div>";
            return;
        }

        const scale = this.zoom || 1.0;
        this.lineSpacing = this.baseLineSpacing * scale;
        this.staffSpacing = this.baseStaffSpacing * scale;

        // Parse MusicXML
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "application/xml");

        const parserError = xmlDoc.querySelector("parsererror");
        if (parserError) {
            throw new Error("Invalid MusicXML structure: " + parserError.textContent);
        }

        // SVG Canvas dimensions (mobile‑aware)
        const containerWidth = this.forceMobile ? 425 : Math.max(this.container.clientWidth || 0, 850);
        this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        // FIX: Remove explicit width and height. Let viewBox control the aspect ratio and scaling.
        this.svg.style.backgroundColor = this.paperBg; // The container should control the width (e.g., via CSS `width: 100%`).
        this.svg.style.display = "block";
        this.svg.style.margin = "0 auto";
        this.container.appendChild(this.svg);
        // Store reference to root SVG for overlay elements like playhead
        this._svgRoot = this.svg;

        const svgRoot = this.svg;
        let currentSystemGroup = null;
        let systemNumber = 0;

        // Find parts & measures across all parts
        const parts = Array.from(xmlDoc.querySelectorAll("part"));
        if (parts.length === 0) {
            this.container.innerHTML = "<div style='color:#ef4444; padding:2rem; text-align:center;'>No musical parts found in MusicXML.</div>";
            return;
        }

        const partMeasures = parts.map(p => Array.from(p.querySelectorAll("measure")));
        const partMeasureMap = partMeasures.map(mList => {
            const map = new Map();
            mList.forEach(measureNode => {
                const measureNumber = parseInt(measureNode.getAttribute("number") || "1", 10) || 1;
                map.set(measureNumber, measureNode);
            });
            return map;
        });
        // Render must begin at the first measure in the MusicXML file without trimming any leading content.
        const firstMeasureNumber = 1;
        const measureOffset = 0;
        const maxMeasureNumber = Math.max(
            1,
            ...partMeasures.flatMap(mList => mList.map(m => parseInt(m.getAttribute("number") || "1", 10) || 1))
        );
        const totalMeasures = maxMeasureNumber;
        if (totalMeasures === 0) {
            this.container.innerHTML = "<div style='color:#ef4444; padding:2rem; text-align:center;'>No measures found in MusicXML.</div>";
            return;
        }

        // Map staves per part
        const partStaffMap = [];
        let totalSystemStaves = 0;

        parts.forEach((partNode, pIdx) => {
            const firstM = partMeasures[pIdx][0];
            let numStaves = 1;
            if (firstM) {
                const stavesNode = firstM.querySelector("attributes staves");
                if (stavesNode) {
                    numStaves = parseInt(stavesNode.textContent) || 1;
                } else {
                    const hasStaff2 = firstM.querySelector("note staff")?.textContent === "2";
                    if (hasStaff2) numStaves = 2;
                }
            }
            partStaffMap.push({
                partIndex: pIdx,
                partNode: partNode,
                numStaves: numStaves,
                startStaffId: totalSystemStaves + 1
            });
            totalSystemStaves += numStaves;
        });

        // Determine number of measures per line based on constructor options and lyric presence
        const hasLyrics = xmlDoc.querySelector("lyric") !== null;
        let isMobile;
        if (this.autoDetectMobile) {
            // Auto-detect based on viewport width, but allow explicit override via forceMobile
            isMobile = this.forceMobile || window.innerWidth <= 360; // Mobile viewport width threshold or forced mode
        } else {
            // Rely solely on the forceMobile flag provided via constructor
            isMobile = !!this.forceMobile;
        }
        if (isMobile) {
            this.measuresPerLine = 1; // One measure per system for mobile
        } else {
            this.measuresPerLine = hasLyrics ? 2 : 3; // Default behavior for larger screens
        }

        // FIX: Correctly calculate the total height of all staves in a system.
        // This calculation now accounts for additional spacing between different parts.
        let calculatedStaffSystemHeight = 0;
        const staffHeight = 4 * this.lineSpacing; // Height of one 5-line staff (4 spaces between 5 lines)

        for (let i = 0; i < partStaffMap.length; i++) {
            const pInfo = partStaffMap[i];
            calculatedStaffSystemHeight += pInfo.numStaves * staffHeight; // Height of staff lines for this part
            calculatedStaffSystemHeight += Math.max(0, pInfo.numStaves - 1) * this.staffSpacing * scale; // Spacing *within* this part's staves

            if (i < partStaffMap.length - 1) { // If not the last part, add extra spacing between parts
                calculatedStaffSystemHeight += this.partSpacing * scale;
            }
        }
        // Ensure a minimum height if no staves are rendered (e.g., empty score)
        if (totalSystemStaves === 0) calculatedStaffSystemHeight = staffHeight;

        // FIX: Correctly calculate rowSpacing using the configurable systemSpacing.
        // Hitung seberapa jauh lirik turun di bawah garis staff terbawah.
        // Staff memiliki tinggi 4 * lineSpacing. Lirik digambar pada this.liricYOffset dari atas staff.
        // Jadi, overflow di bawah staff adalah: this.liricYOffset - (4 * this.lineSpacing).
        // Tambahkan margin kecil (misal 10px) agar tidak terlalu mepet dengan sistem berikutnya.
        const lyricBottomOverflow = Math.max(0, this.liricYOffset - (4 * this.lineSpacing));
        const lyricPadding = hasLyrics ? (lyricBottomOverflow + 10) * scale : 0;
        
        this.rowSpacing = calculatedStaffSystemHeight + lyricPadding + this.systemSpacing * scale;

        // Metadata Header Details
        const songTitle = xmlDoc.querySelector("work-title")?.textContent ||
            xmlDoc.querySelector("movement-title")?.textContent ||
            xmlDoc.querySelector("credit-words")?.textContent ||
            "Untitled Score";
        const composer = xmlDoc.querySelector("creator[type='composer']")?.textContent ||
            xmlDoc.querySelector("creator")?.textContent ||
            "";
        // Get part names and abbreviations
        const initialY = 30 * scale; // Define the starting Y position for all content
        const subtitle = xmlDoc.querySelector("movement-title")?.textContent || "";
        const partName = parts.length === 1
            ? (xmlDoc.querySelector("part-name")?.textContent || (totalSystemStaves === 2 ? "Piano" : "Score"))
            : "Full Score";

        // Header Title Block
        let currentY = initialY; // Use the defined starting Y

        // Title
        // Draw title at the initial currentY position
        this.drawText(containerWidth / 2, currentY, songTitle, `${Math.round(22 * scale)}px`, this.engraverColor, "middle", true, "'Outfit', 'Times New Roman', serif");

        // Subtitle
        if (subtitle && subtitle !== songTitle) {
            currentY += 18 * scale;
            this.drawText(containerWidth / 2, currentY, subtitle, `${Math.round(12 * scale)}px`, "#64748b", "middle", false);
        }

        // ============================================================
        // Metadata line: Composer (kanan) + Part Name (kiri) sejajar
        // ============================================================
        currentY += 15 * scale;                 // geser ke baseline bersama
        const metadataY = currentY;

        // Composer (kanan)
        if (composer) {
            this.drawText(
                containerWidth - 40 * scale,
                metadataY,
                composer,
                `${Math.round(11 * scale)}px`,
                this.engraverColor,
                "end",
                false,
                "'Inter', sans-serif"
            );
        }

        // Part Name / Instrument (kiri)
        this.drawText(
            25 * scale,
            metadataY,
            partName,
            `${Math.round(12 * scale)}px`,
            "#000000",
            "start",
            false,
            "'Inter', sans-serif"
        );
        
        // Pre-fetch part names and abbreviations for system labels
        const partDetails = {};
        partStaffMap.forEach(pInfo => {
            const partId = pInfo.partNode.getAttribute('id');
            const partListEntry = xmlDoc.querySelector(`part-list score-part[id="${partId}"]`);
            const name = partListEntry?.querySelector('part-name')?.textContent || `Part ${pInfo.partIndex + 1}`;
            const abbr = partListEntry?.querySelector('part-abbreviation')?.textContent || name.substring(0, 4);
            partDetails[pInfo.partIndex] = { name, abbr };
        });

                // System Layout Metrics
        currentY += 80 * scale; // Add more space before the first staff system to prevent overlap
        const leftMargin = 85 * scale;
        const rightMargin = 40 * scale;
        const systemStartX = leftMargin - 60 * scale;
        const usableWidth = containerWidth - leftMargin - rightMargin;
        const measureWidth = Math.max(220 * scale, usableWidth / this.measuresPerLine);

        let currentX = leftMargin;

        // Track clefs, key, and time signatures for each staff ID (1..totalSystemStaves)
        const staffState = {};
        for (let s = 1; s <= totalSystemStaves; s++) {
            staffState[s] = { clef: "G", fifths: 0, beats: 4, beatType: 4, timeSymbol: null, divisions: 4 };
        }

        // === Auto-clef: pilih clef terbaik per staff ===
        if (this.autoClef) {
            this.applyAutoClefToStaffState(partStaffMap, partMeasureMap, staffState);
        }

        const activeTies = {};

        // Declarations for system metadata tracking
        let currentSystemMeta = null;
        let systemRowWidth = 0;
        // Measure Iteration across maxMeasures
        for (let measureIdx = 0; measureIdx < totalMeasures; measureIdx++) {
            // Track metadata for the current system
            // Declarations moved outside the loop for proper scope
            const isSystemStart = (measureIdx % this.measuresPerLine === 0);
            // Declare offset variables here to be accessible throughout the measure loop
            let currentStaffYOffset = 0;
            let previousPartIndex = -1;

            // Advance to next system row if row is full
            if (measureIdx > 0 && isSystemStart) {
                currentY += this.rowSpacing; // Move to the next system row using the pre-calculated spacing
                currentX = leftMargin; // Reset X position for the new system
            }

            // Update metadata attributes across all parts for this measure
            partStaffMap.forEach(pInfo => {
                const measureNumber = measureIdx + firstMeasureNumber;
                const mNode = partMeasureMap[pInfo.partIndex].get(measureNumber);
                if (!mNode) return;

                const attrNode = mNode.querySelector("attributes");
                if (attrNode) {
                    const divisionsNode = attrNode.querySelector("divisions");
                    const divVal = divisionsNode ? (parseInt(divisionsNode.textContent) || 4) : 4;

                    const fifthsNode = attrNode.querySelector("key fifths");
                    const fifthsVal = fifthsNode ? (parseInt(fifthsNode.textContent) || 0) : 0;

                    const timeNode = attrNode.querySelector("time");
                    let beatsVal = 4, beatTypeVal = 4, symbolVal = null;
                    if (timeNode) {
                        symbolVal = timeNode.getAttribute("symbol");
                        beatsVal = parseInt(timeNode.querySelector("beats")?.textContent || "4") || 4;
                        beatTypeVal = parseInt(timeNode.querySelector("beat-type")?.textContent || "4") || 4;
                    }

                    attrNode.querySelectorAll("clef").forEach(clefNode => {
                        const clefNum = parseInt(clefNode.getAttribute("number") || "1") || 1;
                        const sign = clefNode.querySelector("sign")?.textContent;
                        const staffId = pInfo.startStaffId + (clefNum - 1);
                        if (staffState[staffId] && sign) {
                            // Jika auto-clef sudah memilih clef di measure pertama,
                            // jangan timpa dengan clef asli dari XML.
                            // Clef perubahan eksplisit di measure selanjutnya tetap dihormati.
                            if (measureIdx === 0 && staffState[staffId]._clefAutoApplied) {
                                return;
                            }
                            staffState[staffId].clef = sign;
                        }
                    });

                    for (let s = 0; s < pInfo.numStaves; s++) {
                        const staffId = pInfo.startStaffId + s;
                        if (staffState[staffId]) {
                            staffState[staffId].divisions = divVal;
                            staffState[staffId].fifths = fifthsVal;
                            if (timeNode) {
                                staffState[staffId].beats = beatsVal;
                                staffState[staffId].beatType = beatTypeVal;
                                staffState[staffId].timeSymbol = symbolVal;
                            }
                        }
                    }
                }
            });


            // At System Start: Draw Continuous System Staff Lines & Connectors
            if (isSystemStart) {
                // Finalize previous system metadata if exists
                if (currentSystemMeta) {
                    currentSystemMeta.endTick = this._cumulativeTick;
                    currentSystemMeta.xEnd = systemStartX + systemRowWidth;
                    currentSystemMeta.yEnd = currentY + calculatedStaffSystemHeight;
                    this._systemMetadata.push(currentSystemMeta);
                    if (currentSystemGroup) {
                        currentSystemGroup.setAttribute("data-start-tick", currentSystemMeta.startTick);
                        currentSystemGroup.setAttribute("data-end-tick", currentSystemMeta.endTick);
                    }
                }
                systemNumber += 1;
                currentSystemGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
                currentSystemGroup.setAttribute("id", `system-${systemNumber}`);
                currentSystemGroup.setAttribute("data-system-number", `${systemNumber}`);
                currentSystemGroup.setAttribute("data-start-tick", this._cumulativeTick);
                svgRoot.appendChild(currentSystemGroup);
                this.svg = currentSystemGroup;

                const remainingMeasures = totalMeasures - measureIdx;
                const systemMeasuresInRow = Math.min(this.measuresPerLine, remainingMeasures);
                systemRowWidth = systemMeasuresInRow * measureWidth + 60 * scale;

                // Set geometry attributes on the system group for the playhead
                currentSystemGroup.setAttribute("x", systemStartX);
                currentSystemGroup.setAttribute("y", currentY);
                currentSystemGroup.setAttribute("width", systemRowWidth);
                currentSystemGroup.setAttribute("height", calculatedStaffSystemHeight);

                // Initialize metadata for the new system
                currentSystemMeta = {
                    systemNumber: systemNumber,
                    startTick: this._cumulativeTick,
                    xStart: systemStartX,
                    yStart: currentY,
                    // end values will be set later
                };

                // Draw vertical system start line across all staves
                this.drawSystemStartLine(systemStartX, currentY, calculatedStaffSystemHeight);

                // Draw continuous 5 staff lines and a left bar line for each staff (height of one staff)
                for (let s = 1; s <= totalSystemStaves; s++) {
                    const pInfo = partStaffMap.find(p => s >= p.startStaffId && s < p.startStaffId + p.numStaves);
                    if (!pInfo) continue; // Should not happen

                    const localStaff = (s - pInfo.startStaffId) + 1; // 1-based local staff index within its part

                    // Add extra spacing when moving to a new part
                    if (pInfo.partIndex !== previousPartIndex && previousPartIndex !== -1) {
                        currentStaffYOffset += this.partSpacing * scale; // Add part spacing for new part
                    }
                    const sY = currentY + currentStaffYOffset; // Top line of the current staff

                    // Draw staff lines
                    this.drawStaffLines(systemStartX, sY, systemRowWidth);

                    // Draw vertical bar line at the left margin for this staff (height = one staff)
                    const staffHeight = 4 * this.lineSpacing;
                    this.drawBarLine(leftMargin, sY, false, staffHeight);

                    // Draw Clef, Key, Time Signature at system start for this staff
                    const state = staffState[s];
                    const clefX = systemStartX + 6 * scale;
                    this.drawClef(state.clef, clefX, sY);

                    const keySigX = clefX + 20 * scale; // Position for key signature
                    this.drawKeySignature(keySigX, sY, state.fifths, state.clef);

                    const timeSigX = keySigX + (24 * scale); // Fixed position after max key signature width (7 symbols * 9pt width)
                    this.drawTimeSignature(timeSigX, sY, state.beats, state.beatType, state.timeSymbol);

                    // Draw part abbreviation vertically at the start of the system
                    const textX = systemStartX - 14 * scale; // Geser ke kanan dari -25
                    const textY = sY + (4.05 * this.lineSpacing); // Geser ke atas dari 2*lineSpacing
                    const textContent = partDetails[pInfo.partIndex].abbr;
                    this.drawText(textX, textY, textContent, `${Math.round(11 * scale)}px`, this.engraverColor, "start", false, "'Inter', sans-serif", -90); // Rotasi -90 derajat, anchor "start"
                    
                    // Update offset for the next staff
                    currentStaffYOffset += (4 * this.lineSpacing); // Height of the staff lines
                    if (localStaff < pInfo.numStaves) {
                        currentStaffYOffset += this.staffSpacing * scale;
                    }
                    previousPartIndex = pInfo.partIndex;
                }

                // Draw grand staff braces for any part that has 2 staves.
                let braceYOffset = 0;
                partStaffMap.forEach((pInfo, index) => { // NOSONAR
                    const partHeight = pInfo.numStaves * (4 * this.lineSpacing) + Math.max(0, pInfo.numStaves - 1) * this.staffSpacing * scale;
                    if (pInfo.numStaves >= 2) { // Draw for 2 or 3 staves
                        const braceTopY = currentY + braceYOffset;
                        const braceBottomY = braceTopY + partHeight;
                        this.drawGrandStaffBrace(systemStartX - 0 * scale, braceTopY, braceBottomY);
                    }
                    braceYOffset += partHeight + (index < partStaffMap.length - 1 ? this.partSpacing * scale : 0);
                });

                // Measure Number
                const displayMeasureNumber = measureIdx + firstMeasureNumber;
                this.drawText(systemStartX, currentY - 14 * scale, `${displayMeasureNumber}`, `${Math.round(10 * scale)}px`, "#64748b", "start", true, "'Inter', sans-serif");
            }

            // Tempo Markings from primary measure
            const firstM = partMeasureMap[0].get(measureIdx + firstMeasureNumber);
            if (firstM) {
                let tempoBpm = null;
                const metroNode = firstM.querySelector("metronome per-minute");
                if (metroNode) {
                    tempoBpm = metroNode.textContent;
                } else {
                    const soundNode = firstM.querySelector("sound[tempo]");
                    if (soundNode) tempoBpm = soundNode.getAttribute("tempo");
                }
                if (tempoBpm && !isNaN(parseFloat(tempoBpm))) {
                    const bpmText = `♩ = ${Math.round(parseFloat(tempoBpm))}`;
                    this.drawText(currentX, currentY - 12 * scale, bpmText, `${Math.round(11 * scale)}px`, this.engraverColor, "start", true);
                }
            }

            // Create a group for the entire measure content
            const measureGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
            measureGroup.setAttribute("data-measure-number", measureIdx + 1); // Use 1-based index for consistency with MusicXML
            measureGroup.setAttribute("data-start-tick", this._cumulativeTick);
            measureGroup.setAttribute("x", currentX);
            measureGroup.setAttribute("width", measureWidth);

            const padding = 24 * scale;
            const xRange  = measureWidth - padding - 18 * scale;
            measureGroup.setAttribute("data-content-x",     currentX + padding);
            measureGroup.setAttribute("data-content-width", xRange);
            
            // Temporarily append to the current system group to render into it
            this.svg.appendChild(measureGroup);
            
            // All subsequent drawing for this measure will go into this new group
            const originalSvgTarget = this.svg;
            this.svg = measureGroup;

            // Measure Right Barline per staff (height = one staff)
            const isLastMeasureInScore = (measureIdx === totalMeasures - 1);
            const staffHeight = 4 * this.lineSpacing;
            // Compute vertical position for each staff similar to left barline logic
            let rightBarOffset = 0;
            let rightPrevPart = -1;
            for (let s = 1; s <= totalSystemStaves; s++) {
                const pInfo = partStaffMap.find(p => s >= p.startStaffId && s < p.startStaffId + p.numStaves);
                if (!pInfo) continue;
                if (pInfo.partIndex !== rightPrevPart && rightPrevPart !== -1) {
                    rightBarOffset += this.partSpacing * scale;
                }
                const sY = currentY + rightBarOffset; // Top line of this staff
                this.drawBarLine(currentX + measureWidth, sY, isLastMeasureInScore, staffHeight);
                // Update offset for next staff
                rightBarOffset += (4 * this.lineSpacing);
                const localStaff = (s - pInfo.startStaffId) + 1;
                if (localStaff < pInfo.numStaves) {
                    rightBarOffset += this.staffSpacing * scale;
                }
                rightPrevPart = pInfo.partIndex;
            }

            // Parse & Render Notes across all parts and staves for this measure
            currentStaffYOffset = 0; // Reset offset for the note rendering pass
            previousPartIndex = -1; // Reset part index tracker

            

            for (let s = 1; s <= totalSystemStaves; s++) {
                
                let channelId = -1; // Inisialisasi channelId untuk staff ini
                const pInfo = partStaffMap.find(p => s >= p.startStaffId && s < p.startStaffId + p.numStaves);
                if (!pInfo) continue;

                const localStaff = (s - pInfo.startStaffId) + 1;

                // Add extra spacing when moving to a new part
                if (pInfo.partIndex !== previousPartIndex && previousPartIndex !== -1) {
                    currentStaffYOffset += this.partSpacing * scale;
                }
                const sY = currentY + currentStaffYOffset;

                const staffMarker = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                staffMarker.setAttribute('data-part-index', String(pInfo.partIndex));
                staffMarker.setAttribute('data-staff-id', String(s));
                staffMarker.setAttribute('data-y', String(sY));
                if (Array.isArray(this.midiTrackIdByPartIndex)) {
                    const mtid = this.midiTrackIdByPartIndex[pInfo.partIndex];
                    if (mtid !== undefined && mtid !== null) {
                        staffMarker.setAttribute('data-midi-track-id', String(mtid));
                    }
                }
                currentSystemGroup.appendChild(staffMarker);

                // Dapatkan channelId dari part
                const partId = pInfo.partNode.getAttribute('id');
                const partListEntry = xmlDoc.querySelector(`part-list score-part[id="${partId}"]`);
                const midiChannelNode = partListEntry?.querySelector('midi-instrument midi-channel');
                if (midiChannelNode) channelId = parseInt(midiChannelNode.textContent, 10);
                const state = staffState[s];

                const measureNumber = measureIdx + firstMeasureNumber;
                const mNode = partMeasureMap[pInfo.partIndex].get(measureNumber);
                if (!mNode) {
                    // Compute full measure duration in divisions
                    const beatFactor = 4 / state.beatType; // quarter‑note factor
                    const fullMeasureDivisions = state.beats * state.divisions * beatFactor;
                    // Determine appropriate rest glyph (whole or half) based on beats per measure
                    const restType = state.beats >= 4 ? 'whole' : 'half';
                    // Position the rest roughly in the middle of the measure
                    const noteX = currentX + measureWidth / 2;
                    this.drawRest(noteX - 2, sY, restType);
                    // No notes to draw for this staff in this measure
                    continue;
                }

                // FIX: This entire block is rewritten to handle internal note splitting for ties.
                // Determine measure duration (beats * divisions) using the first staff's state.
                let measureDuration = staffState[1] ? staffState[1].beats * staffState[1].divisions : 0;
                let currentDiv = 0; // Running cursor for horizontal position in divisions.
                let lastBaseDiv = 0; // For chord alignment
                const allNotesInMeasure = []; // This will hold all noteData objects, including split ones.

                // Get current staff's divisions for this measure, which is crucial for duration calculations.
                const currentStaffDivisions = staffState[s].divisions;

                // Iterate through original note nodes from the XML.
                // Note: currentDiv and lastBaseDiv are reset to 0 for each new staff (declared with 'let' above).
                // Notes from other staves are skipped without changing currentDiv/lastBaseDiv,
                // so each staff's cursor is independent.
                mNode.querySelectorAll("note").forEach(originalNoteNode => {
                    const noteStaff = parseInt(originalNoteNode.querySelector("staff")?.textContent || "1") || 1;
                    const isChord = originalNoteNode.querySelector("chord") !== null;
                    const isRest = originalNoteNode.querySelector("rest") !== null;
                    let originalDuration = parseInt(originalNoteNode.querySelector("duration")?.textContent || "0") || 0;

                    if (noteStaff !== localStaff) return; // Skip notes from other staves

                    // Determine original tie types from the XML node
                    let lyricText = null;
                    const lyricTxtNode = originalNoteNode.querySelector("lyric text");
                    if (lyricTxtNode) {
                        lyricText = lyricTxtNode.textContent;
                    } else {
                        const rawLyric = originalNoteNode.querySelector("lyric");
                        if (rawLyric) lyricText = rawLyric.textContent.trim();
                    }

                    let originalTieStart = false;
                    let originalTieStop = false;
                    originalNoteNode.querySelectorAll("tie, tied").forEach(t => {
                        const type = t.getAttribute("type");
                        if (type === "start") originalTieStart = true;
                        if (type === "stop") originalTieStop = true;
                    });

                    // Split duration if it's not a standard representable duration
                    let pieces = [originalDuration];
                    if (!isRest && originalDuration > 0 &&
                        !MusicXMLSVGRenderer.isStandardDuration(originalDuration, currentStaffDivisions)) {
                        pieces = MusicXMLSVGRenderer.splitDurationIntoRepresentablePieces(originalDuration, currentStaffDivisions);
                    }

                    let pieceCurrentDiv = isChord ? lastBaseDiv : currentDiv;

                    pieces.forEach((pieceDuration, pIdx) => {
                        const isFirstPiece = (pIdx === 0);
                        const isLastPiece = (pIdx === pieces.length - 1);

                        // Calculate tie types for each piece
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
                            channelId: channelId,
                            node: originalNoteNode,
                            isRest: isRest,
                            staff: s,
                            step: originalNoteNode.querySelector("pitch step, unpitched display-step")?.textContent || "C",
                            octave: parseInt(originalNoteNode.querySelector("pitch octave, unpitched display-octave")?.textContent || "4") || 4,
                            alter: parseInt(originalNoteNode.querySelector("pitch alter")?.textContent || "0") || 0,
                            accidental: originalNoteNode.querySelector("accidental")?.textContent,
                            type: MusicXMLSVGRenderer.getNoteType(pieceDuration, currentStaffDivisions),
                            stem: originalNoteNode.querySelector("stem")?.textContent,
                            notehead: originalNoteNode.querySelector("notehead")?.textContent,
                            dots: MusicXMLSVGRenderer.getDotCount(pieceDuration, currentStaffDivisions),
                            lyric: isFirstPiece ? lyricText : null,
                            onsetDiv: pieceCurrentDiv,
                            duration: pieceDuration,
                            articulations: {
                                staccato: originalNoteNode.querySelector("articulations staccato") !== null,
                                accent: originalNoteNode.querySelector("articulations accent") !== null,
                                tenuto: originalNoteNode.querySelector("articulations tenuto") !== null,
                                fermata: originalNoteNode.querySelector("fermata") !== null
                            },
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

                // measureDuration is defined earlier; using the outer variable
                const totalMeasureDivs = Math.max(measureDuration, currentDiv, 1);

                if (allNotesInMeasure.length === 0) {
                    allNotesInMeasure.push({
                        isRest: true,
                        staff: s,
                        step: "C",
                        octave: 4,
                        alter: 0,
                        accidental: null,
                        type: MusicXMLSVGRenderer.getNoteType(measureDuration, currentStaffDivisions),
                        stem: "up",
                        dots: 0,
                        lyric: null,
                        onsetDiv: 0,
                        duration: measureDuration,
                        articulations: {},
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
                            type: MusicXMLSVGRenderer.getNoteType(firstOnset, currentStaffDivisions),
                            stem: "up",
                            dots: 0,
                            lyric: null,
                            onsetDiv: 0,
                            duration: firstOnset,
                            articulations: {},
                            tieStart: false,
                            tieStop: false,
                            divisions: currentStaffDivisions,
                            beatType: state.beatType || 4
                        });
                    }
                }

                // ============================================================
                // PERBAIKAN: Kelompokkan notes dengan onsetDiv yang sama,
                // tetapi pisahkan notes yang memiliki tieStart dan yang tidak
                // ============================================================
                const columnsByOnset = {};
                allNotesInMeasure.forEach(note => {
                    // Buat key unik: onsetDiv + tieStart flag untuk memisahkan tie note dengan note berikutnya
                    const key = note.tieStart ? `${note.onsetDiv}-tie` : `${note.onsetDiv}`;
                    if (!columnsByOnset[key]) columnsByOnset[key] = [];
                    columnsByOnset[key].push(note);
                });

                // Urutkan key berdasarkan onsetDiv (numeric) dan prioritaskan yang bukan tie
                const sortedKeys = Object.keys(columnsByOnset).sort((a, b) => {
                    const aOnset = parseInt(a);
                    const bOnset = parseInt(b);
                    if (aOnset !== bOnset) return aOnset - bOnset;
                    // Jika onset sama, yang mengandung 'tie' diletakkan BELAKANG (agar tidak tumpang tindih)
                    if (a.includes('tie') && !b.includes('tie')) return 1;
                    if (!a.includes('tie') && b.includes('tie')) return -1;
                    return 0;
                });

                // Untuk melacak posisi X terakhir yang sudah digunakan
                let lastX = 0;

                // Simpan semua note yang akan digambar untuk deteksi tumpang tindih
                const allColumns = [];

                sortedKeys.forEach(key => {
                    const onset = parseInt(key) || 0;
                    const colNotes = columnsByOnset[key];
                    const ratio = onset / totalMeasureDivs;
                    const padding = 24 * scale;
                    const xRange = measureWidth - padding - 18 * scale;
                    let colX = currentX + padding + ratio * xRange;

                    // Cek apakah ini adalah tie note (tieStart dan tieStop dalam satu note)
                    const hasTieStart = colNotes.some(n => n.tieStart);
                    const hasTieStop = colNotes.some(n => n.tieStop);
                    const isChord = colNotes.length > 1;

                    // ============================================================
                    // PERBAIKAN UTAMA: Tie note digeser ke kiri agar tidak tumpang tindih
                    // ============================================================

                    // Jika ini adalah tie stop (akhir tie), posisi agak digeser
                    if (hasTieStop && !hasTieStart && !isChord && allColumns.length > 0) {
                        // Tie stop: posisi agak digeser ke kiri jika bukan note pertama
                        colX -= 16 * scale;
                    }

                    // ============================================================
                    // PERBAIKAN: Deteksi jika ada note biasa di posisi yang sama
                    // Jika ada tie dan note biasa di onset yang sama, geser tie ke kiri
                    // ============================================================
                    // Cek apakah ada note lain di onset yang sama yang bukan tie
                    const hasNonTie = colNotes.some(n => !n.tieStart && !n.tieStop);
                    if (hasTieStart && hasNonTie) {
                        // Jika ada tie dan non-tie di posisi yang sama, geser tie lebih ke kiri
                        colX -= 14 * scale;
                    }

                    // Pastikan tidak tumpang tindih dengan note sebelumnya
                    if (colX <= lastX + 5 * scale) {
                        // Jika masih tumpang tindih, geser lebih jauh
                        colX = lastX + 12 * scale;
                    }
                    lastX = colX;

                    // Simpan data untuk deteksi tumpang tindih antar kolom
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

                // ============================================================
                // PERBAIKAN: Deteksi tumpang tindih antar kolom setelah semua posisi dihitung
                // ============================================================
                // Proses kedua: jika ada dua kolom yang terlalu dekat, geser yang memiliki tie
                for (let i = 0; i < allColumns.length - 1; i++) {
                    const current = allColumns[i];
                    const next = allColumns[i + 1];
                    
                    // Jika jarak antar kolom terlalu dekat
                    if (next.colX - current.colX < 12 * scale) {
                        // Jika current adalah tie, geser ke kiri
                        if (current.hasTieStart && !current.hasTieStop) {
                            current.colX -= 6 * scale;
                        }
                        // Jika next adalah tie, geser ke kiri
                        if (next.hasTieStart && !next.hasTieStop) {
                            next.colX -= 6 * scale;
                        }
                        // Jika keduanya tie, geser current ke kiri dan next ke kanan
                        if (current.hasTieStart && next.hasTieStart) {
                            current.colX -= 4 * scale;
                            next.colX += 4 * scale;
                        }
                    }
                }

                // Gambar semua kolom dengan posisi yang sudah disesuaikan
                const renderedStems = [];
                allColumns.forEach(col => {
                    const stemData = this.drawNoteColumn(
                        col.colX, 
                        sY, 
                        col.colNotes, 
                        staffState[s].clef, 
                        activeTies, 
                        channelId
                    );
                    if (stemData && stemData.isBeamable) {
                        renderedStems.push(stemData);
                    }
                });

                // Render beams for this staff
                this.drawBeams(renderedStems);

                // Update offset for the next staff
                currentStaffYOffset += (4 * this.lineSpacing);
                if (localStaff < pInfo.numStaves) {
                    currentStaffYOffset += this.staffSpacing * scale;
                }
                previousPartIndex = pInfo.partIndex;
            }

            // Restore the original SVG target (the system group)
            this.svg = originalSvgTarget;

            // Set the end tick for the measure group
            measureGroup.setAttribute("data-end-tick", this._cumulativeTick + (staffState[1].beats * staffState[1].divisions));

            // CRITICAL FIX: Advance currentX to the next measure column!
            currentX += measureWidth;
            // Advance cumulative tick counter by this measure's duration
            // Compute measure duration (beats * divisions) using first staff's state
            const measureDuration = staffState[1].beats * staffState[1].divisions;
            this._cumulativeTick += measureDuration;
        }

        this.svg = svgRoot;
        // Finalize metadata for the last system after rendering completes
        if (currentSystemMeta) {
            currentSystemMeta.endTick = this._cumulativeTick;
            currentSystemMeta.xEnd = systemStartX + systemRowWidth;
            currentSystemMeta.yEnd = currentY + calculatedStaffSystemHeight;
            this._systemMetadata.push(currentSystemMeta);
            if (currentSystemGroup) {
                currentSystemGroup.setAttribute("data-start-tick", currentSystemMeta.startTick);
                currentSystemGroup.setAttribute("data-end-tick", currentSystemMeta.endTick);
            }
        }

        // FIX: Correctly calculate viewBox to fit the rendered content without extra top space.
        const topMargin = 20 * scale; // Explicit top margin inside the SVG
        const finalContentBottomY = currentY + calculatedStaffSystemHeight + 40 * scale;
        const viewBoxStartY = initialY - topMargin; // Start viewBox above the first content element
        const totalContentHeight = finalContentBottomY + topMargin - viewBoxStartY;

        const viewBoxWidth = this.forceMobile ? 425 : containerWidth;
        this.svg.setAttribute("viewBox", `-10 ${viewBoxStartY} ${viewBoxWidth} ${totalContentHeight}`);
        // Attach click handler to report tick value for DAW seeking
        if (typeof this.onClickSystem === 'function') {
            this.svg.addEventListener('click', (e) => {
                const grp = e.target.closest('[data-start-tick]');
                if (grp) {
                    const tickStr = grp.getAttribute('data-start-tick');
                    const tick = tickStr !== null ? parseInt(tickStr, 10) : null;
                    if (tick !== null && !isNaN(tick)) {
                        this.onClickSystem(tick, e);
                    }
                }
            });
        }
        this._syncTrackFilterFromSource();
        this.renderComments();
    }

    // ============================================================
    // COMMENT API
    // ============================================================

    /**
     * Replace the entire comment list.
     *
     * @param {Array<Object>} comments - New list of comments
     */
    setComments(comments) {
        this.comments = Array.isArray(comments) ? comments.slice() : [];
        this.renderComments();
    }

    /**
     * Add or replace a comment by ID.
     *
     * @param {Object} comment - Comment object to add or update
     */
    addComment(comment) {
        if (!comment) return;
        const id = comment.id ?? comment.track_comment_id;
        const idx = this.comments.findIndex(c => (c.id ?? c.track_comment_id) === id);
        if (idx >= 0) this.comments[idx] = { ...this.comments[idx], ...comment };
        else this.comments.push(comment);
        this.renderComments();
    }

    /**
     * Update specific fields of a comment.
     *
     * @param {string|number} id - Comment ID
     * @param {Object} changes - Partial fields to update
     */
    updateComment(id, changes) {
        const c = this.comments.find(c => (c.id ?? c.track_comment_id) === id);
        if (!c) return;
        Object.assign(c, changes);
        this.renderComments();
    }

    /**
     * Remove a comment by ID.
     *
     * @param {string|number} id - Comment ID
     */
    removeComment(id) {
        this.comments = this.comments.filter(c => (c.id ?? c.track_comment_id) !== id);
        this.renderComments();
    }

    /**
     * Show the comment overlay.
     */
    showComments() {
        this.commentsVisible = true;
        if (this._commentsOverlay) this._commentsOverlay.style.display = '';
    }

    /**
     * Hide the comment overlay.
     */
    hideComments() {
        this.commentsVisible = false;
        if (this._commentsOverlay) this._commentsOverlay.style.display = 'none';
    }

    /**
     * Enable or disable comment interaction (drag & click).
     * Does not trigger a re-render — only updates display and cursor.
     *
     * @param {boolean} on - True to enable, false to disable
     */
    setCommentMode(on) {
        this.commentMode = !!on;
        if (on) this.showComments();
        else this.hideComments();
        this._refreshCommentCursors();
    }

    /**
     * Set the currently logged-in user (used to determine edit rights).
     *
     * @param {string|number|null} id - Author ID, or null if none
     */
    setCommentAuthor(id) {
        this.commentAuthor = (id === null || id === undefined) ? null : id;
        this._refreshCommentCursors();
    }

    /**
     * Set a filter by MIDI track ID(s).
     * Accepts a single ID, an array of IDs, or a Set.
     * Null/undefined clears the filter.
     *
     * @param {number|Array<number>|Set<number>|null} midiTrackId - Track ID(s) to filter, or null
     */
    setCommentTrackFilter(midiTrackId) {
        if (midiTrackId === null || midiTrackId === undefined) {
            this.commentTrackFilter = null;
        } else {
            const arr = (midiTrackId instanceof Set)
                ? Array.from(midiTrackId)
                : Array.isArray(midiTrackId)
                    ? midiTrackId
                    : [midiTrackId];

            const set = new Set(
                arr
                    .filter(v => v !== null && v !== undefined && Number(v) !== -1)
                    .map(v => Number(v))
            );

            this.commentTrackFilter = set.size > 0 ? set : null;
        }
        this.renderComments();
    }

    /**
     * Filter comments by author.
     * Null = show comments from all users.
     * Non-null = show only comments from the specified author.
     *
     * @param {string|number|null} userId - Author ID to filter, or null
     */
    setCommentUserFilter(userId) {
        this.commentUserFilter = (userId === null || userId === undefined) ? null : userId;
        this.renderComments();
    }

    /**
     * Register callbacks for comment operations.
     * Can be called at any time; only provided keys are updated.
     *
     * @param {Object} cbs - Callback functions (e.g., { canEdit: fn })
     */
    setCommentCallbacks(cbs) {
        this.commentCallbacks = { ...this.commentCallbacks, ...(cbs || {}) };
    }

    /**
     * Check edit permissions for a comment.
     * Default: only the author can edit their own comment.
     * For custom policies (e.g., composer can delete client comments),
     * override via callbacks.canEdit.
     *
     * @param {Object} comment - Comment object
     * @returns {boolean} True if the current user can edit
     */
    canEditComment(comment) {
        if (!comment) return false;
        if (typeof this.commentCallbacks.canEdit === 'function') {
            return !!this.commentCallbacks.canEdit(comment, this.commentAuthor);
        }
        return String(comment.author) === String(this.commentAuthor);
    }

    /**
     * Check if a comment was created by the currently logged-in user.
     * Used for UI highlighting (e.g., bold border).
     *
     * @param {Object} comment - Comment object
     * @returns {boolean} True if authored by the current user
     */
    isMyComment(comment) {
        if (!comment || this.commentAuthor === null) return false;
        return String(comment.author) === String(this.commentAuthor);
    }

    /**
     * Convert a MIDI tick to SVG coordinates (viewBox space).
     *
     * @param {number} tick - MIDI tick position
     * @param {number} [midiTrackId] - Optional track ID for staff alignment
     * @returns {Object|null} Coordinates { x, y, systemNumber, measureNumber, progress }
     */
    tickToCoordinates(tick, midiTrackId = undefined) {
        if (!this._svgRoot) return null;
        const measures = this._svgRoot.querySelectorAll('g[data-measure-number][data-start-tick]');
        if (measures.length === 0) return null;

        // Cari measure yang mengandung tick (tidak berubah)
        let targetMeasure = measures[0];
        for (const m of measures) {
            const s = parseFloat(m.dataset.startTick);
            const e = parseFloat(m.dataset.endTick);
            if (tick >= s && tick < e) { targetMeasure = m; break; }
            if (tick >= s) targetMeasure = m;
        }

        const sTick = parseFloat(targetMeasure.dataset.startTick);
        const eTick = parseFloat(targetMeasure.dataset.endTick);
        const span  = Math.max(1, eTick - sTick);
        const progress = Math.max(0, Math.min(1, (tick - sTick) / span));

        const measureX = parseFloat(targetMeasure.getAttribute('x'));
        const measureW = parseFloat(targetMeasure.getAttribute('width'));
        const contentX = parseFloat(targetMeasure.getAttribute('data-content-x')     ?? measureX);
        const contentW = parseFloat(targetMeasure.getAttribute('data-content-width') ?? measureW);

        const x = contentX + progress * contentW;

        const system = targetMeasure.closest('g[data-system-number]');
        let systemY = parseFloat(system?.getAttribute('y') ?? 0);

        // ⬇️ GANTI seluruh blok getCTM dengan ini:
        if (midiTrackId !== undefined && midiTrackId !== null && system) {
            const staffEl = system.querySelector(
                `g[data-staff-id][data-midi-track-id="${String(midiTrackId)}"]`
            );
            if (staffEl) {
                const storedY = parseFloat(staffEl.getAttribute('data-y'));
                if (Number.isFinite(storedY)) systemY = storedY;
            }
        }

        return {
            x,
            y: systemY,
            systemNumber:  parseInt(system?.dataset.systemNumber ?? 1, 10),
            measureNumber: parseInt(targetMeasure.dataset.measureNumber ?? 1, 10),
            progress
        };
    }

    /**
     * Convert SVG coordinates (viewBox space) to a MIDI tick.
     *
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {number} Corresponding MIDI tick
     */
    coordinatesToTick(x, y) {
        if (!this._svgRoot) return 0;
        const systems = Array.from(this._svgRoot.querySelectorAll('g[data-system-number]'));
        if (systems.length === 0) return 0;

        let system = systems[0];
        let bestDist = Infinity;
        for (const s of systems) {
            const sy = parseFloat(s.getAttribute('y') ?? 0);
            const d  = Math.abs(y - sy);
            if (d < bestDist) { bestDist = d; system = s; }
        }

        const measures = Array.from(system.querySelectorAll('g[data-measure-number][data-start-tick]'));
        if (measures.length === 0) return 0;

        let targetMeasure = measures[0];
        for (const m of measures) {
            const cx = parseFloat(m.getAttribute('data-content-x')     ?? m.getAttribute('x'));
            const cw = parseFloat(m.getAttribute('data-content-width') ?? m.getAttribute('width'));
            if (x >= cx && x <= cx + cw) { targetMeasure = m; break; }
            if (x >= cx) targetMeasure = m;
        }

        const cx = parseFloat(targetMeasure.getAttribute('data-content-x')     ?? targetMeasure.getAttribute('x'));
        const cw = parseFloat(targetMeasure.getAttribute('data-content-width') ?? targetMeasure.getAttribute('width'));
        const progress = cw > 0 ? Math.max(0, Math.min(1, (x - cx) / cw)) : 0;

        const sTick = parseFloat(targetMeasure.dataset.startTick);
        const eTick = parseFloat(targetMeasure.dataset.endTick);
        const span  = Math.max(1, eTick - sTick);

        return Math.round(sTick + progress * span);
    }

    /**
     * Find the nearest MIDI track ID based on Y coordinate (viewBox space).
     * Used when dragging comments between tracks.
     *
     * @param {number} y - Y coordinate (viewBox space)
     * @returns {number|null} Nearest MIDI track ID, or null if none found
     */
    coordinatesToTrack(y) {
        if (!this._svgRoot) return null;
        const markers = Array.from(
            this._svgRoot.querySelectorAll('g[data-midi-track-id][data-y]')
        );
        if (markers.length === 0) return null;

        let best = null;
        let bestDist = Infinity;
        for (const m of markers) {
            const my = parseFloat(m.getAttribute('data-y'));
            if (!Number.isFinite(my)) continue;
            const d = Math.abs(y - my);
            if (d < bestDist) { bestDist = d; best = m; }
        }
        if (!best) return null;

        const tid = best.getAttribute('data-midi-track-id');
        if (tid === null || tid === '') return null;
        const n = Number(tid);
        return Number.isFinite(n) ? n : null;
    }

    /**
     * Set the active track source element.
     * The renderer will read the `.value` of this element
     * each time render() is called, and synchronize commentTrackFilter.
     *
     * @param {string|null} selector - CSS selector (e.g., '#track-select').
     *                                 Null disables auto-sync.
     */
    setCommentTrackSource(selector) {
        this._commentTrackSourceSelector = selector || null;
        this._syncTrackFilterFromSource();
        this.renderComments();
    }

    /**
     * Read the value from the track source element
     * and update commentTrackFilter accordingly.
     */
    _syncTrackFilterFromSource() {
        if (!this._commentTrackSourceSelector) return;
        const el = document.querySelector(this._commentTrackSourceSelector);
        if (!el) return;
        const v = el.value;
        this.commentTrackFilter = (v === '' || v === null || v === undefined)
            ? null
            : Number(v);
    }

    /**
     * Render all comments into the SVG overlay.
     * Creates or updates the #comments-overlay group,
     * applies filters (track/user), scales callouts based on screen size,
     * and attaches interaction handlers.
     */
    renderComments() {
        if (!this._svgRoot) return;

        // Siapkan overlay group
        let overlay = this._svgRoot.querySelector('#comments-overlay');
        if (!overlay) {
            overlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            overlay.setAttribute('id', 'comments-overlay');
            this._svgRoot.appendChild(overlay);
        }
        this._commentsOverlay = overlay;
        while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
        overlay.style.display = this.commentsVisible ? '' : 'none';


        

        // Pasang listener "klik area kosong" sekali
        if (!this._commentCreateAttached) {
            this._attachCommentCreateHandler();
            this._commentCreateAttached = true;
        }

        if (!Array.isArray(this.comments) || this.comments.length === 0) return;

        // ---- Filter track & user ----
        const visibleComments = this.comments.filter(c => {
            if (this.commentTrackFilter !== null) {
                const t = c.midiTrackId;
                const isGlobal = (t === null || t === undefined || Number(t) === -1);
                if (!isGlobal && !this.commentTrackFilter.has(Number(t))) {
                    return false;
                }
            }
            if (this.commentUserFilter !== null) {
                if (String(c.author) !== String(this.commentUserFilter)) return false;
            }
            return true;
        });

        if (visibleComments.length === 0) return;

        const offsetX = -21;
        const offsetY = -4;

        // ---- Compute comment scale based on actual on-screen size ----
        const vbW = this._svgRoot.viewBox?.baseVal?.width || 1200;
        
        // Actual rendered width of the SVG in CSS pixels
        const renderedPx = (this.container && this.container.clientWidth)
            || this._svgRoot.getBoundingClientRect().width
            || vbW;
        
        // How many CSS pixels per viewBox unit
        const pxPerUnit = renderedPx / vbW;
        
        // Desired on-screen height of the callout, in CSS pixels.
        // Slightly larger on small screens (touch-friendly).
        const isSmallScreen = (typeof window !== 'undefined') && (window.innerWidth < 601);
        const scl = 0.8;
        const targetHeightPx = isSmallScreen ? 32 * scl : 26 * scl;
        
        // The callout is 4.5 units tall in "comment space".
        // Solve: 4.5 * COMMENT_SCALE * pxPerUnit = targetHeightPx
        // → COMMENT_SCALE = targetHeightPx / (4.5 * pxPerUnit)
        const COMMENT_UNIT_H = 4.5;
        const COMMENT_SCALE = targetHeightPx / (COMMENT_UNIT_H * pxPerUnit);
        
        const COMMENT_BOX_H = COMMENT_UNIT_H * COMMENT_SCALE;
        const COMMENT_GAP   = 1.5;
        const MAX_LEN       = isSmallScreen ? 8 : 12;

        const placedComments = [];
        const sorted = visibleComments.slice().sort((a, b) => (a.tick || 0) - (b.tick || 0));

        for (const comment of sorted) {
            if (comment.tick === null || comment.tick === undefined) continue;

            const coords = this.tickToCoordinates(comment.tick, comment.midiTrackId);
            if (!coords) continue;

            const rawText = String(comment.comment || '');
            const snippet = rawText.length > MAX_LEN
                ? rawText.substring(0, MAX_LEN).trim() + '…'
                : rawText;

            const rectWidth   = Math.max(6, snippet.length * 1.8);
            const xVisual     = coords.x + offsetX;
            const widthVisual = rectWidth * COMMENT_SCALE;

            // Cari Y bebas tabrakan (stack ke atas)
            let currentY = coords.y - 14;
            const MAX_ATTEMPTS = 50;
            let attempts = 0;
            while (attempts++ < MAX_ATTEMPTS) {
                const yTop = currentY + offsetY;
                const yBot = yTop + COMMENT_BOX_H;

                let collision = null;
                for (const p of placedComments) {
                    if (p.systemNumber !== coords.systemNumber) continue;
                    if (xVisual >= p.xVisual + p.widthVisual + COMMENT_GAP) continue;
                    if (xVisual + widthVisual + COMMENT_GAP <= p.xVisual) continue;
                    if (yTop >= p.yBot + COMMENT_GAP) continue;
                    if (yBot + COMMENT_GAP <= p.yTop) continue;
                    if (!collision || p.yTop < collision.yTop) collision = p;
                }
                if (!collision) break;
                currentY = (collision.yTop - offsetY) - COMMENT_BOX_H - COMMENT_GAP;
            }

            placedComments.push({
                systemNumber: coords.systemNumber,
                xVisual,
                widthVisual,
                yTop: currentY + offsetY,
                yBot: currentY + offsetY + COMMENT_BOX_H
            });

            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            icon.setAttribute('class', 'comment-indicator');
            icon.setAttribute('data-comment-id', String(comment.id ?? comment.track_comment_id ?? ''));
            // Tandai komentar milik user saat ini (untuk styling CSS)
            if (this.isMyComment(comment)) icon.classList.add('is-mine');
            icon.style.cursor = (this.commentMode && this.canEditComment(comment)) ? 'pointer' : 'default';
            icon.style.userSelect = 'none';
            icon.setAttribute('transform', `translate(${coords.x + offsetX}, ${currentY + offsetY})`);
            icon.dataset.baseY = currentY.toString();

            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = rawText;
            icon.appendChild(title);

            const scale = COMMENT_SCALE;
            const color = comment.color || '#dc2626';

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', '0');
            rect.setAttribute('y', '0');
            rect.setAttribute('width',  String(rectWidth * scale));
            rect.setAttribute('height', String(4.5 * scale));
            rect.setAttribute('rx',     String(0.5 * scale));
            rect.setAttribute('fill', color);
            icon.appendChild(rect);

            const tail = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            tail.setAttribute(
                'points',
                `${2*scale},${4.0*scale} ${4*scale},${4.0*scale} ${2*scale},${6*scale}`
            );
            tail.setAttribute('fill', color);
            icon.appendChild(tail);

            const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            textEl.setAttribute('x', String(1.5 * scale));
            textEl.setAttribute('y', String(3.1 * scale));
            textEl.setAttribute('font-size', String(2.2 * scale));
            textEl.setAttribute('fill', '#ffffff');
            textEl.setAttribute('font-family', 'sans-serif');
            textEl.textContent = snippet;
            icon.appendChild(textEl);

            this._attachCommentInteraction(icon, comment, coords, offsetX, offsetY);

            overlay.appendChild(icon);
        }
    }

    /**
     * Attach interaction handlers (drag & click) to a comment icon.
     * Enables dragging to reposition comments and clicking to edit.
     *
     * @param {SVGElement} icon - The SVG group element representing the comment
     * @param {Object} comment - Comment object bound to the icon
     * @param {Object} coords - Initial coordinates { x, y, systemNumber, measureNumber, progress }
     * @param {number} offsetX - Horizontal offset applied during rendering
     * @param {number} offsetY - Vertical offset applied during rendering
     */
    _attachCommentInteraction(icon, comment, coords, offsetX, offsetY) {
        const svg = this._svgRoot;
        const self = this;
        const DRAG_THRESHOLD_PX = 3;

        /** Baca translate(x,y) dari atribut transform ikon. */
        const readTranslate = (el) => {
            const s = el.getAttribute('transform') || '';
            const m = /translate\(\s*([-\d.eE+]+)\s*[,\s]\s*([-\d.eE+]+)\s*\)/.exec(s);
            if (!m) return null;
            const x = parseFloat(m[1]);
            const y = parseFloat(m[2]);
            return (Number.isFinite(x) && Number.isFinite(y)) ? { x, y } : null;
        };

        // ---- Drag ----
        const onDragStart = (e) => {
            if (!self.commentMode) return;
            if (!self.canEditComment(comment)) return;
            e.stopPropagation();
            if (e.cancelable) e.preventDefault();

            const startClientX = e.clientX ?? e.touches[0].clientX;
            const startClientY = e.clientY ?? e.touches[0].clientY;

            // Posisi cursor dalam koordinat SVG saat mousedown
            const startPt = svg.createSVGPoint();
            startPt.x = startClientX;
            startPt.y = startClientY;
            const startSvgP = startPt.matrixTransform(svg.getScreenCTM().inverse());

            // Posisi ikon AKTUAL dari DOM (source of truth).
            // Lebih andal daripada menghitung dari `coords`, karena tetap benar
            // walau parent belum rebuild overlay setelah drag sebelumnya.
            const cur = readTranslate(icon) || {
                x: coords.x + offsetX,
                y: coords.y - 14 + offsetY
            };
            const iconX = cur.x;
            const iconY = cur.y;

            // KUNCI: simpan offset cursor terhadap pojok kiri-atas ikon.
            // Inilah yang membuat drag terasa natural — titik yang di-grab
            // tetap berada di bawah cursor selama drag.
            const grabOffsetX = startSvgP.x - iconX;
            const grabOffsetY = startSvgP.y - iconY;

            let hasMoved = false;

            const onMove = (eMove) => {
                const mX = eMove.clientX ?? eMove.touches[0].clientX;
                const mY = eMove.clientY ?? eMove.touches[0].clientY;

                // Threshold kecil agar jitter saat klik tidak dianggap drag
                if (!hasMoved) {
                    const dx0 = mX - startClientX;
                    const dy0 = mY - startClientY;
                    if (dx0 * dx0 + dy0 * dy0 < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
                    hasMoved = true;
                }

                const movePt = svg.createSVGPoint();
                movePt.x = mX;
                movePt.y = mY;
                const moveSvgP = movePt.matrixTransform(svg.getScreenCTM().inverse());

                // Posisi baru ikon = posisi cursor − grab offset.
                // Dengan begitu offset cursor relatif terhadap ikon tetap.
                const newX = moveSvgP.x - grabOffsetX;
                const newY = moveSvgP.y - grabOffsetY;

                icon.setAttribute('transform', `translate(${newX}, ${newY})`);
            };

            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                window.removeEventListener('touchmove', onMove);
                window.removeEventListener('touchend', onUp);

                if (!hasMoved) return;

                window.__commentJustDragged = true;
                setTimeout(() => window.__commentJustDragged = false, 200);

                // Baca transform akhir dari DOM
                const fin = readTranslate(icon) || { x: iconX, y: iconY };

                // Anchor tick (posisi staff Y) dalam viewBox space
                const clickX = fin.x - offsetX;
                const clickY = (fin.y - offsetY) + 14;

                const newTick = self.coordinatesToTick(clickX, clickY);

                // ⬇️ Deteksi track dari posisi Y akhir (bukan dari comment.midiTrackId)
                const newMidiTrackId = self.coordinatesToTrack(clickY);

                if (typeof self.commentCallbacks.onMoveRequest === 'function') {
                    try {
                        self.commentCallbacks.onMoveRequest(comment, newTick, newMidiTrackId);
                    } catch (err) {
                        console.error('[comments] onMoveRequest error:', err);
                        if (typeof self.commentCallbacks.onError === 'function') {
                            self.commentCallbacks.onError(err, 'move', comment);
                        }
                    }
                }
            };

            window.addEventListener('mousemove', onMove, { passive: false });
            window.addEventListener('mouseup', onUp);
            window.addEventListener('touchmove', onMove, { passive: false });
            window.addEventListener('touchend', onUp);
        };

        icon.addEventListener('mousedown', onDragStart);
        icon.addEventListener('touchstart', onDragStart, { passive: false });

        // ---- Click untuk edit ----
        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.__commentJustDragged) return;
            if (!self.commentMode) return;
            if (!self.canEditComment(comment)) return;
            if (typeof self.commentCallbacks.onEditRequest === 'function') {
                try {
                    self.commentCallbacks.onEditRequest(comment, e);
                } catch (err) {
                    console.error('[comments] onEditRequest error:', err);
                    if (typeof self.commentCallbacks.onError === 'function') {
                        self.commentCallbacks.onError(err, 'edit', comment);
                    }
                }
            }
        });
    }

    /**
     * Attach a handler for creating new comments by clicking on empty space.
     * Converts click coordinates into a MIDI tick and invokes onCreateRequest callback.
     */
    _attachCommentCreateHandler() {
        const svg = this._svgRoot;
        const self = this;

        svg.addEventListener('click', (e) => {
            if (!self.commentMode) return;
            if (window.__commentJustDragged) return;
            // Klik pada komentar sudah di-stopPropagation oleh handler di atas

            const pt = svg.createSVGPoint();
            pt.x = e.clientX;
            pt.y = e.clientY;
            const v = pt.matrixTransform(svg.getScreenCTM().inverse());

            const tick = self.coordinatesToTick(v.x, v.y);

            if (typeof self.commentCallbacks.onCreateRequest === 'function') {
                try {
                    // Kirim juga track yang sedang difilter, agar caller tahu
                    // komentar baru ditujukan untuk track mana.
                    self.commentCallbacks.onCreateRequest(
                        tick,
                        self.commentTrackFilter,
                        e.clientX,
                        e.clientY
                    );
                } catch (err) {
                    console.error('[comments] onCreateRequest error:', err);
                    if (typeof self.commentCallbacks.onError === 'function') {
                        self.commentCallbacks.onError(err, 'create');
                    }
                }
            }
        });
    }

    /**
     * Refresh cursor style and "is-mine" class for each comment icon
     * without rebuilding the overlay. Used after setCommentMode or setCommentAuthor.
     */
    _refreshCommentCursors() {
        if (!this._commentsOverlay) return;
        const icons = this._commentsOverlay.querySelectorAll('.comment-indicator');
        icons.forEach(icon => {
            const id = icon.getAttribute('data-comment-id');
            const c = this.comments.find(x => String(x.id ?? x.track_comment_id) === id);
            if (!c) return;

            // Cursor
            const editable = this.commentMode && this.canEditComment(c);
            icon.style.cursor = editable ? 'pointer' : 'default';

            // Tandai milik sendiri
            if (this.isMyComment(c)) icon.classList.add('is-mine');
            else icon.classList.remove('is-mine');
        });
    }

    // ============================================================
    // INDIVIDUAL CALLBACK SETTERS
    // ============================================================

    /**
     * Set the callback for creating a new comment.
     * Signature: (tick, midiTrackId, clientX, clientY) => void
     *
     * @param {Function|null} fn - Callback function or null
     * @returns {this} For chaining
     */
    setOnCreateRequest(fn) {
        this.commentCallbacks.onCreateRequest = (typeof fn === 'function') ? fn : null;
        return this;
    }

    /**
     * Set the callback for editing a comment.
     * Signature: (comment, event) => void
     *
     * @param {Function|null} fn - Callback function or null
     * @returns {this} For chaining
     */
    setOnEditRequest(fn) {
        this.commentCallbacks.onEditRequest = (typeof fn === 'function') ? fn : null;
        return this;
    }

    /**
     * Set the callback for moving a comment.
     * Signature: (comment, newTick) => void
     *
     * @param {Function|null} fn - Callback function or null
     * @returns {this} For chaining
     */
    setOnMoveRequest(fn) {
        this.commentCallbacks.onMoveRequest = (typeof fn === 'function') ? fn : null;
        return this;
    }

    /**
     * Set the callback for handling comment errors.
     * Signature: (err, action, comment?) => void
     *
     * @param {Function|null} fn - Callback function or null
     * @returns {this} For chaining
     */
    setOnCommentError(fn) {
        this.commentCallbacks.onError = (typeof fn === 'function') ? fn : null;
        return this;
    }

    /**
     * Set the callback for determining edit permissions.
     * Signature: (comment, currentAuthor) => boolean
     *
     * @param {Function|null} fn - Callback function or null
     * @returns {this} For chaining
     */
    setCanEditComment(fn) {
        this.commentCallbacks.canEdit = (typeof fn === 'function') ? fn : null;
        return this;
    }

    /**
     * Analyze pitch distribution for each staff, then choose the most suitable clef
     * (G/F/C) and apply it to the staffState.
     *
     * @param {Array<Object>} partStaffMap - Staff information per part
     * @param {Array<Map>} partMeasureMap - Map of measure number → measure node
     * @param {Object} staffState - Staff state object to be modified
     */
    applyAutoClefToStaffState(partStaffMap, partMeasureMap, staffState) {
        const stats = this.analyzeStaffPitchRanges(partStaffMap, partMeasureMap);

        for (let s = 1; s <= Object.keys(staffState).length; s++) {
            const stat = stats[s];
            if (!stat || !stat.hasNotes) continue;

            const pInfo = partStaffMap.find(p => s >= p.startStaffId && s < p.startStaffId + p.numStaves);
            if (!pInfo) continue;
            const localStaff = s - pInfo.startStaffId + 1;
            const originalClef = this.getInitialClefFromXml(pInfo, localStaff);

            const chosen = this.pickClefForRange(stat, originalClef);
            staffState[s].clef = chosen;
            staffState[s]._clefAutoApplied = true;

            if (this.debugAutoClef) {
                console.log(
                    `[AutoClef] staff ${s}: ` +
                    `avgDiatonic=${stat.avgDiatonic.toFixed(2)}, ` +
                    `min=${stat.minDiatonic}, max=${stat.maxDiatonic}, ` +
                    `original=${originalClef} → chosen=${chosen}`
                );
            }
        }
    }

    /**
     * Collect pitch statistics (min, max, duration-weighted average)
     * for each staff across all parts.
     *
     * @param {Array<Object>} partStaffMap - Staff information per part
     * @param {Array<Map>} partMeasureMap - Map of measure number → measure node
     * @returns {Object} Map of staffId → {
     *   minDiatonic: number,
     *   maxDiatonic: number,
     *   avgDiatonic: number,
     *   hasNotes: boolean,
     *   noteCount: number
     * }
     */
    analyzeStaffPitchRanges(partStaffMap, partMeasureMap) {
        const result = {};

        partStaffMap.forEach(pInfo => {
            for (let s = 0; s < pInfo.numStaves; s++) {
                const staffId = pInfo.startStaffId + s;
                const localStaff = s + 1;

                let minD = Infinity;
                let maxD = -Infinity;
                let totalWeighted = 0;
                let totalWeight = 0;
                let noteCount = 0;

                for (const mNode of partMeasureMap[pInfo.partIndex].values()) {
                    mNode.querySelectorAll("note").forEach(noteNode => {
                        if (noteNode.querySelector("rest")) return;

                        const noteStaff = parseInt(noteNode.querySelector("staff")?.textContent || "1", 10);
                        if (noteStaff !== localStaff) return;

                        const step = noteNode.querySelector("pitch step")?.textContent;
                        if (!step) return;

                        const octave = parseInt(noteNode.querySelector("pitch octave")?.textContent || "4", 10);
                        const diatonic = this.getDiatonicIndex(step, octave);
                        const dur = parseInt(noteNode.querySelector("duration")?.textContent || "0", 10);
                        const weight = Math.max(1, dur);

                        if (diatonic < minD) minD = diatonic;
                        if (diatonic > maxD) maxD = diatonic;
                        totalWeighted += diatonic * weight;
                        totalWeight += weight;
                        noteCount++;
                    });
                }

                result[staffId] = {
                    minDiatonic: minD,
                    maxDiatonic: maxD,
                    avgDiatonic: totalWeight > 0 ? totalWeighted / totalWeight : 0,
                    hasNotes: noteCount > 0,
                    noteCount: noteCount
                };
            }
        });

        return result;
    }

    /**
     * Choose the most appropriate clef based on how far the pitch range
     * extends beyond the original clef’s staff range. Only swap clefs if
     * there is significant overflow, so conventional instrument clefs
     * (e.g., violin → treble, cello → bass) are not changed without strong reason.
     *
     * Staff ranges (diatonic indices):
     *   G (treble): E4=2 .. F5=10
     *   C (alto)  : F3=-4 .. G4=4
     *   F (bass)  : G2=-10 .. A3=-2
     *
     * @param {Object} stat - Pitch statistics for the staff:
     *   { minDiatonic, maxDiatonic, avgDiatonic }
     * @param {string} originalClef - Initial clef from XML ("G" | "F" | "C")
     * @returns {string} Selected clef ("G" | "F" | "C")
     */
    pickClefForRange(stat, originalClef) {
        const { minDiatonic, maxDiatonic } = stat;
        const current = originalClef || "G";

        // Rentang nyaman tiap clef (5 garis staff).
        const staffRange = {
            G: { min:  0, max: 12 }, // C4 .. A5 (allow 1 ledger line each side)
            C: { min: -6, max:  6 }, // D3 .. B4
            F: { min: -12, max: 0 }  // C2 .. C4
        };

        // Berapa banyak "overflow" di luar staff clef sekarang.
        const range = staffRange[current] || staffRange.G;
        const overflowBelow = Math.max(0, range.min - minDiatonic);
        const overflowAbove = Math.max(0, maxDiatonic - range.max);

        // Ambang minimal: butuh overflow setara ~4 langkah diatonic (≈ 1 oktaf)
        // sebelum kita menganggap clef asli sudah tidak layak.
        const MIN_OVERFLOW = 4;

        // Kalau masih muat di clef asli, jangan ubah sama sekali.
        if (overflowBelow < MIN_OVERFLOW && overflowAbove < MIN_OVERFLOW) {
            return current;
        }

        // Kalau lebih banyak overflow ke bawah → pilih clef yang lebih rendah.
        if (overflowBelow > overflowAbove) {
            if (current === "G") return "F"; // treble → bass
            if (current === "C") return "F"; // alto   → bass
            return current;                   // bass sudah paling rendah, biarkan
        }

        // Kalau lebih banyak overflow ke atas → pilih clef yang lebih tinggi.
        if (overflowAbove > overflowBelow) {
            if (current === "F") return "G"; // bass → treble
            if (current === "C") return "G"; // alto → treble
            return current;                   // treble sudah paling tinggi, biarkan
        }

        return current;
    }

    /**
     * Read the initial clef from XML for a given staff.
     * Useful for deciding clef transitions.
     *
     * @param {Object} pInfo - Part information object
     * @param {number} localStaff - Local staff number within the part (1-based)
     * @returns {string} Initial clef ("G" | "F" | "C"), defaults to "G"
     */
    getInitialClefFromXml(pInfo, localStaff) {
        const firstMeasure = pInfo.partNode.querySelector("measure");
        if (!firstMeasure) return "G";

        const clefs = firstMeasure.querySelectorAll("attributes clef");
        for (const c of clefs) {
            const num = parseInt(c.getAttribute("number") || "1", 10);
            if (num === localStaff) {
                const sign = c.querySelector("sign")?.textContent;
                if (sign) return sign;
            }
        }
        return "G";
    }
    
    /**
     * Draw 5 Horizontal Staff Lines
     */
    drawStaffLines(x, y, width) {
        for (let i = 0; i < 5; i++) {
            const lineY = y + i * this.lineSpacing;
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", x);
            line.setAttribute("y1", lineY);
            line.setAttribute("x2", x + width);
            line.setAttribute("y2", lineY);
            line.setAttribute("stroke", this.staffLineColor);
            line.setAttribute("stroke-width", `${0.95 * this.zoom}`);
            this.svg.appendChild(line);
        }

        // === BARU: simpan batas kiri/kanan sistem untuk tie antar-sistem ===
        this.currentSystemLeftX  = x;
        this.currentSystemRightX = x + width;
    }

    /**
     * Draws the thick vertical line at the beginning of a system that connects all staves.
     * @param {number} x - The X coordinate for the line.
     * @param {number} y - The starting Y coordinate (top of the system).
     * @param {number} totalSystemHeight - The total height of all staves in the system.
     */
    drawSystemStartLine(x, y, totalSystemHeight) {
        const scale = this.zoom || 1.0;
        const topY = y;
        const bottomY = y + totalSystemHeight;

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", x);
        line.setAttribute("y1", topY);
        line.setAttribute("x2", x);
        line.setAttribute("y2", bottomY);
        line.setAttribute("stroke", this.engraverColor);
        line.setAttribute("stroke-width", `${1.8 * scale}`);
        this.svg.appendChild(line);
    }

    /**
     * Draws a simplified curly brace for a grand staff (e.g., piano).
     * @param {number} x - The X coordinate for the brace.
     * @param {number} topY - The Y coordinate of the top of the brace.
     * @param {number} bottomY - The Y coordinate of the bottom of the brace.
     */
    drawGrandStaffBrace(x, topY, bottomY) {
        const scale = this.zoom || 1.0;
        const height = bottomY - topY;
        const midY = topY + height / 2;
        const depth = 12 * scale;

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

        const d = `M ${x} ${topY} 
            C ${x - depth * 0.8} ${topY + height * 0.1}, ${x - depth * 0.8} ${midY - height * 0.1}, ${x - depth} ${midY} 
            C ${x - depth * 0.8} ${midY + height * 0.1}, ${x - depth * 0.8} ${bottomY - height * 0.1}, ${x} ${bottomY} 
            C ${x - depth * 0.6} ${bottomY - height * 0.05}, ${x - depth * 0.6} ${midY + height * 0.05}, ${x - depth * 0.9} ${midY} 
            C ${x - depth * 0.6} ${midY - height * 0.05}, ${x - depth * 0.6} ${topY + height * 0.05}, ${x} ${topY} Z`;

        path.setAttribute("d", d);
        path.setAttribute("fill", this.engraverColor);
        this.svg.appendChild(path);
    }


    /**
     * Draws a vertical bar line, including a thick final barline if specified.
     * @param {number} x - The X coordinate for the barline.
     * @param {number} y - The starting Y coordinate.
     * @param {boolean} isFinalEnd - If true, draws a thick final barline.
     * @param {number} totalSystemHeight - The height of the barline.
     */
    drawBarLine(x, y, isFinalEnd, totalSystemHeight) {
        const scale = this.zoom || 1.0;
        const topY = y;
        const bottomY = y + totalSystemHeight;

        if (isFinalEnd) {
            const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line1.setAttribute("x1", x - 5 * scale);
            line1.setAttribute("y1", topY);
            line1.setAttribute("x2", x - 5 * scale);
            line1.setAttribute("y2", bottomY);
            line1.setAttribute("stroke", this.engraverColor);
            line1.setAttribute("stroke-width", `${1.1 * scale}`);
            this.svg.appendChild(line1);

            const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line2.setAttribute("x1", x);
            line2.setAttribute("y1", topY);
            line2.setAttribute("x2", x);
            line2.setAttribute("y2", bottomY);
            line2.setAttribute("stroke", this.engraverColor);
            line2.setAttribute("stroke-width", `${3.5 * scale}`);
            this.svg.appendChild(line2);
        } else {
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", x);
            line.setAttribute("y1", topY);
            line.setAttribute("x2", x);
            line.setAttribute("y2", bottomY);
            line.setAttribute("stroke", this.staffLineColor);
            line.setAttribute("stroke-width", `${1.2 * scale}`);
            this.svg.appendChild(line);
        }
    }

    /** 
     * Draws the appropriate clef symbol based on the sign.
     * @param {string} clefSign - The clef sign ('G', 'F', or 'C').
     * @param {number} x - The X coordinate.
     * @param {number} y - The Y coordinate of the top staff line.
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
     * Draws a G-clef (Treble) symbol.
     * @param {number} x - The X coordinate.
     * @param {number} y - The Y coordinate of the top staff line.
     */
    drawTrebleClef(x, y) {
        const scale = this.zoom || 1.0;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const pathData = "M165 177q-24 30-26 60-2 34 19 64 23 32 57 34h21l4 23q3 15 2 26-1 15-9 24-9 10-23 9-6 0-11-3l10-5q9-7 10-19 0-12-6-21-8-9-20-10t-22 9q-7 10-9 22-1 19 14 31 13 11 31 12a52 52 0 0 0 34-9q17-13 18-31 1-15-2-34l-4-29q17-5 28-20 12-15 13-36 3-25-12-46a51 51 0 0 0-46-23l-5-36q20-16 32-42 12-24 14-53 0-17-5-41-7-31-22-33-6 0-12 6a89 89 0 0 0-25 37 167 167 0 0 0-3 89q-31 29-45 45m98 97c0 12-5 31-13 36l-9-63q21 6 22 27m-41-169q1-18 9-37 10-22 16-22h3c5 0 10 2 9 15q-1 17-13 35-10 15-22 25-3-7-2-16m-6 76 3 27q-14 6-23 18-12 13-13 30-1 18 8 31 4 7 12 13c7 5 16 5 18 2q0-4-8-15-4-5-4-13 1-18 16-25l9 70-16 1q-22-2-39-19a48 48 0 0 1-16-38q3-42 53-82";
        x = x - (16 * scale);
        y = y + (6 * scale);
        const tx = x - 10 * scale;
        const ty = y - 28 * scale;
        const sx = 0.2075 * scale * 0.8;
        const sy = 0.2075 * scale * 0.8;

        path.setAttribute("d", pathData);
        path.setAttribute("transform", `translate(${tx}, ${ty}) scale(${sx}, ${sy})`);
        path.setAttribute("fill", this.engraverColor);
        this.svg.appendChild(path);
    }

    /**
     * Draws an F-clef (Bass) symbol with its two dots.
     * @param {number} x - The X coordinate.
     * @param {number} y - The Y coordinate of the top staff line.
     */
    drawBassClef(x, y) {
        const scale = this.zoom || 1.0;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const pathData = "M205 23c-67 0-107 39-118 77-11 39 3 77 17 98h1a64 64 0 0 0 52 26 64 64 0 0 0 64-64 64 64 0 0 0-64-64 64 64 0 0 0-50 24l3-18c10-33 34-61 95-61 60 0 94 64 92 153-1 80-12 128-60 171q-72 65-180 107c-13 5-1 19 7 16 73-28 145-53 196-98 51-46 96-87 96-198 1-97-44-169-151-169";
        x = x - (11 * scale);
        const tx = x + (2.5 * scale);
        const ty = y - 1.5 * scale;
        const sx = 0.09 * scale;
        const sy = 0.09 * scale;

        path.setAttribute("d", pathData);
        path.setAttribute("transform", `translate(${tx}, ${ty}) scale(${sx}, ${sy})`);
        path.setAttribute("fill", this.engraverColor);
        this.svg.appendChild(path);

        // Double dots around line 4
        x = x + (22 * scale);
        y = y - (5 * scale);
        const dotX = x + (18.5 * scale);
        const r = 1.5 * scale;
        this.drawCircle(dotX, y + (1 * this.lineSpacing), r, this.engraverColor); // FIX: Position relative to staff lines
        this.drawCircle(dotX, y + (2 * this.lineSpacing), r, this.engraverColor); // FIX: Position relative to staff lines
    }

    /**
     * Draws a C-clef (Alto/Tenor) symbol.
     * @param {number} x - The X coordinate.
     * @param {number} y - The Y coordinate of the top staff line.
     */
    drawAltoClef(x, y) {
        const scale = this.zoom || 1.0;
        const staffHeight = 4 * this.lineSpacing; // Total height of the 5-line staff
        const nativeClefHeight = 2362; // Native height of the PHP SVG path data (from Y=0 to Y=2362)
        const nativeClefWidth = 1532; // Native width of the PHP SVG path data (from X=0 to X=1532)

        const clefScale = staffHeight / nativeClefHeight * scale;

        // The complex path data from the PHP example, which is based on Wikimedia source.
        // This path defines the entire shape, including inner cutouts, using winding rules.
        const pathData = "M0 2362L0 56L0 5L266 5L266 2311L266 2362L0 2362zM400 2362L400 56L400 5L485 5L485 1160C527 1138 570 1093 612 1022C655 952 691 878 719 799C747 720 762 662 764 624C777 708 798 775 826 826C855 876 886 912 922 934C958 955 993 966 1029 966C1118 955 1174 915 1198 834C1222 764 1234 665 1234 548C1234 495 1233 447 1230 405C1227 363 1221 320 1210 277C1200 234 1183 195 1159 161C1134 127 1102 103 1062 91C1026 81 990 76 955 76C923 76 896 82 875 93C853 104 841 121 839 141C844 159 856 180 877 205C898 229 912 248 920 260C928 272 932 289 932 312C932 353 918 387 890 415C862 443 825 458 778 458C732 458 694 441 666 408C638 374 623 334 621 289C625 228 647 175 686 131C726 88 775 55 834 33C893 11 952 0 1012 0C1080 0 1145 12 1207 36C1270 60 1326 96 1374 142C1423 189 1462 246 1490 314C1518 381 1532 458 1532 543C1532 661 1510 759 1467 836C1423 914 1367 972 1299 1008C1230 1044 1157 1064 1080 1066C1000 1061 933 1043 880 1012L774 1184L880 1355C953 1325 1025 1310 1095 1310C1184 1310 1261 1336 1328 1386C1394 1437 1445 1502 1480 1583C1514 1664 1532 1747 1532 1833C1532 1927 1511 2015 1469 2096C1427 2177 1368 2241 1292 2290C1215 2338 1128 2362 1029 2362C914 2357 818 2330 741 2280C664 2231 626 2157 626 2060C630 2013 647 1977 677 1950C707 1922 739 1908 774 1905C816 1905 854 1920 887 1950C920 1979 937 2016 937 2060C937 2077 933 2093 925 2108C917 2122 906 2139 890 2159C874 2178 863 2192 857 2201C851 2211 846 2222 844 2236C844 2254 855 2269 878 2281C900 2293 929 2300 964 2303C1074 2298 1147 2251 1184 2164C1220 2075 1238 1966 1238 1833C1238 1718 1225 1617 1199 1531C1173 1444 1117 1401 1029 1401C951 1401 891 1434 849 1502C807 1569 780 1648 768 1739C755 1662 735 1588 706 1517C677 1445 644 1382 605 1328C568 1275 527 1232 485 1202L485 2362L400 2362z";

        const pathElement = document.createElementNS("http://www.w3.org/2000/svg", "path");

        // Calculate translation to center the clef vertically on the middle staff line.
        // The 'y' parameter is the top line of the staff.
        // The middle staff line is at y + 2 * this.lineSpacing.
        // The native vertical center of the clef path (from Y=0 to Y=2362) is 2362 / 2 = 1181.
        const ty = (y + 2 * this.lineSpacing) - (nativeClefHeight / 2 * clefScale);

        // The PHP code applies a small horizontal offset of +1.0 to the x coordinate.
        // We apply this offset after scaling, relative to the 'x' parameter.
        const tx = x + (1.0 * clefScale);

        pathElement.setAttribute("d", pathData);
        pathElement.setAttribute("transform", `translate(${tx}, ${ty}) scale(${clefScale})`);
        pathElement.setAttribute("fill", this.engraverColor);
        this.svg.appendChild(pathElement);
    }

    /**
     * Draws a filled circle.
     * @param {number} cx - The center X coordinate.
     * @param {number} cy - The center Y coordinate.
     * @param {number} r - The radius.
     * @param {string} color - The fill color.
     */
    drawCircle(cx, cy, r, color) {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", cx);
        circle.setAttribute("cy", cy);
        circle.setAttribute("r", r);
        circle.setAttribute("fill", color);
        this.svg.appendChild(circle);
    }

    /**
     * Draws a time signature (e.g., 4/4, C, ¢).
     * @param {number} x - The X coordinate.
     * @param {number} y - The Y coordinate of the top staff line.
     * @param {number} beats - The numerator of the time signature.
     * @param {number} beatType - The denominator of the time signature.
     * @param {string|null} [symbol=null] - Optional symbol ('common' or 'cut').
     */
    drawTimeSignature(x, y, beats, beatType, symbol = null) {
        const scale = this.zoom || 1.0;

        if (symbol === "common" || (beats === 4 && beatType === 4 && symbol === "C")) {
            this.drawText(x, y + 24 * scale, "C", `${Math.round(24 * scale)}px`, this.engraverColor, "middle", true, "'Outfit', 'Times New Roman', serif");
        } else if (symbol === "cut") {
            this.drawText(x, y + 2 * this.lineSpacing, "¢", `${Math.round(24 * scale)}px`, this.engraverColor, "middle", true, "'Outfit', 'Times New Roman', serif");
        } else {
            const topY = y + 1.5 * this.lineSpacing; // FIX: Position relative to staff lines
            const bottomY = y + 3.5 * this.lineSpacing; // FIX: Position relative to staff lines
            const size = `${Math.round(18 * scale)}px`;

            this.drawText(x, topY, `${beats}`, size, this.engraverColor, "middle", true, "'Outfit', 'Times New Roman', serif"); // Centered on space 1
            this.drawText(x, bottomY, `${beatType}`, size, this.engraverColor, "middle", true, "'Outfit', 'Times New Roman', serif"); // Centered on space 3
        }
    }

    /**
     * Draws the key signature (sharps or flats).
     * @param {number} x - The starting X coordinate for the signature.
     * @param {number} y - The Y coordinate of the top staff line.
     * @param {number} fifths - The number of sharps (positive) or flats (negative).
     * @param {string} clefType - The current clef type ('G', 'F', 'C').
     */
    drawKeySignature(x, y, fifths, clefType) {
        if (!fifths || fifths === 0) return 0;

        const scale = this.zoom || 1.0;
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
            const symX = x + i * 8.5 * scale;
            if (fifths > 0) {
                this.drawSharp(symX, symY);
            } else {
                this.drawFlat(symX, symY);
            }
        }

        return count * 9 * scale;
    }

    /**
     * Draws a sharp (♯) symbol.
     * @param {number} x - The X coordinate.
     * @param {number} y - The Y coordinate.
     */
    drawSharp(x, y) {
        const scale = this.zoom || 1.0;
        const paths = [
            "M1.2 0 L1.6 0 L1.6 10 L1.2 10 Z",
            "M3.0 0 L3.4 0 L3.4 10 L3.0 10 Z",
            "M0 3.5 L5 2.5 L5 3.0 L0 4.0 Z",
            "M0 6.5 L5 5.5 L5 6.0 L0 7.0 Z"
        ];
        const tx = x - 1 * scale;
        const ty = y - 8.5 * scale;
        const sx = 2.25 * scale * 0.8;
        const sy = 2.25 * scale * 0.8;

        paths.forEach(d => {
            const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
            p.setAttribute("d", d);
            p.setAttribute("transform", `translate(${tx}, ${ty}) scale(${sx}, ${sy})`);
            p.setAttribute("fill", this.engraverColor);
            p.classList.add("accidental-symbol");
            this.svg.appendChild(p);
        });
    }

    /**
     * Draws a flat (♭) symbol.
     * @param {number} x - The X coordinate.
     * @param {number} y - The Y coordinate.
     */
    drawFlat(x, y) {
        const scale = this.zoom || 1.0;
        const d = "M 1.2 0 L 1.6 0 L 1.6 9 C 4.8 9 4.8 18 1.6 18 L 1.2 18 Z";
        const tx = x - 3.15 * scale;
        const ty = y - 30.35 * scale;
        const sx = 2.25 * scale;
        const sy = 2.25 * scale;

        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", d);
        p.setAttribute("transform", `translate(${tx}, ${ty}) scale(${sx}, ${sy})`);
        p.setAttribute("fill", this.engraverColor);
        p.classList.add("accidental-symbol");
        this.svg.appendChild(p);
    }

    /**
     * Draws a natural (♮) symbol.
     * @param {number} x - The X coordinate.
     * @param {number} y - The Y coordinate.
     */
    drawNatural(x, y) {
        const scale = this.zoom || 1.0;
        const d = "M 1 0 L 1.4 0 L 1.4 10 L 1 10 Z M 3 0 L 3.4 0 L 3.4 10 L 3 10 Z M 1 3 L 3.4 3 L 3.4 3.5 L 1 3.5 Z M 1 6.5 L 3.4 6.5 L 3.4 7 L 1 7 Z";
        const tx = x - 4.5 * scale;
        const ty = y - 10.5 * scale;
        const sx = 2.25 * scale;
        const sy = 2.25 * scale;

        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", d);
        p.setAttribute("transform", `translate(${tx}, ${ty}) scale(${sx}, ${sy})`);
        p.setAttribute("fill", this.engraverColor);
        p.classList.add("accidental-symbol");
        this.svg.appendChild(p);
    }

    /**
     * Renders a full column of notes, which may be a single note or a chord.
     * @param {number} x - The X coordinate for the column.
     * @param {number} y - The Y coordinate of the top staff line.
     * @param {Object[]} notes - An array of note data objects for this column.
     * @param {string} clefType - The current clef type.
     * @param {Object} activeTies - An object tracking active ties.
     * @param {number} [channelId=-1] - The MIDI channel ID, used for special drum noteheads.
     */
    drawNoteColumn(x, y, notes, clefType, activeTies, channelId) {
        const scale = this.zoom || 1.0;
        let hasRest = false;
        let tiePath = null;
        let restType = "quarter";

        const rests = notes.filter(n => n.isRest);
        if (rests.length > 0) {
            hasRest = true;
            restType = rests[0].type;
        }

        if (hasRest) {
            const restGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
            const note = rests[0]; // Assuming all rests in a column have the same timing
            const minTick = this._cumulativeTick + note.onsetDiv;
            const maxTick = minTick + note.duration;
            restGroup.setAttribute("data-start-tick", minTick);
            restGroup.setAttribute("data-end-tick", maxTick);
            restGroup.classList.add("music-notation");

            // Temporarily set the group as the drawing target
            const originalSvg = this.svg;
            this.svg = restGroup;
            const restSymbolElement = this.drawRestSymbol(x, y, restType, this.engraverColor); // Draw the rest symbol first
            if (note.dots > 0 && restSymbolElement) { // Check if there are dots to draw
                for (let i = 0; i < note.dots; i++) {
                    const dotX = restSymbolElement.x + restSymbolElement.width + (4 * scale) + (i * 8 * scale); // Adjust X for each dot
                    this.drawDot(dotX, restSymbolElement.y, this.engraverColor);
                }
            }
            // **FIX**: Draw lyric if it's attached to a rest
            if (note.lyric) {
                this.drawText(x, y + (this.liricYOffset * scale), note.lyric, `${Math.round(this.lyricFontSize * scale)}px`, "#1e293b", "middle", false, this.lyricFontFamily);
            }
            
            this.svg = originalSvg; // Restore original target
            this.svg.appendChild(restGroup); // Add the complete group to the measure
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

        // Ambang batas default per clef. Nilainya sengaja dibuat lebih rendah dari
        // garis tengah staff supaya stem otomatis mengarah ke bawah lebih awal —
        // tanpa harus menunggu munculnya ledger line di atas staff.
        let defaultThreshold;
        if (clefType === "F") {
            defaultThreshold = -4; // F3, satu langkah di bawah garis tengah bass (D3)
        } else if (clefType === "C") {
            defaultThreshold = 0;  // C4, tepat di garis tengah alto
        } else {
            defaultThreshold = 4;  // G4, dua langkah di bawah garis tengah treble (B4)
        }

        const threshold = (this.stemDirectionThreshold !== null && this.stemDirectionThreshold !== undefined)
            ? this.stemDirectionThreshold
            : defaultThreshold;

        const stemDown = avgDiatonic >= threshold;

        // Create a group for the entire note/chord column
        const noteGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const firstNote = calculatedNotes[0];
        const minTick = this._cumulativeTick + firstNote.onsetDiv;
        const maxTick = minTick + firstNote.duration;
        noteGroup.setAttribute("data-start-tick", minTick);
        noteGroup.setAttribute("data-end-tick", maxTick);
        noteGroup.classList.add("music-notation");

        // Temporarily set the group as the drawing target
        const originalSvg = this.svg;
        this.svg = noteGroup;

        // FIX: Langkah 1 - Gambar semua garis bantu (ledger lines) terlebih dahulu.
        // Dengan menggambar garis bantu sebelum kepala not, kita memastikan
        // kepala not (termasuk highlight-nya) akan selalu berada di lapisan atas.
        calculatedNotes.forEach(note => {
            this.drawLedgerLines(x, y, note.diatonic, clefType);
        });

        // Langkah 2 - Gambar semua elemen not lainnya (kepala not, lirik, dll.)
        calculatedNotes.forEach(note => {
            const color = this.colorCoded ? (this.pitchColors[note.step] || this.engraverColor) : this.engraverColor;
            const isHollow = note.type === "whole" || note.type === "half";

            this.drawNotehead(x, note.y, color, isHollow, note.notehead, channelId);
            // Educational letter label inside notehead (only if colorCoded is enabled)
            if (this.colorCoded) {
                this.drawText(x, note.y + 3 * scale, note.step || "", `${Math.round(8 * scale)}px`, isHollow ? this.engraverColor : "#ffffff", "middle", true);
            }

            // Draw dot for dotted notes
            if (note.dots > 0) { // Check if there are dots to draw
                for (let i = 0; i < note.dots; i++) {
                    this.drawDot(x + 10 * scale + (i * 8 * scale), note.y, color); // Adjust X for each dot
                }
            }

            // Accidentals
            if (note.accidental === "natural") {
                this.drawNatural(x - 14 * scale, note.y);
            } else if (note.alter !== 0) {
                if (note.alter === 1) {
                    this.drawSharp(x - 14 * scale, note.y);
                } else if (note.alter === -1) {
                    this.drawFlat(x - 14 * scale, note.y);
                } else if (note.alter === 0) {
                    this.drawNatural(x - 14 * scale, note.y);
                }
            }

            // Articulations (Staccato dot, Accent, Tenuto, Fermata)
            if (note.articulations) {
                const artY = stemDown ? lowestNote.y - 12 * scale : highestNote.y + 12 * scale;
                if (note.articulations.staccato) {
                    this.drawCircle(x, artY, 2 * scale, this.engraverColor);
                }
                if (note.articulations.accent) {
                    this.drawText(x, artY, ">", `${Math.round(14 * scale)}px`, this.engraverColor, "middle", true);
                }
                if (note.articulations.fermata) {
                    this.drawText(x, y - 18 * scale, "𝄐", `${Math.round(16 * scale)}px`, this.engraverColor, "middle", true);
                }
            }

            // Lyric Text
            if (note.lyric) {
                this.drawText(x, y + (this.liricYOffset * scale), note.lyric, `${Math.round(this.lyricFontSize * scale)}px`, "#1e293b", "middle", false, this.lyricFontFamily);
            }

            // Slurs / Ties Bezier Arcs
            const { tieStart, tieStop } = note; // Use pre-calculated tie flags from the noteData object
            const pitchKey = `${note.step}${note.alter}${note.octave}${note.staff}`;

            if (tieStop && activeTies[pitchKey]) {
                const prev = activeTies[pitchKey];
                const yOffset = (stemDown ? -8 : 8) * scale;
                const sy1 = prev.y + yOffset;
                const sy2 = note.y + yOffset;

                // System boundary check (x <= prev.x or Y distance > 50*scale)
                const isCrossSystem = (x <= prev.x) || (Math.abs(prev.y - note.y) > 50 * scale);

                // Tinggi lengkungan tie: minimum 8px, maksimum 22px, proporsional dengan jarak
                const span = Math.abs(x - prev.x);
                const curveHeight = Math.min(22, Math.max(8, span * 0.35)) * scale;
                const thickness = 3.3 * scale;

                // ==============================================================
                // Rentang tick untuk highlight tie (dari note awal ke note akhir)
                // ==============================================================
                const noteStartTick = this._cumulativeTick + note.onsetDiv;
                const noteEndTick   = noteStartTick + note.duration;
                const tieStartTick  = (prev.startTick !== undefined) ? prev.startTick : noteStartTick;
                const tieEndTick    = noteEndTick;

                if (isCrossSystem) {
                    // ==============================================================
                    // Segmen 1: berakhir TEPAT di garis birama kanan sistem lama
                    // ==============================================================
                    const systemRightX = this.currentSystemRightX ?? (prev.x + 22 * scale);
                    const endX1 = systemRightX;

                    const cx1 = (prev.x + endX1) / 2;
                    const cy1 = sy1 + (stemDown ? -curveHeight : curveHeight);

                    const path1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
                    const d1 = `M ${prev.x} ${sy1} Q ${cx1} ${cy1} ${endX1} ${sy1} ` +
                            `Q ${cx1} ${cy1 - (stemDown ? -thickness : thickness)} ${prev.x} ${sy1} Z`;
                    path1.setAttribute("d", d1);
                    path1.setAttribute("fill", this.engraverColor);
                    path1.classList.add("tie-curve");
                    path1.setAttribute("data-start-tick", tieStartTick);
                    path1.setAttribute("data-end-tick",   tieEndTick);

                    // ==== PERBAIKAN: append ke system group MILIK NOTE AWAL ====
                    const targetSystem1 = prev.systemGroup || this.svg;
                    targetSystem1.appendChild(path1);

                    // ==============================================================
                    // Segmen 2: dimulai TEPAT di garis birama kiri sistem baru
                    // ==============================================================
                    const systemLeftX = this.currentSystemLeftX ?? (x - 40 * scale);
                    const startX2 = systemLeftX;

                    const cx2 = (startX2 + x) / 2;
                    const cy2 = sy2 + (stemDown ? -curveHeight : curveHeight);

                    const path2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
                    const d2 = `M ${startX2} ${sy2} Q ${cx2} ${cy2} ${x} ${sy2} ` +
                            `Q ${cx2} ${cy2 - (stemDown ? -thickness : thickness)} ${startX2} ${sy2} Z`;
                    path2.setAttribute("d", d2);
                    path2.setAttribute("fill", this.engraverColor);
                    path2.classList.add("tie-curve");
                    path2.setAttribute("data-start-tick", tieStartTick);
                    path2.setAttribute("data-end-tick",   tieEndTick);

                    // Path2 tetap di sistem sekarang
                    this.svg.appendChild(path2);
                } else {
                    // Tie normal: lengkungan proporsional dengan jarak antar-note
                    const cx = (prev.x + x) / 2;
                    const cy = ((sy1 + sy2) / 2) + (stemDown ? -curveHeight : curveHeight);

                    tiePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
                    const d = `M ${prev.x} ${sy1} Q ${cx} ${cy} ${x} ${sy2} Q ${cx} ${cy - (stemDown ? -thickness : thickness)} ${prev.x} ${sy1} Z`;
                    tiePath.setAttribute("d", d);
                    tiePath.setAttribute("fill", this.engraverColor);
                    tiePath.classList.add("tie-curve");
                    tiePath.setAttribute("data-start-tick", tieStartTick);
                    tiePath.setAttribute("data-end-tick",   tieEndTick);
                    this.svg.appendChild(tiePath);
                }

                delete activeTies[pitchKey];
            }

            if (tieStart) {
                const startTick = this._cumulativeTick + note.onsetDiv;
                activeTies[pitchKey] = {
                    x: x,
                    y: note.y,
                    startTick: startTick,
                    endTick:   startTick + note.duration,
                    // Simpan referensi ke system group tempat note awal berada.
                    // originalSvg = measureGroup; measureGroup berada di dalam system group.
                    systemGroup: originalSvg.closest('g[data-system-number]') || null
                };
            }
        });

        // Stems & Flags
        const firstNoteType = calculatedNotes[0].type;
        let flagElement = null;
        let stemX = x;
        let stemEndY = y;
        let stemLine = null;
        const isBeamable = firstNoteType === "eighth" || firstNoteType === "16th" || firstNoteType === "32nd";

        if (firstNoteType !== "whole") {
            const stemLength = 28 * scale;
            stemX = stemDown ? x - 6.0 * scale : x + 6.0 * scale;
            const stemStartY = stemDown ? highestNote.y : lowestNote.y;
            stemEndY = stemDown ? lowestNote.y + stemLength : highestNote.y - stemLength;

            stemLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
            stemLine.classList.add("note-stem");
            stemLine.setAttribute("x1", stemX);
            stemLine.setAttribute("y1", stemStartY);
            stemLine.setAttribute("x2", stemX);
            stemLine.setAttribute("y2", stemEndY);
            stemLine.setAttribute("stroke", this.engraverColor);
            stemLine.setAttribute("stroke-width", `${1.4 * scale}`);
            this.svg.appendChild(stemLine);

            if (isBeamable) {
                flagElement = this.drawStemFlag(stemX, stemEndY, stemDown, firstNoteType === "16th");
            }
        }

        this.svg = originalSvg; // Restore original target
        this.svg.appendChild(noteGroup); // Add the complete group to the measure

        const beatDurationDivs = Math.max(1, (notes[0].divisions || 4) * (4 / (notes[0].beatType || 4)));

        // Di bagian return, pastikan type half note dikenali
        return {
            x: x,
            stemX: stemX,
            stemEndY: stemEndY,
            stemDown: stemDown,
            type: firstNote.type, // Gunakan type dari note pertama
            isBeamable: isBeamable,
            beatIndex: Math.floor(lowestNote.onsetDiv / beatDurationDivs),
            beatDurationDivs: beatDurationDivs,
            divisions: notes[0].divisions,
            flagElement: flagElement,
            stemLine: stemLine
        };
    }

    /**
     * Renders beams for a group of beamable notes (e.g., eighths, sixteenths).
     * This function is called by `drawBeams` to handle a single contiguous group.
     * @param {Object[]} group - An array of stem data objects for the notes in the beam group.
     */
    drawBeams(stems) {
        if (!stems || stems.length < 2) return;

        let i = 0;
        while (i < stems.length) {
            if (!stems[i].isBeamable) {
                i++;
                continue;
            }

            // ============================================================
            // PERBAIKAN: Half note tidak boleh di-beam
            // ============================================================
            if (stems[i].type === 'half') {
                i++;
                continue;
            }

            let currentGroup = [stems[i]];
            let j = i + 1;
            while (j < stems.length && stems[j].isBeamable) {
                // ============================================================
                // PERBAIKAN: Half note tidak boleh di-beam dengan note lain
                // ============================================================
                if (stems[j].type === 'half') {
                    break;
                }
                
                // Cek beatIndex dan stem direction
                if (stems[j].beatIndex !== stems[i].beatIndex) {
                    break;
                }
                if (stems[j].stemDown !== stems[i].stemDown) {
                    break;
                }
                
                currentGroup.push(stems[j]);
                j++;
            }

            if (currentGroup.length > 1) {
                this.renderBeamGroup(currentGroup);
            }
            i = j;
        }
    }

    /**
     * Render a group of beamed notes onto the SVG canvas.
     *
     * This function removes any existing flag elements from the notes,
     * aligns all intermediate stem endpoints to follow the sloped beam vector,
     * and then draws the primary beam line between the first and last stems.
     * If the group contains 16th or 32nd notes, it also draws a secondary beam line
     * offset from the primary beam.
     *
     * @param {Array<Object>} group - Array of note objects that share a beam.
     * Each note object should contain properties such as:
     *   - stemX {number}: The x-coordinate of the stem.
     *   - stemEndY {number}: The y-coordinate of the stem endpoint.
     *   - stemLine {SVGLineElement}: The SVG line element representing the stem.
     *   - flagElement {SVGElement}: The flag element to be removed if present.
     *   - type {string}: The note type (e.g., "8th", "16th", "32nd").
     *   - stemDown {boolean}: Indicates if the stem points downward.
     *
     * @returns {void} This function directly manipulates the SVG DOM to render beams.
     */
    renderBeamGroup(group) {
        const scale = this.zoom || 1.0;
        const first = group[0];
        const last = group[group.length - 1];

        group.forEach(s => {
            if (s.flagElement && s.flagElement.parentNode) {
                s.flagElement.parentNode.removeChild(s.flagElement);
            }
        });

        let x1 = first.stemX;
        let y1 = first.stemEndY;
        let x2 = last.stemX;
        let y2 = last.stemEndY;

        // Align intermediate stem endpoints to touch the sloped beam vector exactly
        let dx = x2 - x1;
        let dy = y2 - y1;

        if (dx > 0) {
            group.forEach(s => {
                const ratio = (s.stemX - x1) / dx;
                const alignedY = y1 + ratio * dy;
                s.stemEndY = alignedY;
                if (s.stemLine) {
                    s.stemLine.setAttribute("y2", alignedY);
                }
            });
        }

        // ============================================================
        // PERBAIKAN: Tentukan jumlah beam berdasarkan note TERPENDEK
        // dalam grup, bukan note pertama.
        // ============================================================
        // Cari note dengan beam level terbanyak (16th = 2, 8th = 1)
        let maxBeamLevel = 1;
        group.forEach(s => {
            if (s.type === "16th" || s.type === "32nd") {
                maxBeamLevel = Math.max(maxBeamLevel, 2);
            }
            if (s.type === "32nd") {
                maxBeamLevel = Math.max(maxBeamLevel, 3);
            }
        });

        // ============================================================
        // PERBAIKAN: Untuk setiap note, tentukan berapa beam yang
        // harus melewatinya berdasarkan durasinya.
        // ============================================================
        // Half note (1/2) dan quarter note (1/4) hanya punya 1 beam line
        // 8th note punya 1 beam line
        // 16th note punya 2 beam lines
        // 32nd note punya 3 beam lines
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

        let beamOffset = 0.7 * scale;

        // ============================================================
        // PERBAIKAN UTAMA: Gambar beam secara bertahap
        // ============================================================
        // Primary Beam Line (level 1) - selalu ada untuk semua note

        if(x1 < x2) {
            x1 = x1 - beamOffset;
            x2 = x2 + beamOffset;
        } else {
            x1 = x1 + beamOffset;
            x2 = x2 - beamOffset;
        }

        const beam = document.createElementNS("http://www.w3.org/2000/svg", "line");
        beam.classList.add("note-beam");
        beam.setAttribute("x1", x1);
        beam.setAttribute("y1", y1);
        beam.setAttribute("x2", x2);
        beam.setAttribute("y2", y2);
        beam.setAttribute("stroke", this.engraverColor);
        beam.setAttribute("stroke-width", `${3.5 * scale}`);
        this.svg.appendChild(beam);  

        // ============================================================
        // PERBAIKAN: Gambar secondary beam hanya untuk note yang
        // MEMILIKI beam level 2 (16th/32nd), dan hanya di rentang
        // note tersebut.
        // ============================================================
        if (maxBeamLevel >= 2) {
            const offset = (first.stemDown ? -5 : 5) * scale;
            
            // Cari note yang memiliki beam level 2+
            const beam2Notes = group.filter(s => getBeamCount(s.type) >= 2);
            
            if (beam2Notes.length > 0) {
                // Gambar beam level 2 hanya di antara note pertama dan terakhir
                // yang memiliki beam level 2+
                const firstBeam2 = beam2Notes[0];
                const lastBeam2 = beam2Notes[beam2Notes.length - 1];
                
                let bx1 = firstBeam2.stemX;
                let by1 = firstBeam2.stemEndY + offset;
                let bx2 = lastBeam2.stemX;
                let by2 = lastBeam2.stemEndY + offset;

                if(bx1 < bx2) {
                    bx1 = bx1 - beamOffset;
                    bx2 = bx2 + beamOffset;
                } else {
                    bx1 = bx1 + beamOffset;
                    bx2 = bx2 - beamOffset;
                }
                
                const beam2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
                beam2.classList.add("note-beam");
                beam2.setAttribute("x1", bx1);
                beam2.setAttribute("y1", by1);
                beam2.setAttribute("x2", bx2);
                beam2.setAttribute("y2", by2);
                beam2.setAttribute("stroke", this.engraverColor);
                beam2.setAttribute("stroke-width", `${3.0 * scale}`);
                this.svg.appendChild(beam2);
            }
        }

        // ============================================================
        // PERBAIKAN: Gambar tertiary beam hanya untuk note 32nd
        // ============================================================
        if (maxBeamLevel >= 3) {
            const offset = (first.stemDown ? -5 : 5) * scale;
            const offset3 = (first.stemDown ? -10 : 10) * scale;
            
            const beam3Notes = group.filter(s => getBeamCount(s.type) >= 3);
            
            if (beam3Notes.length > 0) {
                const firstBeam3 = beam3Notes[0];
                const lastBeam3 = beam3Notes[beam3Notes.length - 1];
                
                let bx1 = firstBeam3.stemX;
                let by1 = firstBeam3.stemEndY + offset3;
                let bx2 = lastBeam3.stemX;
                let by2 = lastBeam3.stemEndY + offset3;

                if(bx1 < bx2) {
                    bx1 = bx1 - beamOffset;
                    bx2 = bx2 + beamOffset;
                } else {
                    bx1 = bx1 + beamOffset;
                    bx2 = bx2 - beamOffset;
                }
                
                const beam3 = document.createElementNS("http://www.w3.org/2000/svg", "line");
                beam3.classList.add("note-beam");
                beam3.setAttribute("x1", bx1);
                beam3.setAttribute("y1", by1);
                beam3.setAttribute("x2", bx2);
                beam3.setAttribute("y2", by2);
                beam3.setAttribute("stroke", this.engraverColor);
                beam3.setAttribute("stroke-width", `${3.0 * scale}`);
                this.svg.appendChild(beam3);
            }
        }
    }

    /**
     * Draws a notehead, which can be a filled ellipse, a hollow ellipse, or a special symbol like 'x'.
     * @param {number} cx - The center X coordinate of the notehead.
     * @param {number} cy - The center Y coordinate of the notehead.
     * @param {string} color - The fill or stroke color of the notehead.
     * @param {boolean} isHollow - True for half and whole notes.
     * @param {string} [noteheadType='normal'] - The type of notehead (e.g., 'x', 'slash').
     * @param {number} [channelId=-1] - The MIDI channel ID, used to identify drum notes.
     */
    drawNotehead(cx, cy, color, isHollow, noteheadType = 'normal', channelId = -1) {
        const scale = this.zoom || 1.0;
        let rx = 7.1 * scale;
        let ry = 4.6 * scale;
        const strokeWidth = 2.0 * scale;

        if (channelId === 10 && noteheadType === 'x') {
            const xPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
            const size = 8 * scale;
            xPath.setAttribute("d", `M ${cx - size/2} ${cy - size/2} L ${cx + size/2} ${cy + size/2} M ${cx - size/2} ${cy + size/2} L ${cx + size/2} ${cy - size/2}`);
            xPath.setAttribute("stroke", color);
            xPath.setAttribute("stroke-width", `${1.8 * scale}`);
            xPath.setAttribute("stroke-linecap", "butt");
            xPath.classList.add("note-head");
            xPath.classList.add("hat");
            this.svg.appendChild(xPath);
            return;
        } else if (channelId === 10 && noteheadType === 'slash') {
            const slashPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
            const size = 10 * scale;
            slashPath.setAttribute("d", `M ${cx - size/2} ${cy + size/2} L ${cx + size/2} ${cy - size/2}`);
            slashPath.setAttribute("stroke", color);
            slashPath.setAttribute("stroke-width", `${2.5 * scale}`);
            slashPath.setAttribute("stroke-linecap", "butt");
            slashPath.classList.add("note-head");
            this.svg.appendChild(slashPath);
            return;
        }

        const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
        ellipse.setAttribute("cx", cx);
        ellipse.setAttribute("cy", cy);
        ellipse.setAttribute("transform", `rotate(-15 ${cx} ${cy})`);

        if (isHollow) {
            // Reduce radius by half the stroke width to keep the outer boundary consistent
            rx -= strokeWidth / 2;
            ry -= strokeWidth / 2;
            ellipse.setAttribute("fill", "transparent");
            ellipse.setAttribute("stroke", color);
            ellipse.setAttribute("stroke-width", `${strokeWidth}`);
        } else {
            ellipse.setAttribute("fill", color);
        }
        ellipse.setAttribute("rx", rx);
        ellipse.setAttribute("ry", ry);
        ellipse.classList.add("note-head");
        this.svg.appendChild(ellipse);
    }

    /**
     * Draws ledger lines for notes that are outside the standard 5-line staff.
     * @param {number} x - The X coordinate of the notehead.
     * @param {number} y - The Y coordinate of the top staff line.
     * @param {number} diatonic - The diatonic index of the note.
     * @param {string} clefType - The current clef type.
     */
    drawLedgerLines(x, y, diatonic, clefType) {
        let lineMin, lineMax;
        if (clefType === "F") {
            // Bass: G2 (-10) .. A3 (-2)
            lineMin = -10;
            lineMax = -2;
        } else if (clefType === "C") {
            // Alto: F3 (-4) .. G4 (4)   ← 5 garis paranada alto
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
     * Draw a single horizontal ledger line on the SVG canvas.
     *
     * Ledger lines are short horizontal strokes used in musical notation
     * to extend the staff for notes that lie above or below it.
     * This function creates an SVG line element centered at the given X coordinate
     * and positioned at the specified Y coordinate, scaled according to the current zoom.
     *
     * @param {number} x - The center X coordinate of the ledger line.
     * @param {number} lineY - The Y coordinate where the ledger line should be drawn.
     * @returns {void} This function directly appends the ledger line to the SVG canvas.
     */
    drawHorizontalLedger(x, lineY) {
        /**
         * Draws a single horizontal ledger line.
         * @param {number} x - The center X coordinate of the line.
         * @param {number} lineY - The Y coordinate of the line.
         */
        const scale = this.zoom || 1.0;
        const ledger = document.createElementNS("http://www.w3.org/2000/svg", "line");
        ledger.setAttribute("x1", x - 11 * scale);
        ledger.setAttribute("y1", lineY);
        ledger.setAttribute("x2", x + 11 * scale);
        ledger.setAttribute("y2", lineY);
        ledger.setAttribute("stroke", this.engraverColor);
        ledger.setAttribute("stroke-width", `${1.1 * scale}`);
        this.svg.appendChild(ledger);
    }

    /**
     * Draws note stem flags for eighth, sixteenth, or 32nd notes.
     * @param {number} x - The X coordinate of the stem.
     * @param {number} y - The Y coordinate of the end of the stem.
     * @param {boolean} isDown - True if the stem is pointing down.
     * @param {boolean} isDouble - True if a double flag is needed (16th or 32nd).
     */
    drawStemFlag(x, y, isDown, isDouble) {
        const scale = this.zoom || 1.0;
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.classList.add("note-flag");
        const flagPathUp = "M -0.112 3.631 C -0.112 0 -0.3031 0 0 0 C 0.28 0.1911 0 0 0 0 C 0.42 0.6879 0.512 0.7834 0.531 0.898 C 1.4 2.8 1.4 2.8 2.327 4.051 C 4.028 5.943 4.525 7.071 4.525 8.581 C 4.506 9.994 3.263 13.014 2.996 12.899 C 3.378 11.829 3.913 10.682 4.047 9.727 C 4.219 8.561 3.741 6.879 1.831 5.16 C 0.779 4.294 0 4.2 -0.112 3.631 Z";
        const flagPathDown = "M -0.112 -3.631 C -0.112 0 -0.3031 0 0 0 C 0.28 -0.1911 0 0 0 0 C 0.42 -0.6879 0.512 -0.7834 0.531 -0.898 C 1.4 -2.8 1.4 -2.8 2.327 -4.051 C 4.028 -5.943 4.525 -7.071 4.525 -8.581 C 4.506 -9.994 3.263 -13.014 2.996 -12.899 C 3.378 -11.829 3.913 -10.682 4.047 -9.727 C 4.219 -8.561 3.741 -6.879 1.831 -5.16 C 0.779 -4.294 0 -4.2 -0.112 -3.631 Z";

        const path = isDown ? flagPathDown : flagPathUp;
        const sx = 2.0 * scale;
        const sy = 1.6 * scale;

        const p1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p1.setAttribute("d", path);
        p1.setAttribute("transform", `translate(${x}, ${y}) scale(${sx}, ${sy})`);
        p1.setAttribute("fill", this.engraverColor);
        group.appendChild(p1);

        if (isDouble) {
            const yOffset = (isDown ? -8.5 : 8.5) * scale;
            const p2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
            p2.setAttribute("d", path);
            p2.setAttribute("transform", `translate(${x}, ${y + yOffset}) scale(${sx}, ${sy})`);
            p2.setAttribute("fill", this.engraverColor);
            group.appendChild(p2);
        }

        this.svg.appendChild(group);
        return group;
    }
    
    /**
     * Draws a single dot for a dotted note or rest.
     * @param {number} x - The X coordinate for the dot.
     * @param {number} y - The Y coordinate for the dot.
     * @param {string} color - The fill color.
     */
    drawDot(x, y, color) {
        const scale = this.zoom || 1.0;
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", x + 0.8 * scale);
        dot.setAttribute("cy", y);
        // Increased radius from 2 to 3 for better visibility
        dot.setAttribute("r", 2.8 * scale);
        dot.setAttribute("fill", color);
        this.svg.appendChild(dot);
    }

    /**
     * Backward-compatible alias for rest rendering.
     * @param {number} x - The X coordinate.
     * @param {number} y - The Y coordinate of the top staff line.
     * @param {string} type - The rest type ('whole', 'half', 'quarter', etc.).
     */
    drawRest(x, y, type) {
        this.drawRestSymbol(x, y, type);
    }

    /**
     * Draws a rest symbol of a specific type.
     * @param {number} x - The X coordinate.
     * @param {number} y - The Y coordinate of the top staff line.
     * @param {string} type - The rest type ('whole', 'half', 'quarter', etc.).
     * @param {string} color - The fill color.
     */
    drawRestSymbol(x, y, type, color) {
        let restInfo = { x: x, y: y, width: 0 };
        const scale = this.zoom || 1.0;
        color = color || this.engraverColor;

        switch (type) {
            case 'whole':
                const rWhole = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                rWhole.setAttribute("x", x - 10 * scale);
                rWhole.setAttribute("y", y + 1 * this.lineSpacing); // On 2nd line from top
                rWhole.setAttribute("width", 20 * scale);
                rWhole.setAttribute("height", 6 * scale);
                rWhole.setAttribute("fill", color);
                rWhole.classList.add("rest-symbol");
                this.svg.appendChild(rWhole);
                restInfo.x = x - 10 * scale;
                restInfo.y = y + 1 * this.lineSpacing + (3 * scale);
                restInfo.width = 20 * scale;
                break;

            case 'half':
                const rHalf = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                rHalf.setAttribute("x", x - 10 * scale);
                rHalf.setAttribute("y", y + 2 * this.lineSpacing); // On middle line
                rHalf.setAttribute("width", 20 * scale);
                rHalf.setAttribute("height", 6 * scale);
                rHalf.setAttribute("fill", color);
                rHalf.classList.add("rest-symbol");
                this.svg.appendChild(rHalf);
                restInfo.x = x - 10 * scale;
                restInfo.y = y + 2 * this.lineSpacing + (3 * scale);
                restInfo.width = 20 * scale;
                break;

            case 'quarter':
                const qPath = "M349 372c-14-12-44-43-65-102-21-58 25-95 50-114q12-7-1-21L219 9c-13-17-30-7-20 7 120 171-35 197-35 197s17 44 97 115c-84-22-139 40-97 104 41 64 120 78 127 80s18-4 7-11c-26-17-79-61-54-93 34-42 84-23 97-17 22 11 31-1 8-19";
                const pQ = document.createElementNS("http://www.w3.org/2000/svg", "path");
                pQ.setAttribute("d", qPath);
                pQ.setAttribute("transform", `translate(${x - 8 * scale}, ${y + 5 * scale}) scale(${0.06 * scale})`);
                pQ.setAttribute("fill", color);
                pQ.classList.add("rest-symbol");
                this.svg.appendChild(pQ);
                restInfo.x = x;
                restInfo.y = y + 2 * this.lineSpacing;
                restInfo.width = 10 * scale;
                break;

            case 'eighth':
            case '16th':
            case '32nd':
                const restGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
                restGroup.classList.add("rest-symbol");

                const hookPath = "M 1.098 0 C 0.578 0.098 0.18 0.457 0 0.953 C -0.039 1.113 -0.039 1.152 -0.039 1.371 C -0.039 1.672 -0.02 1.832 0.121 2.07 C 0.32 2.469 0.738 2.789 1.215 2.906 C 1.715 3.047 3 3.153 4 2.153 L 4.941 0.598 C 4.844 0.477 4.645 0.438 4.523 0.535 C 4.484 0.574 4.422 0.656 4.383 0.715 C 4.203 1.016 3.746 1.551 3.508 1.75 C 3.289 1.93 3.168 1.949 2.969 1.871 C 2.789 1.773 2.73 1.672 2.609 1.133 C 2.492 0.598 2.352 0.355 2.051 0.156 C 1.773 -0.023 1.414 -0.082 1.098 0 z";
                const hookScale = 2.75 * scale;

                const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                line.setAttribute("x1", x + 15 * scale);
                line.setAttribute("y1", y + 10 * scale);
                line.setAttribute("x2", x + 10 * scale);
                line.setAttribute("y2", y + 40.5 * scale);
                line.setAttribute("stroke", color);
                line.setAttribute("stroke-width", `${1.1 * scale}`);
                line.classList.add("rest-line");
                restGroup.appendChild(line);

                const pH1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
                pH1.setAttribute("d", hookPath);
                pH1.setAttribute("transform", `translate(${x + 1.5 * scale}, ${y + 11 * scale}) scale(${hookScale})`);
                pH1.setAttribute("fill", color);
                pH1.classList.add("rest-symbol");
                restGroup.appendChild(pH1);

                if (type === '16th' || type === '32nd') {
                    const pH2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
                    pH2.setAttribute("d", hookPath);
                    pH2.setAttribute("transform", `translate(${x - 0.5 * scale}, ${y + 21 * scale}) scale(${hookScale})`);
                    pH2.setAttribute("fill", color);
                    pH2.classList.add("rest-symbol");
                    restGroup.appendChild(pH2);
                }
                this.svg.appendChild(restGroup);
                restInfo.x = x + 15 * scale;
                restInfo.y = y + 2 * this.lineSpacing;
                restInfo.width = 10 * scale;
                break;
        }
        return restInfo;
    }

    /**
     * Calculates a numerical index for a note's diatonic position on an imaginary grand staff.
     * @param {string} step - The note step ('C', 'D', 'E', etc.).
     * @param {number} octave - The octave number.
     * @returns {number} The calculated diatonic index.
     */
    getDiatonicIndex(step, octave) {
        const offset = this.stepOffsets[step] !== undefined ? this.stepOffsets[step] : 0;
        const oct = typeof octave === "number" && !isNaN(octave) ? octave : 4;
        return (oct - 4) * 7 + offset;
    }

    /**
     * Calculate the vertical Y position of a note on the staff.
     * @param {number} diatonic - Diatonic index of the note.
     * @param {number} startY - Reference Y position (top line of staff).
     * @param {string} clefType - Clef type: "F", "C", or "G".
     * @returns {number} The computed Y coordinate.
     */
    getNoteY(diatonic, startY, clefType) {
        const ls = this.lineSpacing / 2;

        if (clefType === "F") {
            // Bass Clef: top line = A3 (diatonic -2)
            // A3 should be at y = startY
            return startY - (diatonic + 2) * ls;

        } else if (clefType === "C") {
            // Alto/Tenor Clef: middle line = C4 (diatonic 0)
            // C4 should be at y = startY + 2 * lineSpacing
            // Corrected Formula: y = startY + (4 - diatonic) * lineSpacing
            return startY + (4 - diatonic) * ls;

        } else {
            // Treble Clef: bottom line = E4 (diatonic 2)
            // E4 should be at y = startY + 4 * lineSpacing
            // Formula: y = startY + (10 - diatonic) * (lineSpacing/2)
            return startY + (10 - diatonic) * ls;
        }
    }

    /**
     * Draw a text label on the SVG canvas.
     *
     * This function creates an SVG <text> element at the specified coordinates,
     * applies styling such as font size, color, alignment, and weight, and appends
     * it to the current SVG container. It is useful for rendering note names,
     * annotations, or any textual elements in a musical score or diagram.
     *
     * @param {number} x - The X coordinate where the text will be placed.
     * @param {number} y - The Y coordinate where the text will be placed.
     * @param {string} text - The text content to display.
     * @param {number} size - The font size of the text.
     * @param {string} color - The fill color of the text.
     * @param {string} [anchor="middle"] - Text alignment relative to the X coordinate
     *   ("start", "middle", "end", or "center" which maps to "middle").
     * @param {boolean} [isBold=false] - Whether the text should be rendered in bold.
     * @param {string} [fontStyle="'Inter', sans-serif"] - The font family/style to use.
     * @returns {void} This function directly appends the text element to the SVG canvas.
     * @param {number} [rotation=0] - The rotation angle in degrees.
     */
    drawText(x, y, text, size, color, anchor = "middle", isBold = false, fontStyle = "'Inter', sans-serif", rotation = 0) {
        const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
        txt.setAttribute("x", x);
        txt.setAttribute("y", y);
        txt.setAttribute("font-size", size);
        txt.setAttribute("fill", color);
        txt.setAttribute("text-anchor", anchor === "center" ? "middle" : anchor);
        txt.setAttribute("font-family", fontStyle);
        if (isBold) {
            txt.setAttribute("font-weight", "bold");
        }
        if (rotation !== 0) {
            txt.setAttribute("transform", `rotate(${rotation} ${x},${y})`);
        }
        txt.textContent = text || "";
        this.svg.appendChild(txt);
    }

    /**
     * Selects all note group elements that are active at a given MIDI tick.
     * @param {number} tick The target MIDI tick.
     * @returns {SVGGElement[]} An array of SVG group elements for the active notes.
     */
    selectNotesByTick(tick) {
        if (!this._svgRoot) {
            return [];
        }

        const activeNotes = [];
        const allNoteElements = this._svgRoot.querySelectorAll('g[data-element-type="note"]');

        allNoteElements.forEach(el => {
            const start = parseFloat(el.getAttribute('data-start-tick'));
            const end = parseFloat(el.getAttribute('data-end-tick'));
            if (tick >= start && tick < end) {
                activeNotes.push(el);
            }
        });
        return activeNotes;
    }

    /**
     * Creates or updates the vertical playhead line element within the SVG.
     */
    createOrUpdatePlayhead() {
        if (!this._svgRoot) return;
        this.playheadElement = this._svgRoot.querySelector('#playhead-line');
        if (!this.playheadElement) {
            this.playheadElement = document.createElementNS("http://www.w3.org/2000/svg", "line");
            this.playheadElement.setAttribute("id", "playhead-line");
            this.playheadElement.setAttribute("stroke", "rgba(255,0,0,0.7)");
            this.playheadElement.setAttribute("stroke-width", "2");
            this.playheadElement.style.pointerEvents = "none";
            this._svgRoot.appendChild(this.playheadElement);
        }
    }

    /**
     * Updates the visual position of the playhead, highlights active notes, and handles auto-scrolling.
     * @param {number} tick The current MIDI tick to display.
     * @param {object} pos Position info: { measure, tickInMeasure, ticksPerMeasure }
     * @param {HTMLElement} [scrollContainer=null] The scrollable container for auto-scrolling.
     * @param {Object} [scoreOptions={}] The score rendering options.
     */
    updatePlayhead(tick, pos, scrollContainer, scoreOptions = {}) {
        if (!this._svgRoot) return;
        let scrollOffset = scoreOptions.scrollOffset || 0;


        const scale = this.zoom || 1.0;
        const svg = this._svgRoot;

        this.createOrUpdatePlayhead();
        const playheadLine = this.playheadElement;

        // Ensure playhead is visible if it was hidden
        playheadLine.style.display = '';

        // Cari measure aktif
        const currentMeasureNum = pos.measure;
        const activeMeasure = svg.querySelector(`g[data-measure-number="${currentMeasureNum}"]`);

        if (activeMeasure) {
            const activeSystem = activeMeasure.closest('g[data-system-number]');
            if (!activeSystem) return;

            const systemX = parseFloat(activeSystem.getAttribute('x'));
            const systemY = parseFloat(activeSystem.getAttribute('y'));
            const systemHeight = parseFloat(activeSystem.getAttribute('height'));

            const measureX = parseFloat(activeMeasure.getAttribute('x'));
            const measureWidth = parseFloat(activeMeasure.getAttribute('width'));

            const progress = pos.ticksPerMeasure > 0
                ? Math.max(0, Math.min(1, pos.tickInMeasure / pos.ticksPerMeasure))
                : 0;

            const xPos = systemX + measureX + (progress * measureWidth) - (24.75 * scale);
            playheadLine.setAttribute('x1', xPos);
            playheadLine.setAttribute('x2', xPos);

            const extraPadding = this.lineSpacing * 2;
            playheadLine.setAttribute('y1', systemY - extraPadding);
            playheadLine.setAttribute('y2', systemY + systemHeight + extraPadding);

            // Auto-scroll logic
            if (scrollContainer && scoreOptions.scroll) {
                const viewBox = svg.getAttribute("viewBox").split(" ");

                const vbY = parseFloat(viewBox[1]);
                const vbHeight = parseFloat(viewBox[3]);
                const vbWidth = parseFloat(viewBox[2]);
                // const contentWidth = scrollContainer.scrollWidth; // lebar konten penuh
                const contentWidth = this._svgRoot.parentNode.offsetWidth;
                const scaleX = (contentWidth) / vbWidth; // Gunakan skala horizontal untuk menghitung skala vertikal

                let offsetY = systemY;
                if(activeSystem.dataset.systemNumber == '1') {
                    offsetY = 0; // Jika sistem pertama, setel offset ke 0
                }
                const newScrollTop = (systemY * scaleX) - 20;

                scrollContainer.scrollTo({
                    top: newScrollTop + scrollOffset,
                    behavior: 'smooth',
                });
            }
        }

        // 4. Append the playhead line to ensure it's on top
        this.svg.appendChild(playheadLine);
    }

    /**
     * Clears all currently highlighted notes from the score.
     */
    clearHighlightedNotes() {
        if (!this._svgRoot) return;
        this._svgRoot.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));
    }

    /**
     * Highlights the notes that are active at a given tick, optionally within a specific measure.
     * 
     * @param {*} tick - The current MIDI tick.
     * @param {*} measureNumber - The measure number
     * @param {*} scoreOptions - The score option
     * @returns 
     */
    highlightActiveNotes(tick, measureNumber = null, scoreOptions = {}) {
        if (!this._svgRoot || !scoreOptions.highlight) {
            return;
        }

        let parentElements = [this._svgRoot];

        if (measureNumber !== null) {
            let systemNumber = null;
            const systemElements = [];
            let measureEl = this._svgRoot.querySelector(`g[data-measure-number="${measureNumber}"]`);
            const currentSystem = measureEl?.closest('g[data-system-number]');
            if (currentSystem) {
                systemElements.push(currentSystem);
                systemNumber = parseInt(currentSystem.dataset.systemNumber);
                const prevSystem = this._svgRoot.querySelector(`g[data-system-number="${systemNumber - 1}"]`);
                if (prevSystem) systemElements.push(prevSystem);
            }
            if (systemElements.length > 0) {
                parentElements = systemElements;
            }
        }

        // 1. Clear previous highlights
        this._svgRoot.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));

        // 2. Highlight current notes/rests + tie curves
        parentElements.forEach(parentElement => {
            // Highlight note/rest groups
            const musicalElements = parentElement.querySelectorAll('g.music-notation');
            musicalElements.forEach(el => {
                const minTick = parseFloat(el.dataset.startTick);
                const maxTick = parseFloat(el.dataset.endTick);
                if (tick >= minTick && tick < maxTick) {
                    el.classList.add('highlight');
                }
            });

            // === BARU: Highlight tie curves berdasarkan rentang tick-nya sendiri ===
            const tieCurves = parentElement.querySelectorAll('path.tie-curve[data-start-tick]');
            tieCurves.forEach(el => {
                const minTick = parseFloat(el.getAttribute('data-start-tick'));
                const maxTick = parseFloat(el.getAttribute('data-end-tick'));
                if (tick >= minTick && tick < maxTick) {
                    el.classList.add('highlight');
                }
            });
        });
    }


    /**
     * Resets the playhead to the beginning and scrolls to the top.
     * @param {HTMLElement} [scrollContainer=null] The scrollable container to scroll.
     */
    resetPlayhead(scrollContainer = null) {
        this.updatePlayheadPos(0);
        this.lastScrolledSystem = null;
        if (scrollContainer) scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /**
     * Clears the content of the SVG container.
     */
    clearScore() {
        if (this.svg) {
            this.svg.innerHTML = '';
        }
    }

    static NOTE_TYPE_VALUES = [
        { name: 'maxima', val: 8 }, { name: 'long', val: 4 }, { name: 'breve', val: 2 },
        { name: 'whole', val: 1 }, { name: 'half', val: 0.5 }, { name: 'quarter', val: 0.25 },
        { name: 'eighth', val: 0.125 }, { name: '16th', val: 0.0625 }, { name: '32nd', val: 0.03125 },
        { name: '64th', val: 0.015625 }, { name: '128th', val: 0.0078125 }
    ];

    /**
     * Converts a duration in divisions to a MusicXML note type string.
     * @param {number} duration - Duration in divisions.
     * @param {number} divisions - Divisions per quarter note.
     * @returns {string} The note type (e.g., 'quarter', 'eighth').
     */
    static getNoteType(duration, divisions) {
        if (divisions <= 0 || duration <= 0) return '128th';
        const value = duration / (4 * divisions); // Value relative to a whole note
        for (const type of MusicXMLSVGRenderer.NOTE_TYPE_VALUES) {
            if (value >= type.val - 0.0001) {
                return type.name;
            }
        }
        return '128th';
    }

    /**
     * Checks if a duration can be represented by a single standard (dotted) note.
     * @param {number} duration - Duration in divisions.
     * @param {number} divisions - Divisions per quarter note.
     * @returns {boolean} True if it's a standard duration.
     */
    static isStandardDuration(duration, divisions) {
        if (duration <= 0 || divisions <= 0) return false;
        const value = duration / (4 * divisions); // Value relative to a whole note
        for (const type of MusicXMLSVGRenderer.NOTE_TYPE_VALUES) {
            const baseDuration = type.val;
            // Only undotted and single-dotted durations are rendered directly.
            // Longer dotted values are rendered as tied notes instead.
            if (Math.abs(value - baseDuration) < 0.001 ||
                Math.abs(value - baseDuration * 1.5) < 0.001) {
                return true;
            }
        }
        return false;
    }

    /**
     * Splits a non-standard duration into a series of standard, representable durations.
     * @param {number} duration - The total duration in divisions to split.
     * @param {number} divisions - Divisions per quarter note.
     * @returns {number[]} An array of durations (in divisions) that sum to the original duration.
     */
    static splitDurationIntoRepresentablePieces(duration, divisions) {
        const pieces = [];
        let remaining = duration;
        const epsilon = 0.01; // Tolerance for float comparisons

        const value = duration / (4 * divisions);
        const fractionalPart = value - Math.floor(value);
        if (Math.abs(fractionalPart - 0.75) < 0.001 && value >= 1) {
            // Keep the integer portion undotted, then use a dotted half note.
            let wholeUnits = Math.floor(value);
            for (const type of MusicXMLSVGRenderer.NOTE_TYPE_VALUES) {
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

            // Iterate through standard note types from largest to smallest
            for (const type of MusicXMLSVGRenderer.NOTE_TYPE_VALUES) {
                const baseDurationDivs = type.val * 4 * divisions;

                // Check for single-dotted and undotted durations.
                const dottedFactors = [1.5, 1.0];
                for (const factor of dottedFactors) {
                    const candidateDuration = Math.round(baseDurationDivs * factor);

                    // If this candidate fits within the remaining duration and is larger than the current best
                    if (candidateDuration > 0 && candidateDuration <= remaining + epsilon && candidateDuration > bestPieceDuration) {
                        bestPieceDuration = candidateDuration;
                    }
                }
            }

            if (bestPieceDuration > 0) {
                pieces.push(bestPieceDuration);
                remaining -= bestPieceDuration;
            } else {
                // CRITICAL FIX: Prevent infinite loop if no piece can be found
                const finalPiece = Math.round(remaining);
                if (finalPiece > 0) {
                    pieces.push(finalPiece);
                }
                remaining = 0;
            }
        }
        return pieces;
    }

    /**
     * Gets the number of dots represented by a note duration.
     * @param {number} duration - Duration in divisions.
     * @param {number} divisions - Divisions per quarter note.
    * @returns {number} The number of dots (0 or 1).
     */
    static getDotCount(duration, divisions) {
        if (duration <= 0 || divisions <= 0) return 0;
        const value = duration / (4 * divisions);
        const noteType = MusicXMLSVGRenderer.getNoteType(duration, divisions);
        const type = MusicXMLSVGRenderer.NOTE_TYPE_VALUES.find(item => item.name === noteType);
        if (!type) return 0;

        if (Math.abs(value - type.val * 1.5) < 0.001) return 1;
        return 0;
    }
}

window.MusicXMLSVGRenderer = MusicXMLSVGRenderer;
