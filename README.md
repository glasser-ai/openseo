# OpenSEO

Open-source Chrome extension for traffic, keywords, backlinks and domain registration,
powered by [glasser](https://glasser.ai).

[**Install from the Chrome Web Store**](https://chromewebstore.google.com/detail/openseo/egmioohncebomfkepifnhcpddmhoceec)

| Report | Source |
| --- | --- |
| Domain registration | Public RDAP registries (free) |
| Traffic | Similarweb through Apify |
| Search | DataForSEO |
| Backlinks | Ahrefs Domain Rating and DataForSEO |

## Install

1. [Add OpenSEO from the Chrome Web Store](https://chromewebstore.google.com/detail/openseo/egmioohncebomfkepifnhcpddmhoceec).
2. Open a website and select OpenSEO, or press `Alt+D`.
3. Connect a [glasser Key](https://app.glasser.ai/keys?utm_source=openseo&utm_medium=readme&utm_campaign=onboarding&utm_content=store) in Settings.

Chrome updates the extension itself. Domain registration works straight away; the other
reports need a Key.

<details>
<summary>Install from a release archive instead</summary>

Use this to run a specific version, or to verify the published build yourself.

1. [Download a release](https://github.com/glasser-ai/openseo/releases/latest) and extract `openseo-VERSION-chrome.zip`.
2. Check it against the published `SHA256SUMS` if you want to confirm the archive.
3. Open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**.
4. Select the extracted folder.

Updates are manual: replace the files in the same folder and select **Reload**. Keep the same
folder to preserve the extension identity and saved settings.

</details>

## Cache and costs

Reports are cached locally for **7 days**, or **1 day** for empty results, and reused across tabs
and browser restarts. Opening a section automatically fetches missing or outdated results. Overview
is a section of five, so opening the panel on a domain with nothing saved fetches all five, about
**$0.18**; reopening it within the 7 days costs nothing. The default $5/day covers roughly 28 new
domains. **Refresh** requests new data. New lookups use your glasser balance; cached results are
free to view.

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

To release, update `package.json` and push to `main`. CI tags `vVERSION`, publishes the
GitHub Release with the archive and `SHA256SUMS`, and does nothing when the version is
unchanged. Tags are not pushed by hand.
CI checks the code, builds the extension, and publishes the ZIP and SHA-256 checksum.

## License

[Apache-2.0](LICENSE). See [Third-party notices](THIRD_PARTY_NOTICES.md) for dependencies,
fonts and data attribution.
