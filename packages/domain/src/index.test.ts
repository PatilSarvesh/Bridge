import { describe, expect, it } from "vitest";

import { reviewDateFor } from "./index.js";

describe("decision review policy", () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");

  it("reviews ordinary decisions after 180 days", () => {
    expect(reviewDateFor("high", createdAt)).toBe("2026-06-30T00:00:00.000Z");
  });

  it("reviews protected decisions after 90 days", () => {
    expect(reviewDateFor("protected", createdAt)).toBe("2026-04-01T00:00:00.000Z");
  });
});
