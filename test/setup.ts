import { vi } from "vitest";

vi.mock("../src/classify.js", async (original) => ({
  ...(await original<typeof import("../src/classify.js")>()),
  loadClassifier: () => null,
}));
