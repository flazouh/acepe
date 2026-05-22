/**
 * Per-session model memory: remembers which model was selected per mode.
 * Stored in SQLite and restored when session resumes.
 * Format: sessionId → { modeId → modelId }
 */
export type SessionModelPerMode = Record<string, Record<string, string>>;
