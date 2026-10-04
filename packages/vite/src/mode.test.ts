import { describe, expect, it } from "vitest";
import { detectMode, isDevelopmentMode, isProductionMode } from "./mode.js";

describe("KAS mode detection", () => {
  it("uses Vite's build command for production mode", () => {
    expect(detectMode("build")).toBe("build");
    expect(isProductionMode("build")).toBe(true);
    expect(isDevelopmentMode("build")).toBe(false);
  });

  it("treats serve and unknown commands as development mode", () => {
    expect(detectMode("serve")).toBe("serve");
    expect(detectMode(undefined)).toBe("serve");
    expect(isDevelopmentMode("serve")).toBe(true);
    expect(isProductionMode("serve")).toBe(false);
  });

  it("does not infer build mode from NODE_ENV", () => {
    expect(detectMode("serve")).toBe("serve");
  });
});
