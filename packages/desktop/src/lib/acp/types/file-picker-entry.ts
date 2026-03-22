/**
 * File entry for the file picker dropdown.
 * Based on IndexedFile which now includes git status directly from Rust.
 */
import type { IndexedFile } from "../../services/converted-session-types.js";

export type FilePickerEntry = IndexedFile;
