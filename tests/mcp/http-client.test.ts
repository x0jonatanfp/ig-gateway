import { describe, expect, it } from "vitest";
import {
  ConfigurationError,
  GatewayError,
  describeGatewayError,
} from "../../src/mcp/domain/gateway-error.js";
import { createHttpIgGateway } from "../../src/mcp/infrastructure/http-ig-gateway.js";

interface Recorded {
  url: string;
  init: RequestInit;
}

function fakeFetch(reply: {
  status?: number;
  body?: unknown;
  raw?: string;
  throws?: Error;
}) {
  const calls: Recorded[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (reply.throws) throw reply.throws;
    const text =
      reply.raw ?? (reply.body === undefined ? "" : JSON.stringify(reply.body));
    return new Response(text, { status: reply.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const config = {
  gatewayUrl: "http://127.0.0.1:4005",
  token: "token-de-prueba",
};

describe("HTTP client routes and bodies", () => {
  it("quota: GET with project in the query and token header", async () => {
    const { impl, calls } = fakeFetch({
      body: { quotaUsage: 1, quotaTotal: 100, quotaRemaining: 99 },
    });
    const gateway = createHttpIgGateway(config, { fetchImpl: impl });
    await gateway.getQuota("/mi proyecto");
    expect(calls[0]?.url).toBe(
      "http://127.0.0.1:4005/v1/quota?project=%2Fmi+proyecto",
    );
    expect(calls[0]?.init.method).toBeUndefined();
    expect(new Headers(calls[0]?.init.headers).get("x-ig-gateway-token")).toBe(
      "token-de-prueba",
    );
  });

  it("check: POST /v1/accounts/check with project", async () => {
    const { impl, calls } = fakeFetch({ body: { id: "1", username: "u" } });
    const gateway = createHttpIgGateway(config, { fetchImpl: impl });
    await gateway.checkAccount("/p");
    expect(calls[0]?.url).toBe("http://127.0.0.1:4005/v1/accounts/check");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ project: "/p" });
  });

  it("media and discovery: limit in the query", async () => {
    const { impl, calls } = fakeFetch({ body: [] });
    const gateway = createHttpIgGateway(config, { fetchImpl: impl });
    await gateway.listMedia("/p", 5);
    await gateway.discoverAccount("/p", "example_brand", 2);
    expect(calls[0]?.url).toBe(
      "http://127.0.0.1:4005/v1/media?project=%2Fp&limit=5",
    );
    expect(calls[1]?.url).toBe(
      "http://127.0.0.1:4005/v1/discovery/example_brand?project=%2Fp&limit=2",
    );
  });

  it("insights: GET /v1/media/:id/insights with project", async () => {
    const { impl, calls } = fakeFetch({
      body: [{ name: "reach", values: [{ value: 5 }] }],
    });
    const gateway = createHttpIgGateway(config, { fetchImpl: impl });
    await gateway.getInsights("/p", "1797");
    expect(calls[0]?.url).toBe(
      "http://127.0.0.1:4005/v1/media/1797/insights?project=%2Fp",
    );
  });

  it("active hours: GET /v1/account/active-hours with project and timezone", async () => {
    const { impl, calls } = fakeFetch({ body: { timeZone: "UTC", days: 0, hours: [], peak: [] } });
    const gateway = createHttpIgGateway(config, { fetchImpl: impl });
    await gateway.getActiveHours("/p", "Europe/Madrid");
    expect(calls[0]?.url).toBe(
      "http://127.0.0.1:4005/v1/account/active-hours?project=%2Fp&timezone=Europe%2FMadrid",
    );
  });

  it("publication: GET /v1/publications/:id", async () => {
    const { impl, calls } = fakeFetch({ body: { id: "publication-1" } });
    const gateway = createHttpIgGateway(config, { fetchImpl: impl });
    await gateway.getPublication("publication-1");
    expect(calls[0]?.url).toBe(
      "http://127.0.0.1:4005/v1/publications/publication-1",
    );
  });

  it("comments: list and reply", async () => {
    const { impl, calls } = fakeFetch({ body: [] });
    const gateway = createHttpIgGateway(config, { fetchImpl: impl });
    await gateway.listComments("/p", "1797");
    await gateway.replyComment("/p", "1797", "Gracias");
    expect(calls[0]?.url).toBe(
      "http://127.0.0.1:4005/v1/media/1797/comments?project=%2Fp",
    );
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      project: "/p",
      action: "reply",
      text: "Gracias",
    });
  });

  it("hide: POST with action hide on the comment id", async () => {
    const { impl, calls } = fakeFetch({ body: { id: "c-1" } });
    const gateway = createHttpIgGateway(config, { fetchImpl: impl });
    await gateway.hideComment("/p", "c-1");
    expect(calls[0]?.url).toBe("http://127.0.0.1:4005/v1/media/c-1/comments");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      project: "/p",
      action: "hide",
    });
  });

  it("publish: real gateway body with media, dryRun and idempotencyKey", async () => {
    const { impl, calls } = fakeFetch({
      status: 201,
      body: { id: "publication-1", status: "published" },
    });
    const gateway = createHttpIgGateway(config, { fetchImpl: impl });
    await gateway.publish({
      project: "/p",
      media: ["/a.png", "/b.png"],
      type: "carousel",
      caption: "hola",
      dryRun: false,
      idempotencyKey: "ig-mcp-abc",
      altText: "alt",
      collaborators: ["uno"],
      shareToFeed: true,
    });
    expect(calls[0]?.url).toBe("http://127.0.0.1:4005/v1/publications");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      project: "/p",
      media: [{ path: "/a.png" }, { path: "/b.png" }],
      caption: "hola",
      type: "carousel",
      dryRun: false,
      idempotencyKey: "ig-mcp-abc",
      altText: "alt",
      collaborators: ["uno"],
      shareToFeed: true,
    });
  });
});

describe("HTTP client errors", () => {
  it("without token fails as configuration and never calls fetch", async () => {
    const { impl, calls } = fakeFetch({ body: {} });
    const gateway = createHttpIgGateway(
      { gatewayUrl: "http://127.0.0.1:4005", token: undefined },
      { fetchImpl: impl },
    );
    await expect(gateway.getQuota("/p")).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    expect(calls).toHaveLength(0);
  });

  it("401 without error body maps to AUTHENTICATION", async () => {
    const { impl } = fakeFetch({
      status: 401,
      body: { error: "Unauthorized" },
    });
    const gateway = createHttpIgGateway(config, { fetchImpl: impl });
    const error = await gateway.getQuota("/p").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).code).toBe("AUTHENTICATION");
    expect(describeGatewayError(error as GatewayError)).not.toContain(
      config.token,
    );
  });

  it("honours the code and retryable sent by the gateway", async () => {
    const { impl } = fakeFetch({
      status: 502,
      body: {
        error: "Instagram publishing quota exhausted",
        code: "QUOTA_EXHAUSTED",
        retryable: false,
      },
    });
    const gateway = createHttpIgGateway(config, { fetchImpl: impl });
    const error = (await gateway
      .getQuota("/p")
      .catch((e) => e)) as GatewayError;
    expect(error.code).toBe("QUOTA_EXHAUSTED");
    expect(error.retryable).toBe(false);
  });

  it("429 is retryable RATE_LIMIT", async () => {
    const { impl } = fakeFetch({ status: 429, body: { error: "slow down" } });
    const gateway = createHttpIgGateway(config, { fetchImpl: impl });
    const error = (await gateway
      .getQuota("/p")
      .catch((e) => e)) as GatewayError;
    expect(error.code).toBe("RATE_LIMIT");
    expect(error.retryable).toBe(true);
  });

  it("codeless 5xx is retryable REMOTE_FAILURE", async () => {
    const { impl } = fakeFetch({ status: 500, raw: "no json" });
    const gateway = createHttpIgGateway(config, { fetchImpl: impl });
    const error = (await gateway
      .getQuota("/p")
      .catch((e) => e)) as GatewayError;
    expect(error.code).toBe("REMOTE_FAILURE");
    expect(error.retryable).toBe(true);
  });

  it("network failure is UNREACHABLE and never leaks the token", async () => {
    const { impl } = fakeFetch({ throws: new Error("ECONNREFUSED") });
    const gateway = createHttpIgGateway(config, { fetchImpl: impl });
    const error = (await gateway
      .getQuota("/p")
      .catch((e) => e)) as GatewayError;
    expect(error.code).toBe("UNREACHABLE");
    const text = describeGatewayError(error);
    expect(text).not.toContain(config.token);
    expect(text).toContain("127.0.0.1:4005");
  });

  it("timeout is retryable REMOTE_FAILURE", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    const { impl } = fakeFetch({ throws: timeout });
    const gateway = createHttpIgGateway(config, { fetchImpl: impl });
    const error = (await gateway
      .getQuota("/p")
      .catch((e) => e)) as GatewayError;
    expect(error.code).toBe("REMOTE_FAILURE");
    expect(error.retryable).toBe(true);
  });

  it("token never travels in the body or the error message", async () => {
    const { impl, calls } = fakeFetch({
      status: 403,
      body: { error: "forbidden", code: "PERMISSION", retryable: false },
    });
    const gateway = createHttpIgGateway(config, { fetchImpl: impl });
    const error = (await gateway
      .getQuota("/p")
      .catch((e) => e)) as GatewayError;
    expect(String(calls[0]?.init.body)).not.toContain(config.token);
    expect(JSON.stringify(error.message)).not.toContain(config.token);
  });
});
