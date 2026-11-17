import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sameOrigin } from "./auth";
import { sanitizeEmailHtml } from "./email/sanitize";

describe("Phase 1 Remediation — Financial Subsystem Security", () => {
  it("enforces sameOrigin rejection for cross-origin requests", () => {
    // Cross-origin request from malicious site
    const maliciousReq = new Request("http://localhost:3001/api/cost/expenses", {
      method: "POST",
      headers: {
        origin: "http://malicious-site.com",
        host: "localhost:3001",
      },
    });
    assert.strictEqual(sameOrigin(maliciousReq), false, "Mismatched origin must be rejected");

    // Malicious referer
    const maliciousRefererReq = new Request("http://localhost:3001/api/cost/expenses", {
      method: "POST",
      headers: {
        referer: "http://attacker.example.org/phish",
        host: "localhost:3001",
      },
    });
    assert.strictEqual(sameOrigin(maliciousRefererReq), false, "Mismatched referer must be rejected");
  });

  it("permits legitimate same-origin requests", () => {
    // Direct same-origin request
    const legitimateReq = new Request("http://localhost:3001/api/cost/expenses", {
      method: "POST",
      headers: {
        origin: "http://localhost:3001",
        host: "localhost:3001",
        "sec-fetch-site": "same-origin",
      },
    });
    assert.strictEqual(sameOrigin(legitimateReq), true, "Legitimate same-origin request must be accepted");
  });

  it("verifies financial dashboard route enforces strict OWNER / ADMIN access check", () => {
    const routePath = path.resolve(process.cwd(), "src/app/api/cost/dashboard/route.ts");
    const content = fs.readFileSync(routePath, "utf8");

    // Ensure ensureDefaultCategories is removed from GET
    assert.doesNotMatch(content, /await\s+ensureDefaultCategories\(\)/, "GET /api/cost/dashboard must NOT call ensureDefaultCategories()");

    // Ensure role restriction for ordinary members
    assert.match(content, /user\.role\s*!==\s*"OWNER"\s*&&\s*user\.role\s*!==\s*"ADMIN"/, "Dashboard must restrict access to OWNER and ADMIN");
    assert.match(content, /status:\s*403/, "Forbidden status code 403 must be returned for non-admin users");
  });

  it("verifies categories route has zero database writes on GET and requires sameOrigin on mutations", () => {
    const routePath = path.resolve(process.cwd(), "src/app/api/cost/categories/route.ts");
    const content = fs.readFileSync(routePath, "utf8");

    assert.doesNotMatch(content, /await\s+ensureDefaultCategories\(\)/, "GET /api/cost/categories must NOT call ensureDefaultCategories()");
    assert.match(content, /POST[\s\S]*sameOrigin\(req\)/, "POST /api/cost/categories must check sameOrigin");
    assert.match(content, /DELETE[\s\S]*sameOrigin\(req\)/, "DELETE /api/cost/categories must check sameOrigin");
  });

  it("verifies expenses route isolates MEMBER access and forces reimbursement status on create", () => {
    const routePath = path.resolve(process.cwd(), "src/app/api/cost/expenses/route.ts");
    const content = fs.readFileSync(routePath, "utf8");

    assert.match(content, /if\s*\(user\.role\s*===\s*"MEMBER"\)\s*\{\s*where\.userId\s*=\s*user\.id;\s*\}/, "GET expenses must force where.userId = user.id for MEMBER");
    assert.match(content, /POST[\s\S]*sameOrigin\(req\)/, "POST /api/cost/expenses must enforce sameOrigin");
    assert.match(content, /effectiveStatus\s*=\s*isMember\s*\?\s*"REIMBURSEMENT_PENDING"/, "MEMBER expenses must be forced to REIMBURSEMENT_PENDING");
    assert.match(content, /effectiveClassification\s*=\s*isMember\s*\?\s*"OPEX"/, "MEMBER expenses must be forced to OPEX");
  });

  it("verifies mutating cost endpoints all enforce sameOrigin protection", () => {
    const endpoints = [
      "src/app/api/cost/expenses/[id]/route.ts",
      "src/app/api/cost/investments/route.ts",
      "src/app/api/cost/recurring/route.ts",
      "src/app/api/cost/recurring/record-payment/route.ts",
      "src/app/api/cost/marketing/route.ts",
      "src/app/api/cost/invoices/upload/route.ts",
      "src/app/api/cost/invoices/verify/route.ts",
      "src/app/api/cost/ai/route.ts",
    ];

    for (const ep of endpoints) {
      const fullPath = path.resolve(process.cwd(), ep);
      const content = fs.readFileSync(fullPath, "utf8");
      assert.match(content, /sameOrigin\(req\)/, `${ep} must enforce sameOrigin CSRF protection`);
    }
  });

  it("verifies financial export report route restricts exports to OWNER and ADMIN", () => {
    const routePath = path.resolve(process.cwd(), "src/app/api/cost/reports/export/route.ts");
    const content = fs.readFileSync(routePath, "utf8");
    assert.match(content, /if\s*\(user\.role\s*!==\s*"OWNER"\s*&&\s*user\.role\s*!==\s*"ADMIN"\)/, "Export route must restrict access to OWNER and ADMIN");
  });
});

describe("Phase 1 Remediation — Email Subsystem Security & Privacy", () => {
  // These used to grep the route source for one exact expression. That encoded a
  // policy the product no longer has: the corporate mailbox is shared and only
  // drafts are private (see src/lib/email/access.ts, tested behaviourally in
  // access.test.ts). Asserting on code shape made a deliberate design change look
  // like a security failure. What is still worth locking down is that each route
  // actually delegates its scoping to the shared helper instead of hand-rolling a
  // `where` clause nobody reviews.
  it("email list endpoint scopes through the shared visibility helper", () => {
    const content = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/email/route.ts"), "utf8");
    assert.match(content, /emailFolderVisibilityWhere\s*\(/, "List must scope via emailFolderVisibilityWhere");
    // A search string must narrow the scoped result, never replace the scope.
    assert.match(content, /where\.AND\.push\(\{\s*OR:\s*searchConditions\s*\}\)/, "Search must combine via AND");
  });

  it("email detail, attachment and action endpoints check message-level access", () => {
    const detailRoute = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/email/[id]/route.ts"), "utf8");
    assert.match(detailRoute, /emailMessageVisibilityWhere\s*\(/, "Detail must use emailMessageVisibilityWhere");

    const attRoute = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/email/attachments/[id]/route.ts"), "utf8");
    assert.match(attRoute, /canReadMailboxMessage\s*\(/, "Attachment download must check canReadMailboxMessage");

    const actionsRoute = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/email/actions/route.ts"), "utf8");
    assert.match(actionsRoute, /emailMessageVisibilityWhere\s*\(/, "Actions must scope via emailMessageVisibilityWhere");
    assert.match(
      actionsRoute,
      /canPermanentlyDeleteSharedMail\s*\(/,
      "Permanent deletion must be limited to mailbox admins"
    );
  });

  it("verifies draft saving route assigns userId and checks ownership", () => {
    const draftRoute = fs.readFileSync(path.resolve(process.cwd(), "src/app/api/email/draft/route.ts"), "utf8");
    assert.match(draftRoute, /userId:\s*user\.id/, "Draft creation must record user.id");
    assert.match(draftRoute, /draftUserScope/, "Draft update must scope by user if not privileged");
  });

  it("sanitizes dangerous HTML markup and strips script/XSS vectors", () => {
    const maliciousHtml = `
      <div>
        <p>Hello customer,</p>
        <script>fetch('/api/auth/profile').then(r => r.json()).then(d => alert(d.passwordHash));</script>
        <img src="https://example.com/logo.png" onerror="alert(document.cookie)" />
        <a href="javascript:alert(1)">Click here</a>
        <a href="https://example.com/legit">Legit link</a>
      </div>
    `;

    const sanitized = sanitizeEmailHtml(maliciousHtml);

    assert.doesNotMatch(sanitized, /<script>/i, "Script tags must be stripped");
    assert.doesNotMatch(sanitized, /onerror/i, "Event handlers must be stripped");
    assert.doesNotMatch(sanitized, /javascript:/i, "javascript: scheme links must be stripped");
    assert.match(sanitized, /https:\/\/example\.com\/legit/, "Legitimate links must be preserved");
    assert.match(sanitized, /rel="noopener noreferrer nofollow"/, "Links must have safe rel tags");
  });

  it("verifies email UI renders in a sandboxed iframe without host script access", () => {
    const uiPath = path.resolve(process.cwd(), "src/components/modules/email.tsx");
    const content = fs.readFileSync(uiPath, "utf8");

    // dangerouslySetInnerHTML must be removed from email body viewer
    assert.doesNotMatch(content, /dangerouslySetInnerHTML=\{\{\s*__html:\s*emailDetail\.bodyHtml\s*\}\}/, "Email body viewer must NOT use dangerouslySetInnerHTML");

    // iframe sandbox must be present
    assert.match(content, /<iframe[\s\S]*sandbox="allow-popups"/, "Email body viewer must use an iframe with sandbox='allow-popups'");
  });
});

describe("Phase 1 Remediation — Production Promotion Script Safety", () => {
  it("verifies promote-to-prod.sh enforces explicit environment gate and safe migration policy", () => {
    const scriptPath = path.resolve(process.cwd(), "promote-to-prod.sh");
    const content = fs.readFileSync(scriptPath, "utf8");

    // Must require PROCEED_PROD_DEPLOY=true
    assert.match(content, /PROCEED_PROD_DEPLOY.*!=\s*"true"/, "promote-to-prod.sh must fail closed without PROCEED_PROD_DEPLOY=true");

    // Must permanently ban executing prisma db push
    assert.doesNotMatch(content, /^\s*npx\s+prisma\s+db\s+push/m, "promote-to-prod.sh must NOT execute prisma db push");
    assert.doesNotMatch(content, /--accept-data-loss/, "promote-to-prod.sh must NOT accept data loss");

    // Must require prisma migrate deploy
    assert.match(content, /prisma\s+migrate\s+deploy/, "promote-to-prod.sh must use prisma migrate deploy");

    // Must verify company_os target database
    assert.match(content, /company_os/, "promote-to-prod.sh must verify target database is company_os");

    // Hard kill -9 on port 3000 must be replaced with graceful SIGTERM termination
    assert.doesNotMatch(content, /lsof -ti:3000 \| xargs kill -9/, "Hard kill -9 pipeline must be replaced");
    assert.match(content, /kill -15/, "Script must attempt graceful SIGTERM first");
  });
});
