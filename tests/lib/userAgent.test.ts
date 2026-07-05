import { describe, it, expect } from "vitest";
import { isValidUserAgentHeader } from "@/lib/userAgent";

const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(0x7f);

describe("isValidUserAgentHeader", () => {
  it("treats empty / whitespace-only as valid (unset)", () => {
    expect(isValidUserAgentHeader("")).toBe(true);
    expect(isValidUserAgentHeader("   ")).toBe(true);
  });

  it("accepts visible ASCII (trimmed)", () => {
    expect(isValidUserAgentHeader("claude-cli/2.1.161")).toBe(true);
    expect(isValidUserAgentHeader("  claude-cli/2.1.161  ")).toBe(true);
  });

  it("accepts non-ASCII — matches backend HeaderValue byte rule", () => {
    expect(isValidUserAgentHeader("claude-cli/1.0 中文")).toBe(true);
  });

  it("accepts internal tab", () => {
    expect(isValidUserAgentHeader("claude\tcli")).toBe(true);
  });

  it("rejects control characters (newline / null / DEL)", () => {
    expect(isValidUserAgentHeader("claude\ncli")).toBe(false);
    expect(isValidUserAgentHeader(`claude${NUL}cli`)).toBe(false);
    expect(isValidUserAgentHeader(`claude${DEL}cli`)).toBe(false);
  });
});
