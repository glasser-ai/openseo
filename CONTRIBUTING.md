# Contributing

Use Node.js 22.22.2+, 24.15.0+, or 26+ (supported major versions: 22, 24, and 26+) and pnpm 10.12.4. Follow the installation steps in [README.md](README.md).

For a change, explain the problem and the resulting behavior. Add a regression test for changes
to billing, request recovery, cache behavior or permissions. Use mocked API responses in tests;
do not make paid requests or put a real Key in fixtures, screenshots or logs.

Run `pnpm lint`, `pnpm check-types`, `pnpm test` and `pnpm build` before submitting a patch.
For API changes, also run `pnpm check:contract`. Inspect any generated schema diff.
For UI changes, load the production build in Chrome and check the affected flow at panel width.

Keep monetary calculations in integer micro-USD. Ledger writes and spending decisions must use
the worker's serial queue. Preserve the idempotency key during recovery. Do not release an
uncertain reservation automatically or raise a stored spending limit during an upgrade.

Source contributions use the project's Apache-2.0 license. Retain third-party notices.
Report security issues through [SECURITY.md](SECURITY.md), not a public issue.
