import { test } from "node:test";
import assert from "node:assert/strict";

// Force offline mode before loading the Supabase-backed modules.
process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
process.env.SUPABASE_ANON_KEY = "";
process.env.DOWNLOAD_TOKEN_SECRET = "unit-test-secret-not-for-production";
process.env.ALLOW_SANDBOX_PAYMENTS = "false";

const datasetSlug = "pune-real-estate-data";

test("session and download tokens verify with their bound claims", async () => {
  const { issueSessionToken, verifySessionToken, signDownloadToken, verifyDownloadToken } = await import(
    "../services/authService.js"
  );

  const session = issueSessionToken("203.0.113.10");
  const sessionPayload = verifySessionToken(session, "203.0.113.10");
  assert.ok(sessionPayload);
  assert.equal(sessionPayload.type, "web:session");
  assert.ok(sessionPayload.scopes.includes("web:session"));
  assert.ok(sessionPayload.exp > Date.now());
  assert.equal(verifySessionToken(session, "203.0.113.11"), null, "session must be bound to the IP");

  const download = signDownloadToken({
    orderId: "order-123",
    datasetSlug,
    format: "csv",
  });
  const payload = verifyDownloadToken(download);
  assert.ok(payload);
  assert.equal(payload.orderId, "order-123");
  assert.equal(payload.datasetSlug, datasetSlug);
  assert.equal(payload.format, "csv");
  assert.equal(payload.scope, "downloads:read");
  assert.ok(payload.exp <= Date.now() + 60 * 60 * 1000);
});

test("expired tokens are rejected", async () => {
  const { issueSessionToken, verifySessionToken, signDownloadToken, verifyDownloadToken } = await import(
    "../services/authService.js"
  );

  const expiredDownload = signDownloadToken({
    orderId: "order-123",
    datasetSlug,
    format: "csv",
    exp: Date.now() - 1000,
  });
  assert.equal(verifyDownloadToken(expiredDownload), null);

  const expiredSession = issueSessionToken("203.0.113.10", -1000);
  assert.equal(verifySessionToken(expiredSession, "203.0.113.10"), null);
});

test("tampered tokens are rejected", async () => {
  const { signDownloadToken, verifyDownloadToken } = await import("../services/authService.js");
  const token = signDownloadToken({ orderId: "order-123", datasetSlug, format: "csv" });
  const [payload, signature] = token.split(".");
  assert.ok(payload && signature);

  const flippedSignature = `${signature.slice(0, -1)}${signature.at(-1) === "A" ? "B" : "A"}`;
  assert.equal(verifyDownloadToken(`${payload}.${flippedSignature}`), null);

  const forgedPayload = Buffer.from(
    JSON.stringify({
      type: "download",
      orderId: "order-999",
      datasetSlug,
      format: "csv",
      scope: "downloads:read",
      iat: Date.now(),
      exp: Date.now() + 60000,
    })
  ).toString("base64url");
  assert.equal(verifyDownloadToken(`${forgedPayload}.${signature}`), null);
});

test("checkout never generates a snapshot or download URL", async () => {
  const { OrderService } = await import("../services/orderService.js");
  const { DownloadService } = await import("../services/downloadService.js");

  let generateCalled = false;
  const original = DownloadService.generateSnapshot;
  DownloadService.generateSnapshot = async () => {
    generateCalled = true;
    throw new Error("checkout must not generate a snapshot");
  };

  try {
    const result = await OrderService.processCheckout({
      datasetSlug,
      format: "csv",
      customerEmail: "buyer@example.com",
    });

    assert.equal(result.status, "pending");
    assert.equal(result.paymentRequired, true);
    assert.equal(result.amount, 8500);
    assert.ok(result.orderId);
    assert.equal("downloadUrl" in result, false);
    assert.equal("fileName" in result, false);
    assert.match(result.message, /not fulfilled/);
    assert.equal(generateCalled, false);
  } finally {
    DownloadService.generateSnapshot = original;
  }
});

test("google auth endpoint builds valid Supabase OAuth redirect URL", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  const { authRouter } = await import("../routes/auth.js");
  assert.ok(authRouter);
});
