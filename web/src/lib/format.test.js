import { describe, it, expect } from "vitest";
import {
  fromStroops,
  toStroops,
  formatAmount,
  shortAddress,
  statusOf,
  isExpired,
  timeLeft,
  friendlyError,
} from "./format.js";

const ADDRESS = "GAJG2CTQGG5WAOQNEEYJNRMXFZ3BHLAGACFCTOGXQQ44UZDUCBX4WJHV";

describe("amount conversion", () => {
  it("round-trips whole and fractional amounts", () => {
    expect(toStroops("5")).toBe(50_000_000n);
    expect(toStroops("0.5")).toBe(5_000_000n);
    expect(toStroops("1.2345678")).toBe(12_345_678n);
    expect(fromStroops(50_000_000n)).toBe(5);
  });

  it("never loses precision to floating point", () => {
    // 0.1 + 0.2 dalam float meleset; lewat string tetap eksak.
    expect(toStroops("0.1") + toStroops("0.2")).toBe(toStroops("0.3"));
    expect(toStroops("70.0000001")).toBe(700_000_001n);
  });

  it("respects a token's decimals", () => {
    expect(toStroops("1", 2)).toBe(100n);
    expect(fromStroops(100n, 2)).toBe(1);
  });

  it("formats for humans", () => {
    expect(formatAmount(50_000_000n)).toBe("5");
    expect(formatAmount(12_345_678n)).toBe("1.2346");
  });
});

describe("shortAddress", () => {
  it("abbreviates long keys and leaves short ones alone", () => {
    expect(shortAddress(ADDRESS)).toBe("GAJG…WJHV");
    expect(shortAddress(ADDRESS, 6, 6)).toBe("GAJG2C…X4WJHV");
    expect(shortAddress("GABC")).toBe("GABC");
    expect(shortAddress(undefined)).toBe("");
  });
});

describe("transfer status", () => {
  it("maps the contract's numeric status", () => {
    expect(statusOf({ status: 0 })).toBe("Pending");
    expect(statusOf({ status: 1 })).toBe("Claimed");
    expect(statusOf({ status: 2 })).toBe("Refunded");
  });

  it("detects expiry against the latest ledger", () => {
    expect(isExpired({ expiry_ledger: 100 }, 101)).toBe(true);
    expect(isExpired({ expiry_ledger: 100 }, 100)).toBe(false);
    // Tanpa ledger terkini, jangan pernah mengklaim sudah kedaluwarsa.
    expect(isExpired({ expiry_ledger: 100 }, 0)).toBe(false);
  });
});

describe("timeLeft", () => {
  it("estimates from ledger distance", () => {
    expect(timeLeft({ expiry_ledger: 1_012 }, 1_000)).toBe("1m left");
    expect(timeLeft({ expiry_ledger: 1_720 }, 1_000)).toBe("1h 0m left");
    expect(timeLeft({ expiry_ledger: 121_960 }, 1_000)).toBe("7d 0h left");
  });

  it("reports expiry and unknown ledgers", () => {
    expect(timeLeft({ expiry_ledger: 100 }, 200)).toBe("expired");
    expect(timeLeft({ expiry_ledger: 100 }, 0)).toBe("");
  });
});

describe("friendlyError", () => {
  it("translates every contract error code", () => {
    for (let code = 1; code <= 13; code++) {
      const message = friendlyError(new Error(`HostError: Error(Contract, #${code})`));
      expect(message).not.toMatch(/Error\(Contract/);
      expect(message.length).toBeGreaterThan(8);
    }
  });

  it("recognises wallet, balance and network failures", () => {
    expect(friendlyError(new Error("User declined the request"))).toMatch(/cancelled/i);
    expect(friendlyError(new Error("tx failed: account underfunded"))).toMatch(/balance/i);
    expect(friendlyError(new Error("Failed to fetch"))).toMatch(/connection/i);
  });

  it("falls back to the raw message", () => {
    expect(friendlyError(new Error("boom"))).toBe("boom");
  });
});
