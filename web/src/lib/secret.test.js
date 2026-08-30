import { describe, it, expect } from "vitest";
import {
  randomSecret,
  bytesToHex,
  hexToBytes,
  sha256Hex,
  buildClaimLink,
  readSecretFromLocation,
} from "./secret.js";

describe("secret generation", () => {
  it("produces 32 fresh bytes as hex", () => {
    const secret = randomSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(secret).not.toBe(randomSecret());
  });
});

describe("hex conversion", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 15, 16, 255]);
    expect(bytesToHex(bytes)).toBe("000f10ff");
    expect(Array.from(hexToBytes("000f10ff"))).toEqual([0, 15, 16, 255]);
  });

  it("rejects malformed input rather than guessing", () => {
    expect(() => hexToBytes("abc")).toThrow();
    expect(() => hexToBytes("zz")).toThrow();
  });

  it("tolerates a 0x prefix and stray whitespace", () => {
    expect(Array.from(hexToBytes(" 0x10ff "))).toEqual([16, 255]);
  });
});

describe("sha256Hex", () => {
  it("matches the known digest of an empty input", async () => {
    await expect(sha256Hex("")).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("is stable for the same secret and differs for another", async () => {
    const a = await sha256Hex("00ff");
    expect(await sha256Hex("00ff")).toBe(a);
    expect(await sha256Hex("00fe")).not.toBe(a);
  });
});

describe("claim links", () => {
  it("keeps the secret in the fragment so it never reaches a server", () => {
    const link = buildClaimLink("https://kirim.app", 7, "abcd");
    expect(link).toBe("https://kirim.app/claim?id=7#s=abcd");
    // Semua yang sebelum '#' adalah bagian yang dikirim ke jaringan.
    expect(link.split("#")[0]).not.toContain("abcd");
  });

  it("reads the secret back out of a location", () => {
    expect(readSecretFromLocation({ hash: "#s=deadbeef" })).toBe("deadbeef");
    expect(readSecretFromLocation({ hash: "" })).toBe(null);
    expect(readSecretFromLocation({})).toBe(null);
  });
});
