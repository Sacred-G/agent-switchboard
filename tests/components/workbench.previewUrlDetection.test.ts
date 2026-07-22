import { describe, it, expect } from "vitest";
import {
  extractLocalUrls,
  detectCommandFailureHint,
  detectCommandQuickFix,
  isLocalPreviewUrl,
  stripAnsi,
} from "@/components/workbench/store";

describe("stripAnsi", () => {
  it("removes CSI color/cursor sequences", () => {
    expect(stripAnsi("\x1b[32mLocal:\x1b[0m http://localhost:3000")).toBe(
      "Local: http://localhost:3000",
    );
  });

  it("removes OSC hyperlink sequences", () => {
    const osc = "\x1b]8;;http://example.com\x1b\\click\x1b]8;;\x1b\\";
    expect(stripAnsi(osc)).toBe("click");
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("ready in 200ms")).toBe("ready in 200ms");
  });
});

describe("detectCommandFailureHint", () => {
  it("suggests a targeted port-conflict action", () => {
    expect(detectCommandFailureHint("Error: listen EADDRINUSE: 3000")).toMatch(
      /port is already in use/i,
    );
  });

  it("recognizes missing commands and permissions", () => {
    expect(detectCommandFailureHint("zsh: command not found: vite")).toMatch(
      /installed and on PATH/i,
    );
    expect(detectCommandFailureHint("EACCES: permission denied")).toMatch(
      /permissions/i,
    );
  });

  it("does not invent a fix for unknown output", () => {
    expect(detectCommandFailureHint("unexpected failure")).toBeUndefined();
  });

  it("builds a safe diagnostic command for a busy port", () => {
    expect(detectCommandQuickFix("EADDRINUSE 127.0.0.1:5173")).toBe(
      "lsof -nP -iTCP:5173 -sTCP:LISTEN",
    );
  });
});

describe("extractLocalUrls", () => {
  it("finds a Vite-style dev server line", () => {
    expect(extractLocalUrls("  ➜  Local:   http://localhost:5173/\n")).toEqual([
      "http://localhost:5173/",
    ]);
  });

  it("finds a 127.0.0.1 URL", () => {
    expect(extractLocalUrls("Serving on http://127.0.0.1:8000")).toEqual([
      "http://127.0.0.1:8000",
    ]);
  });

  it("normalizes 0.0.0.0 to localhost so it's actually browsable", () => {
    expect(extractLocalUrls("Running on http://0.0.0.0:8080/")).toEqual([
      "http://localhost:8080/",
    ]);
  });

  it("strips trailing punctuation picked up from prose", () => {
    expect(extractLocalUrls("App is ready at http://localhost:3000.")).toEqual([
      "http://localhost:3000",
    ]);
    expect(extractLocalUrls("(see http://localhost:3000/docs)")).toEqual([
      "http://localhost:3000/docs",
    ]);
  });

  it("ignores non-loopback hosts", () => {
    expect(extractLocalUrls("Deployed to https://example.com")).toEqual([]);
    expect(extractLocalUrls("Internal API at http://192.168.1.5:9000")).toEqual(
      [],
    );
  });

  it("de-duplicates repeated URLs in the same chunk", () => {
    expect(
      extractLocalUrls(
        "http://localhost:3000 http://localhost:3000 http://localhost:3000",
      ),
    ).toEqual(["http://localhost:3000"]);
  });

  it("finds multiple distinct local URLs in one chunk", () => {
    expect(
      extractLocalUrls(
        "Local:   http://localhost:3000/\nNetwork: http://127.0.0.1:3000/",
      ),
    ).toEqual(["http://localhost:3000/", "http://127.0.0.1:3000/"]);
  });

  it("returns nothing for plain output with no URL", () => {
    expect(extractLocalUrls("Compiled successfully!")).toEqual([]);
  });
});

describe("isLocalPreviewUrl", () => {
  it("accepts loopback URLs", () => {
    expect(isLocalPreviewUrl("http://localhost:3000")).toBe(true);
    expect(isLocalPreviewUrl("http://127.0.0.1:8080/app")).toBe(true);
    expect(isLocalPreviewUrl("http://[::1]:4000")).toBe(true);
  });

  it("rejects non-loopback URLs, matching the CSP frame-src allowlist", () => {
    expect(isLocalPreviewUrl("https://example.com")).toBe(false);
    expect(isLocalPreviewUrl("http://192.168.1.5:9000")).toBe(false);
    expect(isLocalPreviewUrl("not a url")).toBe(false);
  });
});
