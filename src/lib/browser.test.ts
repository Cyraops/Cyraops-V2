import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { browserRuntime, validateDestinationUrl, isPrivateIp } from "./ai/browser/browser-runtime";

describe("Browser Runtime & SSRF Security Protection", () => {
  it("strictly detects private IP addresses and loopbacks", () => {
    // Loopbacks
    assert.equal(isPrivateIp("127.0.0.1"), true);
    assert.equal(isPrivateIp("::1"), true);
    assert.equal(isPrivateIp("localhost"), true);
    assert.equal(isPrivateIp("0.0.0.0"), true);

    // Private IPv4 ranges
    assert.equal(isPrivateIp("10.0.0.1"), true);
    assert.equal(isPrivateIp("10.255.255.255"), true);
    assert.equal(isPrivateIp("172.16.0.1"), true);
    assert.equal(isPrivateIp("172.31.255.255"), true);
    assert.equal(isPrivateIp("192.168.1.1"), true);
    assert.equal(isPrivateIp("192.168.0.254"), true);

    // Cloud metadata (AWS, GCP, Azure, OpenStack)
    assert.equal(isPrivateIp("169.254.169.254"), true);
    assert.equal(isPrivateIp("169.254.1.1"), true);

    // Public IPs should not be blocked
    assert.equal(isPrivateIp("8.8.8.8"), false);
    assert.equal(isPrivateIp("1.1.1.1"), false);
  });

  it("blocks dangerous URL schemes and internal metadata hosts", async () => {
    // Dangerous protocols
    const fileScheme = await validateDestinationUrl("file:///etc/passwd");
    assert.equal(fileScheme.valid, false);
    assert.match(fileScheme.error || "", /protocol/i);

    const gopherScheme = await validateDestinationUrl("gopher://127.0.0.1:25");
    assert.equal(gopherScheme.valid, false);

    const javascriptScheme = await validateDestinationUrl("javascript:alert(1)");
    assert.equal(javascriptScheme.valid, false);

    // Metadata hosts
    const gcpMeta = await validateDestinationUrl("http://metadata.google.internal/computeMetadata/v1/");
    assert.equal(gcpMeta.valid, false);
    assert.match(gcpMeta.error || "", /SSRF Protection/i);

    const awsMeta = await validateDestinationUrl("http://169.254.169.254/latest/meta-data/");
    assert.equal(awsMeta.valid, false);

    const localhostHost = await validateDestinationUrl("http://localhost:3000/api/admin");
    assert.equal(localhostHost.valid, false);

    const loopbackIp = await validateDestinationUrl("http://127.0.0.1:3001");
    assert.equal(loopbackIp.valid, false);

    const privateClassA = await validateDestinationUrl("http://10.0.1.50/dashboard");
    assert.equal(privateClassA.valid, false);
  });
});

describe("Interactive Browser Runtime Operations", () => {
  const userA = "test-user-alpha-" + Date.now();
  const userB = "test-user-beta-" + Date.now();

  after(async () => {
    await browserRuntime.closeSession(userA);
    await browserRuntime.closeSession(userB);
    await browserRuntime.closeAll();
  });

  it("maintains strict cross-user session isolation", async () => {
    const sessionA = await browserRuntime.getSession(userA);
    const sessionB = await browserRuntime.getSession(userB);

    assert.notEqual(sessionA.userId, sessionB.userId);
    assert.notEqual(sessionA.context, sessionB.context);
    assert.notEqual(sessionA.page, sessionB.page);

    const stateA = browserRuntime.getState(userA);
    const stateB = browserRuntime.getState(userB);
    assert.equal(stateA.userId, userA);
    assert.equal(stateB.userId, userB);
  });

  it("supports human takeover workflow and pauses agent operations", async () => {
    // Activate human takeover
    const stateAfterTakeover = await browserRuntime.takeover(userA, true);
    assert.equal(stateAfterTakeover.isHumanTakeover, true);
    assert.equal(stateAfterTakeover.status, "HUMAN_TAKEOVER");

    // Agent attempts action while under takeover -> should be rejected
    await assert.rejects(
      async () => {
        await browserRuntime.click(userA, "button", "AGENT");
      },
      /under human takeover/i
    );

    // Agent attempts navigation while under takeover -> should be rejected
    await assert.rejects(
      async () => {
        await browserRuntime.navigate(userA, "https://example.com", { actor: "AGENT" });
      },
      /under human control/i
    );

    // Return control to agent
    const stateAfterReturn = await browserRuntime.takeover(userA, false);
    assert.equal(stateAfterReturn.isHumanTakeover, false);
    assert.equal(stateAfterReturn.status, "IDLE");

    // Activity history records takeover events
    const hasTakeoverLog = stateAfterReturn.history.some((h) => h.action.includes("Takeover"));
    const hasReturnLog = stateAfterReturn.history.some((h) => h.action.includes("Control Returned"));
    assert.equal(hasTakeoverLog, true);
    assert.equal(hasReturnLog, true);
  });

  it("captures screenshots and manages browser activity logs", async () => {
    const session = await browserRuntime.getSession(userA);
    const screenshot = await browserRuntime.captureScreenshot(session);
    assert.ok(screenshot);
    assert.match(screenshot, /browser-screenshots/);

    const state = browserRuntime.getState(userA);
    assert.ok(state.history.length > 0);
  });
});
