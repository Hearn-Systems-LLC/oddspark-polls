import { afterEach, describe, expect, it, vi } from "vitest";
import { selectCloudflareClientAddress } from "../../src/lib/cloudflare-client-address";

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("selectCloudflareClientAddress", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("selects and normalizes a direct IPv4 CF-Connecting-IP", () => {
    expect(
      selectCloudflareClientAddress(
        headers({ "cf-connecting-ip": "203.0.113.8" }),
      ),
    ).toEqual({
      ok: true,
      value: {
        claimToken: "v4:203.0.113.8",
        rateLimitToken: "v4-full:203.0.113.8",
      },
    });
  });

  it("selects and normalizes a direct IPv6 CF-Connecting-IP", () => {
    expect(
      selectCloudflareClientAddress(
        headers({ "cf-connecting-ip": "2001:db8::1" }),
      ),
    ).toEqual({
      ok: true,
      value: {
        claimToken: "v6:20010db800000000",
        rateLimitToken: "v6-full:20010db8000000000000000000000001",
      },
    });
  });

  it("recovers CF-Connecting-IPv6 only behind a Class-E pseudo IPv4 primary", () => {
    expect(
      selectCloudflareClientAddress(
        headers({
          "cf-connecting-ip": "240.0.0.1",
          "cf-connecting-ipv6": "2001:db8::99",
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        claimToken: "v6:20010db800000000",
        rateLimitToken: "v6-full:20010db8000000000000000000000099",
      },
    });
  });

  it("accepts mapped IPv6 in the guarded auxiliary header", () => {
    expect(
      selectCloudflareClientAddress(
        headers({
          "cf-connecting-ip": "240.0.0.1",
          "cf-connecting-ipv6": "::ffff:203.0.113.8",
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        claimToken: "v4:203.0.113.8",
        rateLimitToken: "v4-full:203.0.113.8",
      },
    });
  });

  it("fails when Class-E primary lacks a valid CF-Connecting-IPv6", () => {
    expect(
      selectCloudflareClientAddress(
        headers({ "cf-connecting-ip": "240.0.0.1" }),
      ),
    ).toEqual({ ok: false, code: "identity_unavailable" });
    expect(
      selectCloudflareClientAddress(
        headers({
          "cf-connecting-ip": "240.0.0.1",
          "cf-connecting-ipv6": "not-an-address",
        }),
      ),
    ).toEqual({ ok: false, code: "identity_unavailable" });
    expect(
      selectCloudflareClientAddress(
        headers({
          "cf-connecting-ip": "240.0.0.1",
          "cf-connecting-ipv6": "203.0.113.8",
        }),
      ),
    ).toEqual({ ok: false, code: "identity_unavailable" });
  });

  it("rejects a non-canonical Class-E primary even with valid IPv6 recovery", () => {
    expect(
      selectCloudflareClientAddress(
        headers({
          "cf-connecting-ip": "240.000.0.1",
          "cf-connecting-ipv6": "2001:db8::99",
        }),
      ),
    ).toEqual({ ok: false, code: "identity_unavailable" });
  });

  it("ignores auxiliary CF-Connecting-IPv6 when the primary is not Class E", () => {
    expect(
      selectCloudflareClientAddress(
        headers({
          "cf-connecting-ip": "203.0.113.8",
          "cf-connecting-ipv6": "2001:db8::spoofed",
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        claimToken: "v4:203.0.113.8",
        rateLimitToken: "v4-full:203.0.113.8",
      },
    });
  });

  it("ignores generic forwarded headers and form-like sources", () => {
    expect(
      selectCloudflareClientAddress(
        headers({
          "x-forwarded-for": "198.51.100.1",
          "x-real-ip": "198.51.100.2",
          "cf-pseudo-ipv4": "198.51.100.3",
        }),
      ),
    ).toEqual({ ok: false, code: "identity_unavailable" });
  });

  it("fails on missing or malformed primary identity", () => {
    expect(selectCloudflareClientAddress(headers({}))).toEqual({
      ok: false,
      code: "identity_unavailable",
    });
    expect(
      selectCloudflareClientAddress(
        headers({ "cf-connecting-ip": "not-an-ip" }),
      ),
    ).toEqual({ ok: false, code: "identity_unavailable" });
  });

  it("never logs header values for hostile input", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    selectCloudflareClientAddress(
      headers({
        "cf-connecting-ip": "192.0.2.1,10.0.0.1",
        "x-forwarded-for": "198.51.100.9",
      }),
    );

    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
