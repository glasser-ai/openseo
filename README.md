# OpenSEO

Open-source Chrome extension for traffic, keywords, backlinks and domain registration,
powered by [glasser](https://glasser.ai).

| Report | Source |
| --- | --- |
| Domain registration | Public RDAP registries (free) |
| Traffic | Similarweb through Apify |
| Search | DataForSEO |
| Backlinks | Ahrefs Domain Rating and DataForSEO |

## Install

1. [Download the latest release](https://github.com/glasser-ai/openseo/releases/latest) and extract `openseo-VERSION-chrome.zip`.
2. Open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**.
3. Select the extracted folder, open a website, and click OpenSEO.
4. Connect a [glasser Key](https://app.glasser.ai/keys?utm_source=openseo&utm_medium=readme&utm_campaign=onboarding&utm_content=download) in Settings.

To update, replace the files in the same folder and select **Reload** in Chrome.

## Cache and costs

Reports are cached locally for **7 days**, or **1 day** for empty results, and reused across tabs
and browser restarts. Opening a section automatically fetches missing or outdated results.
**Refresh** requests new data. New lookups use your glasser balance; cached results are free to view.

Settings provides estimated budgets of **$5/day** and **$20/month** per browser profile.
Price changes can cause charges to exceed them. Set either to zero to stop new paid lookups;
pending requests can still charge. Activity shows charges and unfinished requests.

Only the domain is sent for lookups. No page content or telemetry.
See [Privacy](PRIVACY.md).

## Development

Requires Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` and pnpm 10.12.4.

```sh
pnpm install --frozen-lockfile
pnpm dev    # Development browser with OpenSEO (Dev)
pnpm build  # Production build: .output/chrome-mv3
pnpm zip    # Chrome ZIP: .output
```

Load `.output/chrome-mv3` through **Load unpacked** to use a local production build.
Run `pnpm lint`, `pnpm check-types`, `pnpm test` and `pnpm build` before contributing.
See [Contributing](CONTRIBUTING.md) and [Security](SECURITY.md).

To release, update `package.json`, push to `main`, then push a matching `vVERSION` tag.
CI checks the code, builds the extension, and publishes the ZIP and SHA-256 checksum.

## License

[Apache-2.0](LICENSE). See [Third-party notices](THIRD_PARTY_NOTICES.md) for dependencies,
fonts and data attribution.
