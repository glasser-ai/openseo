# Privacy

OpenSEO does not upload page HTML, page text, cookies or form contents. It uses the current
tab's hostname for domain reports. It does not scan Google or Bing search results.

When you open the Page or AI search section, OpenSEO reads these facts from the open page: the
title, meta description, canonical link, robots meta tags, `lang` attribute, viewport tag,
up to five H1 texts, H2 and H3 counts, image and missing-alt counts, word count, hreflang count,
structured-data types and whether Open Graph title and image tags exist. The page also requests
the site's own `/robots.txt`. These facts stay in the panel: they are not stored and not sent to
glasser or any other service.

## Network requests

| Destination | Purpose and data sent |
| --- | --- |
| `api.glasser.ai` | Key validation and balance checks; endpoint descriptions and prices; paid Runs and recovery. Requests use your glasser Key as a Bearer credential. Paid requests include the selected domain, the country chosen for Search, when one is chosen, and endpoint parameters. The Page section's keyword lookup sends a page address instead of the domain: the canonical address the page publishes, or else the open page's origin and path. From either address, tracking parameters such as `utm_*`, a user name and password, and the `#` fragment are dropped. If the address has another query string and the page names no canonical address, nothing is sent, because the query string can hold private data. Each Run also carries a tag that names OpenSEO and its version, so glasser can tell OpenSEO's requests from other requests made with the same Key. The tag holds no page, domain or user data. Recovery uses a Run ID or the original request and idempotency key. |
| The open site | `/robots.txt`, requested from the page itself when the Page or AI search section opens. It is a normal same-site request without cookies, and no glasser Key is sent. |
| `data.iana.org/rdap/dns.json` | Public registry discovery. The list is cached for seven days. No glasser Key is sent. |
| The RDAP registry selected from IANA's list | Registration dates for the registrable domain, such as `example.com` for `docs.example.com`. Results are cached for thirty days. No glasser Key is sent. Registries without a usable public CORS endpoint may be unavailable. |

Balance and price checks are free. After a Key is stored, opening a section automatically
starts paid lookups for missing or outdated results after a local estimated-budget check.
Recovery can continue for requests
already sent, including after a budget is lowered. Removing the Key stops authenticated recovery
until a Key is available again. A price change can cause actual charges to exceed the estimated
daily or monthly budget.

The API and registries receive normal network metadata, including your IP address. glasser
routes paid endpoint requests to the selected data Provider. Its handling of those requests is
covered by [glasser's privacy policy](https://glasser.ai/privacy-policy/). The extension does not load
remote fonts or favicons and includes no analytics, telemetry or crash reporting.

External links open only when selected. They include glasser Keys and Run pages, Provider
attribution, keyword-result URLs, competitor sites, top pages and context-menu tools. Those sites receive normal browser
requests and apply their own policies. The Keys link includes UTM parameters that identify
OpenSEO and the link location; it does not include your Key or the inspected domain.

## Local storage

Chrome's local extension storage holds your Key, settings, spending counters, reservations,
recent charge history, request identities, selected domains, page URLs looked up and cached results. This storage is
not encrypted by OpenSEO and is not synced by the extension. Chrome restricts access to trusted
extension contexts; website content scripts cannot read the Key or ledger.

Removing a Key removes the credential only. It does not revoke the Key in glasser or erase
saved results and history. Uninstalling the extension removes its local storage. Cached entries
can remain stored after their freshness period ends; expiry controls reuse, not deletion.

## Permissions

| Permission | Purpose |
| --- | --- |
| `activeTab` and `scripting` | Read the selected tab address and insert the report after a toolbar, shortcut or context-menu action. The insertion script creates the report container and reads nothing. The Page and AI search sections run a second script in the same tab that reads only the facts listed above. |
| `storage` | Store settings, Key, results and the local ledger. |
| `contextMenus` | Provide right-click actions. |
| `alarms` | Recover unfinished paid requests after worker suspension. |
| Host access to `api.glasser.ai` | Authenticated API requests. |

The report loads an extension iframe in a container on the website. Its content uses the
extension origin, but the website can affect the surrounding container. There is no persistent
content script on all websites or optional host permission. RDAP requests use normal
cross-origin fetch and depend on the registry's CORS support.
