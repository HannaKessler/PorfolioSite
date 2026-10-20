/**
 * The virtual project for the format-duration task. Plain JavaScript so the test
 * worker can run it directly without a compiler. Each variant plants one bug.
 */

export type TaskVariant = "rounding" | "padding";

export const MODULE_PATH = "src/formatDuration.js";
export const TEST_PATH = "test/formatDuration.test.js";

const CORRECT = `/**
 * Formats a duration in seconds as m:ss, or h:mm:ss from one hour up.
 * Fractional seconds are rounded to the nearest whole second.
 */
export function formatDuration(totalSeconds) {
  if (typeof totalSeconds !== "number" || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    throw new RangeError("totalSeconds must be a non-negative finite number");
  }
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return \`\${hours}:\${String(minutes).padStart(2, "0")}:\${ss}\`;
  }
  return \`\${minutes}:\${ss}\`;
}
`;

/** The buggy line and its fix, per variant. Both appear exactly once in the module. */
export const BUGS: Record<TaskVariant, { buggy: string; fixed: string; description: string }> = {
  rounding: {
    // Rounds the seconds part on its own, so 59.6 s becomes "1:60" instead of "1:00".
    buggy: "  const seconds = Math.round(totalSeconds % 60);",
    fixed: "  const seconds = rounded % 60;",
    description: "Seconds were rounded separately from minutes, so 59.6 s formatted as 1:60.",
  },
  padding: {
    // Forgets to zero-pad seconds, so 65 s becomes "1:5" instead of "1:05".
    buggy: "  const ss = String(seconds);",
    fixed: '  const ss = String(seconds).padStart(2, "0");',
    description: "Seconds were not zero-padded, so 65 s formatted as 1:5.",
  },
};

export function moduleSource(variant: TaskVariant): string {
  const bug = BUGS[variant];
  if (!CORRECT.includes(bug.fixed)) throw new Error(`variant ${variant}: fixed line not in module`);
  return CORRECT.replace(bug.fixed, bug.buggy);
}

export const TEST_SOURCE = `import { formatDuration } from "../src/formatDuration.js";

describe("formatDuration", () => {
  it("formats zero", () => {
    expect(formatDuration(0)).toBe("0:00");
  });
  it("pads single-digit seconds", () => {
    expect(formatDuration(65)).toBe("1:05");
  });
  it("rounds fractional seconds into the next minute", () => {
    expect(formatDuration(59.6)).toBe("1:00");
  });
  it("formats hours with padded minutes", () => {
    expect(formatDuration(3725)).toBe("1:02:05");
  });
  it("rounds down below half a second", () => {
    expect(formatDuration(119.4)).toBe("1:59");
  });
  it("rejects negative input", () => {
    expect(() => formatDuration(-1)).toThrow(RangeError);
  });
});
`;

export function projectFiles(variant: TaskVariant): Record<string, string> {
  return {
    [MODULE_PATH]: moduleSource(variant),
    [TEST_PATH]: TEST_SOURCE,
  };
}
