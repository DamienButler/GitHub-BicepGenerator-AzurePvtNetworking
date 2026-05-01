/**
 * Validate Existing Config — MVP
 *
 * Lets a user paste an existing Azure private-networking config (CIDR list or
 * Bicep file) and checks whether it covers the GitHub IP/CIDR ranges expected
 * for the selected platform (GitHub.com or GHE.com data residency region).
 *
 * Range data is read from `window.BicepData` exposed by `js/app.js` so the
 * generator and validator share a single source of truth.
 *
 * All processing is client-side. Exposed globals:
 *   - window.CidrUtils   (pure helpers, used by tests/cidr-utils.test.html)
 *   - window.Validator   (validate / build summary)
 */

(function () {
    'use strict';

    // ===== CIDR utilities =====================================================

    const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
    const IPV4_RE   = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);
    // Used to extract CIDRs out of free-form text (e.g. a pasted Bicep file).
    const CIDR_EXTRACT_RE = new RegExp(
        `\\b${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}\\/(?:3[0-2]|[12]?\\d)\\b`,
        'g'
    );

    /** Convert dotted-quad IPv4 to a 32-bit unsigned integer, or null. */
    function ipToInt(ip) {
        if (typeof ip !== 'string' || !IPV4_RE.test(ip)) return null;
        const parts = ip.split('.');
        // `>>> 0` forces an unsigned 32-bit result.
        return (
            ((parseInt(parts[0], 10) << 24) |
             (parseInt(parts[1], 10) << 16) |
             (parseInt(parts[2], 10) << 8)  |
              parseInt(parts[3], 10)) >>> 0
        );
    }

    /** Validate IPv4 string. */
    function isValidIPv4(ip) {
        return ipToInt(ip) !== null;
    }

    /**
     * Parse a CIDR like "10.0.0.0/24" into { ip, prefix, network, broadcast }.
     * Returns null on invalid input. The `network` field is the canonical
     * starting integer of the block, regardless of host bits in the input.
     */
    function parseCIDR(cidr) {
        if (typeof cidr !== 'string') return null;
        const trimmed = cidr.trim();
        const slash = trimmed.indexOf('/');
        if (slash === -1) return null;
        const ipPart = trimmed.slice(0, slash);
        const prefixPart = trimmed.slice(slash + 1);
        if (!/^\d+$/.test(prefixPart)) return null;
        const prefix = parseInt(prefixPart, 10);
        if (prefix < 0 || prefix > 32) return null;
        const ipInt = ipToInt(ipPart);
        if (ipInt === null) return null;
        // Build the prefix mask. `>>> 0` keeps it unsigned.
        // Special-case /0 because shifting by 32 in JS is a no-op.
        const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
        const network = (ipInt & mask) >>> 0;
        const size = prefix === 0 ? 0x100000000 : (1 << (32 - prefix)) >>> 0;
        const broadcast = (network + size - 1) >>> 0;
        return { ip: ipPart, prefix, network, broadcast, mask, size, cidr: `${ipPart}/${prefix}` };
    }

    /** True if `outer` fully contains `inner` (both CIDR strings). */
    function cidrContains(outer, inner) {
        const o = parseCIDR(outer);
        const i = parseCIDR(inner);
        if (!o || !i) return false;
        // A CIDR contains another iff its prefix is shorter or equal AND the
        // inner block sits entirely inside the outer block.
        if (o.prefix > i.prefix) return false;
        return i.network >= o.network && i.broadcast <= o.broadcast;
    }

    /** True if a single IPv4 address sits inside a CIDR. */
    function ipInCidr(ip, cidr) {
        const ipInt = ipToInt(ip);
        const c = parseCIDR(cidr);
        if (ipInt === null || !c) return false;
        return ipInt >= c.network && ipInt <= c.broadcast;
    }

    /**
     * Extract CIDR strings from arbitrary text.
     *  - mode "cidr"  : one per line, also tolerates commas; whitespace trimmed.
     *  - mode "bicep" : pulls every IPv4 CIDR token out via regex.
     * Returns { valid: string[], invalid: string[] } where `invalid` lists
     * non-blank tokens that look CIDR-ish but failed to parse (cidr mode only).
     */
    function extractCidrs(text, mode) {
        const result = { valid: [], invalid: [] };
        if (typeof text !== 'string') return result;

        if (mode === 'bicep') {
            const matches = text.match(CIDR_EXTRACT_RE) || [];
            const seen = new Set();
            for (const m of matches) {
                if (parseCIDR(m) && !seen.has(m)) {
                    seen.add(m);
                    result.valid.push(m);
                }
            }
            return result;
        }

        // Default: cidr-list mode.
        const tokens = text
            .split(/[\s,]+/)        // newlines, spaces, commas
            .map(t => t.trim())
            .filter(Boolean);
        const seen = new Set();
        for (const tok of tokens) {
            if (parseCIDR(tok)) {
                if (!seen.has(tok)) { seen.add(tok); result.valid.push(tok); }
            } else {
                result.invalid.push(tok);
            }
        }
        return result;
    }

    // ===== Public CIDR namespace (also used by the test page) =================
    window.CidrUtils = Object.freeze({
        ipToInt, isValidIPv4, parseCIDR, cidrContains, ipInCidr, extractCidrs
    });

    // ===== Required ranges per selected platform/region =======================

    /**
     * Build the list of required CIDRs for the selected configuration.
     * We split into "buckets" (Actions, GitHub-base, Region-Actions, Region-IPs)
     * so the UI can group results meaningfully.
     */
    function getRequiredRanges(platform, region) {
        const data = window.BicepData;
        if (!data) return [];

        const buckets = [
            { label: 'AllowOutBoundActions', source: 'base-actions', cidrs: data.BASE_ACTIONS_IPS },
            { label: 'AllowOutBoundGitHub (base)', source: 'base-github', cidrs: data.BASE_GITHUB_IPS }
        ];

        if (platform === 'ghecom') {
            const region_data = data.REGION_DATA[region];
            if (region_data) {
                if (region_data.actionsIPs.length) {
                    buckets.push({
                        label: `AllowOutBoundGitHub (${region_data.name} Actions)`,
                        source: `region-${region}-actions`,
                        cidrs: region_data.actionsIPs
                    });
                }
                if (region_data.regionIPs.length) {
                    buckets.push({
                        label: `AllowOutBoundGitHub (${region_data.name} Region)`,
                        source: `region-${region}-ips`,
                        cidrs: region_data.regionIPs
                    });
                }
            }
        }

        // Flatten with bucket label attached for reporting.
        const flat = [];
        for (const b of buckets) {
            for (const c of b.cidrs) {
                flat.push({ cidr: c, bucket: b.label, source: b.source });
            }
        }
        return flat;
    }

    // ===== Core validation ====================================================

    /**
     * Validate `customerCidrs` against the required set.
     * For each required CIDR we look for any customer CIDR that contains it
     * (exact match or a broader/equal prefix). Coverage is tracked separately
     * from "exact" so we can show a "broader-than-required" count.
     */
    function validate(customerCidrs, requiredRanges) {
        const covered = [];   // { required, by, exact }
        const missing = [];   // required CIDRs no customer entry covers
        const broader = [];   // customer CIDRs that covered something with a wider prefix
        const broaderSet = new Set();
        const usedCustomer = new Set();

        for (const req of requiredRanges) {
            let match = null;
            let exact = false;
            for (const cust of customerCidrs) {
                if (cust === req.cidr) { match = cust; exact = true; break; }
                if (cidrContains(cust, req.cidr)) { match = cust; break; }
            }
            if (match) {
                covered.push({ required: req, by: match, exact });
                usedCustomer.add(match);
                if (!exact) {
                    const reqP = parseCIDR(req.cidr).prefix;
                    const custP = parseCIDR(match).prefix;
                    if (custP < reqP && !broaderSet.has(`${match}|${req.cidr}`)) {
                        broader.push({ customer: match, required: req });
                        broaderSet.add(`${match}|${req.cidr}`);
                    }
                }
            } else {
                missing.push(req);
            }
        }

        // Customer entries not used to cover any required range.
        const requiredSet = new Set(requiredRanges.map(r => r.cidr));
        const extra = customerCidrs.filter(c => !usedCustomer.has(c) && !requiredSet.has(c));

        return { covered, missing, broader, extra };
    }

    /** Look up each blocked IP against required ranges and customer CIDRs. */
    function lookupBlockedIPs(blockedText, requiredRanges, customerCidrs) {
        if (!blockedText || !blockedText.trim()) return [];
        const tokens = blockedText.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
        const results = [];
        for (const tok of tokens) {
            if (!isValidIPv4(tok)) {
                results.push({ ip: tok, status: 'invalid' });
                continue;
            }
            const reqHit = requiredRanges.find(r => ipInCidr(tok, r.cidr));
            const custHit = customerCidrs.find(c => ipInCidr(tok, c));
            if (reqHit && custHit) {
                results.push({ ip: tok, status: 'in-required-and-covered', requiredCidr: reqHit.cidr, requiredBucket: reqHit.bucket, customerCidr: custHit });
            } else if (reqHit) {
                results.push({ ip: tok, status: 'in-required-not-covered', requiredCidr: reqHit.cidr, requiredBucket: reqHit.bucket });
            } else if (custHit) {
                results.push({ ip: tok, status: 'not-in-required-but-in-customer', customerCidr: custHit });
            } else {
                results.push({ ip: tok, status: 'not-in-required' });
            }
        }
        return results;
    }

    window.Validator = Object.freeze({
        getRequiredRanges, validate, lookupBlockedIPs
    });

    // ===== UI wiring ==========================================================

    document.addEventListener('DOMContentLoaded', initUI);
    if (document.readyState !== 'loading') initUI();

    let initialised = false;
    function initUI() {
        if (initialised) return;
        initialised = true;

        const validateBtn   = document.getElementById('validate-btn');
        const platformInputs = document.querySelectorAll('input[name="v-platform"]');
        const regionGroup   = document.getElementById('v-region-group');
        const resultsSection = document.getElementById('v-results-section');
        const resultsContainer = document.getElementById('v-results-container');
        if (!validateBtn) return; // validator markup not present

        platformInputs.forEach(r => r.addEventListener('change', e => {
            if (e.target.value === 'ghecom') regionGroup.classList.remove('hidden');
            else regionGroup.classList.add('hidden');
        }));

        validateBtn.addEventListener('click', () => {
            const platform = document.querySelector('input[name="v-platform"]:checked').value;
            const region   = document.querySelector('input[name="v-region"]:checked').value;
            const inputType = document.querySelector('input[name="v-input-type"]:checked').value;
            const configText = document.getElementById('v-config-input').value;
            const blockedText = document.getElementById('v-blocked-input').value;

            const required = getRequiredRanges(platform, region);
            const extracted = extractCidrs(configText, inputType);
            const result   = validate(extracted.valid, required);
            const blocked  = lookupBlockedIPs(blockedText, required, extracted.valid);

            renderResults({
                platform, region, inputType,
                required, customerCidrs: extracted.valid, invalidEntries: extracted.invalid,
                result, blocked
            });
        });
    }

    // ===== Rendering ==========================================================

    function escapeHTML(str) {
        const d = document.createElement('div');
        d.textContent = String(str);
        return d.innerHTML;
    }

    function platformLabel(platform, region) {
        if (platform === 'github.com') return 'GitHub.com';
        const data = window.BicepData?.REGION_DATA?.[region];
        return `GHE.com — ${data ? data.name : region}`;
    }

    function renderResults(ctx) {
        const { platform, region, required, customerCidrs, invalidEntries, result, blocked } = ctx;
        const totalRequired = required.length;
        const coveredCount  = result.covered.length;
        const missingCount  = result.missing.length;
        const broaderCount  = result.broader.length;
        const extraCount    = result.extra.length;
        const invalidCount  = invalidEntries.length;
        const passing       = missingCount === 0 && totalRequired > 0;

        const statusClass = passing ? 'pass' : 'warn';
        const statusIcon  = passing ? '✓' : '!';
        const statusTitle = passing ? 'Pass — all required ranges covered'
                                    : 'Needs changes — one or more required ranges missing';

        const summaryMd = buildCustomerSummary(ctx, passing);
        const patchSnippet = buildPatchSnippet(result.missing);

        let html = `
        <div class="result-card">
            <div class="result-header">
                <div class="result-icon ${statusClass}">${statusIcon}</div>
                <div>
                    <div class="result-title">${escapeHTML(statusTitle)}</div>
                    <div class="result-subtitle">
                        Configuration: <strong>${escapeHTML(platformLabel(platform, region))}</strong>
                    </div>
                </div>
            </div>
            <div class="result-body">
                <div class="v-stats">
                    <div class="v-stat"><span class="v-stat-label">Required</span><span class="v-stat-value">${totalRequired}</span></div>
                    <div class="v-stat ${coveredCount ? 'ok' : ''}"><span class="v-stat-label">Covered</span><span class="v-stat-value">${coveredCount}</span></div>
                    <div class="v-stat ${missingCount ? 'bad' : ''}"><span class="v-stat-label">Missing</span><span class="v-stat-value">${missingCount}</span></div>
                    <div class="v-stat ${broaderCount ? 'info' : ''}"><span class="v-stat-label">Broader coverage</span><span class="v-stat-value">${broaderCount}</span></div>
                    <div class="v-stat"><span class="v-stat-label">Extra pasted</span><span class="v-stat-value">${extraCount}</span></div>
                    <div class="v-stat ${invalidCount ? 'bad' : ''}"><span class="v-stat-label">Invalid entries</span><span class="v-stat-value">${invalidCount}</span></div>
                </div>`;

        // Sections
        html += renderSection('Missing required ranges', 'bad', result.missing.map(r =>
            `<code>${escapeHTML(r.cidr)}</code> <span class="v-muted">— ${escapeHTML(r.bucket)}</span>`
        ));

        html += renderSection('Broader customer ranges used for coverage', 'info', result.broader.map(b =>
            `<code>${escapeHTML(b.customer)}</code> covers <code>${escapeHTML(b.required.cidr)}</code> <span class="v-muted">(${escapeHTML(b.required.bucket)})</span>`
        ));

        html += renderSection(`Covered required ranges (${coveredCount})`, 'ok', result.covered.map(c =>
            `<code>${escapeHTML(c.required.cidr)}</code> <span class="v-muted">via</span> <code>${escapeHTML(c.by)}</code> ${c.exact ? '<span class="v-pill ok">exact</span>' : '<span class="v-pill info">contained</span>'}`
        ), /*collapsed*/ true);

        html += renderSection('Extra pasted ranges (not required)', 'neutral', result.extra.map(e =>
            `<code>${escapeHTML(e)}</code>`
        ), true);

        html += renderSection('Invalid entries', 'bad', invalidEntries.map(e =>
            `<code>${escapeHTML(e)}</code>`
        ));

        // Blocked IP lookups
        if (blocked.length) {
            const items = blocked.map(b => {
                switch (b.status) {
                    case 'invalid':
                        return `<code>${escapeHTML(b.ip)}</code> <span class="v-pill bad">invalid IPv4</span>`;
                    case 'in-required-and-covered':
                        return `<code>${escapeHTML(b.ip)}</code> is in required range <code>${escapeHTML(b.requiredCidr)}</code> and is covered by your config (<code>${escapeHTML(b.customerCidr)}</code>) <span class="v-pill ok">covered</span>`;
                    case 'in-required-not-covered':
                        return `<code>${escapeHTML(b.ip)}</code> is in required range <code>${escapeHTML(b.requiredCidr)}</code> but is <strong>not covered</strong> by your pasted config <span class="v-pill bad">gap</span>`;
                    case 'not-in-required-but-in-customer':
                        return `<code>${escapeHTML(b.ip)}</code> is not in any expected GitHub range, but is allowed by <code>${escapeHTML(b.customerCidr)}</code> <span class="v-pill info">unexpected</span>`;
                    default:
                        return `<code>${escapeHTML(b.ip)}</code> does not match the expected ranges for the selected product/region <span class="v-pill neutral">unrelated</span>`;
                }
            });
            html += renderSection('Blocked IP lookup results', 'info', items);
        }

        // Suggested patch
        if (patchSnippet) {
            html += `
            <div class="v-section">
                <div class="v-section-header">
                    <span class="v-section-title">Suggested Bicep snippet</span>
                    <button class="download-btn" id="v-copy-patch-btn">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                        Copy snippet
                    </button>
                </div>
                <p class="v-muted" style="margin-bottom:10px;">
                    Merge these into the appropriate outbound allow rule (typically <code>AllowOutBoundGitHub</code> or <code>AllowOutBoundActions</code>). Do not blindly replace your whole file.
                </p>
                <pre class="bicep-preview">${escapeHTML(patchSnippet)}</pre>
            </div>`;
        }

        // Customer-ready summary
        html += `
            <div class="v-section">
                <div class="v-section-header">
                    <span class="v-section-title">Customer-ready summary</span>
                    <button class="download-btn" id="v-copy-summary-btn">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                        Copy summary
                    </button>
                </div>
                <pre class="bicep-preview">${escapeHTML(summaryMd)}</pre>
            </div>
        </div></div>`;

        const resultsSection = document.getElementById('v-results-section');
        const resultsContainer = document.getElementById('v-results-container');
        resultsContainer.innerHTML = html;
        resultsSection.classList.remove('hidden');

        // Wire copy buttons
        const copyPatch = document.getElementById('v-copy-patch-btn');
        if (copyPatch && patchSnippet) {
            copyPatch.addEventListener('click', () => copyText(copyPatch, patchSnippet));
        }
        const copySummary = document.getElementById('v-copy-summary-btn');
        if (copySummary) {
            copySummary.addEventListener('click', () => copyText(copySummary, summaryMd));
        }

        // Wire collapsible sections
        resultsContainer.querySelectorAll('.v-section.collapsible .v-section-header').forEach(h => {
            h.addEventListener('click', () => h.parentElement.classList.toggle('open'));
        });

        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function renderSection(title, tone, items, collapsible = false) {
        if (!items || items.length === 0) return '';
        const cls = `v-section tone-${tone}` + (collapsible ? ' collapsible' : '');
        const lis = items.map(i => `<li>${i}</li>`).join('');
        return `
        <div class="${cls}">
            <div class="v-section-header">
                <span class="v-section-title">${escapeHTML(title)} <span class="v-count">(${items.length})</span></span>
                ${collapsible ? '<svg class="chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' : ''}
            </div>
            <ul class="v-list">${lis}</ul>
        </div>`;
    }

    function buildPatchSnippet(missing) {
        if (!missing.length) return '';
        const lines = missing.map(m => `      '${m.cidr}'`).join('\n');
        return `// Add the following CIDRs to the appropriate destinationAddressPrefixes\n// (e.g. inside the AllowOutBoundGitHub rule).\ndestinationAddressPrefixes: [\n${lines}\n]\n`;
    }

    function buildCustomerSummary(ctx, passing) {
        const label = platformLabel(ctx.platform, ctx.region);
        if (passing) {
            return `# GitHub Private Networking — Config Validation\n\n` +
                   `**Platform:** ${label}\n` +
                   `**Result:** ✅ Pass\n\n` +
                   `The supplied configuration appears to cover all required GitHub ranges for the selected product and region. ` +
                   `No missing required CIDRs were detected from the pasted input.\n\n` +
                   `- Required ranges checked: ${ctx.required.length}\n` +
                   `- Covered: ${ctx.result.covered.length}\n` +
                   `- Broader-than-required coverage: ${ctx.result.broader.length}\n` +
                   `- Extra pasted ranges: ${ctx.result.extra.length}\n`;
        }
        const missingList = ctx.result.missing.map(m => `- \`${m.cidr}\` (${m.bucket})`).join('\n');
        return `# GitHub Private Networking — Config Validation\n\n` +
               `**Platform:** ${label}\n` +
               `**Result:** ⚠️ Needs changes\n\n` +
               `The supplied configuration does not appear to include all required GitHub ranges for the selected product and region. ` +
               `The following ranges are missing and should be reviewed in the outbound allow rule for GitHub traffic ` +
               `(typically \`AllowOutBoundGitHub\` or \`AllowOutBoundActions\`):\n\n` +
               `${missingList}\n\n` +
               `- Required ranges checked: ${ctx.required.length}\n` +
               `- Covered: ${ctx.result.covered.length}\n` +
               `- Missing: ${ctx.result.missing.length}\n` +
               `- Broader-than-required coverage: ${ctx.result.broader.length}\n` +
               `- Extra pasted ranges: ${ctx.result.extra.length}\n`;
    }

    function copyText(btn, text) {
        navigator.clipboard.writeText(text).then(() => {
            const orig = btn.innerHTML;
            btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
            setTimeout(() => { btn.innerHTML = orig; }, 1800);
        });
    }

})();
