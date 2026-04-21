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
    // Match IPv4 addresses and CIDR ranges
    const ipv4Regex = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\/\d{1,2})?)\b/g;
    const matches = text.match(ipv4Regex) || [];
    // Filter out things that aren't valid IPs (e.g. version numbers)
    return [...new Set(matches.filter(ip => {
        const parts = ip.split('/')[0].split('.');
        return parts.every(p => parseInt(p) <= 255);
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
    const fullText = $('body').text();

    // Parse each region's Azure private networking IPs
    const regionConfigs = [
        { key: 'eu', name: 'EU' },
        { key: 'australia', name: 'Australia' },
        { key: 'japan', name: 'Japan' },
        { key: 'us', name: 'US' }
    ];

    // Find the "IP ranges for Azure private networking" section
    // We'll parse the text content looking for region headers and IP lists
    const sections = $('h4').toArray();

    for (const section of sections) {
        const heading = $(section).text().trim();
        const config = regionConfigs.find(r => r.name === heading || heading.startsWith(r.name));
        if (!config) continue;

        // Collect text from siblings until next h4 or h3
        let text = '';
        let next = $(section).next();
        while (next.length && !['H3', 'H4'].includes(next.prop('tagName'))) {
            text += ' ' + next.text();
            next = next.next();
        }

        // Look for Actions IPs and Region IPs
        const actionsMatch = text.match(/Actions\s+IPs?:?\s*([\s\S]*?)(?:region|$)/i);
        const regionMatch = text.match(/region:?\s*([\s\S]*?)$/i);

        const actionsIPs = actionsMatch ? extractIPsFromText(actionsMatch[1]) : [];
        const regionIPs = regionMatch ? extractIPsFromText(regionMatch[1]) : [];

        // Ensure /32 suffix on single IPs
        regions[config.key] = {
            name: config.name,
            actionsIPs: actionsIPs.map(ip => ip.includes('/') ? ip : `${ip}/32`),
            regionIPs: regionIPs.map(ip => ip.includes('/') ? ip : `${ip}/32`)
        };

        console.log(`  ${config.name}: ${actionsIPs.length} Actions IPs, ${regionIPs.length} Region IPs`);
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
