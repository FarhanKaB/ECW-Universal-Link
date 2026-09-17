// ==UserScript==
// @name         ECW Universal Link (Without Delete)
// @namespace    https://github.com/FarhanKaB
// @version      1.0.1
// @description  Auto-link CPTs with ICDs in ECW (Remember this does not Delete any CPT)
// @author       FarhanKaB
// @match        https://*.ecwcloud.com/mobiledoc/jsp/webemr/*
// @match        https://*.eclinicalweb.com/mobiledoc/jsp/webemr/*
// @downloadURL  https://raw.githubusercontent.com/FarhanKaB/ECW-Universal-Link/main/ECW-Universal-Link.user.js
// @updateURL    https://raw.githubusercontent.com/FarhanKaB/ECW-Universal-Link/main/ECW-Universal-Link.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ─── UI notification (non‑blocking, stacked so they never overlap) ─
    const NOTIFICATION_GAP = 12; // px between stacked notifications
    const activeNotifications = [];

    // Inject animation keyframes once
    if (!document.getElementById('ecw-notify-style')) {
        const style = document.createElement('style');
        style.id = 'ecw-notify-style';
        style.textContent = `
            @keyframes ecwNotifySlideIn {
                from { transform: translateX(120%); opacity: 0; }
                to   { transform: translateX(0); opacity: 1; }
            }
            @keyframes ecwNotifySlideOut {
                from { transform: translateX(0); opacity: 1; }
                to   { transform: translateX(120%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }

    function repositionNotifications() {
        let top = 80;
        activeNotifications.forEach(container => {
            if (!document.body.contains(container)) return;
            container.style.top = top + 'px';
            top += container.offsetHeight + NOTIFICATION_GAP;
        });
    }

    function dismissNotification(container) {
        container.style.animation = 'ecwNotifySlideOut 0.25s ease forwards';
        setTimeout(() => {
            container.remove();
            const idx = activeNotifications.indexOf(container);
            if (idx !== -1) activeNotifications.splice(idx, 1);
            repositionNotifications();
        }, 250);
    }

    function showNotification(messages, isWarning = true) {
        if (typeof messages === 'string') messages = [messages];
        if (!messages.length) return;

        // Skip if an identical message set is already showing
        const key = messages.join('||');
        const alreadyShowing = activeNotifications.some(c => c.dataset.msgKey === key);
        if (alreadyShowing) return;

        const accent = isWarning ? '#f59e0b' : '#3b82f6';
        const iconGlyph = isWarning ? '!' : 'i';

        const container = document.createElement('div');
        container.dataset.msgKey = key;
        Object.assign(container.style, {
            position: 'fixed',
            top: '80px',
            right: '20px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            width: '360px',
            maxWidth: '90vw',
            padding: '14px 16px',
            background: 'rgba(255, 255, 255, 0.97)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(0,0,0,0.06)',
            borderLeft: '4px solid ' + accent,
            borderRadius: '12px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
            zIndex: '9999999',
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            fontSize: '13.5px',
            color: '#1f2937',
            animation: 'ecwNotifySlideIn 0.3s ease',
            transition: 'top 0.25s ease'
        });

        // Icon badge
        const iconBadge = document.createElement('div');
        Object.assign(iconBadge.style, {
            flexShrink: '0',
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            background: accent,
            color: '#fff',
            fontWeight: '700',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: '1px'
        });
        iconBadge.textContent = iconGlyph;
        container.appendChild(iconBadge);

        // Content column
        const content = document.createElement('div');
        content.style.flex = '1';
        content.style.minWidth = '0';

        if (messages.length === 1) {
            const p = document.createElement('div');
            p.style.lineHeight = '1.4';
            p.style.fontWeight = '500';
            p.textContent = messages[0];
            content.appendChild(p);
        } else {
            const list = document.createElement('ul');
            list.style.margin = '0';
            list.style.paddingLeft = '18px';
            list.style.lineHeight = '1.5';
            messages.forEach(msg => {
                const li = document.createElement('li');
                li.textContent = msg;
                list.appendChild(li);
            });
            content.appendChild(list);
        }
        container.appendChild(content);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u00d7';
        Object.assign(closeBtn.style, {
            flexShrink: '0',
            border: 'none',
            background: 'transparent',
            color: '#9ca3af',
            fontSize: '18px',
            lineHeight: '1',
            cursor: 'pointer',
            padding: '0',
            marginLeft: '4px'
        });
        closeBtn.onmouseenter = () => closeBtn.style.color = '#4b5563';
        closeBtn.onmouseleave = () => closeBtn.style.color = '#9ca3af';
        closeBtn.onclick = () => dismissNotification(container);
        container.appendChild(closeBtn);

        document.body.appendChild(container);
        activeNotifications.push(container);
        repositionNotifications();

        setTimeout(() => dismissNotification(container), 5000);
    }

    // ─── Row selectors ─────────────────────────────────────────────────
    // Only real ng-repeat rows are data rows. Filler / summary rows that
    // ECW sometimes injects into the tbody are ignored.
    function getICDRows() {
        return Array.from(document.querySelectorAll('#billingTbl2 tbody tr[ng-repeat]'));
    }

    function getCPTRows() {
        return Array.from(document.querySelectorAll('#billingTbl4 tbody tr[ng-repeat]'));
    }

    // ─── Visible ICD input resolver ────────────────────────────────────
    // Depending on the practice's isSmartIcdToCptMappingSuggestionsEnabled
    // setting, a CPT row can contain TWO complete sets of icd1-icd4 inputs
    // with identical data-fieldname values (and sometimes identical ids):
    //
    //   1. the smart-suggestion set, inside
    //      <td ng-repeat="icdSlot in cptIcdSlots"> ... </td>
    //   2. the classic set, inside
    //      <td ng-if="!isSmartIcdToCptMappingSuggestionsEnabled"> ... </td>
    //
    // A plain querySelector returns whichever comes first in document order,
    // which on smart-mapping-OFF instances is the HIDDEN smart input — so
    // every write lands in a dead field and nothing appears on screen.
    //
    // This picks the input that is actually live:
    //   a) prefer one whose <td> is neither ng-hide nor display:none
    //   b) then any whose <td> is not ng-hide (covers chkPopup == '1',
    //      where the input itself is hidden but its ng-model is still bound)
    //   c) otherwise fall back to the last match
    function getICDInput(row, slot) {
        const inputs = row.querySelectorAll(`input[data-fieldname="icd${slot}"]`);
        if (inputs.length === 0) return null;
        if (inputs.length === 1) return inputs[0];

        for (const inp of inputs) {
            const td = inp.closest('td');
            if (td && !td.classList.contains('ng-hide') && td.offsetParent !== null) return inp;
        }
        for (const inp of inputs) {
            const td = inp.closest('td');
            if (td && !td.classList.contains('ng-hide')) return inp;
        }
        return inputs[inputs.length - 1];
    }

    // Clear all four ICD slots on a CPT row.
    function clearICDSlots(row) {
        for (let i = 1; i <= 4; i++) {
            const input = getICDInput(row, i);
            if (input) setInputValue(input, '');
        }
    }

    // Write an ICD row-number into a given slot on a CPT row.
    function setICDSlot(row, slot, rowNum) {
        if (!rowNum) return;
        const input = getICDInput(row, slot);
        if (input) setInputValue(input, rowNum);
    }

    // ─── Helpers ────────────────────────────────────────────────────────
    function setInputValue(inputEl, value) {
        if (!inputEl) return;
        inputEl.focus();
        inputEl.value = value;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        inputEl.blur();

        if (typeof window.txtIcdBlur === 'function') {
            try {
                const idx = inputEl.closest('tr')
                                  .querySelector('input[data-fieldindex]')?.getAttribute('data-fieldindex') || 0;
                window.txtIcdBlur(
                    inputEl.getAttribute('data-fieldname'),
                    inputEl.value,
                    'GET_CODE',
                    parseInt(idx, 10),
                    'yes'
                );
            } catch (e) {}
        }
    }

    function refreshICDDisplay(row) {
        row.querySelectorAll('td.ng-binding[title]').forEach(td => {
            td.dispatchEvent(new Event('mouseover'));
        });
    }

    function getPatientAge() {
        // --- Get DOB from patient header e.g. "May 3, 2015" ---
        const span = document.querySelector(".patient-identifier-span");
        if (!span) return null;
        const text = span.textContent;
        const dobMatch = text.match(/(\w+ \d{1,2},\s*\d{4})/);
        if (!dobMatch) return null;
        const dob = new Date(dobMatch[1]);
        if (isNaN(dob)) return null;

        // --- Get Appt date from top-right e.g. "Appt: (05/02/2026 02:50 pm, ESTPT)" ---
        let serviceDate = null;
        const headerText = document.body.textContent;
        const apptMatch = headerText.match(/Appt[:\s(]+(\d{2}\/\d{2}\/\d{4})/i);
        if (apptMatch) {
            const [mm, dd, yyyy] = apptMatch[1].split('/');
            serviceDate = new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
        }

        // Final fallback: use today
        if (!serviceDate || isNaN(serviceDate)) serviceDate = new Date();

        // --- Calculate exact age ---
        let age = serviceDate.getFullYear() - dob.getFullYear();
        const monthDiff = serviceDate.getMonth() - dob.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && serviceDate.getDate() < dob.getDate())) {
            age--;
        }
        return age;
    }

    // ─── Preventive age rules ──────────────────────────────────────────
    const PREVENTIVE_RULES = {
        "99391": { min: 0, max: 0 },
        "99392": { min: 1, max: 4 },
        "99393": { min: 5, max: 11 },
        "99394": { min: 12, max: 17 },
        "99395": { min: 18, max: 39 },
        "99396": { min: 40, max: 64 },
        "99397": { min: 65, max: 999 },
        "99381": { min: 0, max: 0 },
        "99382": { min: 1, max: 4 },
        "99383": { min: 5, max: 11 },
        "99384": { min: 12, max: 17 },
        "99385": { min: 18, max: 39 },
        "99386": { min: 40, max: 64 },
        "99387": { min: 65, max: 999 }
    };

    // ─── Eye-related ICD detection ──────────────────────────────────────
    const EYE_ICD_PATTERNS = [
        /^H(0[0-6]|1[0-9]|2[0-8]|3[0-6]|40|4[2-9]|5[0-9])/,
        /^C69/,
        /^D31/,
        /^Q1[0-5]/,
        /^S05/,
        /^T15/,
        /^T26/,
        /^P39\.1/
    ];

    function isEyeICD(code) {
        if (!code) return false;
        return EYE_ICD_PATTERNS.some(rx => rx.test(code.toUpperCase()));
    }

    // ─── Pain-related ICD detection ─────────────────────────────────────
    const PAIN_RELATED_ICD_CODES = new Set([
        "R52", "R52.0", "R52.1", "R52.2", "R52.9", "R51",
        "G44.1", "G44.209", "G44.401", "G44.501",
        "R07.0", "R07.1", "R07.2", "R07.9",
        "M54.2", "M54.5", "M54.4", "M54.8", "M54.9", "M54.59", "M54.50", "M54.12",
        "M25.5", "M25.51", "M25.52", "M25.53", "M25.54", "M25.55", "M25.56", "M25.57", "M25.58", "M25.59",
        "M25.511", "M25.512", "M25.519", "M25.521", "M25.522", "M25.529", "M25.531", "M25.532", "M25.539", "M25.541", "M25.542", "M25.549",
        "M25.551", "M25.552", "M25.559", "M25.561", "M25.562", "M25.569", "M25.571", "M25.572", "M25.579",
        "M79.6", "M79.1", "M79.2", "M79.7",
        "G89.0", "G89.2", "G89.3", "G89.4", "G89.21", "G89.22", "G89.29",
        "G50.1", "G56.0", "G57.0",
        "R10.0", "R10.2", "R10.30", "R10.4", "M17.0",
        "N94.4", "N94.5", "N94.6", "M72.2",
        "R52.81", "R52.82", "R52.89", "M54.16", "M10.9", "M17.12", "M79.10","M85.80","R25.2","M43.16","K59.4",
        "T14.0", "T79.8XXA",
        "K52.9",
        "R11.2"
    ]);
    const NON_PAIN_M_EXACT_CODES = new Set([
        "M67.4", "M72.0", "M79.3",
        "M81.0", "M81.6", "M81.8",
        "M22.0", "M22.1", "M24.4", "M24.5", "M24.6", "M25.6", "M62.4", "M62.81", "M89.7"
    ]);
    const NON_PAIN_M_PREFIXES = [
        "M20.", "M21.", "M40.", "M41.", "M43.0", "M43.1", "M85.", "M95.", "M96.", "M88"
    ];

    function isPainRelatedICD(code) {
        if (!code) return false;
        if (PAIN_RELATED_ICD_CODES.has(code)) return true;
        if (code.startsWith('M')) {
            if (NON_PAIN_M_EXACT_CODES.has(code)) return false;
            if (NON_PAIN_M_PREFIXES.some(prefix => code.startsWith(prefix))) return false;
            return true;
        }
        return false;
    }

    // ─── 99214 eligibility / chronic disease codes ─────────────────────
    const EXCLUDED_ICDS = new Set([
        "E66.9", "E66.01", "E66.09", "E66.3",   // obesity
        "F17.210", "F17.200", "F17.220",        // smoking
        "E55.9"                                  // vitamin D deficiency
    ]);

    const CHRONIC_CODES = new Set([
        "B18.8","I10","E03.8","E03.9","E07.89","E07.9","E11.21","E11.22","E11.40","E11.42","E11.49","E11.59",
        "E11.610","E11.618","E11.65","E11.69","E11.8","E11.9","E44.0","E78.1","E78.2","E78.5",
        "F01.50","F01.51","F03.90","F03.91","F06.30","F06.31","F06.32","F06.4","F20.1","F20.3","F20.9","F31.10",
        "F31.61","F31.9","F32.9","F32.A","F33.0","F33.1","F34.9","F39","F41.1","F41.9","F51.01","F51.12","F52.21",
        "G47.00","G47.09","G89.29","H25.013","H34.8192","I25.10","I25.119","I25.810","I25.812","I25.83","I25.9",
        "I48.91","I50.22","I51.7","I51.9","I67.9","I73.9","I83.10","I83.891","I83.93",
        "J32.0","J44.1","J44.9","J45.20","J45.21","J45.30","J45.40","J45.901","J45.909","J45.991",
        "K21.00","K21.9","K58.0","K58.1","K58.2","K70.31","K74.60","K76.0","K86.0","K86.1","K90.0",
        "L40.9","L74.9","L83","M06.89","M06.9","M10.00","M10.072","M10.9","M47.22","M47.25","M47.26","M79.7","M81.0",
        "N18.2","N18.30","N18.31","N18.32","N18.4","N18.9","N40.0","N40.1","N46.9","N52.9",
        "R00.1","R01.1","R41.81","R54","R87.810","R94.4","R94.5","R94.6","T82.212D"
    ]);

    function extractICDCode(rawText) {
        if (!rawText) return null;
        const match = rawText.trim().match(/^([A-Z][0-9A-Z]{1,3}(?:\.[0-9A-Z]{1,4})?)\b/i);
        return match ? match[1].toUpperCase() : null;
    }

    // ─── CPT Rules ──────────────────────────────────────────────────────
    function buildCPTRules() {
        const rules = {};
        const prevICDs = ["Z00.01", "Z00.121", "Z00.00", "Z00.129", "Z68", "Z71.3", "Z71.82", "Z71.89"];
        const prevCodes = [
            "99391","99392","99393","99394","99395","99396","99397",
            "99381","99382","99383","99384","99385","99386","99387",
            "G0438","G0439","G0402"
        ];
        prevCodes.forEach(c => { rules[c] = { type: "customICDCollector", icdList: prevICDs }; });

        const ecgICDs = ["E78","I10","R00.0","R00.1","R00.2","R03.0","R06.02","R07.9","Z13.6"];
        const labDrawICDs = ["E08","E09","E10","E11","E13","R73.03","E78","E00","E01","E02","E03","I10"];
        const b12ICDs = ["D51.9","E53.9"];

        Object.assign(rules, {
            "3008F": { type: "customICDCollector", icdList: ["Z00.01","Z00.121","Z00.00","Z00.129","E66.3","E66.9","E66.01","E66.09","R63.6","Z68"] },
            "2010F": { type: "bmiLink" },
            "0503F": { type: "exact", icds: ["Z39.2"], fallback: "officeVisit" },
            "99401": { type: "multiICD", icds: [["Z71.3"], ["Z71.82","Z71.89"]] },
            "99402": { type: "multiICD", icds: [["Z71.3"], ["Z71.82","Z71.89"]] },
            "99406": { type: "multiICD", icds: [["F17"], ["Z71.6"]] },
            "G0447": { type: "multiICD", icds: [["E66.9","E66.01","E66.09"], ["Z68"]] },
            "G8418": { type: "bmiLink" },
            "G8417": { type: "bmiLink" },
            "G8420": { type: "bmiLink" },
            "LSM01": { type: "customICDCollector", icdList: ["Z71.3","Z71.82","Z71.89"], fallback: "officeVisit" },
            "PD001": { type: "customICDCollector", icdList: ["Z71.3","Z71.82","Z71.89"], fallback: "officeVisit" },
            "4013F": { type: "startsWith", icds: ["E78"], fallback: "officeVisit" },
            "G9664": { type: "startsWith", icds: ["E78"], fallback: "officeVisit" },
            "2026F": { type: "startsWith", icds: ["E11"], fallback: "officeVisit" },
            "2033F": { type: "startsWith", icds: ["E11"], fallback: "officeVisit" },
            "3072F": { type: "startsWith", icds: ["E11"], fallback: "officeVisit" },
            "4010F": { type: "startsWith", icds: ["I10"], fallback: "officeVisit" },
            "CP001": { type: "exact", icds: ["Z09","Z71.89","Z76.89"], fallback: "officeVisit" },
            "3074F": { type: "startsWith", icds: ["I10"], fallback: "officeVisit" },
            "3075F": { type: "startsWith", icds: ["I10"], fallback: "officeVisit" },
            "3077F": { type: "startsWith", icds: ["I10"], fallback: "officeVisit" },
            "3078F": { type: "startsWith", icds: ["I10"], fallback: "officeVisit" },
            "3079F": { type: "startsWith", icds: ["I10"], fallback: "officeVisit" },
            "3080F": { type: "startsWith", icds: ["I10"], fallback: "officeVisit" },
            "G8752": { type: "startsWith", icds: ["I10"], fallback: "officeVisit" },
            "G8753": { type: "startsWith", icds: ["I10"], fallback: "officeVisit" },
            "G8754": { type: "startsWith", icds: ["I10"], fallback: "officeVisit" },
            "G8755": { type: "startsWith", icds: ["I10"], fallback: "officeVisit" },
            "3725F": { type: "exact", icds: ["Z13.31"], fallback: "officeVisit" },
            "G8510": { type: "exact", icds: ["Z13.31"], fallback: "officeVisit" },
            "G0444": { type: "exact", icds: ["Z13.31"], fallback: "officeVisit" },
            "G8431": { type: "exact", icds: ["Z13.31"], fallback: "officeVisit" },
            "1000F": { type: "startsWith", icds: ["F17"], fallback: "officeVisit" },
            "1036F": { type: "startsWith", icds: ["F17"], fallback: "officeVisit" },
            "G9275": { type: "startsWith", icds: ["F17"], fallback: "officeVisit" },
            "G9276": { type: "startsWith", icds: ["F17"], fallback: "officeVisit" },
            "G9622": { type: "exact", icds: ["Z13.89","Z13.9"], fallback: "officeVisit" },
            "G0442": { type: "exact", icds: ["Z13.89","Z13.9"], fallback: "officeVisit" },
            "3016F": { type: "exact", icds: ["Z13.89","Z13.9"], fallback: "officeVisit" },
            "H0049": { type: "exact", icds: ["Z13.89","Z13.9"], fallback: "officeVisit" },
            "G0136": { type: "officeVisit" },
            "1100F": { type: "officeVisit" },
            "3288F": { type: "officeVisit" },
            "1101F": { type: "officeVisit" },
            "1125F": { type: "painLink", fallback: "officeVisit" },
            "0521F": { type: "painLink", fallback: "officeVisit" },
            "99497": { type: "chronicLink", fallback: "officeVisit" },
            "1157F": { type: "chronicLink", fallback: "officeVisit" },
            "1126F": { type: "officeVisit" },
            "1160F": { type: "officeVisit" },
            "1170F": { type: "officeVisit" },
            "3048F": { type: "startsWith", icds: ["E78","Z71.2"], fallback: "officeVisit" },
            "3049F": { type: "startsWith", icds: ["E78","Z71.2"], fallback: "officeVisit" },
            "3050F": { type: "startsWith", icds: ["E78","Z71.2"], fallback: "officeVisit" },
            "3044F": { type: "startsWith", icds: ["E11","R73.03","Z71.2"], fallback: "officeVisit" },
            "3051F": { type: "startsWith", icds: ["E11","R73.03","Z71.2"], fallback: "officeVisit" },
            "3052F": { type: "startsWith", icds: ["E11","R73.03","Z71.2"], fallback: "officeVisit" },
            "3046F": { type: "startsWith", icds: ["E11","R73.03","Z71.2"], fallback: "officeVisit" },
            "3060F": { type: "exact", icds: ["Z71.2"], fallback: "officeVisit" },
            "3061F": { type: "exact", icds: ["Z71.2"], fallback: "officeVisit" },
            "Q0091": { type: "exact", icds: ["Z12.4"], fallback: "officeVisit" },
            "G0101": { type: "exact", icds: ["Z12.4"], fallback: "officeVisit" },
            "88150": { type: "exact", icds: ["Z12.4"], fallback: "officeVisit" },
            "88142": { type: "exact", icds: ["Z12.4"], fallback: "officeVisit" },
            "86480": { type: "exact", icds: ["Z11.1"], fallback: "officeVisit" },
            "S0612": { type: "multiICD", icds: [["Z11.51","Z12.4"]], fallback: "officeVisit" },
            "90460": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90461": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90471": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90472": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "G0008": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "G0009": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90674": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90686": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90688": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90715": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90746": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90589": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90700": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90702": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90696": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90697": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90723": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90698": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90633": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90740": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90743": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90744": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90747": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90647": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90648": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90651": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90707": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90710": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90619": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90620": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90621": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90624": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90734": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90623": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90732": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90671": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90677": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90713": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90680": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90681": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90714": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90622": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90611": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90716": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90749": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90656": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90657": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90658": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90660": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90661": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "91319": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "91320": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "91321": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "91322": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "91323": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "91304": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90480": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90380": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90381": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "90382": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "96380": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "96381": { type: "exact", icds: ["Z23"], fallback: "officeVisit" },
            "93000": { type: "customICDCollector", icdList: ecgICDs, fallback: "officeVisit", useRowOrder: true },
            "93005": { type: "customICDCollector", icdList: ecgICDs, fallback: "officeVisit", useRowOrder: true },
            "93010": { type: "customICDCollector", icdList: ecgICDs, fallback: "officeVisit", useRowOrder: true },
            "81025": { type: "exact", icds: ["Z32.00","Z32.01","Z32.02"], fallback: "officeVisit" },
            "83014": { type: "exact", icds: ["B96.81"], fallback: "officeVisit" },
            "86580": { type: "exact", icds: ["Z11.1"], fallback: "officeVisit" },
            "87811": { type: "exact", icds: ["Z11.52"], fallback: "officeVisit" },
            "92228": { type: "startsWith", icds: ["E11"], fallback: "officeVisit" },
            "92229": { type: "startsWith", icds: ["E11"], fallback: "officeVisit" },
            "92250": { type: "startsWith", icds: ["E11"], fallback: "officeVisit" },
            "82962": { type: "startsWith", icds: ["E11"], fallback: "officeVisit" },
            "94060": { type: "exact", icds: ["R06.2"], fallback: "officeVisit" },
            "96160": { type: "exact", icds: ["Z71.89"], fallback: "officeVisit" },
            "G9820": { type: "exact", icds: ["Z11.3"], fallback: "officeVisit" },
            "96372": { type: "customICDCollector", icdList: b12ICDs, fallback: "officeVisit" },
            "97802": { type: "customICDCollector", icdList: ["Y93.79","Y93.81"], fallback: "officeVisit" },
            "J3420": { type: "customICDCollector", icdList: b12ICDs, fallback: "officeVisit" },
            "99408": { type: "exact", icds: ["Z13.9"], fallback: "officeVisit" },
            "99173": { type: "exact", icds: ["Z01.00","Z00.01","Z00.121"], fallback: "officeVisit" },
            "82270": { type: "exact", icds: ["Z12.11"], fallback: "officeVisit" },
            "G0108": { type: "startsWith", icds: ["E11"], fallback: "officeVisit" },
            "2028F": { type: "startsWith", icds: ["E11"], fallback: "officeVisit" },
            "2023F": { type: "startsWith", icds: ["E11"], fallback: "officeVisit" },
            "4008F": { type: "startsWith", icds: ["I10"], fallback: "officeVisit" },
            "69209": { type: "startsWith", icds: ["H61"], fallback: "officeVisit" },
            "96210": { type: "startsWith", icds: ["H61"], fallback: "officeVisit" },
            "G0445": { type: "exact", icds: ["Z11.3"], fallback: "officeVisit" },
            "G0328": { type: "exact", icds: ["Z12.11"], fallback: "officeVisit" },
            "G0123": { type: "exact", icds: ["Z12.4"], fallback: "officeVisit" },
            "G2023": { type: "exact", icds: ["Z11.52"], fallback: "officeVisit" },
            "87110": { type: "exact", icds: ["Z11.8"], fallback: "officeVisit" },
            "82950": { type: "exact", icds: ["Z13.1"], fallback: "officeVisit" },
            "95251": { type: "exact", icds: ["E11.9"], fallback: "officeVisit" },
            "95249": { type: "exact", icds: ["Z46.89"], fallback: "officeVisit" },
            // Updated: Z12.31 (screening mammogram) takes priority, Z71.2 as fallback
            "3014F": { type: "exact", icds: ["Z12.31","Z71.2"], fallback: "officeVisit" },
            "3015F": { type: "exact", icds: ["Z12.4","Z71.2"], fallback: "officeVisit" },
            "3017F": { type: "multiICD", icds: [["Z12.11","Z71.2"]], fallback: "officeVisit" },
            "99211": { type: "officeVisit" },
            "99212": { type: "officeVisit" },
            "99213": { type: "officeVisit" },
            "99214": { type: "officeVisit" },
            "99215": { type: "officeVisit" },
            "99201": { type: "officeVisit" },
            "99202": { type: "officeVisit" },
            "99203": { type: "officeVisit" },
            "99204": { type: "officeVisit" },
            "99205": { type: "officeVisit" },
            "36415": { type: "labDrawThenZ13", icdList: labDrawICDs },
            "1111F": { type: "officeVisit" },
            "99051": { type: "officeVisit" },
            "82274": { type: "officeVisit" },
            "99000": { type: "officeVisit" }
        });
        return rules;
    }

    const cptRules = buildCPTRules();

    // ─── Core Functions ──────────────────────────────────────────────
    function officeVisit(cptCodes, icdRows, cptRows) {
        const topICDs = [];
        for (const row of icdRows) {
            const val = getBillingICDCode(row);
            if (!val) continue;
            if (val.startsWith('Z')) continue; // skip this Z row, keep scanning further rows
            const firstChar = val[0];
            if (firstChar >= 'A' && firstChar <= 'Y') {
                const rowNum = getBillingICDRowNumber(row);
                if (rowNum) topICDs.push(rowNum);
                if (topICDs.length === 4) break;
            }
        }
        if (!topICDs.length) return;

        cptCodes.forEach(code => {
            const matches = cptRows.filter(row => row.querySelector('td:nth-child(2)')?.textContent.trim() === code);
            matches.forEach(row => {
                clearICDSlots(row);
                topICDs.forEach((num, idx) => setICDSlot(row, idx + 1, num));
                refreshICDDisplay(row);
            });
        });
    }

    function matchICDsFromList(icdList, availableICDs) {
        const matched = [];
        icdList.forEach(code => {
            if (code.includes('.')) {
                const exact = availableICDs.find(i => i === code.toUpperCase());
                if (exact) matched.push(exact);
            } else {
                availableICDs.forEach(i => {
                    if (i.startsWith(code.toUpperCase())) matched.push(i);
                });
            }
        });
        return [...new Set(matched)];
    }

    // Billing-tab helper: get ICD code from a billing ICD row
    function getBillingICDCode(row) {
        return row.querySelector('td:nth-child(3)')?.textContent.trim().toUpperCase() || '';
    }

    // Billing-tab helper: get ICD row number from a billing ICD row
    function getBillingICDRowNumber(row) {
        return row.querySelector('td:first-child center')?.textContent.trim() || '';
    }

    function linkCPTGeneric(icdRows, cptRows) {
        const allICDs = icdRows.map(r => getBillingICDCode(r)).filter(Boolean);

        for (const [cpt, rule] of Object.entries(cptRules)) {
            const matches = cptRows.filter(row => row.querySelector('td:nth-child(2)')?.textContent.trim() === cpt);
            matches.forEach(row => {
                clearICDSlots(row);

                if (rule.type === "officeVisit") {
                    officeVisit([cpt], icdRows, cptRows);
                    return;
                }

                // ── labDrawThenZ13 (36415) ──────────────────────────────
                if (rule.type === "labDrawThenZ13") {
                    // Try priority chronic/metabolic ICD list first, in grid order
                    const matchedRows = icdRows.filter(r => {
                        const val = getBillingICDCode(r);
                        if (!val) return false;
                        return rule.icdList.some(code =>
                            code.includes('.') ? val === code.toUpperCase() : val.startsWith(code.toUpperCase())
                        );
                    });
                    if (matchedRows.length) {
                        matchedRows.slice(0, 4).forEach((icdRow, idx) => {
                            setICDSlot(row, idx + 1, getBillingICDRowNumber(icdRow));
                        });
                        refreshICDDisplay(row);
                        return;
                    }
                    // No priority match — office-visit if non-Z exists, else Z13.0
                    const hasNonZ = icdRows.some(r => {
                        const val = getBillingICDCode(r);
                        return val && !val.startsWith('Z');
                    });
                    if (hasNonZ) {
                        officeVisit([cpt], icdRows, cptRows);
                    } else {
                        const z13Row = icdRows.find(r => getBillingICDCode(r) === 'Z13.0');
                        if (z13Row) {
                            setICDSlot(row, 1, getBillingICDRowNumber(z13Row));
                            refreshICDDisplay(row);
                        }
                    }
                    return;
                }

                // ── bmiLink (3008F, G8420, G8418, G8417, 2010F) ─────────
                if (cpt === "3008F" || rule.type === "bmiLink") {
                    let slot = 1;
                    const priorityICDs = ["Z00.01","Z00.121","Z00.00","Z00.129","E66.3","E66.9","E66.01","E66.09","R63.6"];
                    let firstRowNum = null;
                    for (const code of priorityICDs) {
                        const found = icdRows.find(r => getBillingICDCode(r) === code);
                        if (found) {
                            firstRowNum = getBillingICDRowNumber(found);
                            break;
                        }
                    }
                    if (!firstRowNum) {
                        for (const r of icdRows) {
                            const val = getBillingICDCode(r);
                            if (val && !val.startsWith('Z')) {
                                firstRowNum = getBillingICDRowNumber(r);
                                break;
                            }
                        }
                    }
                    if (firstRowNum) {
                        setICDSlot(row, 1, firstRowNum);
                        slot = 2;
                    }
                    const z68Row = icdRows.find(r => getBillingICDCode(r).startsWith("Z68"));
                    if (z68Row && slot <= 4) {
                        setICDSlot(row, slot, getBillingICDRowNumber(z68Row));
                    }
                    refreshICDDisplay(row);
                    return;
                }

                // ── painLink (1125F, 0521F) ─────────────────────────────
                if (rule.type === "painLink") {
                    const painRows = icdRows.filter(r => isPainRelatedICD(getBillingICDCode(r)));
                    if (painRows.length) {
                        painRows.slice(0, 4).forEach((icdRow, idx) => {
                            setICDSlot(row, idx + 1, getBillingICDRowNumber(icdRow));
                        });
                        refreshICDDisplay(row);
                        return;
                    }
                    // No pain-related ICD — fall back to office visit
                    officeVisit([cpt], icdRows, cptRows);
                    return;
                }

                // ── chronicLink (99497, 1157F) ──────────────────────────
                if (rule.type === "chronicLink") {
                    const chronicRows = icdRows.filter(r => CHRONIC_CODES.has(getBillingICDCode(r)));
                    if (chronicRows.length) {
                        chronicRows.slice(0, 4).forEach((icdRow, idx) => {
                            setICDSlot(row, idx + 1, getBillingICDRowNumber(icdRow));
                        });
                        refreshICDDisplay(row);
                        return;
                    }
                    officeVisit([cpt], icdRows, cptRows);
                    return;
                }

                // ── 99173 eye exam ──────────────────────────────────────
                if (cpt === "99173") {
                    // Try eye-related ICD rows first
                    const eyeRows = icdRows.filter(r => isEyeICD(getBillingICDCode(r)));
                    if (eyeRows.length) {
                        eyeRows.slice(0, 4).forEach((icdRow, idx) => {
                            setICDSlot(row, idx + 1, getBillingICDRowNumber(icdRow));
                        });
                        refreshICDDisplay(row);
                        return;
                    }
                    // Fall back to preventive-visit ICDs
                    const fallbackCodes = ["Z01.00", "Z00.01", "Z00.121"];
                    const fallbackRow = icdRows.find(r => fallbackCodes.includes(getBillingICDCode(r)));
                    if (fallbackRow) {
                        const rowNum = getBillingICDRowNumber(fallbackRow);
                        if (rowNum) {
                            setICDSlot(row, 1, rowNum);
                            refreshICDDisplay(row);
                            return;
                        }
                    }
                    // Last resort: standard office-visit linking
                    officeVisit([cpt], icdRows, cptRows);
                    return;
                }

                if (rule.type === "customICDCollector") {
                    let matchedRows = [];
                    if (rule.useRowOrder) {
                        matchedRows = icdRows.filter(r => {
                            const val = getBillingICDCode(r);
                            if (!val) return false;
                            return rule.icdList.some(code =>
                                code.includes('.') ? val === code.toUpperCase() : val.startsWith(code.toUpperCase())
                            );
                        });
                    } else {
                        const matchedICDs = matchICDsFromList(rule.icdList, allICDs);
                        matchedRows = matchedICDs
                            .map(icd => icdRows.find(r => getBillingICDCode(r) === icd))
                            .filter(Boolean);
                    }
                    if (matchedRows.length) {
                        matchedRows.slice(0, 4).forEach((icdRow, idx) => {
                            setICDSlot(row, idx + 1, getBillingICDRowNumber(icdRow));
                        });
                    } else if (rule.fallback === "officeVisit") {
                        officeVisit([cpt], icdRows, cptRows);
                    }
                    refreshICDDisplay(row);
                    return;
                }

                const icdGroups = Array.isArray(rule.icds[0]) ? rule.icds : [rule.icds];
                let foundAny = false;
                icdGroups.forEach((options, idx) => {
                    let found = null;
                    for (const code of options) {
                        const rowMatch = icdRows.find(r => {
                            const icdVal = getBillingICDCode(r);
                            if (!icdVal) return false;
                            return code.length <= 3 ? icdVal.startsWith(code) : icdVal === code;
                        });
                        if (rowMatch) { found = rowMatch; break; }
                    }
                    if (found) {
                        const rowNum = getBillingICDRowNumber(found);
                        if (rowNum) {
                            setICDSlot(row, idx + 1, rowNum);
                            foundAny = true;
                        }
                    }
                });
                if (!foundAny && rule.fallback === "officeVisit") {
                    officeVisit([cpt], icdRows, cptRows);
                }
                refreshICDDisplay(row);
            });
        }
    }

    function handleUnlistedCPTs(cptRows) {
        const icdRows = getICDRows();
        cptRows.forEach(row => {
            const cptCode = row.querySelector("td:nth-child(2)")?.textContent.trim();
            if (cptCode && !cptRules[cptCode]) {
                officeVisit([cptCode], icdRows, cptRows);
            }
        });
    }

    function alertDuplicateICDStart(icdRows) {
        const prefixesMap = {};
        for (const row of icdRows) {
            const icdVal = getBillingICDCode(row);
            if (!icdVal || icdVal.length < 3) continue;
            const prefix = icdVal.slice(0, 3);
            if (prefix.startsWith("Z")) continue;
            if (!prefixesMap[prefix]) prefixesMap[prefix] = [];
            prefixesMap[prefix].push(icdVal);
        }
        const duplicates = Object.values(prefixesMap).filter(arr => arr.length > 1);
        if (duplicates.length) {
            const msg = duplicates.map(arr => arr.join(", ")).join(" | ");
            showNotification([`Duplicate ICD prefix conflict: ${msg}`]);
        }
    }

    // ─── ICD ordering check: diagnosis (non-Z) code below a Z code ──────
    function checkICDOrderZBeforeDx(icdRows) {
        let seenZ = false;
        const outOfOrder = [];
        for (const row of icdRows) {
            const val = getBillingICDCode(row);
            if (!val) continue;
            if (val.startsWith('Z')) {
                seenZ = true;
                continue;
            }
            if (seenZ) outOfOrder.push(val);
        }
        if (outOfOrder.length) {
            const unique = [...new Set(outOfOrder)];
            showNotification([`Diagnosis code(s) ${unique.join(", ")} found below a Z code — reorder ICD list`]);
        }
    }

    // ─── Diabetes + Prediabetes conflict check ─────────────────────────
    function checkDiabetesPrediabetesConflict(icdRows) {
        const codes = icdRows.map(r => getBillingICDCode(r)).filter(Boolean);
        const hasDiabetes = codes.some(code => /^E0[89]|^E1[0-3]|^O24/.test(code));
        const hasPrediabetes = codes.some(code => code === 'R73.03' || code.startsWith('R7303'));
        if (hasDiabetes && hasPrediabetes) {
            showNotification(['Diabetes and Prediabetes (R73.03) both present — remove one']);
        }
    }

    function alertDuplicateCPT(cptRows) {
        const cptMap = {};
        for (const row of cptRows) {
            const cptVal = row.querySelector('td:nth-child(2)')?.textContent.trim();
            if (!cptVal) continue;
            if (!cptMap[cptVal]) cptMap[cptVal] = [];
            cptMap[cptVal].push(cptVal);
        }
        const duplicates = Object.values(cptMap).filter(arr => arr.length > 1);
        if (duplicates.length) {
            const msg = duplicates.map(arr => arr[0]).join(", ");
            showNotification([`Duplicate CPT(s) detected: ${msg}`]);
        }
    }

    function validatePreventiveCPT(cptRows) {
        const age = getPatientAge();
        if (age === null) return;

        const warnings = [];
        for (const row of cptRows) {
            const cpt = row.querySelector('td:nth-child(2)')?.textContent.trim();
            if (!cpt || !PREVENTIVE_RULES[cpt]) continue;
            const { min, max } = PREVENTIVE_RULES[cpt];
            if (age < min || age > max) {
                const correct = Object.entries(PREVENTIVE_RULES)
                    .filter(([k, r]) => age >= r.min && age <= r.max)
                    .map(([k]) => k)
                    .join(", ");
                warnings.push(`CPT ${cpt} unsuitable for age ${age}. Suggested: ${correct}`);
            }
        }
        if (warnings.length) {
            showNotification(warnings);
        }
    }

    // ─── SL modifier for paediatric vaccines ──────────────────────────
    function applySLModifierForPedsVaccines() {
        const age = getPatientAge();
        if (age === null || age >= 19) return;

        const slModifierCPTs = new Set([
            "90380","90381","90382","90480","90589","90611","90619","90620","90621","90622","90623","90624","90633",
            "90647","90648","90651","90656","90657","90658","90660","90661","90671","90674","90677","90680","90681",
            "90686","90688","90696","90697","90698","90700","90702","90707","90710","90713","90714","90715","90716",
            "90723","90732","90734","90740","90743","90744","90746","90747","90749","91304","91319","91320","91321",
            "91322","91323","96380","96381"
        ]);

        const tbody = document.querySelector("#billingTbl4 tbody");
        if (!tbody) return;
        const rows = Array.from(tbody.querySelectorAll("tr[ng-repeat]"));

        rows.forEach(row => {
            const cptCode = row.querySelector("td:nth-child(2)")?.textContent.trim();
            if (!cptCode || !slModifierCPTs.has(cptCode)) return;

            try {
                const scope = angular.element(row).scope();
                if (scope) {
                    scope.$applyAsync(() => {
                        if (scope.cpt) scope.cpt.mod1 = "SL";
                    });
                } else {
                    const modInput = row.querySelector('input[data-fieldname="mod1"]') ||
                                     row.querySelector('input[name="mod1"]') ||
                                     row.querySelector('input[id*="mod1"]');
                    if (modInput) {
                        modInput.focus();
                        modInput.value = "SL";
                        modInput.dispatchEvent(new Event("input", { bubbles: true }));
                        modInput.dispatchEvent(new Event("change", { bubbles: true }));
                        modInput.blur();
                    }
                }
            } catch (e) {
                console.error("SL modifier error:", cptCode, e);
            }
        });
        tbody.dispatchEvent(new Event("mouseup", { bubbles: true }));
    }

    // ─── 99214 eligibility check (4+ diseases, ≥1 chronic) ─────────────
    function checkChronicDiseaseCountFor99214(icdRows) {
        const codes = new Set();
        icdRows.forEach(row => {
            const rawText = row.querySelector('td:nth-child(3)')?.textContent;
            const code = extractICDCode(rawText);
            if (!code) return;
            if (code.startsWith('Z')) return;
            if (EXCLUDED_ICDS.has(code)) return;
            codes.add(code);
        });

        console.log('[99214 check] counted codes:', Array.from(codes));

        if (codes.size < 4) return;

        const hasChronic = Array.from(codes).some(code =>
            CHRONIC_CODES.has(code)
        );

        if (hasChronic) {
            showNotification(["99214 can be added"], false);
        }
    }

    // ─── L21.x age-appropriateness check ────────────────────────────────
    let lastL21NotifyTime = 0;
    function checkForL21(icdRows) {
        const age = getPatientAge();
        if (age === null) return;

        const l21Codes = icdRows
            .map(row => extractICDCode(row.querySelector('td:nth-child(3)')?.textContent))
            .filter(code => code && code.startsWith('L21'));
        if (!l21Codes.length) return;

        const uniqueCodes = [...new Set(l21Codes)];
        let mismatched = [];

        if (age < 18) {
            mismatched = uniqueCodes.filter(code => code !== 'L21.0');
            if (mismatched.length) {
                const now = Date.now();
                if (now - lastL21NotifyTime < 2000) return;
                lastL21NotifyTime = now;
                showNotification([`Patient is ${age} (under 18) — use L21.0 instead of ${mismatched.join(", ")}`]);
            }
        } else {
            mismatched = uniqueCodes.filter(code => code === 'L21.0');
            if (mismatched.length) {
                const now = Date.now();
                if (now - lastL21NotifyTime < 2000) return;
                lastL21NotifyTime = now;
                showNotification([`Patient is ${age} (18+) — use L21.9/L21.8 instead of L21.0`]);
            }
        }
    }

    // ─── Malignant neoplasm (C-code) ICD warning ───────────────────────
    function checkForCancerICD(icdRows) {
        const cCodes = icdRows
            .map(r => getBillingICDCode(r))
            .filter(code => code && code.startsWith('C'));
        if (cCodes.length) {
            const unique = [...new Set(cCodes)];
            showNotification([`ICD code(s) ${unique.join(", ")} start with "C" (malignant neoplasm) — please verify`]);
        }
    }

    // ─── Flu vaccine CPT presence check (90686 / 90688) ────────────────
    function checkForFluVaccineCPTs(cptRows) {
        const targetCodes = new Set(["90686", "90688"]);
        const present = cptRows
            .map(row => row.querySelector('td:nth-child(2)')?.textContent.trim())
            .filter(code => targetCodes.has(code));
        if (present.length) {
            const unique = [...new Set(present)];
            showNotification([`CPT ${unique.join(", ")} present on this claim`]);
        }
    }

    // ─── Medicare preventive CPT rule (9939x / 9938x invalid) ──────────
    function checkMedicarePreventiveCPT(cptRows) {
        // This check requires insurance info which may not be available on
        // the billing tab. Attempt to read it from the page if present.
        // If not available, skip silently.
        const insuranceSpans = document.querySelectorAll('.insurance-name, [data-fieldname*="Insurance"]');
        let primaryName = null;
        insuranceSpans.forEach(el => {
            const txt = (el.value || el.textContent || '').trim();
            if (txt && !primaryName) primaryName = txt;
        });
        if (!primaryName) return;
        if (!primaryName.toUpperCase().includes('MEDICARE')) return;

        const invalidCodes = cptRows
            .map(row => row.querySelector('td:nth-child(2)')?.textContent.trim())
            .filter(code => /^9939\d$/.test(code) || /^9938\d$/.test(code));

        if (!invalidCodes.length) return;

        const unique = [...new Set(invalidCodes)];
        showNotification([`Add G0438/G0439 — ${unique.join(", ")} is invalid for Medicare`]);
    }

    // ─── Main Flow ─────────────────────────────────────────────────────
    function mainFlow() {
        const icdRows = getICDRows();
        const cptRows = getCPTRows();

        linkCPTGeneric(icdRows, cptRows);
        handleUnlistedCPTs(cptRows);
        applySLModifierForPedsVaccines();
        alertDuplicateICDStart(icdRows);
        checkICDOrderZBeforeDx(icdRows);
        alertDuplicateCPT(cptRows);
        validatePreventiveCPT(cptRows);
        checkChronicDiseaseCountFor99214(icdRows);
        checkForL21(icdRows);
        checkForCancerICD(icdRows);
        checkDiabetesPrediabetesConflict(icdRows);
        checkForFluVaccineCPTs(cptRows);
        checkMedicarePreventiveCPT(cptRows);
    }

    // ─── Boot ──────────────────────────────────────────────────────────
    function waitForTables() {
        if (!document.querySelector("#billingTbl4") || !document.querySelector("#billingTbl2")) {
            return setTimeout(waitForTables, 500);
        }
        createButton();
    }

      function createButton() {
        if (document.getElementById("ecwLinkBtnNoDelete")) return;
        const btn = document.createElement("button");
        btn.id = "ecwLinkBtnNoDelete";
        btn.innerText = "Link";
        Object.assign(btn.style, {
            position: "fixed",
            top: "60px",
            left: "calc(100% - 280px)",
            padding: "9px 14px",
            zIndex: "999999",
            background: "#FF0000",
            color: "#fff",
            fontSize: "13px",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
            boxShadow: "0 3px 8px rgba(0,0,0,0.25)",
            transition: "background 0.3s"
        });
        btn.addEventListener("mouseenter", () => { btn.style.background = "#8c8c8c"; });
        btn.addEventListener("mouseleave", () => { btn.style.background = "#FF0000"; });
        btn.addEventListener("click", mainFlow);
        document.body.appendChild(btn);
    }

    waitForTables();
})();
