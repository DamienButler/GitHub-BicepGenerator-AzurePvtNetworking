/**
 * Azure Private Networking Bicep File Generator
 * Generates NSG Bicep files for GitHub-hosted runners with Azure VNET
 */

(function () {
    'use strict';

    // ===== Base IPs (from github.com docs) =====

    const BASE_ACTIONS_IPS = [
        '4.175.114.51/32',
        '20.102.35.120/32',
        '4.175.114.43/32',
        '20.72.125.48/32',
        '20.19.5.100/32',
        '20.7.92.46/32',
        '20.232.252.48/32',
        '52.186.44.51/32',
        '20.22.98.201/32',
        '20.246.184.240/32',
        '20.96.133.71/32',
        '20.253.2.203/32',
        '20.102.39.220/32',
        '20.81.127.181/32',
        '52.148.30.208/32',
        '20.14.42.190/32',
        '20.85.159.192/32',
        '52.224.205.173/32',
        '20.118.176.156/32',
        '20.236.207.188/32',
        '20.242.161.191/32',
        '20.166.216.139/32',
        '20.253.126.26/32',
        '52.152.245.137/32',
        '40.118.236.116/32',
        '20.185.75.138/32',
        '20.96.226.211/32',
        '52.167.78.33/32',
        '20.105.13.142/32',
        '20.253.95.3/32',
        '20.221.96.90/32',
        '51.138.235.85/32',
        '52.186.47.208/32',
        '20.7.220.66/32',
        '20.75.4.210/32',
        '20.120.75.171/32',
        '20.98.183.48/32',
        '20.84.200.15/32',
        '20.14.235.135/32',
        '20.10.226.54/32',
        '20.22.166.15/32',
        '20.65.21.88/32',
        '20.102.36.236/32',
        '20.124.56.57/32',
        '20.94.100.174/32',
        '20.102.166.33/32',
        '20.31.193.160/32',
        '20.232.77.7/32',
        '20.102.38.122/32',
        '20.102.39.57/32',
        '20.85.108.33/32',
        '40.88.240.168/32',
        '20.69.187.19/32',
        '20.246.192.124/32',
        '20.4.161.108/32',
        '20.22.22.84/32',
        '20.1.250.47/32',
        '20.237.33.78/32',
        '20.242.179.206/32',
        '40.88.239.133/32',
        '20.121.247.125/32',
        '20.106.107.180/32',
        '20.22.118.40/32',
        '20.15.240.48/32',
        '20.84.218.150/32'
    ];

    const BASE_GITHUB_IPS = [
        '140.82.112.0/20',
        '143.55.64.0/20',
        '185.199.108.0/22',
        '192.30.252.0/22',
        '20.175.192.146/32',
        '20.175.192.147/32',
        '20.175.192.149/32',
        '20.175.192.150/32',
        '20.199.39.227/32',
        '20.199.39.228/32',
        '20.199.39.231/32',
        '20.199.39.232/32',
        '20.200.245.241/32',
        '20.200.245.245/32',
        '20.200.245.246/32',
        '20.200.245.247/32',
        '20.200.245.248/32',
        '20.201.28.144/32',
        '20.201.28.148/32',
        '20.201.28.149/32',
        '20.201.28.151/32',
        '20.201.28.152/32',
        '20.205.243.160/32',
        '20.205.243.164/32',
        '20.205.243.165/32',
        '20.205.243.166/32',
        '20.205.243.168/32',
        '20.207.73.82/32',
        '20.207.73.83/32',
        '20.207.73.85/32',
        '20.207.73.86/32',
        '20.207.73.88/32',
        '20.217.135.1/32',
        '20.233.83.145/32',
        '20.233.83.146/32',
        '20.233.83.147/32',
        '20.233.83.149/32',
        '20.233.83.150/32',
        '20.248.137.48/32',
        '20.248.137.49/32',
        '20.248.137.50/32',
        '20.248.137.52/32',
        '20.248.137.55/32',
        '20.26.156.215/32',
        '20.26.156.216/32',
        '20.26.156.211/32',
        '20.27.177.113/32',
        '20.27.177.114/32',
        '20.27.177.116/32',
        '20.27.177.117/32',
        '20.27.177.118/32',
        '20.29.134.17/32',
        '20.29.134.18/32',
        '20.29.134.19/32',
        '20.29.134.23/32',
        '20.29.134.24/32',
        '20.87.245.0/32',
        '20.87.245.1/32',
        '20.87.245.4/32',
        '20.87.245.6/32',
        '20.87.245.7/32',
        '4.208.26.196/32',
        '4.208.26.197/32',
        '4.208.26.198/32',
        '4.208.26.199/32',
        '4.208.26.200/32',
        '4.225.11.196/32',
        '4.237.22.32/32'
    ];

    // ===== Data Residency Region IPs =====
    // These are added to AllowOutBoundGitHub for GHE.com data residency

    const REGION_DATA = {
        eu: {
            name: 'EU',
            actionsIPs: [
                '74.241.192.231/32',
                '20.4.161.108/32',
                '74.241.204.117/32',
                '20.31.193.160/32'
            ],
            regionIPs: [
                '108.143.197.176/28',
                '20.123.213.96/28',
                '20.224.46.144/28',
                '20.240.194.240/28',
                '20.240.220.192/28',
                '20.240.211.208/28',
                '108.143.221.96/28',
                '20.61.46.32/28',
                '20.224.62.160/28',
                '51.12.252.16/28',
                '74.241.131.48/28',
                '20.240.211.176/28'
            ]
        },
        australia: {
            name: 'Australia',
            actionsIPs: [
                '4.147.140.77/32',
                '20.53.114.78/32'
            ],
            regionIPs: [
                '4.237.73.192/28',
                '20.5.226.112/28',
                '20.248.163.176/28',
                '20.5.34.240/28',
                '20.5.146.128/28',
                '68.218.155.16/28'
            ]
        },
        japan: {
            name: 'Japan',
            actionsIPs: [
                '20.63.233.164/32',
                '172.192.153.164/32'
            ],
            regionIPs: [
                '74.226.88.241/32',
                '40.81.176.225/32',
                '4.190.169.240/32',
                '74.226.88.192/28',
                '74.226.88.240/28',
                '40.81.180.112/28',
                '40.81.176.224/28',
                '4.190.169.192/28',
                '4.190.169.240/28'
            ]
        },
        us: {
            name: 'US',
            actionsIPs: [],
            regionIPs: [
                '20.221.76.128/28',
                '74.249.180.192/28',
                '135.233.115.208/28',
                '48.214.149.96/28',
                '20.118.27.192/28',
                '172.202.123.176/28'
            ]
        }
    };

    // ===== Expose shared data for the validator (js/validator.js) =====
    // Small refactor: validator reuses these source-of-truth arrays so we never
    // duplicate range data between the generator and the validator.
    window.BicepData = Object.freeze({
        BASE_ACTIONS_IPS,
        BASE_GITHUB_IPS,
        REGION_DATA
    });

    // ===== DOM =====
    const generateBtn = document.getElementById('generate-btn');
    const regionGroup = document.getElementById('region-group');
    const previewSection = document.getElementById('preview-section');
    const previewContainer = document.getElementById('preview-container');
    const detailsGrid = document.getElementById('details-grid');
    const updatesContainer = document.getElementById('updates-container');

    // ===== Load Updates =====
    const UPDATES_DATA_URL = 'data/updates.json';
    let updatesData = null;

    async function fetchUpdatesData() {
        try {
            const response = await fetch(UPDATES_DATA_URL);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            updatesData = await response.json();
            renderUpdates();
        } catch (err) {
            console.warn('No updates data available:', err.message);
            updatesData = [];
            renderUpdates();
        }
    }

    function renderUpdates() {
        if (!updatesData || updatesData.length === 0) {
            updatesContainer.innerHTML = `
                <div class="no-updates">
                    <div class="no-updates-icon">📋</div>
                    <p><strong>No updates recorded yet</strong></p>
                    <p style="margin-top: 8px; font-size: 0.8125rem;">
                        The daily monitoring workflow will begin tracking changes to the GitHub docs once configured.<br>
                        Updates will appear here showing added or removed IP ranges from the bicep prerequisites and GHE.com network details pages.
                    </p>
                </div>`;
            return;
        }

        let html = '';
        for (const update of updatesData) {
            const addedCount = update.changes ? update.changes.filter(c => c.type === 'added').length : 0;
            const removedCount = update.changes ? update.changes.filter(c => c.type === 'removed').length : 0;

            html += `
                <div class="update-entry">
                    <div class="update-header" onclick="toggleUpdate(this)">
                        <div class="update-date">
                            <span class="update-date-icon">📅</span>
                            ${escapeHTML(update.date)}
                        </div>
                        <div class="update-summary">
                            ${addedCount > 0 ? `<span class="update-badge badge-added">+${addedCount} added</span>` : ''}
                            ${removedCount > 0 ? `<span class="update-badge badge-removed">-${removedCount} removed</span>` : ''}
                            <svg class="chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6 9 12 15 18 9"/>
                            </svg>
                        </div>
                    </div>
                    <div class="update-body">
                        <ul class="update-changes-list">`;

            if (update.changes) {
                for (const change of update.changes) {
                    html += `
                        <li class="update-change-item">
                            <span class="change-type ${change.type}">${change.type}</span>
                            <span class="change-range">${escapeHTML(change.range)}</span>
                            <span class="change-service">${escapeHTML(change.source)}</span>
                        </li>`;
                }
            }

            html += `
                        </ul>
                    </div>
                </div>`;
        }

        updatesContainer.innerHTML = html;
    }

    window.toggleUpdate = function (header) {
        const body = header.nextElementSibling;
        const chevron = header.querySelector('.chevron');
        body.classList.toggle('open');
        chevron.classList.toggle('open');
    };

    // Fetch updates on load
    fetchUpdatesData();

    // ===== Events =====
    document.querySelectorAll('input[name="platform"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'ghecom') {
                regionGroup.classList.remove('hidden');
            } else {
                regionGroup.classList.add('hidden');
            }
        });
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
        });
    });

    // Top-level view switcher (Generate Bicep / Validate Existing Config)
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.view-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            document.getElementById(`${btn.dataset.view}-view`).classList.add('active');
        });
    });

    generateBtn.addEventListener('click', () => {
        const platform = document.querySelector('input[name="platform"]:checked').value;
        const region = document.querySelector('input[name="region"]:checked').value;
        const bicep = generateBicep(platform, region);
        showPreview(bicep, platform, region);
        renderDetails(platform, region);
    });

    // ===== Bicep Generation =====
    function generateBicep(platform, region) {
        let githubIPs = [...BASE_GITHUB_IPS];

        // For GHE.com data residency, add region-specific IPs to AllowOutBoundGitHub
        if (platform === 'ghecom') {
            const data = REGION_DATA[region];
            if (data) {
                githubIPs = githubIPs.concat(data.actionsIPs).concat(data.regionIPs);
            }
        }

        const indent = '            ';
        const actionsIPBlock = BASE_ACTIONS_IPS.map(ip => `${indent}'${ip}'`).join('\n');
        const githubIPBlock = githubIPs.map(ip => `${indent}'${ip}'`).join('\n');

        return `@description('NSG for outbound rules')
param location string
param nsgName string = 'actions_NSG'

resource actions_NSG 'Microsoft.Network/networkSecurityGroups@2017-06-01' = {
  name: nsgName
  location: location
  properties: {
    securityRules: [
      {
        name: 'AllowVnetOutBoundOverwrite'
        properties: {
          protocol: 'TCP'
          sourcePortRange: '*'
          destinationPortRange: '443'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: 'VirtualNetwork'
          access: 'Allow'
          priority: 200
          direction: 'Outbound'
          destinationAddressPrefixes: []
        }
      }
      {
        name: 'AllowOutBoundActions'
        properties: {
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '443'
          sourceAddressPrefix: '*'
          access: 'Allow'
          priority: 210
          direction: 'Outbound'
          destinationAddressPrefixes: [
${actionsIPBlock}
          ]
        }
      }
      {
        name: 'AllowOutBoundGitHub'
        properties: {
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '443'
          sourceAddressPrefix: '*'
          access: 'Allow'
          priority: 220
          direction: 'Outbound'
          destinationAddressPrefixes: [
${githubIPBlock}
          ]
        }
      }
      {
        name: 'AllowStorageOutbound'
        properties: {
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '443'
          sourceAddressPrefix: '*'
          destinationAddressPrefix: 'Storage'
          access: 'Allow'
          priority: 230
          direction: 'Outbound'
          destinationAddressPrefixes: []
        }
      }
    ]
  }
}
`;
    }

    // ===== Preview =====
    function showPreview(bicep, platform, region) {
        previewSection.classList.remove('hidden');

        const label = platform === 'github.com'
            ? 'GitHub.com'
            : `GHE.com — ${REGION_DATA[region].name}`;

        previewContainer.innerHTML = `
            <div class="result-card">
                <div class="result-header">
                    <div class="result-icon found">✓</div>
                    <div>
                        <div class="result-title">Bicep File Generated</div>
                        <div class="result-subtitle">
                            Configuration: <strong>${escapeHTML(label)}</strong> — <code>actions-nsg-deployment.bicep</code>
                        </div>
                    </div>
                </div>
                <div class="result-body">
                    <div class="preview-actions">
                        <button class="download-btn primary" id="download-bicep-btn">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                            </svg>
                            Download Bicep File
                        </button>
                        <button class="download-btn" id="copy-bicep-btn">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                            </svg>
                            Copy to Clipboard
                        </button>
                    </div>
                    <div class="bicep-preview">${escapeHTML(bicep)}</div>
                </div>
            </div>`;

        document.getElementById('download-bicep-btn').addEventListener('click', () => {
            downloadFile('actions-nsg-deployment.bicep', bicep, 'text/plain');
        });

        document.getElementById('copy-bicep-btn').addEventListener('click', (e) => {
            navigator.clipboard.writeText(bicep).then(() => {
                const btn = e.currentTarget;
                const origText = btn.innerHTML;
                btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
                setTimeout(() => { btn.innerHTML = origText; }, 2000);
            });
        });

        previewSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ===== Details Rendering =====
    function renderDetails(platform, region) {
        let html = '';

        // AllowOutBoundActions IPs
        html += renderIPCard('AllowOutBoundActions', BASE_ACTIONS_IPS, 'Base Actions IPs', 'base');

        // AllowOutBoundGitHub IPs
        html += renderIPCard('AllowOutBoundGitHub — Base', BASE_GITHUB_IPS, 'Base GitHub IPs', 'base');

        if (platform === 'ghecom') {
            const data = REGION_DATA[region];
            if (data && data.actionsIPs.length > 0) {
                html += renderIPCard(`AllowOutBoundGitHub — ${data.name} Actions IPs`, data.actionsIPs, 'Added for data residency', 'actions');
            }
            if (data && data.regionIPs.length > 0) {
                html += renderIPCard(`AllowOutBoundGitHub — ${data.name} Region IPs`, data.regionIPs, 'Added for data residency', 'region');
            }
            if (data && data.actionsIPs.length === 0 && data.regionIPs.length === 0) {
                html += `<div class="details-placeholder"><p>No additional region-specific IPs are currently documented for the <strong>${data.name}</strong> region. The base GitHub.com IPs will be used.</p></div>`;
            }
        }

        detailsGrid.innerHTML = html;

        // Activate the details tab
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.querySelector('.tab-btn[data-tab="details"]').classList.add('active');
        document.getElementById('details-tab').classList.add('active');
    }

    function renderIPCard(title, ips, subtitle, badgeType) {
        const cardId = `card-${title.replace(/\W+/g, '-').toLowerCase()}`;
        let html = `
            <div class="service-card" id="${cardId}">
                <div class="service-card-header" onclick="toggleCard('${cardId}')">
                    <div class="service-card-title-row">
                        <svg class="chevron service-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"/>
                        </svg>
                        <span class="service-card-name">${escapeHTML(title)}</span>
                        <span class="badge badge-${badgeType}">${escapeHTML(subtitle)}</span>
                    </div>
                    <span class="service-card-count">${ips.length} IPs</span>
                </div>
                <div class="service-card-body">
                    <ul class="service-ranges-list">`;

        for (const ip of ips) {
            html += `<li class="service-range-item"><code>${escapeHTML(ip)}</code></li>`;
        }

        html += `</ul></div></div>`;
        return html;
    }

    // ===== Helpers =====
    function downloadFile(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    window.toggleCard = function (cardId) {
        const card = document.getElementById(cardId);
        if (!card) return;
        card.classList.toggle('expanded');
        const chevron = card.querySelector('.service-chevron');
        if (chevron) chevron.classList.toggle('open');
    };

})();
