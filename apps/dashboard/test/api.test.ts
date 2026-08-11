import { describe, expect, it, vi } from "vitest";
import { ApiError, getFleet, getHealth } from "../src/api";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("dashboard API client", () => {
  it("validates health responses and forwards an abort signal", async () => {
    const health = {
      status: "ok",
      version: "2026.8.10",
      timestamp: "2026-08-10T22:00:00.000Z",
    };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(health)));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(getHealth({ signal: controller.signal })).resolves.toEqual(health);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("rejects fleet data that does not match the shared contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ accountId: "installation-42" }))),
    );

    const request = getFleet("42");

    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({ kind: "invalid-response" });
  });
});
