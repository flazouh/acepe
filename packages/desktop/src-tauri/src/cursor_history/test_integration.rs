//! Integration tests for Cursor history parsing.
//!
//! These tests verify that we can correctly parse real Cursor data
//! from the local filesystem.

#[cfg(test)]
mod tests {
    use crate::acp::types::CanonicalAgentId;
    use crate::cursor_history::parser::{
        discover_all_chats, get_cursor_projects_dir,
        is_cursor_installed as parser_is_cursor_installed, load_full_conversation,
        scan_all_transcripts, to_history_entry,
    };
    use crate::cursor_history::types::CursorChatEntry;
    use crate::session_jsonl::types::FullSession;

    fn live_cursor_tests_enabled() -> bool {
        std::env::var("ACEPE_RUN_LIVE_CURSOR_TESTS")
            .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false)
    }

    fn is_cursor_installed() -> bool {
        if !live_cursor_tests_enabled() {
            return false;
        }
        parser_is_cursor_installed()
    }

    fn print_session_details(session: &FullSession) {
        println!("\n=== SESSION DETAILS ===");
        println!("Session ID: {}", session.session_id);
        println!("Title: {}", session.title);
        println!("Project: {}", session.project_path);
        println!("Created: {}", session.created_at);
        println!("\n=== STATS ===");
        println!("Total messages: {}", session.stats.total_messages);
        println!("User messages: {}", session.stats.user_messages);
        println!("Assistant messages: {}", session.stats.assistant_messages);
        println!("Tool uses: {}", session.stats.tool_uses);
        println!("Tool results: {}", session.stats.tool_results);
        println!("Thinking blocks: {}", session.stats.thinking_blocks);
        println!("Input tokens: {}", session.stats.total_input_tokens);
        println!("Output tokens: {}", session.stats.total_output_tokens);

        println!("\n=== MESSAGES (first 5) ===");
        for (i, msg) in session.messages.iter().take(5).enumerate() {
            println!("\n--- Message {} ---", i + 1);
            println!("UUID: {}", msg.uuid);
            println!("Role: {}", msg.role);
            println!("Timestamp: {}", msg.timestamp);
            if let Some(model) = &msg.model {
                println!("Model: {}", model);
            }
            if let Some(usage) = &msg.usage {
                println!(
                    "Tokens: {} in, {} out",
                    usage.input_tokens, usage.output_tokens
                );
            }

            println!("Content blocks: {}", msg.content_blocks.len());
            for (j, block) in msg.content_blocks.iter().take(3).enumerate() {
                match block {
                    crate::session_jsonl::types::ContentBlock::Text { text } => {
                        let preview: String = text.chars().take(150).collect();
                        let suffix = if text.len() > 150 { "..." } else { "" };
                        println!("  [{}] Text: {}{}", j, preview, suffix);
                    }
                    crate::session_jsonl::types::ContentBlock::Thinking { thinking, .. } => {
                        let preview: String = thinking.chars().take(100).collect();
                        let suffix = if thinking.len() > 100 { "..." } else { "" };
                        println!("  [{}] Thinking: {}{}", j, preview, suffix);
                    }
                    crate::session_jsonl::types::ContentBlock::ToolUse { id, name, .. } => {
                        println!("  [{}] ToolUse: {} (id: {})", j, name, id);
                    }
                    crate::session_jsonl::types::ContentBlock::ToolResult {
                        tool_use_id,
                        content,
                    } => {
                        let preview: String = content.chars().take(80).collect();
                        let suffix = if content.len() > 80 { "..." } else { "" };
                        println!(
                            "  [{}] ToolResult (for {}): {}{}",
                            j, tool_use_id, preview, suffix
                        );
                    }
                    crate::session_jsonl::types::ContentBlock::CodeAttachment { path, .. } => {
                        println!("  [{}] CodeAttachment: {}", j, path);
                    }
                }
            }
            if msg.content_blocks.len() > 3 {
                println!("  ... and {} more blocks", msg.content_blocks.len() - 3);
            }
        }
        if session.messages.len() > 5 {
            println!("\n... and {} more messages", session.messages.len() - 5);
        }
    }

    #[tokio::test]
    async fn test_cursor_installed_check() {
        let installed = is_cursor_installed();
        println!("Cursor installed: {}", installed);
        // This test just verifies the function doesn't panic
    }

    #[tokio::test]
    async fn test_cursor_projects_dir() {
        let projects_dir = get_cursor_projects_dir();
        match projects_dir {
            Ok(dir) => {
                println!("Cursor projects dir: {:?}", dir);
                println!("Exists: {}", dir.exists());
            }
            Err(e) => {
                println!("Could not get projects dir: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_scan_all_transcripts() {
        if !is_cursor_installed() {
            println!("Skipping: Cursor not installed");
            return;
        }

        // First, let's manually check what files exist
        let projects_dir = get_cursor_projects_dir().unwrap();
        println!("Projects dir: {:?}", projects_dir);

        let mut total_files = 0;
        let mut total_dirs = 0;
        if let Ok(mut read_dir) = tokio::fs::read_dir(&projects_dir).await {
            while let Ok(Some(entry)) = read_dir.next_entry().await {
                let path = entry.path();
                if path.is_dir() {
                    total_dirs += 1;
                    let transcripts_dir = path.join("agent-transcripts");
                    if transcripts_dir.exists() {
                        if let Ok(mut files) = tokio::fs::read_dir(&transcripts_dir).await {
                            let mut file_count = 0;
                            while let Ok(Some(_)) = files.next_entry().await {
                                file_count += 1;
                            }
                            total_files += file_count;
                            println!("  {:?}: {} files", path.file_name().unwrap(), file_count);
                        }
                    }
                }
            }
        }
        println!("Total: {} dirs, {} files", total_dirs, total_files);

        let result = scan_all_transcripts(&[]).await;
        match result {
            Ok(entries) => {
                println!("Found {} transcripts", entries.len());
                for entry in entries.iter().take(5) {
                    println!(
                        "  - {} ({}): {}",
                        entry.id,
                        entry.workspace_path.as_deref().unwrap_or("unknown"),
                        entry.title.as_deref().unwrap_or("Untitled")
                    );
                }
                // Verify no parsing errors for any entry
                assert!(
                    entries.iter().all(|e| !e.id.is_empty()),
                    "All entries should have IDs"
                );

                // We should find more than just 1 transcript
                println!(
                    "Expected ~{} transcripts, found {}",
                    total_files,
                    entries.len()
                );
            }
            Err(e) => {
                panic!("Failed to scan transcripts: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_parse_individual_transcripts() {
        use crate::cursor_history::parser::extract_transcript_metadata;

        if !is_cursor_installed() {
            println!("Skipping: Cursor not installed");
            return;
        }

        let projects_dir = get_cursor_projects_dir().unwrap();
        let mut success_count = 0;
        let mut error_count = 0;
        let mut none_count = 0;
        let mut error_samples: Vec<String> = Vec::new();

        if let Ok(mut read_dir) = tokio::fs::read_dir(&projects_dir).await {
            while let Ok(Some(project_entry)) = read_dir.next_entry().await {
                let project_path = project_entry.path();
                if !project_path.is_dir() {
                    continue;
                }

                let project_slug = project_path.file_name().unwrap().to_str().unwrap();
                let workspace_path = format!("/{}", project_slug.replace('-', "/"));
                let transcripts_dir = project_path.join("agent-transcripts");

                if !transcripts_dir.exists() {
                    continue;
                }

                if let Ok(mut files) = tokio::fs::read_dir(&transcripts_dir).await {
                    while let Ok(Some(file_entry)) = files.next_entry().await {
                        let file_path = file_entry.path();
                        if !file_path.is_file() {
                            continue;
                        }

                        let file_name = file_path.file_name().unwrap().to_str().unwrap();
                        if !file_name.ends_with(".json") {
                            continue;
                        }

                        let session_id = file_name.trim_end_matches(".json");

                        match extract_transcript_metadata(&file_path, session_id, &workspace_path)
                            .await
                        {
                            Ok(Some(_)) => success_count += 1,
                            Ok(None) => none_count += 1,
                            Err(e) => {
                                error_count += 1;
                                if error_samples.len() < 5 {
                                    error_samples.push(format!(
                                        "{}: {}",
                                        file_name,
                                        e.to_string().chars().take(100).collect::<String>()
                                    ));
                                }
                            }
                        }
                    }
                }
            }
        }

        println!(
            "Results: {} success, {} none (empty), {} errors",
            success_count, none_count, error_count
        );
        if !error_samples.is_empty() {
            println!("Error samples:");
            for sample in &error_samples {
                println!("  {}", sample);
            }
        }

        // Most files should parse successfully (allow some errors for corrupted files)
        let total = success_count + none_count + error_count;

        // Skip assertion when no transcripts are found (e.g., fresh install, CI environment)
        if total == 0 {
            println!("No transcripts found, skipping assertions");
            return;
        }

        assert!(
            success_count > total / 2,
            "At least half of transcripts should parse successfully. Got {}/{} success",
            success_count,
            total
        );
    }

    #[tokio::test]
    async fn test_discover_all_chats() {
        if !is_cursor_installed() {
            println!("Skipping: Cursor not installed");
            return;
        }

        // Test without filtering
        let result = discover_all_chats(&[]).await;
        assert!(result.is_ok(), "discover_all_chats should succeed");

        let entries = result.unwrap();
        println!("Discovered {} chats without filter", entries.len());

        // Test with a filter
        let filtered = discover_all_chats(&["/Users/alex/Documents/pointer".to_string()]).await;
        assert!(
            filtered.is_ok(),
            "discover_all_chats with filter should succeed"
        );

        let filtered_entries = filtered.unwrap();
        println!(
            "Discovered {} chats for pointer project",
            filtered_entries.len()
        );
    }

    #[tokio::test]
    async fn test_to_history_entry_conversion() {
        if !is_cursor_installed() {
            println!("Skipping: Cursor not installed");
            return;
        }

        let entries = scan_all_transcripts(&[]).await.unwrap_or_default();
        if entries.is_empty() {
            println!("No transcripts found, skipping");
            return;
        }

        let first = &entries[0];
        let history_entry = to_history_entry(first);

        println!("Converted to HistoryEntry:");
        println!("  id: {}", history_entry.id);
        println!("  session_id: {}", history_entry.session_id);
        println!("  display: {}", history_entry.display);
        println!("  project: {}", history_entry.project);
        println!("  agent_id: {}", history_entry.agent_id);
        println!("  timestamp: {}", history_entry.timestamp);

        assert!(!history_entry.id.is_empty());
        assert!(!history_entry.session_id.is_empty());
        assert_eq!(history_entry.agent_id, CanonicalAgentId::Cursor);
    }

    #[tokio::test]
    async fn test_load_full_conversation() {
        if !is_cursor_installed() {
            println!("Skipping: Cursor not installed");
            return;
        }

        let entries = scan_all_transcripts(&[]).await.unwrap_or_default();
        if entries.is_empty() {
            println!("No transcripts found, skipping");
            return;
        }

        // Find an entry with a workspace path
        let entry = entries
            .iter()
            .find(|e| e.workspace_path.is_some())
            .or_else(|| entries.first());

        if let Some(entry) = entry {
            let project_path = entry.workspace_path.as_deref().unwrap_or("");
            println!("Loading conversation: {} from {}", entry.id, project_path);

            let result = load_full_conversation(&entry.id, project_path).await;

            match result {
                Ok(session) => {
                    println!("Loaded session successfully:");
                    println!("  session_id: {}", session.session_id);
                    println!("  title: {}", session.title);
                    println!("  project_path: {}", session.project_path);
                    println!("  created_at: {}", session.created_at);
                    println!("  total_messages: {}", session.stats.total_messages);
                    println!("  user_messages: {}", session.stats.user_messages);
                    println!("  assistant_messages: {}", session.stats.assistant_messages);
                    println!("  thinking_blocks: {}", session.stats.thinking_blocks);

                    // Verify the session is valid
                    assert!(!session.session_id.is_empty());
                    assert!(session.stats.total_messages > 0);

                    // Print first few messages
                    for (i, msg) in session.messages.iter().take(3).enumerate() {
                        println!("  Message {}: role={}", i, msg.role);
                        for block in &msg.content_blocks {
                            match block {
                                crate::session_jsonl::types::ContentBlock::Text { text } => {
                                    let preview = if text.chars().count() > 100 {
                                        let truncated: String = text.chars().take(100).collect();
                                        format!("{}...", truncated)
                                    } else {
                                        text.clone()
                                    };
                                    println!("    Text: {}", preview);
                                }
                                crate::session_jsonl::types::ContentBlock::Thinking {
                                    thinking,
                                    ..
                                } => {
                                    let preview = if thinking.chars().count() > 50 {
                                        let truncated: String = thinking.chars().take(50).collect();
                                        format!("{}...", truncated)
                                    } else {
                                        thinking.clone()
                                    };
                                    println!("    Thinking: {}", preview);
                                }
                                crate::session_jsonl::types::ContentBlock::ToolUse {
                                    name, ..
                                } => {
                                    println!("    ToolUse: {}", name);
                                }
                                crate::session_jsonl::types::ContentBlock::ToolResult {
                                    tool_use_id,
                                    ..
                                } => {
                                    println!("    ToolResult for: {}", tool_use_id);
                                }
                                crate::session_jsonl::types::ContentBlock::CodeAttachment {
                                    path,
                                    ..
                                } => {
                                    println!("    CodeAttachment: {}", path);
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    panic!("Failed to load conversation: {}", e);
                }
            }
        } else {
            println!("No suitable entry found for testing");
        }
    }

    #[tokio::test]
    async fn test_parse_all_transcripts_no_errors() {
        if !is_cursor_installed() {
            println!("Skipping: Cursor not installed");
            return;
        }

        let entries = scan_all_transcripts(&[]).await.unwrap_or_default();
        println!("Found {} transcripts to verify", entries.len());

        let mut success_count = 0;
        let mut error_count = 0;

        for entry in &entries {
            let project_path = entry.workspace_path.as_deref().unwrap_or("");
            match load_full_conversation(&entry.id, project_path).await {
                Ok(session) => {
                    success_count += 1;
                    // Verify basic invariants
                    assert!(!session.session_id.is_empty());
                    assert!(
                        session.stats.total_messages >= session.stats.user_messages,
                        "total_messages should be >= user_messages"
                    );
                    assert!(
                        session.stats.total_messages >= session.stats.assistant_messages,
                        "total_messages should be >= assistant_messages"
                    );
                }
                Err(e) => {
                    error_count += 1;
                    println!("Error loading {}: {}", entry.id, e);
                }
            }
        }

        println!(
            "Results: {} success, {} errors out of {} total",
            success_count,
            error_count,
            entries.len()
        );

        // Allow some errors (e.g., if files were deleted), but most should succeed
        assert!(
            success_count > 0 || entries.is_empty(),
            "At least one transcript should parse successfully"
        );
        // Most transcripts should parse successfully
        assert!(
            error_count <= entries.len() / 2,
            "More than half failed: {} errors out of {}",
            error_count,
            entries.len()
        );
    }

    // ============================================
    // SQLITE FORMAT TESTS (NEW CURSOR FORMAT)
    // ============================================

    #[tokio::test]
    async fn test_scan_sqlite_chats() {
        use crate::cursor_history::parser::scan_sqlite_chats;

        if !is_cursor_installed() {
            println!("Skipping: Cursor not installed");
            return;
        }

        // This test should discover SQLite-based chats in ~/.cursor/chats/
        let entries = scan_sqlite_chats().await.expect("Should scan SQLite chats");

        println!("Discovered {} SQLite chats", entries.len());

        // We expect to find some chats (at least the acepe ones)
        assert!(!entries.is_empty(), "Should find at least one SQLite chat");

        // Verify structure of discovered entries
        for entry in entries.iter().take(3) {
            println!(
                "Found SQLite chat: id={}, title={:?}",
                entry.id, entry.title
            );
            assert!(!entry.id.is_empty(), "Chat ID should not be empty");
            assert!(entry.title.is_some(), "Title should be present");
            assert!(
                entry.created_at.unwrap_or(0) > 0,
                "Created timestamp should be positive"
            );
        }
    }

    #[tokio::test]
    async fn test_scan_all_formats_combined() {
        use crate::cursor_history::parser::{scan_all_transcripts, scan_sqlite_chats};

        if !is_cursor_installed() {
            println!("Skipping: Cursor not installed");
            return;
        }

        // Scan both formats
        let json_entries = scan_all_transcripts(&[])
            .await
            .expect("Should scan JSON transcripts");
        let sqlite_entries = scan_sqlite_chats().await.expect("Should scan SQLite chats");

        println!(
            "Found {} JSON transcripts and {} SQLite chats (total: {})",
            json_entries.len(),
            sqlite_entries.len(),
            json_entries.len() + sqlite_entries.len()
        );

        // We should find chats in at least one format
        assert!(
            json_entries.len() + sqlite_entries.len() > 0,
            "Should find at least one chat across both formats"
        );

        // Deduplicate entries by ID (same chat may exist in both formats)
        // Prefer JSON entries over SQLite entries when duplicates exist
        let mut unique_entries = std::collections::HashMap::<String, &CursorChatEntry>::new();
        for entry in json_entries.iter() {
            unique_entries.insert(entry.id.clone(), entry);
        }
        for entry in sqlite_entries.iter() {
            // Only add SQLite entry if not already present from JSON
            unique_entries.entry(entry.id.clone()).or_insert(entry);
        }

        // Verify we have at least one unique entry
        assert!(
            !unique_entries.is_empty(),
            "Should have at least one unique chat entry after deduplication"
        );

        println!(
            "After deduplication: {} unique chat entries ({} JSON + {} SQLite = {} total, {} duplicates)",
            unique_entries.len(),
            json_entries.len(),
            sqlite_entries.len(),
            json_entries.len() + sqlite_entries.len(),
            (json_entries.len() + sqlite_entries.len()) - unique_entries.len()
        );
    }

    #[tokio::test]
    async fn test_scan_workspace_composers() {
        use crate::cursor_history::parser::scan_workspace_composers_in_dir_for_tests;
        use rusqlite::{params, Connection};
        use tempfile::tempdir;

        let temp = tempdir().expect("tempdir should be created");
        let workspace_storage_dir = temp.path().join("workspaceStorage");
        let workspace_dir = workspace_storage_dir.join("workspace-hash");
        std::fs::create_dir_all(&workspace_dir).expect("workspace dir should be created");

        let acepe_path = "/Users/alex/Documents/acepe";
        std::fs::write(
            workspace_dir.join("workspace.json"),
            format!(r#"{{"folder":"file://{}"}}"#, acepe_path),
        )
        .expect("workspace.json should be written");

        let state_db = workspace_dir.join("state.vscdb");
        let conn = Connection::open(&state_db).expect("state.vscdb should open");
        conn.execute(
            "CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)",
            [],
        )
        .expect("ItemTable should be created");

        let composer_data = serde_json::json!({
            "allComposers": [
                {
                    "composerId": "composer-001",
                    "name": "Mock Composer Session",
                    "createdAt": 1700000000000_i64,
                    "lastUpdatedAt": 1700000001000_i64
                }
            ]
        });
        conn.execute(
            "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
            params!["composer.composerData", composer_data.to_string()],
        )
        .expect("mock composer row should be inserted");
        drop(conn);

        let entries = scan_workspace_composers_in_dir_for_tests(
            &workspace_storage_dir,
            &[acepe_path.to_string()],
        )
        .await
        .expect("Should scan workspace composers");

        println!("Found {} workspace composers for acepe", entries.len());
        assert_eq!(entries.len(), 1, "Should parse one mock composer entry");
        assert_eq!(entries[0].id, "composer-001");
        assert_eq!(
            entries[0].title.as_deref(),
            Some("Mock Composer Session"),
            "Should preserve composer title"
        );
        assert_eq!(
            entries[0].workspace_path.as_deref(),
            Some(acepe_path),
            "Should resolve workspace path from workspace.json"
        );
        assert!(
            entries[0]
                .source_path
                .as_deref()
                .is_some_and(|path| path.ends_with("state.vscdb")),
            "source_path should point to the mock state.vscdb"
        );
    }

    #[tokio::test]
    async fn test_scan_all_chats_includes_workspace() {
        use crate::cursor_history::parser::scan_all_chats_with_projects;

        if !is_cursor_installed() {
            println!("Skipping: Cursor not installed");
            return;
        }

        // Scan all formats for acepe project
        let acepe_path = "/Users/alex/Documents/acepe".to_string();
        let entries = scan_all_chats_with_projects(std::slice::from_ref(&acepe_path))
            .await
            .expect("Should scan all chats");

        println!(
            "Found {} total chats for acepe (all formats)",
            entries.len()
        );

        // Count by source (we can infer from workspace_path presence)
        let with_workspace: Vec<_> = entries
            .iter()
            .filter(|e| e.workspace_path.is_some())
            .collect();
        println!("  {} with workspace_path", with_workspace.len());

        // We expect to find a good number of entries
        assert!(
            entries.len() > 10,
            "Should find more than 10 chats for acepe"
        );
    }

    // ============================================
    // SPECIFIC SESSION TESTS
    // ============================================

    #[tokio::test]
    async fn test_load_specific_session_963480f0() {
        use crate::cursor_history::parser::{find_transcript_by_id, scan_all_chats_with_projects};
        use crate::history::cursor_sqlite_parser::parse_cursor_store_db;
        use std::path::Path;

        if !is_cursor_installed() {
            println!("Skipping: Cursor not installed");
            return;
        }

        let session_id = "963480f0-dc11-49fa-bb73-03cdf277fd54";

        // First, search using find_transcript_by_id (JSON only)
        println!("Searching JSON transcripts...");
        let find_result = find_transcript_by_id(session_id).await;

        if let Ok(Some(session)) = &find_result {
            println!("Found in JSON transcripts!");
            print_session_details(session);
            assert_eq!(session.session_id, session_id);
            return;
        }

        println!("Not found in JSON transcripts, searching all formats...");

        // Search all formats - discover all chats and look for this session ID
        let all_chats = scan_all_chats_with_projects(&[]).await.unwrap_or_default();
        println!("Total chats discovered: {}", all_chats.len());

        // Look for our specific session
        if let Some(entry) = all_chats.iter().find(|e| e.id == session_id) {
            println!("\nFound session in all chats discovery!");
            println!("  ID: {}", entry.id);
            println!("  Title: {:?}", entry.title);
            println!("  Workspace: {:?}", entry.workspace_path);
            println!("  Source path: {:?}", entry.source_path);
            println!("  Message count: {}", entry.message_count);

            // Try to load full session from SQLite if source is store.db
            if let Some(source_path) = &entry.source_path {
                if source_path.ends_with("store.db") {
                    println!("\nLoading from SQLite store.db: {}", source_path);
                    match parse_cursor_store_db(
                        Path::new(source_path),
                        session_id,
                        entry.workspace_path.as_deref(),
                    )
                    .await
                    {
                        Ok(session) => {
                            print_session_details(&session);
                            assert_eq!(session.session_id, session_id);
                            return;
                        }
                        Err(e) => {
                            println!("Failed to load from SQLite: {}", e);
                        }
                    }
                }
            }
        } else {
            // Print first 20 session IDs for debugging
            println!("\nSession ID not found. First 20 discovered session IDs:");
            for (i, entry) in all_chats.iter().take(20).enumerate() {
                println!("  {}: {} (title: {:?})", i + 1, entry.id, entry.title);
            }
        }

        // Fall back to JSON search
        let find_result = find_transcript_by_id(session_id).await;

        match find_result {
            Ok(Some(session)) => {
                println!("\n=== SESSION FOUND ===");
                println!("Session ID: {}", session.session_id);
                println!("Title: {}", session.title);
                println!("Project: {}", session.project_path);
                println!("Created: {}", session.created_at);
                println!("\n=== STATS ===");
                println!("Total messages: {}", session.stats.total_messages);
                println!("User messages: {}", session.stats.user_messages);
                println!("Assistant messages: {}", session.stats.assistant_messages);
                println!("Tool uses: {}", session.stats.tool_uses);
                println!("Tool results: {}", session.stats.tool_results);
                println!("Thinking blocks: {}", session.stats.thinking_blocks);
                println!("Input tokens: {}", session.stats.total_input_tokens);
                println!("Output tokens: {}", session.stats.total_output_tokens);

                println!("\n=== MESSAGES ===");
                for (i, msg) in session.messages.iter().enumerate() {
                    println!("\n--- Message {} ---", i + 1);
                    println!("UUID: {}", msg.uuid);
                    println!("Role: {}", msg.role);
                    println!("Timestamp: {}", msg.timestamp);
                    if let Some(model) = &msg.model {
                        println!("Model: {}", model);
                    }
                    if let Some(usage) = &msg.usage {
                        println!(
                            "Tokens: {} in, {} out",
                            usage.input_tokens, usage.output_tokens
                        );
                    }

                    println!("Content blocks: {}", msg.content_blocks.len());
                    for (j, block) in msg.content_blocks.iter().enumerate() {
                        match block {
                            crate::session_jsonl::types::ContentBlock::Text { text } => {
                                let preview: String = text.chars().take(200).collect();
                                let suffix = if text.len() > 200 { "..." } else { "" };
                                println!("  [{}] Text: {}{}", j, preview, suffix);
                            }
                            crate::session_jsonl::types::ContentBlock::Thinking {
                                thinking,
                                ..
                            } => {
                                let preview: String = thinking.chars().take(100).collect();
                                let suffix = if thinking.len() > 100 { "..." } else { "" };
                                println!("  [{}] Thinking: {}{}", j, preview, suffix);
                            }
                            crate::session_jsonl::types::ContentBlock::ToolUse {
                                id,
                                name,
                                input,
                            } => {
                                println!("  [{}] ToolUse: {} (id: {})", j, name, id);
                                let input_str = serde_json::to_string(input).unwrap_or_default();
                                let preview: String = input_str.chars().take(100).collect();
                                println!("       Input: {}...", preview);
                            }
                            crate::session_jsonl::types::ContentBlock::ToolResult {
                                tool_use_id,
                                content,
                            } => {
                                let preview: String = content.chars().take(100).collect();
                                let suffix = if content.len() > 100 { "..." } else { "" };
                                println!(
                                    "  [{}] ToolResult (for {}): {}{}",
                                    j, tool_use_id, preview, suffix
                                );
                            }
                            crate::session_jsonl::types::ContentBlock::CodeAttachment {
                                path,
                                ..
                            } => {
                                println!("  [{}] CodeAttachment: {}", j, path);
                            }
                        }
                    }
                }

                // Assertions
                assert_eq!(session.session_id, session_id);
                assert!(
                    session.stats.total_messages > 0,
                    "Session should have messages"
                );
            }
            Ok(None) => {
                println!("Session {} not found in any project", session_id);
                println!("This could mean:");
                println!("  - The session was deleted");
                println!("  - The session ID is incorrect");
                println!("  - The session is stored in an unscanned location");
            }
            Err(e) => {
                panic!("Error searching for session: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_load_specific_session_3f54d0ba_reconstructs_complete_sequence() {
        use crate::cursor_history::parser::scan_all_chats_with_projects;
        use crate::history::cursor_sqlite_parser::parse_cursor_store_db;
        use std::path::Path;

        if !is_cursor_installed() {
            println!("Skipping: Cursor not installed");
            return;
        }

        let session_id = "3f54d0ba-a147-4c4e-a3d5-8d89a3e6b080";
        let all_chats = scan_all_chats_with_projects(&[]).await.unwrap_or_default();
        let Some(entry) = all_chats.iter().find(|chat| chat.id == session_id) else {
            println!("Skipping: session {} not found locally", session_id);
            return;
        };
        let Some(source_path) = entry.source_path.as_deref() else {
            println!("Skipping: session {} has no source path", session_id);
            return;
        };
        if !source_path.ends_with("store.db") {
            println!("Skipping: session {} is not backed by store.db", session_id);
            return;
        }

        let session = parse_cursor_store_db(
            Path::new(source_path),
            session_id,
            entry.workspace_path.as_deref(),
        )
        .await
        .expect("session should load from store.db");

        let assistant_texts = session
            .messages
            .iter()
            .filter(|message| message.role == "assistant")
            .flat_map(|message| message.content_blocks.iter())
            .filter_map(|block| match block {
                crate::session_jsonl::types::ContentBlock::Text { text } => Some(text.clone()),
                crate::session_jsonl::types::ContentBlock::Thinking { thinking, .. } => {
                    Some(thinking.clone())
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        assert!(
            assistant_texts.iter().any(|text| text.contains(
                "Exploring the codebase to understand the project and identify improvements."
            )),
            "expected exploration status text in reconstructed session"
        );
        assert_eq!(
            assistant_texts
                .iter()
                .filter(|text| text.contains(
                    "Exploring the codebase to understand the project and identify improvements."
                ))
                .count(),
            1,
            "expected exactly one exploration status text in reconstructed session"
        );
        assert!(
            assistant_texts
                .iter()
                .any(|text| text.contains("I now have a full picture of the codebase.")),
            "expected post-read assistant summary in reconstructed session"
        );
        assert!(
            assistant_texts.iter().any(|text| text
                .contains("Creating a plan that lists concrete, actionable improvements.")),
            "expected pre-plan status text in reconstructed session"
        );
        assert_eq!(
            assistant_texts
                .iter()
                .filter(|text| text
                    .contains("Creating a plan that lists concrete, actionable improvements."))
                .count(),
            1,
            "expected exactly one pre-plan status text in reconstructed session"
        );

        let tool_names = session
            .messages
            .iter()
            .flat_map(|message| message.content_blocks.iter())
            .filter_map(|block| match block {
                crate::session_jsonl::types::ContentBlock::ToolUse { name, .. } => {
                    Some(name.clone())
                }
                _ => None,
            })
            .collect::<Vec<_>>();

        let read_count = tool_names.iter().filter(|name| *name == "Read").count();
        assert!(
            tool_names.iter().any(|name| name == "Glob"),
            "expected Glob tool call in reconstructed session"
        );
        assert!(
            tool_names.iter().any(|name| name == "CreatePlan"),
            "expected CreatePlan tool call in reconstructed session"
        );
        assert!(
            read_count >= 8,
            "expected at least 8 Read tool calls, found {}",
            read_count
        );
    }

    // ============================================
    // PARSING COVERAGE ANALYSIS
    // ============================================

    #[tokio::test]
    async fn test_analyze_all_txt_transcripts_for_missing_logic() {
        use crate::cursor_history::parser::{analyze_transcript_parsing, ParsingAnalysis};
        use std::collections::HashMap;

        let mock_transcripts = [
            (
                "session-a.txt",
                r#"user:
<user_query>
Read README.md
</user_query>

assistant:
<think>
I should read the file first.
</think>
I'll read it now.

[Tool call] Read
  path: README.md
"#,
            ),
            (
                "session-b.txt",
                r#"user:
<user_query>
Search for TODO markers
</user_query>

A:
I found multiple TODO comments."#,
            ),
        ];

        let mut total_transcripts = 0;
        let mut total_lines = 0;
        let mut total_parsed = 0;
        let mut total_dropped = 0;
        let mut total_user_messages = 0;
        let mut total_assistant_messages = 0;
        let mut total_tool_calls = 0;
        let mut global_unknown_prefixes: HashMap<String, usize> = HashMap::new();
        let mut transcripts_with_issues: Vec<(String, ParsingAnalysis)> = Vec::new();
        let mut lowest_coverage: Option<(String, f64)> = None;

        for (file_name, content) in &mock_transcripts {
            total_transcripts += 1;
            let analysis = analyze_transcript_parsing(content);

            // Aggregate statistics
            total_lines += analysis.total_lines;
            total_parsed += analysis.parsed_lines;
            total_dropped += analysis.dropped_lines;
            total_user_messages += analysis.user_message_count;
            total_assistant_messages += analysis.assistant_message_count;
            total_tool_calls += analysis.tool_call_count;

            // Collect unknown prefixes
            for (prefix, count) in &analysis.unknown_prefixes {
                *global_unknown_prefixes.entry(prefix.clone()).or_insert(0) += count;
            }

            // Track lowest coverage
            let coverage = analysis.coverage_percent();
            if let Some((_, lowest)) = &lowest_coverage {
                if coverage < *lowest {
                    lowest_coverage = Some(((*file_name).to_string(), coverage));
                }
            } else {
                lowest_coverage = Some(((*file_name).to_string(), coverage));
            }

            // Collect transcripts with issues
            if analysis.has_issues() {
                transcripts_with_issues.push(((*file_name).to_string(), analysis));
            }
        }

        // Print summary report
        println!("========================================");
        println!("TRANSCRIPT PARSING ANALYSIS REPORT");
        println!("========================================\n");

        println!("OVERALL STATISTICS:");
        println!("  Total transcripts analyzed: {}", total_transcripts);
        println!("  Total lines: {}", total_lines);
        println!(
            "  Lines parsed: {} ({:.1}%)",
            total_parsed,
            if total_lines > 0 {
                (total_parsed as f64 / total_lines as f64) * 100.0
            } else {
                100.0
            }
        );
        println!(
            "  Lines dropped: {} ({:.1}%)",
            total_dropped,
            if total_lines > 0 {
                (total_dropped as f64 / total_lines as f64) * 100.0
            } else {
                0.0
            }
        );
        println!();

        println!("MESSAGE STATISTICS:");
        println!("  User messages: {}", total_user_messages);
        println!("  Assistant messages: {}", total_assistant_messages);
        println!("  Tool calls: {}", total_tool_calls);
        println!();

        if !global_unknown_prefixes.is_empty() {
            println!("UNKNOWN PREFIXES DETECTED:");
            let mut sorted_prefixes: Vec<_> = global_unknown_prefixes.iter().collect();
            sorted_prefixes.sort_by(|a, b| b.1.cmp(a.1));
            for (prefix, count) in sorted_prefixes.iter().take(20) {
                println!("  {:30} : {} occurrences", prefix, count);
            }
            if sorted_prefixes.len() > 20 {
                println!(
                    "  ... and {} more unknown prefixes",
                    sorted_prefixes.len() - 20
                );
            }
            println!();
        }

        if let Some((file, coverage)) = &lowest_coverage {
            println!("LOWEST COVERAGE TRANSCRIPT:");
            println!("  File: {}", file);
            println!("  Coverage: {:.1}%", coverage);
            println!();
        }

        if !transcripts_with_issues.is_empty() {
            println!(
                "TRANSCRIPTS WITH ISSUES ({}):",
                transcripts_with_issues.len()
            );
            for (file, analysis) in transcripts_with_issues.iter().take(10) {
                println!("\n  File: {}", file);
                println!("    Coverage: {:.1}%", analysis.coverage_percent());
                println!(
                    "    User messages: {}, Assistant messages: {}",
                    analysis.user_message_count, analysis.assistant_message_count
                );

                if !analysis.potential_markers.is_empty() {
                    println!("    Potential unrecognized markers:");
                    for marker in analysis.potential_markers.iter().take(3) {
                        println!("      - {}", marker);
                    }
                }

                if !analysis.unparsed_samples.is_empty() {
                    println!("    Unparsed content samples:");
                    for sample in analysis.unparsed_samples.iter().take(3) {
                        println!("      - {}", sample);
                    }
                }
            }
            if transcripts_with_issues.len() > 10 {
                println!(
                    "\n  ... and {} more transcripts with issues",
                    transcripts_with_issues.len() - 10
                );
            }
        }

        println!("\n========================================");
        println!("END OF REPORT");
        println!("========================================");

        // Assertions for test verification
        assert!(
            total_transcripts > 0,
            "Should find at least one .txt transcript"
        );

        // Verify we're getting both user and assistant messages
        assert!(total_user_messages > 0, "Should find user messages");
        assert!(
            total_assistant_messages > 0,
            "Should find assistant messages after fix"
        );

        // Overall coverage should be reasonable (at least 60%)
        let overall_coverage = if total_lines > 0 {
            (total_parsed as f64 / total_lines as f64) * 100.0
        } else {
            100.0
        };
        assert!(
            overall_coverage >= 60.0,
            "Overall parsing coverage should be at least 60%, got {:.1}%",
            overall_coverage
        );
    }
}
