import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { researchCompanySite, signalsFromResearch, evidenceFromResearch } from "./company-research";

/**
 * These run against a local fixture server, so the parser is tested against
 * known HTML instead of whatever a real website happens to serve today. Port 4567
 * on loopback is the one address the SSRF guard permits under
 * CYRAOPS_TEST_ALLOW_LOCAL, which is exactly the escape hatch we want here: it
 * lets the happy path be real while every other private address stays blocked.
 */

const FIXTURE = `<!doctype html>
<html>
  <head>
    <title>Northwind Logistics — Warehouse Automation</title>
    <meta name="description" content="Freight and warehouse automation for mid-market logistics teams." />
    <script>var hide = "aws ec2";</script>
    <style>.x { color: red; }</style>
  </head>
  <body>
    <h1>Move freight with fewer people</h1>
    <h2>Built on Azure</h2>
    <p>We help freight and warehouse operators migrate off ageing on-premise systems.
       Our customers move 40% faster after the migration.</p>
    <p>Certified for SOC 2 compliance and ISO 27001.</p>
    <nav>
      <a href="/careers">Careers</a>
      <a href="/pricing">Pricing</a>
      <a href="https://elsewhere.example/blog">Blog</a>
    </nav>
  </body>
</html>`;

const EMPTY = `<!doctype html><html><head></head><body><p>Hello.</p></body></html>`;

let server: http.Server;
const base = "http://127.0.0.1:4567";

test.before(async () => {
  process.env.CYRAOPS_TEST_ALLOW_LOCAL = "true";
  server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    if (url === "/empty") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(EMPTY);
      return;
    }
    if (url === "/redirect-private") {
      // The classic SSRF bypass: an allowed URL that points inward.
      response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      response.end();
      return;
    }
    if (url === "/redirect-ok") {
      response.writeHead(302, { location: "/" });
      response.end();
      return;
    }
    if (url === "/binary") {
      response.writeHead(200, { "content-type": "application/pdf" });
      response.end("%PDF-1.4");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(FIXTURE);
  });
  await new Promise<void>((resolve) => server.listen(4567, "127.0.0.1", resolve));
});

test.after(async () => {
  delete process.env.CYRAOPS_TEST_ALLOW_LOCAL;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("reads the page's own words instead of inventing them", async () => {
  const research = await researchCompanySite(`${base}/`);
  assert.equal(research.ok, true);
  assert.equal(research.status, 200);
  assert.match(String(research.title), /Northwind Logistics/);
  assert.match(String(research.description), /Freight and warehouse/);
  assert.ok(research.headings.some((heading) => /Move freight/i.test(heading)));
});

test("ignores scripts and styles so code cannot become a finding", async () => {
  const research = await researchCompanySite(`${base}/`);
  // The fixture puts "aws ec2" inside a <script>. Only the real page text counts,
  // so the cloud finding must be Azure, not AWS.
  assert.equal(research.cloud?.value, "azure");
  assert.match(research.cloud?.quote ?? "", /Azure/);
});

test("finds industry, pain language and the pages worth reading next", async () => {
  const research = await researchCompanySite(`${base}/`);
  assert.equal(research.industry?.value, "logistics");
  assert.ok(research.pains.some((pain) => pain.value === "migration"));
  assert.ok(research.pains.some((pain) => pain.value === "compliance"));
  assert.equal(research.hasCareersPage, true);
  assert.equal(research.careersUrl, `${base}/careers`);
  assert.equal(research.hasPricingPage, true);
  assert.equal(research.pricingUrl, `${base}/pricing`);
  assert.ok(research.links.includes("https://elsewhere.example/blog"));
});

test("every finding carries the quote and the URL it came from", async () => {
  const research = await researchCompanySite(`${base}/`);
  assert.ok(research.cloud?.quote && research.cloud.sourceUrl);
  assert.ok(research.industry?.quote && research.industry.sourceUrl);
  for (const pain of research.pains) {
    assert.ok(pain.quote.length > 0);
    assert.equal(pain.sourceUrl, `${base}/`);
  }
});

test("an uninformative page yields no findings rather than guesses", async () => {
  const research = await researchCompanySite(`${base}/empty`);
  assert.equal(research.ok, true);
  assert.equal(research.title, null);
  assert.equal(research.description, null);
  assert.equal(research.cloud, null);
  assert.equal(research.industry, null);
  assert.deepEqual(research.pains, []);
  assert.equal(research.hasCareersPage, false);
});

test("unchecked signals stay unchecked, so the score cannot be inflated", async () => {
  const research = await researchCompanySite(`${base}/`);
  const signals = signalsFromResearch(research) as Record<string, { value: unknown; state: string }>;
  assert.equal(signals.cloudFootprint.state, "observed");
  assert.equal(signals.cloudFootprint.value, "azure");
  assert.equal(signals.publicPain.state, "observed");
  // No careers page was found, but absence of a page is not evidence of no
  // hiring, so this must not be claimed either way.
  assert.equal(signals.hiring, undefined);
  assert.equal(signals.funding, undefined);
});

test("evidence rows are quotable and bounded", async () => {
  const research = await researchCompanySite(`${base}/`);
  const evidence = evidenceFromResearch(research);
  assert.ok(evidence.length >= 2);
  assert.ok(evidence.every((row) => row.quote && row.quote.length > 0));
  assert.ok(evidence.length <= 6);
});

test("cloud metadata and loopback on other ports stay blocked", async () => {
  const metadata = await researchCompanySite("http://169.254.169.254/latest/meta-data/");
  assert.equal(metadata.ok, false);
  assert.match(String(metadata.error), /prohibited|private|blocked/i);

  const wrongPort = await researchCompanySite("http://127.0.0.1:9999/");
  assert.equal(wrongPort.ok, false);

  const fileScheme = await researchCompanySite("file:///etc/passwd");
  assert.equal(fileScheme.ok, false);
  assert.match(String(fileScheme.error), /protocol/i);
});

test("a redirect into the private network is refused", async () => {
  const research = await researchCompanySite(`${base}/redirect-private`);
  assert.equal(research.ok, false);
  assert.match(String(research.error), /prohibited|private|blocked/i);
});

test("a redirect within the site is followed to the real page", async () => {
  const research = await researchCompanySite(`${base}/redirect-ok`);
  assert.equal(research.ok, true);
  assert.match(String(research.title), /Northwind Logistics/);
});

test("a non-HTML response is reported, not parsed as markup", async () => {
  const research = await researchCompanySite(`${base}/binary`);
  assert.equal(research.ok, false);
  assert.match(String(research.error), /Not an HTML page/i);
});
