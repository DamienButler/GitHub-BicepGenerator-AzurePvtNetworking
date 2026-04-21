# Azure Private Networking Bicep Generator

A client-side web application that generates `actions-nsg-deployment.bicep` files for configuring Azure private networking with GitHub-hosted runners.

## Features

- **GitHub.com Support** — Generate the standard Bicep file with base NSG rules
- **GHE.com Data Residency** — Automatically includes region-specific Actions IPs and ingress IP ranges for EU, Australia, US, and Japan
- **Instant Download** — Download the generated `.bicep` file directly from your browser
- **Copy to Clipboard** — Quick copy for pasting into your editor
- **IP Details View** — Inspect all IP ranges included in the generated file
- **Fully Client-Side** — No data is sent to any backend server

## How It Works

1. Select your platform — **GitHub.com** or **GHE.com** (data residency)
2. If using GHE.com, choose your data residency region (EU, Australia, US, Japan)
3. Click **Generate & Download** to create and download the `actions-nsg-deployment.bicep` file
4. Use the file with the Azure CLI deployment script as described in the [prerequisites documentation](https://docs.github.com/en/enterprise-cloud@latest/admin/configuring-settings/configuring-private-networking-for-hosted-compute-products/configuring-private-networking-for-github-hosted-runners-in-your-enterprise#prerequisites)

## Data Residency Regions

For GHE.com data residency, the following additional IPs are added to the `AllowOutBoundGitHub` NSG rule:

| Region | Actions IPs | Region IPs |
|--------|------------|------------|
| EU | 4 IPs | 6 ranges |
| Australia | 2 IPs | 3 ranges |
| Japan | 2 IPs | 3 ranges |
| US | Base only | Base only |

## Setup for GitHub Pages

1. Push this repository to GitHub
2. Go to **Settings → Pages**
3. Set the source to **Deploy from a branch** → `main` → `/ (root)`
4. The site will be available at `https://<username>.github.io/<repo-name>/`

## Project Structure

```
├── index.html          # Main HTML page
├── css/
│   └── style.css       # Styles (GitHub dark theme)
├── js/
│   └── app.js          # Bicep generation logic & UI
└── README.md
```

## References

- [Configuring private networking for GitHub-hosted runners](https://docs.github.com/en/enterprise-cloud@latest/admin/configuring-settings/configuring-private-networking-for-hosted-compute-products/configuring-private-networking-for-github-hosted-runners-in-your-enterprise)
- [Network details for GHE.com](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/network-details-for-ghecom)

## License

MIT
