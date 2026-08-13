import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Ensure the DOM is reset between tests (globals are disabled in this project,
// so Testing Library's automatic cleanup does not run on its own).
afterEach(() => {
  cleanup();
});
