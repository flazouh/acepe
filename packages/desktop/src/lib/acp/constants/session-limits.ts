/**
 * Session and project scanning limits.
 *
 * These values should match the corresponding Rust constants in
 * src-tauri/src/history/constants.rs for consistency.
 */

/** Maximum number of projects to scan during discovery. */
export const MAX_PROJECTS_TO_SCAN = 20;

/** Maximum number of sessions to display per project in the UI. */
export const MAX_SESSIONS_PER_PROJECT = 50;
