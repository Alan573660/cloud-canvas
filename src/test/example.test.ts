import { describe, it, expect } from "vitest";

describe("project setup", () => {
  it("should pass basic test", () => {
    expect(true).toBe(true);
  });

  it("should have correct environment", () => {
    expect(typeof window).toBe("object");
  });
});
