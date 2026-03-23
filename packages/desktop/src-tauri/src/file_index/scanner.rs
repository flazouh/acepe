//! File scanner using the `ignore` crate for .gitignore-aware file walking.

use std::path::Path;

use anyhow::{Context, Result};
use ignore::WalkBuilder;
use rayon::prelude::*;

use super::types::IndexedFile;

/// Scan a project directory and return all indexed files.
///
/// This function:
/// - Respects .gitignore rules
/// - Skips hidden files by default
/// - Processes files in parallel using rayon
pub fn scan_project(project_path: &Path) -> Result<Vec<IndexedFile>> {
    let walker = WalkBuilder::new(project_path)
        .hidden(false) // Include hidden files (let .gitignore handle exclusion)
        .git_ignore(true) // Respect .gitignore
        .git_global(true) // Respect global gitignore
        .git_exclude(true) // Respect .git/info/exclude
        .follow_links(false) // Don't follow symlinks (safety)
        .max_depth(Some(50)) // Prevent infinite recursion
        .build();

    // Collect all file paths first (I/O bound)
    let files: Vec<_> = walker
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|ft| ft.is_file()).unwrap_or(false))
        .map(|entry| entry.into_path())
        .collect();

    // Index files in parallel
    let indexed: Vec<IndexedFile> = files
        .par_iter()
        .filter_map(|path| index_file(path, project_path).ok())
        .collect();

    Ok(indexed)
}

/// Index a single file, extracting path and extension metadata.
/// Line counting is skipped for performance (not used by UI).
fn index_file(path: &Path, project_root: &Path) -> Result<IndexedFile> {
    let relative_path = path
        .strip_prefix(project_root)
        .context("Failed to strip project root prefix")?;

    let extension = path
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(IndexedFile {
        path: relative_path.to_string_lossy().to_string(),
        extension,
        line_count: 0,    // Skipped for performance - not used by UI
        git_status: None, // Populated by service after merging with git status
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_scan_project() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("file1.ts"), "const x = 1;\nconst y = 2;\n").unwrap();
        fs::write(dir.path().join("file2.rs"), "fn main() {}\n").unwrap();
        fs::create_dir(dir.path().join("subdir")).unwrap();
        fs::write(dir.path().join("subdir/nested.js"), "// comment\n").unwrap();

        let files = scan_project(dir.path()).unwrap();

        assert_eq!(files.len(), 3);

        // Check file extensions are correct
        let ts_file = files.iter().find(|f| f.extension == "ts").unwrap();
        assert!(ts_file.path.ends_with("file1.ts"));

        let rs_file = files.iter().find(|f| f.extension == "rs").unwrap();
        assert!(rs_file.path.ends_with("file2.rs"));

        let js_file = files.iter().find(|f| f.extension == "js").unwrap();
        assert!(js_file.path.contains("nested.js"));
    }

    #[test]
    fn test_scan_respects_gitignore() {
        use std::process::Command;

        let dir = TempDir::new().unwrap();

        // Initialize git repo (required for .gitignore to work)
        Command::new("git")
            .args(["init"])
            .current_dir(dir.path())
            .output()
            .expect("Failed to init git repo");

        // Create .gitignore
        fs::write(dir.path().join(".gitignore"), "ignored.txt\n").unwrap();

        // Create files
        fs::write(dir.path().join("included.ts"), "// included").unwrap();
        fs::write(dir.path().join("ignored.txt"), "// ignored").unwrap();

        let files = scan_project(dir.path()).unwrap();

        // Should find .gitignore and included.ts, but NOT ignored.txt
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert!(paths.iter().any(|p| p.contains("included.ts")));
        assert!(!paths.iter().any(|p| p.contains("ignored.txt")));
    }
}
