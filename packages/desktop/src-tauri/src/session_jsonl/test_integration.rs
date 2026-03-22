//! Integration tests for Claude Code history parsing.
//!
//! These tests verify that we can correctly parse real Claude Code data
//! from the local filesystem at ~/.claude/projects/.

#[cfg(test)]
mod tests {
    use crate::acp::types::CanonicalAgentId;
    use crate::session_jsonl::parser::{
        extract_thread_metadata, get_session_jsonl_root, parse_full_session, path_to_slug,
        scan_all_threads, scan_projects,
    };
    use crate::session_jsonl::types::ContentBlock;

    /// Maximum sessions to scan/parse in tests for performance.
    /// Tests don't need to verify all 7000+ sessions - a sample is sufficient.
    const TEST_MAX_SESSIONS: usize = 50;

    fn live_claude_tests_enabled() -> bool {
        std::env::var("ACEPE_RUN_LIVE_CLAUDE_TESTS")
            .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false)
    }

    /// Check if Claude Code is installed by verifying the home directory exists.
    fn is_claude_installed() -> bool {
        if !live_claude_tests_enabled() {
            return false;
        }
        match get_session_jsonl_root() {
            Ok(dir) => dir.exists(),
            Err(_) => false,
        }
    }

    /// Fast helper: get sessions from a single project for testing.
    /// Much faster than scan_all_threads() which scans 20+ projects.
    async fn get_test_sessions() -> Vec<crate::session_jsonl::types::HistoryEntry> {
        let home_dir = match get_session_jsonl_root() {
            Ok(dir) => dir,
            Err(_) => return Vec::new(),
        };
        let projects_dir = home_dir.join("projects");

        // Find first project directory with .jsonl files
        let mut read_dir = match tokio::fs::read_dir(&projects_dir).await {
            Ok(dir) => dir,
            Err(_) => return Vec::new(),
        };

        while let Ok(Some(entry)) = read_dir.next_entry().await {
            let project_slug = entry.file_name().to_string_lossy().to_string();
            if project_slug.starts_with('.') {
                continue;
            }
            let project_path = entry.path();
            if !project_path.is_dir() {
                continue;
            }

            // Check if this project has any .jsonl files
            if let Ok(mut project_read_dir) = tokio::fs::read_dir(&project_path).await {
                let mut has_sessions = false;
                while let Ok(Some(file_entry)) = project_read_dir.next_entry().await {
                    if file_entry
                        .path()
                        .extension()
                        .map(|e| e == "jsonl")
                        .unwrap_or(false)
                    {
                        has_sessions = true;
                        break;
                    }
                }

                if has_sessions {
                    // Convert slug back to original path (replace - with /)
                    let original_path = format!("/{}", project_slug.replace('-', "/"));
                    if let Ok(entries) = scan_projects(&[original_path]).await {
                        if !entries.is_empty() {
                            return entries;
                        }
                    }
                }
            }
        }

        Vec::new()
    }

    #[tokio::test]
    async fn test_claude_installed_check() {
        let installed = is_claude_installed();
        println!("Claude Code installed: {}", installed);
        // This test just verifies the function doesn't panic
    }

    #[tokio::test]
    async fn test_claude_home_dir() {
        let home_dir = get_session_jsonl_root();
        match home_dir {
            Ok(dir) => {
                println!("Claude home dir: {:?}", dir);
                println!("Exists: {}", dir.exists());
            }
            Err(e) => {
                println!("Could not get home dir: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_path_to_slug() {
        // Test basic path conversion
        assert_eq!(
            path_to_slug("/Users/alex/Documents"),
            "-Users-alex-Documents"
        );
        assert_eq!(path_to_slug("/home/user/project"), "-home-user-project");
        assert_eq!(path_to_slug("relative/path"), "relative-path");
    }

    #[tokio::test]
    async fn test_scan_all_threads() {
        if !is_claude_installed() {
            println!("Skipping: Claude Code not installed");
            return;
        }

        let result = scan_all_threads().await;
        match result {
            Ok(entries) => {
                println!("Found {} threads", entries.len());
                for entry in entries.iter().take(5) {
                    println!(
                        "  - {} ({}): {}",
                        &entry.session_id[..8.min(entry.session_id.len())],
                        entry.project.split('/').next_back().unwrap_or("unknown"),
                        entry.display.chars().take(50).collect::<String>()
                    );
                }
                // Verify no parsing errors for any entry
                assert!(
                    entries.iter().all(|e| !e.session_id.is_empty()),
                    "All entries should have session IDs"
                );

                // Verify sorting (should be descending by timestamp)
                for i in 1..entries.len() {
                    assert!(
                        entries[i - 1].timestamp >= entries[i].timestamp,
                        "Entries should be sorted by timestamp descending"
                    );
                }
            }
            Err(e) => {
                panic!("Failed to scan threads: {}", e);
            }
        }
    }

    #[tokio::test]
    async fn test_scan_projects_with_filter() {
        if !is_claude_installed() {
            println!("Skipping: Claude Code not installed");
            return;
        }

        // Test with no filter first
        let all_result = scan_all_threads().await;
        assert!(all_result.is_ok(), "scan_all_threads should succeed");
        let all_entries = all_result.unwrap();
        println!("Found {} threads without filter", all_entries.len());

        if all_entries.is_empty() {
            println!("No threads found, skipping filter test");
            return;
        }

        // Get a project path from the first entry to use as filter
        let sample_project = &all_entries[0].project;
        if sample_project.is_empty() {
            println!("No project path in entries, skipping filter test");
            return;
        }

        let filtered = scan_projects(std::slice::from_ref(sample_project)).await;
        assert!(filtered.is_ok(), "scan_projects with filter should succeed");

        let filtered_entries = filtered.unwrap();
        println!(
            "Found {} threads for project: {}",
            filtered_entries.len(),
            sample_project
        );

        // All filtered entries should be for this project
        for entry in &filtered_entries {
            assert!(
                entry.project == *sample_project || entry.project.is_empty(),
                "Filtered entry should match project"
            );
        }
    }

    #[tokio::test]
    async fn test_extract_thread_metadata() {
        if !is_claude_installed() {
            println!("Skipping: Claude Code not installed");
            return;
        }

        let home_dir = get_session_jsonl_root().unwrap();
        let projects_dir = home_dir.join("projects");

        if !projects_dir.exists() {
            println!("Projects directory not found, skipping");
            return;
        }

        // Find the first .jsonl file to test
        let mut found_file = None;
        if let Ok(mut read_dir) = tokio::fs::read_dir(&projects_dir).await {
            while let Ok(Some(entry)) = read_dir.next_entry().await {
                let project_path = entry.path();
                if project_path.is_dir() {
                    if let Ok(mut project_read_dir) = tokio::fs::read_dir(&project_path).await {
                        while let Ok(Some(file_entry)) = project_read_dir.next_entry().await {
                            let file_path = file_entry.path();
                            if file_path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                                found_file = Some(file_path);
                                break;
                            }
                        }
                    }
                }
                if found_file.is_some() {
                    break;
                }
            }
        }

        match found_file {
            Some(file_path) => {
                println!("Testing metadata extraction from: {:?}", file_path);
                let result = extract_thread_metadata(&file_path).await;
                match result {
                    Ok(Some(entry)) => {
                        println!("Extracted metadata:");
                        println!("  session_id: {}", entry.session_id);
                        println!("  display: {}", entry.display);
                        println!("  project: {}", entry.project);
                        println!("  timestamp: {}", entry.timestamp);
                        println!("  agent_id: {}", entry.agent_id);

                        assert!(
                            !entry.session_id.is_empty(),
                            "session_id should not be empty"
                        );
                        assert_eq!(entry.agent_id, CanonicalAgentId::ClaudeCode);
                    }
                    Ok(None) => {
                        println!("File did not contain valid metadata (expected for some files)");
                    }
                    Err(e) => {
                        panic!("Failed to extract metadata: {}", e);
                    }
                }
            }
            None => {
                println!("No .jsonl files found, skipping");
            }
        }
    }

    #[tokio::test]
    async fn test_parse_full_session() {
        if !is_claude_installed() {
            println!("Skipping: Claude Code not installed");
            return;
        }

        let entries = get_test_sessions().await;
        if entries.is_empty() {
            println!("No threads found, skipping");
            return;
        }

        // Find an entry with a project path
        let entry = entries
            .iter()
            .find(|e| !e.project.is_empty())
            .or_else(|| entries.first());

        if let Some(entry) = entry {
            println!(
                "Loading session: {} from {}",
                &entry.session_id[..8.min(entry.session_id.len())],
                entry.project.split('/').next_back().unwrap_or("unknown")
            );

            let result = parse_full_session(&entry.session_id, &entry.project).await;

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
                    println!("  tool_uses: {}", session.stats.tool_uses);
                    println!("  tool_results: {}", session.stats.tool_results);
                    println!("  thinking_blocks: {}", session.stats.thinking_blocks);
                    println!("  total_input_tokens: {}", session.stats.total_input_tokens);
                    println!(
                        "  total_output_tokens: {}",
                        session.stats.total_output_tokens
                    );

                    // Verify the session is valid
                    assert!(!session.session_id.is_empty());

                    // Print first few messages
                    for (i, msg) in session.messages.iter().take(3).enumerate() {
                        println!("  Message {}: role={}", i, msg.role);
                        for block in &msg.content_blocks {
                            match block {
                                ContentBlock::Text { text } => {
                                    let preview = if text.len() > 100 {
                                        format!("{}...", &text[..100])
                                    } else {
                                        text.clone()
                                    };
                                    println!("    Text: {}", preview);
                                }
                                ContentBlock::Thinking { thinking, .. } => {
                                    let preview = if thinking.len() > 50 {
                                        format!("{}...", &thinking[..50])
                                    } else {
                                        thinking.clone()
                                    };
                                    println!("    Thinking: {}", preview);
                                }
                                ContentBlock::ToolUse { name, .. } => {
                                    println!("    ToolUse: {}", name);
                                }
                                ContentBlock::ToolResult { tool_use_id, .. } => {
                                    println!("    ToolResult for: {}", tool_use_id);
                                }
                                ContentBlock::CodeAttachment { path, .. } => {
                                    println!("    CodeAttachment: {}", path);
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    panic!("Failed to load session: {}", e);
                }
            }
        } else {
            println!("No suitable entry found for testing");
        }
    }

    #[tokio::test]
    async fn test_parse_all_sessions_no_errors() {
        if !is_claude_installed() {
            println!("Skipping: Claude Code not installed");
            return;
        }

        let entries = get_test_sessions().await;
        let test_count = entries.len().min(TEST_MAX_SESSIONS);
        println!(
            "Found {} threads, testing {} for performance",
            entries.len(),
            test_count
        );

        if entries.is_empty() {
            println!("No threads found, test passes vacuously");
            return;
        }

        let mut success_count = 0;
        let mut error_count = 0;
        let mut error_details: Vec<String> = Vec::new();

        for entry in entries.iter().take(TEST_MAX_SESSIONS) {
            match parse_full_session(&entry.session_id, &entry.project).await {
                Ok(session) => {
                    success_count += 1;
                    // Verify basic invariants
                    assert!(
                        !session.session_id.is_empty(),
                        "session_id should not be empty"
                    );
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
                    if error_details.len() < 10 {
                        error_details.push(format!(
                            "{}: {}",
                            &entry.session_id[..8.min(entry.session_id.len())],
                            e
                        ));
                    }
                }
            }
        }

        println!(
            "Results: {} success, {} errors out of {} tested",
            success_count, error_count, test_count
        );

        if !error_details.is_empty() {
            println!("First few errors:");
            for detail in &error_details {
                println!("  - {}", detail);
            }
        }

        // At least one should succeed if we have entries
        assert!(
            success_count > 0 || entries.is_empty(),
            "At least one session should parse successfully"
        );

        // Most sessions should parse successfully (allow up to 50% failure for edge cases)
        assert!(
            error_count <= test_count / 2,
            "More than half failed: {} errors out of {}",
            error_count,
            test_count
        );
    }

    #[tokio::test]
    async fn test_session_stats_consistency() {
        if !is_claude_installed() {
            println!("Skipping: Claude Code not installed");
            return;
        }

        let entries = get_test_sessions().await;
        if entries.is_empty() {
            println!("No threads found, skipping");
            return;
        }

        // Test a sample of sessions for stats consistency
        let sample_size = 10.min(entries.len());
        println!("Testing stats consistency for {} sessions", sample_size);

        for entry in entries.iter().take(sample_size) {
            if let Ok(session) = parse_full_session(&entry.session_id, &entry.project).await {
                // Count content blocks manually
                let mut manual_tool_uses = 0;
                let mut manual_tool_results = 0;
                let mut manual_thinking = 0;
                let mut manual_user = 0;
                let mut manual_assistant = 0;

                for msg in &session.messages {
                    if msg.role == "user" {
                        manual_user += 1;
                    } else if msg.role == "assistant" {
                        manual_assistant += 1;
                    }

                    for block in &msg.content_blocks {
                        match block {
                            ContentBlock::ToolUse { .. } => manual_tool_uses += 1,
                            ContentBlock::ToolResult { .. } => manual_tool_results += 1,
                            ContentBlock::Thinking { .. } => manual_thinking += 1,
                            ContentBlock::Text { .. } => {}
                            ContentBlock::CodeAttachment { .. } => {}
                        }
                    }
                }

                // Verify stats match our manual count
                assert_eq!(
                    session.stats.user_messages,
                    manual_user,
                    "User message count mismatch for session {}",
                    &session.session_id[..8]
                );
                assert_eq!(
                    session.stats.assistant_messages,
                    manual_assistant,
                    "Assistant message count mismatch for session {}",
                    &session.session_id[..8]
                );
                assert_eq!(
                    session.stats.tool_uses,
                    manual_tool_uses,
                    "Tool use count mismatch for session {}",
                    &session.session_id[..8]
                );
                assert_eq!(
                    session.stats.tool_results,
                    manual_tool_results,
                    "Tool result count mismatch for session {}",
                    &session.session_id[..8]
                );
                assert_eq!(
                    session.stats.thinking_blocks,
                    manual_thinking,
                    "Thinking block count mismatch for session {}",
                    &session.session_id[..8]
                );
            }
        }

        println!("Stats consistency verified for {} sessions", sample_size);
    }

    #[tokio::test]
    async fn test_message_ordering() {
        if !is_claude_installed() {
            println!("Skipping: Claude Code not installed");
            return;
        }

        let entries = get_test_sessions().await;
        if entries.is_empty() {
            println!("No threads found, skipping");
            return;
        }

        // Find a session with multiple messages
        for entry in entries.iter().take(20) {
            if let Ok(session) = parse_full_session(&entry.session_id, &entry.project).await {
                if session.messages.len() > 2 {
                    println!(
                        "Testing message ordering for session {} ({} messages)",
                        &session.session_id[..8],
                        session.messages.len()
                    );

                    // Verify parent-child relationships
                    let mut found_parent_child = false;
                    for (i, msg) in session.messages.iter().enumerate() {
                        if let Some(parent_uuid) = &msg.parent_uuid {
                            // The parent should appear before this message
                            let parent_found =
                                session.messages[..i].iter().any(|m| &m.uuid == parent_uuid);

                            if parent_found {
                                found_parent_child = true;
                            }
                            // Note: parent might not be in our messages if it's a root or was filtered
                        }
                    }

                    if found_parent_child {
                        println!("Parent-child ordering verified");
                        return; // Test passed
                    }
                }
            }
        }

        println!("No suitable session found with parent-child relationships to verify");
    }

    #[tokio::test]
    async fn test_content_block_parsing() {
        if !is_claude_installed() {
            println!("Skipping: Claude Code not installed");
            return;
        }

        let entries = get_test_sessions().await;
        if entries.is_empty() {
            println!("No threads found, skipping");
            return;
        }

        let mut found_text = false;
        let mut found_thinking = false;
        let mut found_tool_use = false;
        let mut found_tool_result = false;

        for entry in entries.iter().take(TEST_MAX_SESSIONS) {
            if let Ok(session) = parse_full_session(&entry.session_id, &entry.project).await {
                for msg in &session.messages {
                    for block in &msg.content_blocks {
                        match block {
                            ContentBlock::Text { text } => {
                                if !found_text && !text.is_empty() {
                                    println!(
                                        "Found Text block: {}...",
                                        &text[..50.min(text.len())]
                                    );
                                    found_text = true;
                                }
                            }
                            ContentBlock::Thinking { thinking, .. } => {
                                if !found_thinking && !thinking.is_empty() {
                                    println!(
                                        "Found Thinking block: {}...",
                                        &thinking[..50.min(thinking.len())]
                                    );
                                    found_thinking = true;
                                }
                            }
                            ContentBlock::ToolUse { name, id, .. } => {
                                if !found_tool_use {
                                    println!(
                                        "Found ToolUse block: {} ({})",
                                        name,
                                        &id[..8.min(id.len())]
                                    );
                                    found_tool_use = true;
                                }
                            }
                            ContentBlock::ToolResult {
                                tool_use_id,
                                content,
                            } => {
                                if !found_tool_result {
                                    println!(
                                        "Found ToolResult block for {} ({} chars)",
                                        &tool_use_id[..8.min(tool_use_id.len())],
                                        content.len()
                                    );
                                    found_tool_result = true;
                                }
                            }
                            ContentBlock::CodeAttachment { path, .. } => {
                                println!("Found CodeAttachment block: {}", path);
                            }
                        }
                    }
                }
            }

            // Stop if we found all block types
            if found_text && found_thinking && found_tool_use && found_tool_result {
                break;
            }
        }

        println!("\nContent block types found:");
        println!("  Text: {}", found_text);
        println!("  Thinking: {}", found_thinking);
        println!("  ToolUse: {}", found_tool_use);
        println!("  ToolResult: {}", found_tool_result);

        // At minimum, we should find text blocks
        assert!(found_text, "Should find at least one Text content block");
    }

    #[tokio::test]
    async fn test_discover_all_tool_names() {
        if !is_claude_installed() {
            println!("Skipping: Claude Code not installed");
            return;
        }

        let entries = get_test_sessions().await;
        if entries.is_empty() {
            println!("No threads found, skipping");
            return;
        }

        let mut tool_names: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        let mut sessions_checked = 0;

        // Sample sessions to discover tool names (limited for test performance)
        for entry in entries.iter().take(TEST_MAX_SESSIONS) {
            if let Ok(session) = parse_full_session(&entry.session_id, &entry.project).await {
                sessions_checked += 1;
                for msg in &session.messages {
                    for block in &msg.content_blocks {
                        if let ContentBlock::ToolUse { name, .. } = block {
                            *tool_names.entry(name.clone()).or_insert(0) += 1;
                        }
                    }
                }
            }
        }

        println!(
            "\nDiscovered {} unique tool names from {} sessions:",
            tool_names.len(),
            sessions_checked
        );

        // Sort by frequency
        let mut sorted_tools: Vec<_> = tool_names.iter().collect();
        sorted_tools.sort_by(|a, b| b.1.cmp(a.1));

        for (name, count) in &sorted_tools {
            println!("  {} ({}x)", name, count);
        }

        // List of tool names that our UI explicitly handles
        let explicitly_supported = [
            // Claude Code tools
            "Read",
            "Edit",
            "Write",
            "Bash",
            "BashOutput",
            "KillShell",
            "KillBash",
            "LS",
            "Glob",
            "Grep",
            "WebFetch",
            "WebSearch",
            "Task",
            "TodoWrite",
            "NotebookRead",
            "NotebookEdit",
            "ExitPlanMode",
            "EnterPlanMode",
            "AskUserQuestion",
            "Skill",
            "TaskOutput",
            // ACP-prefixed tools
            "mcp__acp__Read",
            "mcp__acp__Edit",
            "mcp__acp__Write",
            "mcp__acp__Bash",
            "mcp__acp__BashOutput",
            "mcp__acp__KillShell",
            // Cursor tools
            "read_file",
            "write_file",
            "move_file",
            "copy_file",
            "search_codebase",
            "analyze_code",
            "apply_code_changes",
            "run_tests",
            "get_project_info",
            "explain_code",
        ];

        // Check if each discovered tool can be categorized
        let mut uncategorized: Vec<String> = Vec::new();
        for (name, _) in &sorted_tools {
            // Check explicit support
            if explicitly_supported.contains(&name.as_str()) {
                continue;
            }

            // Check pattern-based detection (mimicking TypeScript logic)
            let lower_name = name.to_lowercase();
            let has_pattern = lower_name.contains("read")
                || lower_name.contains("get")
                || lower_name.contains("fetch")
                || lower_name.contains("load")
                || lower_name.contains("edit")
                || lower_name.contains("write")
                || lower_name.contains("update")
                || lower_name.contains("modify")
                || lower_name.contains("exec")
                || lower_name.contains("run")
                || lower_name.contains("bash")
                || lower_name.contains("shell")
                || lower_name.contains("command")
                || lower_name.contains("search")
                || lower_name.contains("find")
                || lower_name.contains("grep")
                || lower_name.contains("glob")
                || lower_name.contains("list")
                || lower_name.contains("web")
                || lower_name.contains("http")
                || lower_name.contains("think")
                || lower_name.contains("plan")
                || lower_name.contains("task")
                || lower_name.contains("todo")
                || lower_name.contains("move")
                || lower_name.contains("rename")
                || lower_name.contains("delete")
                || lower_name.contains("remove")
                || lower_name.contains("mode")
                || lower_name.contains("switch");

            if !has_pattern {
                uncategorized.push(name.to_string());
            }
        }

        if !uncategorized.is_empty() {
            println!(
                "\nTools that fall back to 'other' UI ({}):",
                uncategorized.len()
            );
            for name in &uncategorized {
                let count = tool_names.get(name).unwrap_or(&0);
                println!("  {} ({}x)", name, count);
            }
        } else {
            println!("\nAll tools have specialized or pattern-matched UI support!");
        }

        // This is informational - we don't fail if some tools are uncategorized
        // since we have a fallback "other" component
        assert!(
            !tool_names.is_empty(),
            "Should discover at least some tool names"
        );
    }
}
