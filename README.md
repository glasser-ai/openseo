# OpenSEO

Open-source Chrome extension for page checks, traffic, keywords, backlinks and domain
registration, powered by [glasser](https://glasser.ai).

[**Install from the Chrome Web Store**](https://chromewebstore.google.com/detail/openseo/egmioohncebomfkepifnhcpddmhoceec)

| Report | Source |
| --- | --- |
| Domain registration | Public RDAP registries (free) |
| Page | The open page and the site's robots.txt (free): indexing, title, description, headings, alt text, structured data; DataForSEO for the keywords the page ranks for |
| Traffic | Similarweb through Apify |
| Search | DataForSEO, with competitors and top pages; Semrush for the 12-month trend |
| AI search | The site's robots.txt for AI crawler access (free); Ahrefs AI citation counts |
| Backlinks | Ahrefs Domain Rating and DataForSEO |
| Site | Hunter for the company, DataForSEO for the technologies |

## Install

1. [Add OpenSEO from the Chrome Web Store](https://chromewebstore.google.com/detail/openseo/egmioohncebomfkepifnhcpddmhoceec).
2. Open a website and select OpenSEO, or press `Alt+D`.
3. Connect a [glasser Key](https://app.glasser.ai/keys?utm_source=openseo&utm_medium=readme&utm_campaign=onboarding&utm_content=store) in Settings.

Chrome updates the extension itself. Domain registration, Page and AI crawler access work
straight away; the other reports need a Key.

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
**$0.06**; reopening it within the 7 days costs nothing. The default $5/day covers roughly 80 new
domains. AI search citations cost **$0.13** and the Site section about **$0.02**; each is fetched
only when that section is opened. The Search section adds competitors and top pages, about
**$0.03** together. The Page section's checks and AI crawler access are free; the keywords
the open page ranks for cost about **$0.015** per page.

Search reads Google in all countries each time the panel opens. To see one country, select it in **Google search
in** at the top of the Search section. Search competitors and the 12-month traffic history have
no all-countries data, so with all countries they show the United States and say so. Each choice
is a separate lookup with its own charge and cache. **Refresh** requests new data. New lookups use your glasser balance; cached results are
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
CI then uploads the same archive to the Chrome Web Store and submits it for review; a
version already submitted in the Developer Dashboard is skipped.
CI checks the code, builds the extension, and publishes the ZIP and SHA-256 checksum.

## License

[Apache-2.0](LICENSE). See [Third-party notices](THIRD_PARTY_NOTICES.md) for dependencies,
fonts and data attribution.
