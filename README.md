# Azure Private Networking Bicep Generator

A client-side web application that generates `actions-nsg-deployment.bicep` files for configuring Azure private networking with GitHub-hosted runners.

## Features

- **GitHub.com Support** — Generate the standard Bicep file with base NSG rules
- **GHE.com Data Residency** — Automatically includes region-specific Actions IPs and ingress IP ranges for EU, Australia, US, and Japan
- **Validate Existing Config** — Paste a CIDR list or an existing Bicep file and check whether it covers the required GitHub IP ranges (with CIDR-containment logic, blocked-IP lookup, and a copy/paste patch snippet)
- **Daily monitoring** — A scheduled GitHub Actions workflow scrapes the GitHub docs each day and records any IP changes to `data/updates.json`
- **Instant Download** — Download the generated `.bicep` file directly from your browser
- **Copy to Clipboard** — Quick copy for pasting into your editor
- **IP Details View** — Inspect all IP ranges included in the generated file
- **Fully Client-Side** — No data is sent to any backend server

## How It Works

### Generating Bicep

1. Select your platform — **GitHub.com** or **GHE.com** (data residency)
2. If using GHE.com, choose your data residency region (EU, Australia, US, Japan)
3. Click **Generate & Download** to create and download the `actions-nsg-deployment.bicep` file
4. Use the file with the Azure CLI deployment script as described in the [prerequisites documentation](https://docs.github.com/en/enterprise-cloud@latest/admin/configuring-settings/configuring-private-networking-for-hosted-compute-products/configuring-private-networking-for-github-hosted-runners-in-your-enterprise#prerequisites)

### Validating an existing config

1. Switch to the **Validate Existing Config** tab
2. Pick the same platform/region the config was deployed for
3. Choose **Paste CIDR list** or **Paste Bicep**, then paste the content
4. Optionally paste blocked IPs from firewall/proxy logs to look up
5. Click **Validate**. The result panel reports:
   - Required ranges covered, missing, or covered by a broader customer CIDR
   - Extra pasted ranges and invalid entries
   - A suggested Bicep snippet for any missing CIDRs
   - A customer-ready Markdown summary you can copy

All validation runs locally in the browser. No pasted content is uploaded.

### Where the IP data comes from (Recent Updates)

The generator and validator read from a single source-of-truth in `js/app.js`:

- `BASE_ACTIONS_IPS` — the IPs in the docs sample bicep `AllowOutBoundActions` rule
- `BASE_GITHUB_IPS` — the IPs in the docs sample bicep `AllowOutBoundGitHub` rule
- `REGION_DATA[<region>]` — per-region `actionsIPs` and `regionIPs` for GHE.com data residency

These constants are kept current by a daily monitoring workflow:

| Component | Path | Role |
|---|---|---|
| Workflow | `.github/workflows/monitor-ips.yml` | Runs daily at 06:00 UTC and on manual dispatch |
| Scraper | `scripts/monitor.js` | Fetches the two docs pages, parses IPs, diffs against the snapshot |
| Snapshot | `data/snapshots.json` | Last-known-good state used for diffing |
| Updates log | `data/updates.json` | Per-day diffs rendered in the **Recent Updates** tab |
| Source page 1 | [Bicep prerequisites](https://docs.github.com/en/enterprise-cloud@latest/admin/configuring-settings/configuring-private-networking-for-hosted-compute-products/configuring-private-networking-for-github-hosted-runners-in-your-enterprise) | `BASE_*` arrays |
| Source page 2 | [GHE.com network details](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/network-details-for-ghecom) | `REGION_DATA` (both the *IP ranges for Azure private networking* subsection **and** the broader *GitHub's IP addresses → \<region\>* tables — the latter is the only place US ranges are documented) |

When the scrape produces a diff, the workflow:

1. Prepends a new `{ date, kind: "auto", changes: [...] }` entry to `data/updates.json`
2. Overwrites `data/snapshots.json` with the new state
3. Auto-rewrites `BASE_ACTIONS_IPS`, `BASE_GITHUB_IPS`, and `REGION_DATA` in `js/app.js`
4. Commits the changes back to `main` so GitHub Pages redeploys

#### Safety guardrails

The scraper refuses to overwrite known-good data when:

- A previously-populated array would become empty
- A list with 4+ entries would shrink by more than 50%
- A whole region key would disappear from `REGION_DATA`

If any of these trigger, the workflow exits non-zero and the snapshot/`app.js` are left untouched. This protects against transient docs-page rendering issues.

#### Update entry kinds

Each entry in `data/updates.json` carries a `kind` field that controls how the **Recent Updates** tab labels it. Operators can edit entries by hand to set the right kind and add a `note` for context.

| `kind` | Badge | When to use it |
|---|---|---|
| `auto` *(default, written by the workflow)* | none | A real diff between yesterday's snapshot and today's scrape — i.e. GitHub published changed IPs |
| `backfill` | purple **backfill** badge | The scraper itself was improved and is now capturing IPs that were always required but previously missed. The IPs are not new from GitHub — only newly visible to this tool. Add a `note` explaining what changed in the scraper. |
| `manual` | orange **manual** badge | A human-curated correction (e.g. you spotted a missing IP in the docs and added it ahead of the next scrape). Add a `note` to record the rationale. |

##### Worked example

The `2026-05-01` entry in `data/updates.json` is marked `kind: "backfill"` because the scraper was improved that day to also read the per-region tables under *GitHub's IP addresses* on the GHE.com docs page. The 15 "added" IPs were already documented and required — they just hadn't been captured before. This is shown in the UI with a purple **backfill** badge and an inline note so users don't think GitHub published 15 new ranges in a single day.

#### Adding a manual or backfill entry

Edit `data/updates.json` directly and prepend an object such as:

```json
{
  "date": "2026-06-15",
  "kind": "manual",
  "note": "Added ahead of the next scheduled scrape — confirmed with GitHub Support ticket #12345.",
  "changes": [
    { "type": "added", "range": "10.0.0.0/24", "source": "Australia Region IPs" }
  ]
}
```

Then update `js/app.js` (`REGION_DATA`) and `data/snapshots.json` to match, so the next scheduled monitor run doesn't immediately diff back the change.

## Data Residency Regions

For GHE.com data residency, the following additional IPs are added to the `AllowOutBoundGitHub` NSG rule:

| Region | Actions IPs | Region IPs |
|--------|------------|------------|
| EU | 4 | 12 |
| Australia | 2 | 6 |
| Japan | 2 | 9 |
| US | 0 *(none documented)* | 6 |

Counts are kept up to date by the daily monitor — see **[Where the IP data comes from](#where-the-ip-data-comes-from-recent-updates)** below.

## Setup for GitHub Pages

1. Push this repository to GitHub
2. Go to **Settings → Pages**
3. Set the source to **Deploy from a branch** → `main` → `/ (root)`
4. The site will be available at `https://<username>.github.io/<repo-name>/`

## Project Structure

```
├── index.html                       # Main HTML page (Generate + Validate views)
├── css/
│   └── style.css                    # Styles (GitHub dark theme)
├── js/
│   ├── app.js                       # Bicep generation, IP data, Updates rendering
│   └── validator.js                 # Validate Existing Config feature
├── data/
│   ├── snapshots.json               # Last-known-good IPs (used for diffing)
│   └── updates.json                 # History of detected changes (Recent Updates tab)
├── scripts/
│   ├── monitor.js                   # Scraper used by the daily workflow
│   └── package.json
├── tests/
│   └── cidr-utils.test.html         # In-browser CIDR utility tests
├── .github/workflows/
│   └── monitor-ips.yml              # Daily IP monitoring workflow
└── README.md
```

## References

- [Configuring private networking for GitHub-hosted runners](https://docs.github.com/en/enterprise-cloud@latest/admin/configuring-settings/configuring-private-networking-for-hosted-compute-products/configuring-private-networking-for-github-hosted-runners-in-your-enterprise)
- [Network details for GHE.com](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/network-details-for-ghecom)

## License

MIT
