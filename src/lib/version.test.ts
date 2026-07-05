import { describe, it, expect } from "vitest";
import { compareVersions, isUpdateAvailable } from "./version";

describe("compareVersions", () => {
  it("Compare version size by main version sections", () => {
    expect(compareVersions("2.1.156", "2.1.154")).toBeGreaterThan(0);
    expect(compareVersions("2.1.154", "2.1.156")).toBeLessThan(0);
    expect(compareVersions("2.2.0", "2.1.999")).toBeGreaterThan(0);
    expect(compareVersions("3.0.0", "2.9.9")).toBeGreaterThan(0);
    expect(compareVersions("2.1.156", "2.1.156")).toBe(0);
  });

  it("Pre-release version is lower than official version with same core", () => {
    expect(compareVersions("2.1.156-beta.1", "2.1.156")).toBeLessThan(0);
    expect(compareVersions("2.1.156", "2.1.156-rc.1")).toBeGreaterThan(0);
  });

  it("Between pre-release sections: numeric by value, numeric < non-numeric, more sections is larger", () => {
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.11")).toBeLessThan(0);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
    expect(compareVersions("1.0.0-beta", "1.0.0-beta.1")).toBeLessThan(0);
  });

  it("Conservative return 0 when parsing fails", () => {
    expect(compareVersions("", "2.1.154")).toBe(0);
    expect(compareVersions("unknown", "2.1.154")).toBe(0);
  });
});

describe("isUpdateAvailable", () => {
  it("Suggest update only when latest is strictly higher than current", () => {
    expect(isUpdateAvailable("2.1.154", "2.1.156")).toBe(true);
  });

  it("Do not suggest update when early access exceeds latest (local 156 > latest 154)", () => {
    expect(isUpdateAvailable("2.1.156", "2.1.154")).toBe(false);
  });

  it("Do not suggest update when versions are equal", () => {
    expect(isUpdateAvailable("2.1.156", "2.1.156")).toBe(false);
  });

  it("Do not suggest update when current or latest version is missing", () => {
    expect(isUpdateAvailable(undefined, "2.1.156")).toBe(false);
    expect(isUpdateAvailable("2.1.156", null)).toBe(false);
    expect(isUpdateAvailable("", "")).toBe(false);
  });
});
