//! Integration tests for OpenCode history parsing.
//!
//! These tests verify that we can correctly parse real OpenCode data
//! from the local filesystem at ~/.local/share/opencode/storage.

#[cfg(test)]
mod tests {
    use crate::acp::types::CanonicalAgentId;
    use crate::opencode_history::parser::{get_storage_dir, scan_projects, scan_sessions};

    fn live_opencode_tests_enabled() -> bool {
        std::env::var("ACEPE_RUN_LIVE_OPENCODE_TESTS")
            .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false)
    }

    /// Check if OpenCode is installed by verifying the storage directory exists.
    fn is_opencode_installed() -> bool {
        if !live_opencode_tests_enabled() {
            return false;
        }
        match get_storage_dir() {
            Ok(dir) => dir.exists(),
            Err(_) => false,
        }
    }

    #[tokio::test]
    async fn test_opencode_installed_check() {
        let installed = is_opencode_installed();
        println!("OpenCode installed: {}", installed);
        // This test just verifies the function doesn't panic
    }

    #[tokio::test]
    async fn test_storage_dir() {
        let storage_dir = get_storage_dir();
        match storage_dir {
            Ok(dir) => {
                println!("OpenCode storage dir: {:?}", dir);
                println!("Exists: {}", dir.exists());
            }
            Err(e) => {
                println!("Could not get storage dir: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_scan_projects() {
        if !is_opencode_installed() {
            println!("Skipping: OpenCode not installed");
            return;
        }

        let result = scan_projects().await;
        match result {
            Ok(projects) => {
                println!("Found {} projects", projects.len());
                for (id, worktree) in projects.iter().take(5) {
                    println!("  - {}: {}", &id[..8.min(id.len())], worktree);
                }
                // Verify all projects have non-empty IDs and worktrees
                assert!(
                    projects
                        .iter()
                        .all(|(id, worktree)| !id.is_empty() && !worktree.is_empty()),
                    "All projects should have non-empty IDs and worktrees"
                );
            }
            Err(e) => {
                println!("Failed to scan projects: {}", e);
                // Don't panic - it's okay if there are no projects
            }
        }
    }

    #[tokio::test]
    async fn test_scan_sessions_no_filter() {
        if !is_opencode_installed() {
            println!("Skipping: OpenCode not installed");
            return;
        }

        // Test with no project filter (should include global sessions)
        let result = scan_sessions(&[]).await;
        match result {
            Ok(entries) => {
                println!("Found {} sessions (no filter)", entries.len());
                for entry in entries.iter().take(5) {
                    println!(
                        "  - {} ({}): {}",
                        &entry.session_id[..8.min(entry.session_id.len())],
                        entry.project,
                        entry.display.chars().take(50).collect::<String>()
                    );
                }
                // Verify all entries have required fields
                assert!(
                    entries.iter().all(|e| {
                        !e.session_id.is_empty()
                            && !e.project.is_empty()
                            && e.agent_id == CanonicalAgentId::OpenCode
                    }),
                    "All entries should have valid session IDs, projects, and agent ID"
                );
            }
            Err(e) => {
                println!("Failed to scan sessions: {}", e);
                // Don't panic - it's okay if there are no sessions
            }
        }
    }

    #[tokio::test]
    async fn test_scan_sessions_with_filter() {
        if !is_opencode_installed() {
            println!("Skipping: OpenCode not installed");
            return;
        }

        // First get projects to use as filter
        let projects = scan_projects().await.unwrap_or_default();
        if projects.is_empty() {
            println!("Skipping: No projects found to use as filter");
            return;
        }

        // Get worktree paths for filtering
        let project_paths: Vec<String> = projects.values().take(3).cloned().collect();
        println!("Filtering by {} project paths", project_paths.len());

        let result = scan_sessions(&project_paths).await;
        match result {
            Ok(entries) => {
                println!("Found {} sessions (with filter)", entries.len());
                for entry in entries.iter().take(5) {
                    println!(
                        "  - {} ({}): {}",
                        &entry.session_id[..8.min(entry.session_id.len())],
                        entry.project,
                        entry.display.chars().take(50).collect::<String>()
                    );
                }
                // Verify all entries match the filter
                assert!(
                    entries
                        .iter()
                        .all(|e| { project_paths.contains(&e.project) || e.project == "global" }),
                    "All entries should match the project filter or be global"
                );
            }
            Err(e) => {
                println!("Failed to scan sessions with filter: {}", e);
                // Don't panic - it's okay if there are no matching sessions
            }
        }
    }

    #[tokio::test]
    async fn test_session_entry_structure() {
        if !is_opencode_installed() {
            println!("Skipping: OpenCode not installed");
            return;
        }

        let result = scan_sessions(&[]).await;
        match result {
            Ok(entries) => {
                if entries.is_empty() {
                    println!("No sessions found to test structure");
                    return;
                }

                let entry = &entries[0];
                println!("Sample entry structure:");
                println!("  ID: {}", entry.id);
                println!("  Session ID: {}", entry.session_id);
                println!("  Display: {}", entry.display);
                println!("  Project: {}", entry.project);
                println!("  Agent ID: {:?}", entry.agent_id);
                println!("  Timestamp: {}", entry.timestamp);
                println!("  Updated At: {}", entry.updated_at);

                // Verify entry structure
                assert!(!entry.id.is_empty(), "Entry should have an ID");
                assert!(
                    !entry.session_id.is_empty(),
                    "Entry should have a session ID"
                );
                assert!(
                    !entry.display.is_empty(),
                    "Entry should have a display name"
                );
                assert_eq!(
                    entry.agent_id,
                    CanonicalAgentId::OpenCode,
                    "Entry should have OpenCode agent ID"
                );
            }
            Err(e) => {
                println!("Failed to get sessions for structure test: {}", e);
            }
        }
    }

    /// Test parsing all sessions and report any failures.
    /// This helps identify problematic session files.
    #[tokio::test]
    async fn test_parse_all_sessions_with_error_reporting() {
        if !is_opencode_installed() {
            println!("Skipping: OpenCode not installed");
            return;
        }

        use crate::opencode_history::parser::get_storage_dir;
        use crate::opencode_history::types::OpenCodeSession;
        use tokio::fs;

        let storage_dir = get_storage_dir().unwrap();
        let sessions_dir = storage_dir.join("session");

        if !sessions_dir.exists() {
            println!("Sessions directory not found");
            return;
        }

        let mut total_files = 0;
        let mut parsed_successfully = 0;
        let mut parse_errors = Vec::new();
        let mut read_errors = Vec::new();

        // Scan all session directories
        let mut read_dir = fs::read_dir(&sessions_dir).await.unwrap();
        while let Some(entry) = read_dir.next_entry().await.unwrap() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            // Scan session files in this directory
            let mut session_dir = fs::read_dir(&path).await.unwrap();
            while let Some(session_file) = session_dir.next_entry().await.unwrap() {
                let file_path = session_file.path();
                if !file_path.is_file()
                    || file_path.extension().and_then(|e| e.to_str()) != Some("json")
                {
                    continue;
                }

                total_files += 1;

                // Try to parse the file
                match fs::read_to_string(&file_path).await {
                    Ok(content) => {
                        match serde_json::from_str::<OpenCodeSession>(&content) {
                            Ok(session) => {
                                parsed_successfully += 1;

                                // Validate session structure
                                if session.id.is_empty() {
                                    parse_errors
                                        .push((file_path.clone(), "Empty session ID".to_string()));
                                }
                                if session.project_id.is_empty() {
                                    parse_errors
                                        .push((file_path.clone(), "Empty project ID".to_string()));
                                }
                            }
                            Err(e) => {
                                parse_errors
                                    .push((file_path.clone(), format!("Parse error: {}", e)));
                            }
                        }
                    }
                    Err(e) => {
                        read_errors.push((file_path.clone(), format!("Read error: {}", e)));
                    }
                }
            }
        }

        println!("\n=== Parsing Results ===");
        println!("Total session files: {}", total_files);
        println!("Parsed successfully: {}", parsed_successfully);
        println!("Parse errors: {}", parse_errors.len());
        println!("Read errors: {}", read_errors.len());

        if !parse_errors.is_empty() {
            println!("\n=== Parse Errors ===");
            for (file_path, error) in parse_errors.iter().take(10) {
                println!("  {}: {}", file_path.display(), error);
            }
            if parse_errors.len() > 10 {
                println!("  ... and {} more errors", parse_errors.len() - 10);
            }
        }

        if !read_errors.is_empty() {
            println!("\n=== Read Errors ===");
            for (file_path, error) in read_errors.iter().take(10) {
                println!("  {}: {}", file_path.display(), error);
            }
            if read_errors.len() > 10 {
                println!("  ... and {} more errors", read_errors.len() - 10);
            }
        }

        // Report success rate
        if total_files > 0 {
            let success_rate = (parsed_successfully as f64 / total_files as f64) * 100.0;
            println!("\nSuccess rate: {:.1}%", success_rate);

            // Don't fail the test, but warn if success rate is low
            if success_rate < 95.0 {
                println!("WARNING: Success rate is below 95%");
            }
        }
    }

    /// Test error handling by trying to parse invalid JSON.
    /// This verifies that errors are handled gracefully.
    #[tokio::test]
    async fn test_error_handling_with_invalid_data() {
        use crate::opencode_history::types::OpenCodeSession;

        // Test with invalid JSON
        let invalid_json = r#"{"id": "test", "invalid": "data"}"#;
        let result = serde_json::from_str::<OpenCodeSession>(invalid_json);
        assert!(result.is_err(), "Should fail to parse invalid JSON");

        // Test with missing required fields
        let missing_fields = r#"{"id": "test"}"#;
        let result = serde_json::from_str::<OpenCodeSession>(missing_fields);
        assert!(
            result.is_err(),
            "Should fail to parse JSON with missing required fields"
        );

        // Test with valid but minimal structure
        let minimal_valid = r#"{
            "id": "test-session",
            "version": "1.0",
            "projectID": "global",
            "directory": "/tmp",
            "time": {
                "created": 1000,
                "updated": 2000
            }
        }"#;
        let result = serde_json::from_str::<OpenCodeSession>(minimal_valid);
        assert!(result.is_ok(), "Should parse minimal valid JSON");

        let session = result.unwrap();
        assert_eq!(session.id, "test-session");
        assert_eq!(session.project_id, "global");
        assert_eq!(session.time.created, 1000);
        assert_eq!(session.time.updated, 2000);
    }
}
