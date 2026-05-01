/**
 * IP Monitor Script
 * 
 * Scrapes the GitHub docs for:
 *   1. github.com bicep prerequisites page — base Actions IPs and GitHub IPs
 *   2. GHE.com network details page — data residency region IPs for Azure private networking
 *
 * Compares with stored snapshot, records changes, and updates js/app.js with new IPs.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_PATH = path.join(ROOT, 'data', 'snapshots.json');
const UPDATES_PATH = path.join(ROOT, 'data', 'updates.json');
const APP_JS_PATH = path.join(ROOT, 'js', 'app.js');

const BICEP_PAGE = 'https://docs.github.com/en/enterprise-cloud@latest/admin/configuring-settings/configuring-private-networking-for-hosted-compute-products/configuring-private-networking-for-github-hosted-runners-in-your-enterprise';
const GHE_NETWORK_PAGE = 'https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/network-details-for-ghecom';

// ===== Helpers =====

function extractIPsFromText(text) {
    // Match IPv4 addresses and CIDR ranges. Two challenges with the rendered
    // docs page text:
    //
    //  1. Cheerio concatenates table cells without separators
    //     (e.g. ".../28108.143..."). We pre-inject a space when a CIDR
    //     prefix is immediately followed by what looks like the start of
    //     ANOTHER IP. Constraining the lookahead to `\d{1,3}\.` prevents
    //     the greedy `\d{1,2}` from backtracking and chopping legit prefixes
    //     like `/32'` (must NOT become `/3 2'`).
    //
    //  2. Cells are sometimes glued onto trailing label text (e.g.
    //     "ingress traffic20.5.34.240/28..."). A simple `\b` boundary
    //     fails here because both `c` and `2` are word characters, so the
    //     first IP would be silently skipped. We use a lookbehind that
    //     excludes only `[\d.]` instead — that's the only context where a
    //     leading digit could legitimately be part of a longer IP.
    const separated = text.replace(/(\/\d{1,2})(?=\d{1,3}\.)/g, '$1 ');
    const ipv4Regex = /(?<![\d.])\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\/\d{1,2})?(?![\d.])/g;
    const matches = separated.match(ipv4Regex) || [];
    return [...new Set(matches.filter(ip => {
        const parts = ip.split('/')[0].split('.');
        if (!parts.every(p => /^\d+$/.test(p) && parseInt(p, 10) <= 255)) return false;
        const slash = ip.split('/')[1];
        if (slash !== undefined && parseInt(slash, 10) > 32) return false;
        return true;
    }))];
}

async function fetchPage(url) {
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'GitHub-Bicep-IP-Monitor/1.0'
        }
    });
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    return await res.text();
}

// ===== Scraping =====

async function scrapeBicepPage() {
    console.log('Fetching bicep prerequisites page...');
    const html = await fetchPage(BICEP_PAGE);
    const $ = cheerio.load(html);

    // Find the bicep code block
    const codeBlocks = $('pre code').toArray();
    
    let actionsIPs = [];
    let githubIPs = [];

    for (const block of codeBlocks) {
        const text = $(block).text();
        
        // Look for the bicep file content
        if (text.includes('AllowOutBoundActions') && text.includes('AllowOutBoundGitHub')) {
            // Extract AllowOutBoundActions IPs
            const actionsMatch = text.match(/name:\s*'AllowOutBoundActions'[\s\S]*?destinationAddressPrefixes:\s*\[([\s\S]*?)\]/);
            if (actionsMatch) {
                actionsIPs = extractIPsFromText(actionsMatch[1]);
            }

            // Extract AllowOutBoundGitHub IPs
            const githubMatch = text.match(/name:\s*'AllowOutBoundGitHub'[\s\S]*?destinationAddressPrefixes:\s*\[([\s\S]*?)\]/);
            if (githubMatch) {
                githubIPs = extractIPsFromText(githubMatch[1]);
            }
            break;
        }
    }

    console.log(`  Found ${actionsIPs.length} Actions IPs, ${githubIPs.length} GitHub IPs`);
    return { actionsIPs, githubIPs };
}

async function scrapeGHENetworkPage() {
    console.log('Fetching GHE.com network details page...');
    const html = await fetchPage(GHE_NETWORK_PAGE);
    const $ = cheerio.load(html);

    const regions = {};
    const regionConfigs = [
        { key: 'eu', name: 'EU' },
        { key: 'australia', name: 'Australia' },
        { key: 'japan', name: 'Japan' },
        { key: 'us', name: 'US' }
    ];

    // ---- Pass 1: "IP ranges for Azure private networking" subsection ----
    // The page has multiple h4 region headings (also under "Domains for Azure
    // private networking"). To avoid clobbering, walk only the h4s that sit
    // between the "IP ranges for Azure private networking" h3 and the next h3.
    const ipRangesH3 = $('h3').filter((_, el) =>
        /IP ranges for Azure private networking/i.test($(el).text())
    ).first();

    const scopedH4s = [];
    if (ipRangesH3.length) {
        let cur = ipRangesH3.next();
        while (cur.length && cur.prop('tagName') !== 'H3') {
            if (cur.prop('tagName') === 'H4') scopedH4s.push(cur.get(0));
            cur = cur.next();
        }
    }

    for (const section of scopedH4s) {
        const heading = $(section).text().trim();
        const config = regionConfigs.find(r => r.name === heading || heading.startsWith(r.name));
        if (!config) continue;

        // Collect text from siblings until next h3/h4
        let text = '';
        let next = $(section).next();
        while (next.length && !['H3', 'H4'].includes(next.prop('tagName'))) {
            text += ' ' + next.text();
            next = next.next();
        }

        const actionsMatch = text.match(/Actions\s+IPs?:?\s*([\s\S]*?)(?:region|$)/i);
        const regionMatch = text.match(/region:?\s*([\s\S]*?)$/i);
        const actionsIPs = actionsMatch ? extractIPsFromText(actionsMatch[1]) : [];
        const regionIPs = regionMatch ? extractIPsFromText(regionMatch[1]) : [];

        regions[config.key] = {
            name: config.name,
            actionsIPs: actionsIPs.map(ip => ip.includes('/') ? ip : `${ip}/32`),
            regionIPs: regionIPs.map(ip => ip.includes('/') ? ip : `${ip}/32`)
        };
        console.log(`  [private-networking] ${config.name}: ${actionsIPs.length} Actions, ${regionIPs.length} Region IPs`);
    }

    // ---- Pass 2: "GitHub's IP addresses" section (h3 + per-region h3) ----
    // This is where the US ranges live, and where extra EU/AU/JP ranges appear
    // that aren't repeated in the private-networking subsection. We MERGE into
    // the existing region.regionIPs (deduped) so we don't lose either set.
    //
    // The page nests headings in different DOM containers from their content,
    // so DOM-tree traversal is unreliable. Instead, take a flattened text view
    // of the body and slice between heading boundaries by text.
    //
    // IMPORTANT: strip <script> contents first. The page embeds a Next.js
    // JSON payload that includes raw escape-sequence text like "\u003eThe EU"
    // — those characters become real characters in `.text()` and break our
    // word-boundary anchors (`\b`) by gluing word chars onto our markers.
    $('script, style, noscript').remove();
    const bodyText = $('body').text();
    const findAll = (re) => {
        const out = [];
        const r = new RegExp(re.source, re.flags.replace('g', '') + 'g');
        let m; while ((m = r.exec(bodyText))) out.push(m.index);
        return out;
    };
    const startIdxs = findAll(/GitHub's IP addresses/i);
    const endIdxs   = findAll(/Supported regions for Azure private networking/i);
    // For each start, pair it with the *immediately-following* end (natural
    // section span). Then pick the pair with the largest gap — TOC and footer
    // pairs have small gaps; the real content pair is much larger.
    let ghIpsStart = -1, ghIpsEnd = -1, bestGap = 0;
    for (const s of startIdxs) {
        const e = endIdxs.find(x => x > s);
        if (e !== undefined && (e - s) > bestGap) {
            bestGap = e - s;
            ghIpsStart = s;
            ghIpsEnd = e;
        }
    }

    if (ghIpsStart >= 0 && ghIpsEnd > ghIpsStart) {
        const section = bodyText.slice(ghIpsStart, ghIpsEnd);
        // Region headings inside this section appear as standalone words
        // ("The EU", "Australia", "US", "Japan") in document order.
        const markers = [
            { key: 'eu',        re: /\bThe\s+EU\b/i },
            { key: 'australia', re: /\bAustralia\b/i },
            { key: 'us',        re: /\bUS\b/ },
            { key: 'japan',     re: /\bJapan\b/i }
        ];
        const found = markers
            .map(m => ({ ...m, idx: section.search(m.re) }))
            .filter(m => m.idx >= 0)
            .sort((a, b) => a.idx - b.idx);

        for (let i = 0; i < found.length; i++) {
            const start = found[i].idx;
            const end = i + 1 < found.length ? found[i + 1].idx : section.length;
            const chunk = section.slice(start, end);
            const ips = extractIPsFromText(chunk).map(ip => ip.includes('/') ? ip : `${ip}/32`);
            const cfg = regionConfigs.find(r => r.key === found[i].key);
            if (!regions[cfg.key]) {
                regions[cfg.key] = { name: cfg.name, actionsIPs: [], regionIPs: [] };
            }
            const merged = new Set([...regions[cfg.key].regionIPs, ...ips]);
            regions[cfg.key].regionIPs = [...merged];
            console.log(`  [github-ips]          ${cfg.name}: ${ips.length} IPs (merged → ${regions[cfg.key].regionIPs.length} total)`);
        }
    }

    return regions;
}

// ===== Comparison =====

function compareArrays(oldArr, newArr, source) {
    const changes = [];
    const oldSet = new Set(oldArr || []);
    const newSet = new Set(newArr || []);

    for (const ip of newSet) {
        if (!oldSet.has(ip)) {
            changes.push({ type: 'added', range: ip, source });
        }
    }
    for (const ip of oldSet) {
        if (!newSet.has(ip)) {
            changes.push({ type: 'removed', range: ip, source });
        }
    }
    return changes;
}

function compareSnapshots(oldSnap, newSnap) {
    const changes = [];

    // Compare base Actions IPs
    changes.push(...compareArrays(oldSnap.actionsIPs, newSnap.actionsIPs, 'AllowOutBoundActions'));

    // Compare base GitHub IPs
    changes.push(...compareArrays(oldSnap.githubIPs, newSnap.githubIPs, 'AllowOutBoundGitHub'));

    // Compare each region
    const allRegions = new Set([
        ...Object.keys(oldSnap.regions || {}),
        ...Object.keys(newSnap.regions || {})
    ]);

    for (const region of allRegions) {
        const oldRegion = (oldSnap.regions || {})[region] || {};
        const newRegion = (newSnap.regions || {})[region] || {};
        const regionName = newRegion.name || oldRegion.name || region;

        changes.push(...compareArrays(
            oldRegion.actionsIPs,
            newRegion.actionsIPs,
            `${regionName} Actions IPs`
        ));
        changes.push(...compareArrays(
            oldRegion.regionIPs,
            newRegion.regionIPs,
            `${regionName} Region IPs`
        ));
    }

    return changes;
}

// ===== Update app.js =====

/**
 * Safety check: refuse to overwrite good data with empty data — and refuse
 * suspicious shrinkage (>50% loss). If a previously-populated array would
 * become empty or shrink dramatically, we abort and keep the last-known-good
 * snapshot. Returns a list of error messages (empty = OK).
 */
function detectDataLoss(oldSnap, newSnap) {
    const errors = [];
    const SHRINK_THRESHOLD = 0.5; // refuse if new size < 50% of old

    const checkArray = (label, oldArr, newArr) => {
        const oldN = oldArr?.length || 0;
        const newN = newArr?.length || 0;
        if (oldN > 0 && newN === 0) {
            errors.push(`${label} would be emptied (${oldN} → 0)`);
        } else if (oldN >= 4 && newN < oldN * SHRINK_THRESHOLD) {
            // Only flag suspicious shrinkage on lists with at least 4 entries
            // (small lists can legitimately churn a lot).
            errors.push(`${label} would shrink suspiciously (${oldN} → ${newN})`);
        }
    };

    checkArray('BASE_ACTIONS_IPS', oldSnap.actionsIPs, newSnap.actionsIPs);
    checkArray('BASE_GITHUB_IPS', oldSnap.githubIPs, newSnap.githubIPs);

    const oldRegions = oldSnap.regions || {};
    const newRegions = newSnap.regions || {};
    for (const key of Object.keys(oldRegions)) {
        const o = oldRegions[key] || {};
        const n = newRegions[key] || {};
        if (!newRegions[key]) {
            errors.push(`REGION_DATA.${key} would be removed entirely`);
            continue;
        }
        checkArray(`REGION_DATA.${key}.actionsIPs`, o.actionsIPs, n.actionsIPs);
        checkArray(`REGION_DATA.${key}.regionIPs`, o.regionIPs, n.regionIPs);
    }
    return errors;
}

function updateAppJS(snapshot) {
    console.log('Updating js/app.js with new IPs...');
    let content = fs.readFileSync(APP_JS_PATH, 'utf8');

    // Helper to format an IP array as JS source
    const formatArray = (arr, indent = '        ') =>
        arr.map(ip => `${indent}'${ip}'`).join(',\n');

    // Replace BASE_ACTIONS_IPS
    content = content.replace(
        /const BASE_ACTIONS_IPS = \[[\s\S]*?\];/,
        `const BASE_ACTIONS_IPS = [\n${formatArray(snapshot.actionsIPs)}\n    ];`
    );

    // Replace BASE_GITHUB_IPS
    content = content.replace(
        /const BASE_GITHUB_IPS = \[[\s\S]*?\];/,
        `const BASE_GITHUB_IPS = [\n${formatArray(snapshot.githubIPs)}\n    ];`
    );

    // Replace REGION_DATA
    const regionEntries = Object.entries(snapshot.regions).map(([key, data]) => {
        const actionsStr = data.actionsIPs.length > 0
            ? `[\n${formatArray(data.actionsIPs, '                ')}\n            ]`
            : '[]';
        const regionStr = data.regionIPs.length > 0
            ? `[\n${formatArray(data.regionIPs, '                ')}\n            ]`
            : '[]';

        return `        ${key}: {
            name: '${data.name}',
            actionsIPs: ${actionsStr},
            regionIPs: ${regionStr}
        }`;
    }).join(',\n');

    content = content.replace(
        /const REGION_DATA = \{[\s\S]*?\n    \};/,
        `const REGION_DATA = {\n${regionEntries}\n    };`
    );

    fs.writeFileSync(APP_JS_PATH, content, 'utf8');
    console.log('  js/app.js updated.');
}

// ===== Main =====

async function main() {
    // Ensure data directory exists
    const dataDir = path.join(ROOT, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    // Load existing snapshot
    let oldSnapshot = { actionsIPs: [], githubIPs: [], regions: {} };
    if (fs.existsSync(SNAPSHOT_PATH)) {
        oldSnapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    }

    // Scrape current data
    const { actionsIPs, githubIPs } = await scrapeBicepPage();
    const regions = await scrapeGHENetworkPage();

    const newSnapshot = {
        lastUpdated: new Date().toISOString(),
        actionsIPs,
        githubIPs,
        regions
    };

    // Guardrail: never let a flaky scrape wipe out good data.
    const dataLoss = detectDataLoss(oldSnapshot, newSnapshot);
    if (dataLoss.length > 0) {
        console.error('\n❌ Refusing to update — scrape would lose data:');
        for (const e of dataLoss) console.error(`  - ${e}`);
        console.error('\nKeeping last-known-good snapshot. Investigate the scraper or the docs page structure.');
        process.exit(1);
    }

    // Compare
    const changes = compareSnapshots(oldSnapshot, newSnapshot);

    if (changes.length > 0) {
        console.log(`\n🔄 ${changes.length} change(s) detected:`);
        for (const c of changes) {
            console.log(`  ${c.type === 'added' ? '+' : '-'} ${c.range} (${c.source})`);
        }

        // Load existing updates
        let updates = [];
        if (fs.existsSync(UPDATES_PATH)) {
            updates = JSON.parse(fs.readFileSync(UPDATES_PATH, 'utf8'));
        }

        // Prepend new update entry
        updates.unshift({
            date: new Date().toISOString().split('T')[0],
            changes
        });

        // Keep last 100 entries
        updates = updates.slice(0, 100);

        // Write updates
        fs.writeFileSync(UPDATES_PATH, JSON.stringify(updates, null, 2), 'utf8');
        console.log('  data/updates.json updated.');

        // Write snapshot
        fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(newSnapshot, null, 2), 'utf8');
        console.log('  data/snapshots.json updated.');

        // Update app.js
        updateAppJS(newSnapshot);
    } else {
        console.log('\n✅ No changes detected.');
        // Still update the lastUpdated timestamp
        newSnapshot.lastUpdated = new Date().toISOString();
        fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(newSnapshot, null, 2), 'utf8');
    }
}

main().catch(err => {
    console.error('❌ Monitor failed:', err);
    process.exit(1);
});
