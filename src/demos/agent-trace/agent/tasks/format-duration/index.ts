import { BUGS, MODULE_PATH, TEST_PATH, projectFiles, type TaskVariant } from "./files";

export { BUGS, MODULE_PATH, TEST_PATH, projectFiles, type TaskVariant };

export const TASK_ID = "format-duration";
/** Kept identical to task.md (a unit test checks this) so no raw-file import is needed. */
export const TASK_TEXT =
  "The test suite for `formatDuration` in `src/formatDuration.js` is failing. Find the bug, fix it with the smallest possible edit, make sure every test passes, then finish with a one-sentence summary of the fix.";
export const VARIANTS: readonly TaskVariant[] = ["rounding", "padding"];
