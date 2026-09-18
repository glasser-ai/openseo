# Privacy

OpenSEO does not upload page HTML, page text, cookies or form contents. It uses the current
tab's hostname for domain reports. It does not scan Google or Bing search results.

## Network requests

| Destination | Purpose and data sent |
| --- | --- |
| `api.glasser.ai` | Key validation and balance checks; endpoint descriptions and prices; paid Runs and recovery. Requests use your glasser Key as a Bearer credential. Paid requests include the selected domain and endpoint parameters. Recovery uses a Run ID or the original request and idempotency key. |
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
attribution, keyword-result URLs and context-menu tools. Those sites receive normal browser
requests and apply their own policies. The Keys link includes UTM parameters that identify
OpenSEO and the link location; it does not include your Key or the inspected domain.

## Local storage

Chrome's local extension storage holds your Key, settings, spending counters, reservations,
recent charge history, request identities, selected domains and cached results. This storage is
not encrypted by OpenSEO and is not synced by the extension. Chrome restricts access to trusted
extension contexts; website content scripts cannot read the Key or ledger.

Removing a Key removes the credential only. It does not revoke the Key in glasser or erase
saved results and history. Uninstalling the extension removes its local storage. Cached entries
can remain stored after their freshness period ends; expiry controls reuse, not deletion.

## Permissions

| Permission | Purpose |
| --- | --- |
| `activeTab` and `scripting` | Read the selected tab address and insert the report after a toolbar, shortcut or context-menu action. The insertion script creates the report container; it does not extract page content. |
| `storage` | Store settings, Key, results and the local ledger. |
| `contextMenus` | Provide right-click actions. |
| `alarms` | Recover unfinished paid requests after worker suspension. |
| Host access to `api.glasser.ai` | Authenticated API requests. |

The report loads an extension iframe in a container on the website. Its content uses the
extension origin, but the website can affect the surrounding container. There is no persistent
content script on all websites or optional host permission. RDAP requests use normal
cross-origin fetch and depend on the registry's CORS support.
