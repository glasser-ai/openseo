import { expect, it } from "vitest";

/*
 * The fact list turns Provider text into links, so the rules are pinned here:
 * only https, mailto and tel ever become an href, and numbers that merely
 * look like digits stay text.
 */
it("links URLs, emails and phone numbers and nothing else", async () => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { FactListForTest } = await import("../Report.jsx");
  const html = renderToStaticMarkup(
    createElement(FactListForTest, {
      fields: [
        { label: "LinkedIn", value: "https://www.linkedin.com/company/surethingio" },
        { label: "Email", value: "support@surething.io, info@x.com" },
        { label: "Phone", value: "+1 650 398 6384" },
        { label: "Last scanned", value: "2026-10-11" },
        { label: "Employees", value: "34 (11-50)" },
        { label: "Evil", value: "javascript:alert(1)" },
      ],
    }),
  );
  expect(html).toContain('href="https://www.linkedin.com/company/surethingio"');
  expect(html).toContain(">linkedin.com/company/surethingio<");
  expect(html).toContain('href="mailto:support@surething.io"');
  expect(html).toContain('href="mailto:info@x.com"');
  expect(html).toContain('href="tel:+16503986384"');
  expect(html).not.toContain("tel:2026");
  expect(html).not.toContain("tel:34");
  expect(html).not.toContain('href="javascript');
});
