import { describe, expect, it } from "vitest";
import { clientIpFromHeaders } from "./request";

describe("clientIpFromHeaders (trusted proxy hops)", () => {
  it("takes the entry the trusted proxy appended, not the spoofable left-most one", () => {
    // attacker sends "X-Forwarded-For: 1.2.3.4"; nginx appends the real peer 203.0.113.9
    expect(clientIpFromHeaders("1.2.3.4, 203.0.113.9", null, 1)).toBe("203.0.113.9");
    expect(clientIpFromHeaders("1.2.3.4, 203.0.113.9, 10.0.0.1", null, 2)).toBe("203.0.113.9");
  });
  it("falls back to x-real-ip, then unknown", () => {
    expect(clientIpFromHeaders(null, "198.51.100.7", 1)).toBe("198.51.100.7");
    expect(clientIpFromHeaders(null, null, 1)).toBe("unknown");
  });
  it("ignores forwarded headers entirely without a trusted proxy", () => {
    expect(clientIpFromHeaders("1.2.3.4", "5.6.7.8", 0)).toBe("unknown");
  });
  it("never lets header garbage into rate-limit keys and clamps the hop count to the list", () => {
    expect(clientIpFromHeaders("<script>alert(1)</script>", null, 1)).toBe("unknown");
    expect(clientIpFromHeaders("203.0.113.9", null, 3)).toBe("203.0.113.9");
    expect(clientIpFromHeaders("2001:db8::1", null, 1)).toBe("2001:db8::1");
  });
});
