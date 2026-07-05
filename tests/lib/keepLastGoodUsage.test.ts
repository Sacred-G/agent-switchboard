import { describe, it, expect } from "vitest";
import {
  resolveDisplayUsage,
  isTransientUsageError,
  KEEP_LAST_GOOD_MS,
  type LastGoodUsage,
} from "@/lib/query/queries";
import type { UsageResult } from "@/types";


const ok = (remaining: number): UsageResult => ({
  success: true,
  data: [{ remaining, unit: "USD" }],
});
const fail = (error = "Network error: connection reset"): UsageResult => ({
  success: false,
  error,
});

const T0 = 1_000_000_000_000;

describe("isTransientUsageError", () => {
  it("网络类Failed → 瞬时（true）", () => {
    expect(isTransientUsageError(fail("Network error: timed out"))).toBe(true);
    expect(isTransientUsageError(fail("Request failed: timed out"))).toBe(true);
    expect(isTransientUsageError(fail("Request failed: Connect超时"))).toBe(true);
    expect(isTransientUsageError(fail("Failed to read response: eof"))).toBe(
      true,
    );
    expect(isTransientUsageError(fail("Failed to read response: eof"))).toBe(true);
  });

  it("确定性Failed → 非瞬时（false），必须立即透出", () => {
    expect(
      isTransientUsageError(fail("Authentication failed (HTTP 401)")),
    ).toBe(false);
    expect(isTransientUsageError(fail("API key is empty"))).toBe(false);
    expect(isTransientUsageError(fail("Unknown balance provider"))).toBe(false);
    expect(isTransientUsageError(fail("Unknown coding plan provider"))).toBe(
      false,
    );
    expect(isTransientUsageError(fail("API error (HTTP 400): bad"))).toBe(
      false,
    );
    expect(isTransientUsageError(fail("Failed to parse response: x"))).toBe(
      false,
    );
  });

  it("HTTP 5xx → 瞬时（true）; 4xx → 非瞬时（false）", () => {
    expect(isTransientUsageError(fail("API error (HTTP 500): oops"))).toBe(
      true,
    );
    expect(
      isTransientUsageError(fail("HTTP 503 Service Unavailable : x")),
    ).toBe(true);
    expect(
      isTransientUsageError(fail("API error (HTTP 502): bad gateway")),
    ).toBe(true);
    expect(
      isTransientUsageError(fail("API error (HTTP 429): rate limited")),
    ).toBe(false);
    expect(
      isTransientUsageError(fail("Authentication failed (HTTP 403)")),
    ).toBe(false);
  });

  it("成功 / 无错误信息 → false", () => {
    expect(isTransientUsageError(ok(1))).toBe(false);
    expect(isTransientUsageError({ success: false })).toBe(false);
  });
});

describe("resolveDisplayUsage (keep-last-good)", () => {
  it("成功结果: 原样展示并记录为 lastGood，lastQueriedAt=获取时刻", () => {
    const success = ok(42);
    const r = resolveDisplayUsage(success, T0, null, T0);
    expect(r.data).toBe(success);
    expect(r.lastQueriedAt).toBe(T0);
    expect(r.lastGood).toEqual({ data: success, at: T0 });
  });

  it("瞬时Failed + 窗口内有上次成功: 继续展示成功值，lastQueriedAt 指向成功时刻", () => {
    const prev: LastGoodUsage = { data: ok(42), at: T0 };
    const now = T0 + KEEP_LAST_GOOD_MS - 1;
    const r = resolveDisplayUsage(fail(), now, prev, now);
    expect(r.data).toBe(prev.data);
    expect(r.lastQueriedAt).toBe(T0);
    expect(r.lastGood).toBe(prev);
  });

  it("瞬时Failed + 上次成功已过期（>= 窗口）: 展示Failed本身", () => {
    const prev: LastGoodUsage = { data: ok(42), at: T0 };
    const now = T0 + KEEP_LAST_GOOD_MS;
    const failure = fail();
    const r = resolveDisplayUsage(failure, now, prev, now);
    expect(r.data).toBe(failure);
    expect(r.lastQueriedAt).toBe(now);
    expect(r.lastGood).toBe(prev);
  });

  it("确定性Failed（鉴权/空 key/未知供应商）: 即使窗口内有上次成功也立即透出，并清空 lastGood", () => {
    const prev: LastGoodUsage = { data: ok(42), at: T0 };
    const now = T0 + 1000;
    for (const failure of [
      fail("Authentication failed (HTTP 401)"),
      fail("API key is empty"),
      fail("Unknown coding plan provider"),
    ]) {
      const r = resolveDisplayUsage(failure, now, prev, now);
      expect(r.data).toBe(failure);
      expect(r.lastQueriedAt).toBe(now);
      expect(r.lastGood).toBeNull();
    }
  });

  it("确定性Failed清空 lastGood: 随后的网络抖动不会复活旧成功", () => {
    const afterSuccess = resolveDisplayUsage(ok(42), T0, null, T0);
    expect(afterSuccess.lastGood).not.toBeNull();
    const afterAuthFail = resolveDisplayUsage(
      fail("Authentication failed (HTTP 401)"),
      T0 + 1000,
      afterSuccess.lastGood,
      T0 + 1000,
    );
    expect(afterAuthFail.lastGood).toBeNull();
    const netFail = fail();
    const afterBlip = resolveDisplayUsage(
      netFail,
      T0 + 2000,
      afterAuthFail.lastGood,
      T0 + 2000,
    );
    expect(afterBlip.data).toBe(netFail);
    expect(afterBlip.lastGood).toBeNull();
  });

  it("瞬时Failed + 从无成功记录: 展示Failed本身", () => {
    const failure = fail();
    const now = T0 + 5000;
    const r = resolveDisplayUsage(failure, now, null, now);
    expect(r.data).toBe(failure);
    expect(r.lastQueriedAt).toBe(now);
    expect(r.lastGood).toBeNull();
  });

  it("新的成功覆盖旧的 lastGood", () => {
    const prev: LastGoodUsage = { data: ok(42), at: T0 };
    const fresh = ok(7);
    const now = T0 + 60_000;
    const r = resolveDisplayUsage(fresh, now, prev, now);
    expect(r.data).toBe(fresh);
    expect(r.lastGood).toEqual({ data: fresh, at: now });
  });

  it("加载中（raw=undefined）: data 为 undefined，lastGood 不变", () => {
    const prev: LastGoodUsage = { data: ok(42), at: T0 };
    const r = resolveDisplayUsage(undefined, 0, prev, T0 + 1000);
    expect(r.data).toBeUndefined();
    expect(r.lastQueriedAt).toBeNull();
    expect(r.lastGood).toBe(prev);
  });

  it("dataUpdatedAt 为 0 的成功: 用注入的 now 作为获取时刻", () => {
    const success = ok(1);
    const now = T0 + 123;
    const r = resolveDisplayUsage(success, 0, null, now);
    expect(r.lastGood).toEqual({ data: success, at: now });
  });
});
