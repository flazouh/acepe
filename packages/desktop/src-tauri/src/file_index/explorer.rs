//! File explorer ranking, preview classification, and content loading.
//!
//! All ranking/scoring/classification happens here in Rust; the frontend only
//! renders already-ranked rows and already-classified preview payloads.

use std::path::Path;
use std::time::UNIX_EPOCH;

use tracing::debug;

use super::git::get_file_content_from_head;
use super::types::{
    FileExplorerPreviewResponse, FileExplorerRow, FileExplorerSearchResponse, FileGitStatus,
    PreviewKind, ProjectIndex,
};

// ── Hard limits ──────────────────────────────────────────────────────────────

/// Maximum query length accepted. Queries longer than this are truncated.
const MAX_QUERY_LEN: usize = 200;
/// Maximum page size. Requests larger than this are clamped.
const MAX_LIMIT: u32 = 200;
/// Maximum offset accepted.
const MAX_OFFSET: u32 = 10_000;
/// Maximum bytes read for a text preview payload.
const MAX_PREVIEW_BYTES: u64 = 512 * 1024; // 512 KB
/// Maximum bytes read for a diff preview payload.
const MAX_DIFF_BYTES: u64 = 256 * 1024; // 256 KB
/// Number of leading bytes sniffed to detect binary content.
const BINARY_SNIFF_BUDGET: usize = 8_000;
/// Maximum changed lines before we decline Pierre diff.
const MAX_DIFF_LINES: usize = 2_000;

// ── Binary extension list ─────────────────────────────────────────────────────

fn is_binary_extension(ext: &str) -> bool {
    matches!(
        ext,
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "bmp"
            | "ico"
            | "tiff"
            | "tif"
            | "svg"
            | "pdf"
            | "zip"
            | "tar"
            | "gz"
            | "bz2"
            | "xz"
            | "7z"
            | "rar"
            | "exe"
            | "dll"
            | "so"
            | "dylib"
            | "a"
            | "o"
            | "wasm"
            | "pyc"
            | "class"
            | "jar"
            | "war"
            | "ear"
            | "db"
            | "sqlite"
            | "sqlite3"
            | "mp3"
            | "mp4"
            | "wav"
            | "ogg"
            | "flac"
            | "mkv"
            | "avi"
            | "mov"
            | "ttf"
            | "otf"
            | "woff"
            | "woff2"
    )
}

/// Sniff the first `BINARY_SNIFF_BUDGET` bytes for null bytes (cheap binary
/// detection that avoids reading the full file).
fn sniff_binary(bytes: &[u8]) -> bool {
    let budget = bytes.len().min(BINARY_SNIFF_BUDGET);
    bytes[..budget].contains(&0u8)
}

fn fallback_for_non_regular_file(
    file_path: &str,
    file_name: String,
    size_bytes: Option<u64>,
    git_status: Option<FileGitStatus>,
) -> FileExplorerPreviewResponse {
    FileExplorerPreviewResponse::Fallback {
        file_path: file_path.to_string(),
        file_name,
        reason: "Unsupported file type".to_string(),
        size_bytes,
        git_status,
        preview_kind: PreviewKind::Unsupported,
    }
}

// ── Preview kind classification ───────────────────────────────────────────────

/// Classify a file's preview kind using only metadata (no file reads).
pub fn classify_preview_kind(
    path: &str,
    extension: &str,
    size_bytes: Option<u64>,
    git_status: Option<&FileGitStatus>,
) -> PreviewKind {
    // Deleted / renamed files: no working-tree content available.
    if let Some(gs) = git_status {
        if gs.status == "D" {
            return PreviewKind::Deleted;
        }
    }

    // Extension-based binary detection (fast, no I/O).
    if is_binary_extension(extension) {
        return PreviewKind::Binary;
    }

    // Size guard: if we already know it's huge, skip content read.
    if let Some(sz) = size_bytes {
        if sz > MAX_PREVIEW_BYTES {
            return PreviewKind::Large;
        }
    }

    // Changed text file → diff preview; unchanged → plain text preview.
    if let Some(gs) = git_status {
        if gs.status == "M" || gs.status == "A" || gs.status == "R" {
            let _ = path; // suppress lint; path reserved for future heuristics
            return PreviewKind::Diff;
        }
    }

    PreviewKind::Text
}

// ── Scoring / ranking ─────────────────────────────────────────────────────────

/// Compute a score for a file row given a (possibly empty) normalised query.
///
/// Higher = better.  Tie-break is handled externally by path ascending.
fn diff_priority(git_status: Option<&FileGitStatus>) -> u64 {
    if let Some(status) = git_status {
        return status.insertions + status.deletions;
    }

    0
}

fn score_row(path: &str, file_name: &str, query_lower: &str, has_git_status: bool) -> i32 {
    let has_git_diff = has_git_status;
    let git_bonus = if has_git_diff { 1_000_000 } else { 0 };

    if query_lower.is_empty() {
        // Empty query: prefer shorter / shallower paths after git bonus.
        let depth_penalty = path.chars().filter(|c| *c == '/').count() as i32 * 10;
        let len_penalty = path.len() as i32;
        return git_bonus - depth_penalty - len_penalty;
    }

    // Exact filename match — shallower paths win ties (fewer '/' separators = better).
    if file_name.to_lowercase() == query_lower {
        let depth_penalty = path.chars().filter(|c| *c == '/').count() as i32 * 100;
        return git_bonus + 100_000 - depth_penalty;
    }

    // Filename starts-with match.
    if file_name.to_lowercase().starts_with(query_lower) {
        let depth_penalty = path.chars().filter(|c| *c == '/').count() as i32 * 10;
        return git_bonus + 50_000 - file_name.len() as i32 - depth_penalty;
    }

    // Filename contains match.
    if file_name.to_lowercase().contains(query_lower) {
        return git_bonus + 20_000 - file_name.len() as i32;
    }

    // Path contains match.
    if path.to_lowercase().contains(query_lower) {
        return git_bonus + 5_000 - path.len() as i32;
    }

    // No match → exclude from results.
    i32::MIN
}

// ── File metadata helpers ─────────────────────────────────────────────────────

fn get_file_metadata(full_path: &Path) -> (Option<i64>, Option<u64>) {
    match std::fs::metadata(full_path) {
        Ok(meta) => {
            let last_modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64);
            let size_bytes = Some(meta.len());
            (last_modified_ms, size_bytes)
        }
        Err(_) => (None, None),
    }
}

fn build_path_segments(path: &str) -> Vec<String> {
    path.split('/').map(|s| s.to_string()).collect()
}

// ── Public search API ─────────────────────────────────────────────────────────

/// Search and rank files in a cached `ProjectIndex` for the explorer modal.
///
/// All ranking, filtering, and slicing happens here.
pub fn search_explorer(
    project_path: &str,
    index: &ProjectIndex,
    query: &str,
    limit: u32,
    offset: u32,
) -> FileExplorerSearchResponse {
    // Clamp inputs.
    let limit = limit.clamp(1, MAX_LIMIT);
    let offset = offset.clamp(0, MAX_OFFSET);
    let query_norm: String = query.chars().take(MAX_QUERY_LEN).collect();
    let query_lower = query_norm.to_lowercase();

    debug!(
        project_path,
        query = query_lower.as_str(),
        limit,
        offset,
        "search_explorer started"
    );

    // Build a git status lookup map (O(1) per file).
    let git_map: std::collections::HashMap<&str, &FileGitStatus> = index
        .git_status
        .iter()
        .map(|gs| (gs.path.as_str(), gs))
        .collect();

    // Score every file.
    let mut scored: Vec<(&crate::file_index::types::IndexedFile, i32, u64)> = index
        .files
        .iter()
        .map(|file| {
            let git_status = git_map.get(file.path.as_str()).copied();
            let diff_size = diff_priority(git_status);
            let file_name = Path::new(&file.path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&file.path);
            let s = score_row(&file.path, file_name, &query_lower, git_status.is_some());
            (file, s, diff_size)
        })
        .filter(|(_, s, _)| *s > i32::MIN)
        .collect();

    // Sort: highest score first, then path ascending for stable tie-breaking.
    scored.sort_by(|(a, sa, da), (b, sb, db)| {
        sb.cmp(sa)
            .then_with(|| db.cmp(da))
            .then_with(|| a.path.cmp(&b.path))
    });

    let total = scored.len() as u64;

    // Apply offset + limit.
    let page: Vec<&crate::file_index::types::IndexedFile> = scored
        .iter()
        .skip(offset as usize)
        .take(limit as usize)
        .map(|(f, _, _)| *f)
        .collect();

    // Build rows (cheap metadata reads).
    let rows: Vec<FileExplorerRow> = page
        .iter()
        .map(|file| {
            let full_path = Path::new(project_path).join(&file.path);
            let (last_modified_ms, size_bytes) = get_file_metadata(&full_path);
            let file_name = Path::new(&file.path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&file.path)
                .to_string();
            let path_segments = build_path_segments(&file.path);
            let git_status = git_map.get(file.path.as_str()).map(|gs| (*gs).clone());
            let is_tracked = git_status.is_none()
                || git_status
                    .as_ref()
                    .map(|gs| gs.status != "A")
                    .unwrap_or(false);
            let is_binary = is_binary_extension(&file.extension);
            let preview_kind =
                classify_preview_kind(&file.path, &file.extension, size_bytes, git_status.as_ref());

            FileExplorerRow {
                project_path: project_path.to_string(),
                path: file.path.clone(),
                file_name,
                extension: file.extension.clone(),
                path_segments,
                git_status,
                is_tracked,
                is_binary,
                last_modified_ms,
                size_bytes,
                preview_kind,
            }
        })
        .collect();

    debug!(
        project_path,
        total,
        returned = rows.len(),
        "search_explorer completed"
    );

    FileExplorerSearchResponse {
        project_path: project_path.to_string(),
        query: query_norm,
        total,
        rows,
    }
}

// ── Preview loading ───────────────────────────────────────────────────────────

/// Load a preview payload for the selected explorer row.
///
/// Performs a two-phase approach: classify first using metadata, read content
/// only when the final kind requires it.
pub fn load_explorer_preview(
    project_path: &str,
    file_path: &str,
    git_status_map: &std::collections::HashMap<String, FileGitStatus>,
) -> Result<FileExplorerPreviewResponse, String> {
    let full_path = Path::new(project_path).join(file_path);
    let file_name = Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(file_path)
        .to_string();
    let extension = Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let git_status = git_status_map.get(file_path).cloned();

    // Get size from metadata if the file exists.
    let size_bytes: Option<u64> = std::fs::metadata(&full_path).ok().map(|m| m.len());

    // Phase 1: classify without reading content.
    let kind = classify_preview_kind(file_path, &extension, size_bytes, git_status.as_ref());

    debug!(
        project_path,
        file_path,
        ?kind,
        "load_explorer_preview classification"
    );

    match kind {
        PreviewKind::Binary | PreviewKind::Large | PreviewKind::Unsupported => {
            return Ok(FileExplorerPreviewResponse::Fallback {
                file_path: file_path.to_string(),
                file_name,
                reason: match kind {
                    PreviewKind::Binary => "Binary file".to_string(),
                    PreviewKind::Large => "File is too large to preview".to_string(),
                    _ => "Unsupported file type".to_string(),
                },
                size_bytes,
                git_status,
                preview_kind: kind,
            });
        }
        PreviewKind::Deleted => {
            return Ok(FileExplorerPreviewResponse::Fallback {
                file_path: file_path.to_string(),
                file_name,
                reason: "File has been deleted".to_string(),
                size_bytes: None,
                git_status,
                preview_kind: PreviewKind::Deleted,
            });
        }
        _ => {}
    }

    if let Ok(metadata) = std::fs::metadata(&full_path) {
        if !metadata.is_file() {
            return Ok(fallback_for_non_regular_file(
                file_path, file_name, size_bytes, git_status,
            ));
        }
    }

    // Phase 2: read content.
    match kind {
        PreviewKind::Diff => {
            let new_content_bytes =
                std::fs::read(&full_path).map_err(|e| format!("Failed to read file: {}", e))?;

            // Guard against binary sniff (extension can lie).
            if sniff_binary(&new_content_bytes) {
                return Ok(FileExplorerPreviewResponse::Fallback {
                    file_path: file_path.to_string(),
                    file_name,
                    reason: "Binary file (detected by content)".to_string(),
                    size_bytes,
                    git_status,
                    preview_kind: PreviewKind::Binary,
                });
            }

            // Size guard on actual bytes.
            if new_content_bytes.len() as u64 > MAX_DIFF_BYTES {
                return Ok(FileExplorerPreviewResponse::Fallback {
                    file_path: file_path.to_string(),
                    file_name,
                    reason: "Diff is too large to preview".to_string(),
                    size_bytes,
                    git_status,
                    preview_kind: PreviewKind::Large,
                });
            }

            let new_content = String::from_utf8_lossy(&new_content_bytes).to_string();

            // Line count guard for Pierre rendering.
            if new_content.lines().count() > MAX_DIFF_LINES {
                return Ok(FileExplorerPreviewResponse::Fallback {
                    file_path: file_path.to_string(),
                    file_name,
                    reason: "Diff has too many lines to preview".to_string(),
                    size_bytes,
                    git_status,
                    preview_kind: PreviewKind::Large,
                });
            }

            // Get HEAD content (returns None for new/untracked files).
            let old_content = get_file_content_from_head(Path::new(project_path), file_path)
                .map_err(|e| format!("Failed to get HEAD content: {}", e))?;

            let gs = match git_status {
                Some(gs) => gs,
                None => {
                    // No git status on record — degrade to text preview.
                    return Ok(FileExplorerPreviewResponse::Text {
                        file_path: file_path.to_string(),
                        file_name,
                        content: new_content,
                        language_hint: language_hint_from_extension(&extension),
                    });
                }
            };

            Ok(FileExplorerPreviewResponse::Diff {
                file_path: file_path.to_string(),
                file_name,
                old_content,
                new_content,
                git_status: gs,
            })
        }

        PreviewKind::Text => {
            let bytes =
                std::fs::read(&full_path).map_err(|e| format!("Failed to read file: {}", e))?;

            // Binary sniff even for "text" classification.
            if sniff_binary(&bytes) {
                return Ok(FileExplorerPreviewResponse::Fallback {
                    file_path: file_path.to_string(),
                    file_name,
                    reason: "Binary file (detected by content)".to_string(),
                    size_bytes,
                    git_status,
                    preview_kind: PreviewKind::Binary,
                });
            }

            if bytes.len() as u64 > MAX_PREVIEW_BYTES {
                return Ok(FileExplorerPreviewResponse::Fallback {
                    file_path: file_path.to_string(),
                    file_name,
                    reason: "File is too large to preview".to_string(),
                    size_bytes,
                    git_status,
                    preview_kind: PreviewKind::Large,
                });
            }

            let content = String::from_utf8_lossy(&bytes).to_string();
            Ok(FileExplorerPreviewResponse::Text {
                file_path: file_path.to_string(),
                file_name,
                content,
                language_hint: language_hint_from_extension(&extension),
            })
        }

        // Already handled above.
        _ => Ok(FileExplorerPreviewResponse::Fallback {
            file_path: file_path.to_string(),
            file_name,
            reason: "Unexpected preview state".to_string(),
            size_bytes,
            git_status,
            preview_kind: kind,
        }),
    }
}

/// Map a file extension to a language hint string for syntax highlighting.
fn language_hint_from_extension(ext: &str) -> Option<String> {
    let hint = match ext {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" => "javascript",
        "svelte" => "svelte",
        "py" => "python",
        "rb" => "ruby",
        "go" => "go",
        "java" => "java",
        "c" | "h" => "c",
        "cpp" | "cc" | "cxx" | "hpp" => "cpp",
        "cs" => "csharp",
        "swift" => "swift",
        "kt" | "kts" => "kotlin",
        "sh" | "bash" => "bash",
        "zsh" => "zsh",
        "fish" => "fish",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "md" | "mdx" => "markdown",
        "html" | "htm" => "html",
        "css" | "scss" | "sass" | "less" => "css",
        "sql" => "sql",
        "xml" => "xml",
        "lua" => "lua",
        "vim" | "vimscript" => "vimscript",
        _ => return None,
    };
    Some(hint.to_string())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_index::types::{FileGitStatus, IndexedFile, ProjectIndex};
    use std::collections::HashMap;
    use std::fs;
    use tempfile::tempdir;

    fn make_index(files: Vec<(&str, &str, Option<&str>)>) -> ProjectIndex {
        // files: (path, extension, optional git status code)
        let git_status: Vec<FileGitStatus> = files
            .iter()
            .filter_map(|(path, _, status)| {
                status.map(|s| FileGitStatus {
                    path: path.to_string(),
                    status: s.to_string(),
                    insertions: 0,
                    deletions: 0,
                })
            })
            .collect();

        let indexed: Vec<IndexedFile> = files
            .iter()
            .map(|(path, ext, status)| IndexedFile {
                path: path.to_string(),
                extension: ext.to_string(),
                line_count: 0,
                git_status: status.map(|s| FileGitStatus {
                    path: path.to_string(),
                    status: s.to_string(),
                    insertions: 0,
                    deletions: 0,
                }),
            })
            .collect();

        ProjectIndex {
            project_path: "/proj".to_string(),
            files: indexed,
            git_status,
            total_files: files.len() as u64,
            total_lines: 0,
        }
    }

    type FileSpec<'a> = (&'a str, &'a str, Option<(&'a str, u64, u64)>);

    fn make_index_with_stats(files: Vec<FileSpec<'_>>) -> ProjectIndex {
        let git_status: Vec<FileGitStatus> = files
            .iter()
            .filter_map(|(path, _, status)| {
                status.map(|(code, insertions, deletions)| FileGitStatus {
                    path: path.to_string(),
                    status: code.to_string(),
                    insertions,
                    deletions,
                })
            })
            .collect();

        let indexed: Vec<IndexedFile> = files
            .iter()
            .map(|(path, ext, status)| IndexedFile {
                path: path.to_string(),
                extension: ext.to_string(),
                line_count: 0,
                git_status: status.map(|(code, insertions, deletions)| FileGitStatus {
                    path: path.to_string(),
                    status: code.to_string(),
                    insertions,
                    deletions,
                }),
            })
            .collect();

        ProjectIndex {
            project_path: "/proj".to_string(),
            files: indexed,
            git_status,
            total_files: files.len() as u64,
            total_lines: 0,
        }
    }

    // ── Ranking tests ──────────────────────────────────────────────────────────

    #[test]
    fn exact_filename_beats_path_substring() {
        let index = make_index(vec![
            ("src/lib/utils/types.ts", "ts", None),
            ("types.ts", "ts", None),
        ]);
        let resp = search_explorer("/proj", &index, "types.ts", 10, 0);
        assert_eq!(
            resp.rows[0].path, "types.ts",
            "exact name should rank first"
        );
    }

    #[test]
    fn modified_files_rank_first_for_empty_query() {
        let index = make_index(vec![("aaa.ts", "ts", None), ("bbb.ts", "ts", Some("M"))]);
        let resp = search_explorer("/proj", &index, "", 10, 0);
        assert_eq!(
            resp.rows[0].path, "bbb.ts",
            "modified file should be first in empty query"
        );
    }

    #[test]
    fn stable_ordering_for_same_score() {
        let index = make_index(vec![
            ("z_file.ts", "ts", None),
            ("a_file.ts", "ts", None),
            ("m_file.ts", "ts", None),
        ]);
        let resp = search_explorer("/proj", &index, "file", 10, 0);
        let paths: Vec<&str> = resp.rows.iter().map(|r| r.path.as_str()).collect();
        // Alphabetical ascending when scores are equal.
        assert_eq!(paths, vec!["a_file.ts", "m_file.ts", "z_file.ts"]);
    }

    #[test]
    fn query_excludes_non_matching_files() {
        let index = make_index(vec![
            ("src/auth.ts", "ts", None),
            ("src/user.ts", "ts", None),
        ]);
        let resp = search_explorer("/proj", &index, "auth", 10, 0);
        assert_eq!(resp.rows.len(), 1);
        assert_eq!(resp.rows[0].path, "src/auth.ts");
    }

    #[test]
    fn limit_and_offset_work_correctly() {
        let index = make_index(vec![
            ("a.ts", "ts", None),
            ("b.ts", "ts", None),
            ("c.ts", "ts", None),
            ("d.ts", "ts", None),
        ]);
        let resp = search_explorer("/proj", &index, "", 2, 1);
        assert_eq!(resp.total, 4);
        assert_eq!(resp.rows.len(), 2);
    }

    #[test]
    fn empty_query_prioritizes_largest_git_diff() {
        let index = make_index_with_stats(vec![
            ("small.ts", "ts", Some(("M", 2, 1))),
            ("plain.ts", "ts", None),
            ("large.ts", "ts", Some(("M", 30, 12))),
        ]);

        let resp = search_explorer("/proj", &index, "", 10, 0);
        let paths: Vec<&str> = resp.rows.iter().map(|row| row.path.as_str()).collect();

        assert_eq!(paths, vec!["large.ts", "small.ts", "plain.ts"]);
    }

    #[test]
    fn typed_query_still_prioritizes_largest_git_diff() {
        let index = make_index_with_stats(vec![
            ("src/app-shell.ts", "ts", Some(("M", 1, 1))),
            ("src/app-state.ts", "ts", Some(("M", 12, 8))),
            ("src/app-utils.ts", "ts", None),
        ]);

        let resp = search_explorer("/proj", &index, "app", 10, 0);
        let paths: Vec<&str> = resp.rows.iter().map(|row| row.path.as_str()).collect();

        assert_eq!(
            paths,
            vec!["src/app-state.ts", "src/app-shell.ts", "src/app-utils.ts"]
        );
    }

    // ── Preview classification tests ──────────────────────────────────────────

    #[test]
    fn modified_text_file_classifies_as_diff() {
        let gs = FileGitStatus {
            path: "foo.ts".to_string(),
            status: "M".to_string(),
            insertions: 3,
            deletions: 1,
        };
        let kind = classify_preview_kind("foo.ts", "ts", Some(1024), Some(&gs));
        assert!(matches!(kind, PreviewKind::Diff));
    }

    #[test]
    fn unchanged_text_file_classifies_as_text() {
        let kind = classify_preview_kind("foo.ts", "ts", Some(1024), None);
        assert!(matches!(kind, PreviewKind::Text));
    }

    #[test]
    fn binary_extension_classifies_as_binary() {
        let kind = classify_preview_kind("image.png", "png", Some(8192), None);
        assert!(matches!(kind, PreviewKind::Binary));
    }

    #[test]
    fn large_file_classifies_as_large() {
        let kind = classify_preview_kind("huge.ts", "ts", Some(MAX_PREVIEW_BYTES + 1), None);
        assert!(matches!(kind, PreviewKind::Large));
    }

    #[test]
    fn deleted_file_classifies_as_deleted() {
        let gs = FileGitStatus {
            path: "gone.ts".to_string(),
            status: "D".to_string(),
            insertions: 0,
            deletions: 5,
        };
        let kind = classify_preview_kind("gone.ts", "ts", None, Some(&gs));
        assert!(matches!(kind, PreviewKind::Deleted));
    }

    #[test]
    fn added_text_file_classifies_as_diff() {
        let gs = FileGitStatus {
            path: "new.ts".to_string(),
            status: "A".to_string(),
            insertions: 10,
            deletions: 0,
        };
        let kind = classify_preview_kind("new.ts", "ts", Some(512), Some(&gs));
        assert!(matches!(kind, PreviewKind::Diff));
    }

    // ── Sniff tests ───────────────────────────────────────────────────────────

    #[test]
    fn sniff_binary_detects_null_bytes() {
        let data = b"hello\x00world";
        assert!(sniff_binary(data));
    }

    #[test]
    fn sniff_binary_returns_false_for_text() {
        let data = b"fn main() { println!(\"hello\"); }\n";
        assert!(!sniff_binary(data));
    }

    #[test]
    fn load_explorer_preview_returns_deleted_fallback_for_missing_deleted_file() {
        let temp = tempdir().expect("temp dir");
        let mut git_status_map = HashMap::new();
        git_status_map.insert(
            "gone.ts".to_string(),
            FileGitStatus {
                path: "gone.ts".to_string(),
                status: "D".to_string(),
                insertions: 0,
                deletions: 3,
            },
        );

        let preview =
            load_explorer_preview(&temp.path().to_string_lossy(), "gone.ts", &git_status_map)
                .expect("deleted preview");

        match preview {
            FileExplorerPreviewResponse::Fallback {
                preview_kind,
                reason,
                ..
            } => {
                assert!(matches!(preview_kind, PreviewKind::Deleted));
                assert_eq!(reason, "File has been deleted");
            }
            _ => panic!("expected deleted fallback preview"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn load_explorer_preview_rejects_non_regular_files_before_reading() {
        use std::os::unix::fs::FileTypeExt;
        use std::os::unix::net::UnixListener;

        let temp = tempdir().expect("temp dir");
        let socket_path = temp.path().join("preview.sock");
        let _listener = UnixListener::bind(&socket_path).expect("bind socket");
        let metadata = fs::metadata(&socket_path).expect("socket metadata");
        assert!(metadata.file_type().is_socket());

        let preview = load_explorer_preview(
            &temp.path().to_string_lossy(),
            "preview.sock",
            &HashMap::new(),
        )
        .expect("preview response");

        match preview {
            FileExplorerPreviewResponse::Fallback {
                preview_kind,
                reason,
                ..
            } => {
                assert!(matches!(preview_kind, PreviewKind::Unsupported));
                assert_eq!(reason, "Unsupported file type");
            }
            _ => panic!("expected fallback preview for socket"),
        }
    }
}
