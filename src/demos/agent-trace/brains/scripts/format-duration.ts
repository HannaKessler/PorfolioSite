import { BUGS } from "../../agent/tasks/format-duration/files";

/** Known fixes for the format-duration task: the buggy line and its replacement. */
export const FORMAT_DURATION_FIXES = Object.values(BUGS).map((b) => ({ find: b.buggy, replace: b.fixed, summary: b.description }));
