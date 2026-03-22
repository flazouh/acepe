use super::*;

/// Read the `cwd` field from the first JSONL file found in `project_dir`.
///
/// Claude CLI slugs are ambiguous: both '/' and '.' are encoded as '-', so
/// "happy-mountain" and "happy/mountain" produce identical slugs. Reading the
/// `cwd` from the session file is the only reliable way to recover the original
/// path.
async fn read_cwd_from_project_dir(project_dir: &std::path::Path) -> Option<String> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let mut read_dir = tokio::fs::read_dir(project_dir).await.ok()?;

    while let Ok(Some(entry)) = read_dir.next_entry().await {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if !name_str.ends_with(".jsonl") {
            continue;
        }

        let file = match tokio::fs::File::open(entry.path()).await {
            Ok(f) => f,
            Err(_) => continue,
        };

        let mut lines = BufReader::new(file).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                if let Some(cwd) = json.get("cwd").and_then(|v| v.as_str()) {
                    if !cwd.is_empty() {
                        return Some(cwd.to_string());
                    }
                }
            }
        }
    }

    None
}

async fn list_claude_project_paths() -> Result<Vec<String>, String> {
    use crate::session_jsonl::parser::get_session_jsonl_root;

    let jsonl_root =
        get_session_jsonl_root().map_err(|e| format!("Failed to get session jsonl root: {}", e))?;
    let projects_dir = jsonl_root.join("projects");

    if !projects_dir.exists() {
        return Ok(Vec::new());
    }

    let mut project_paths = Vec::new();
    let mut read_dir = tokio::fs::read_dir(&projects_dir)
        .await
        .map_err(|e| format!("Failed to read projects directory: {}", e))?;

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| format!("Failed to read directory entry: {}", e))?
    {
        let file_name = entry.file_name();
        let file_name_str = file_name.to_string_lossy();

        // Skip hidden files and directories
        if file_name_str.starts_with('.') {
            continue;
        }

        // Skip the "global" directory (sessions not tied to a project)
        if file_name_str == "global" {
            continue;
        }

        if !entry
            .file_type()
            .await
            .map_err(|e| format!("Failed to get file type: {}", e))?
            .is_dir()
        {
            continue;
        }

        // Read cwd from the first JSONL file in the directory. This is the
        // authoritative project path — slug decoding is ambiguous because Claude
        // CLI encodes both '/' and '-' (and '.') as '-'.
        if let Some(cwd) = read_cwd_from_project_dir(&entry.path()).await {
            project_paths.push(cwd);
        }
    }

    Ok(project_paths)
}

/// List Cursor project directories.
/// Converts slug directories to project paths.
async fn list_cursor_project_paths() -> Result<Vec<String>, String> {
    use crate::cursor_history::parser::get_cursor_projects_dir;

    let projects_dir = get_cursor_projects_dir()
        .map_err(|e| format!("Failed to get Cursor projects directory: {}", e))?;

    if !projects_dir.exists() {
        return Ok(Vec::new());
    }

    let mut project_paths = Vec::new();
    let mut read_dir = tokio::fs::read_dir(&projects_dir)
        .await
        .map_err(|e| format!("Failed to read projects directory: {}", e))?;

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| format!("Failed to read directory entry: {}", e))?
    {
        let file_name = entry.file_name();
        let file_name_str = file_name.to_string_lossy();

        // Skip hidden files and directories
        if file_name_str.starts_with('.') {
            continue;
        }

        if !entry
            .file_type()
            .await
            .map_err(|e| format!("Failed to get file type: {}", e))?
            .is_dir()
        {
            continue;
        }

        // Convert slug to path: `Users-alex-Documents-pointer` -> `/Users/alex/Documents/pointer`
        let project_path = format!("/{}", file_name_str.replace('-', "/"));
        project_paths.push(project_path);
    }

    Ok(project_paths)
}

/// List OpenCode project paths.
/// Uses scan_projects() to get hash -> path mapping, then extracts paths.
async fn list_opencode_project_paths() -> Result<Vec<String>, String> {
    let project_map = opencode_parser::scan_projects()
        .await
        .map_err(|e| format!("Failed to scan OpenCode projects: {}", e))?;

    // Extract unique paths from the hash -> path mapping
    let mut paths: Vec<String> = project_map.values().cloned().collect();
    paths.sort();
    paths.dedup();

    Ok(paths)
}

/// List Codex project paths using fast cwd-only extraction.
async fn list_codex_project_paths() -> Result<Vec<String>, String> {
    codex_scanner::list_project_paths()
        .await
        .map_err(|e| format!("Failed to list Codex projects: {}", e))
}

/// Count Claude Code sessions for a specific project.
async fn count_claude_sessions_for_project(project_path: &str) -> Result<u32, String> {
    use crate::session_jsonl::parser::{get_session_jsonl_root, path_to_slug};

    let jsonl_root =
        get_session_jsonl_root().map_err(|e| format!("Failed to get session jsonl root: {}", e))?;
    let projects_dir = jsonl_root.join("projects");

    if !projects_dir.exists() {
        return Ok(0);
    }

    // Convert project path back to slug
    let slug = path_to_slug(project_path);
    let project_dir = projects_dir.join(&slug);

    if !project_dir.exists() || !project_dir.is_dir() {
        return Ok(0);
    }

    let mut count = 0u32;
    let mut read_dir = tokio::fs::read_dir(&project_dir)
        .await
        .map_err(|e| format!("Failed to read project directory {}: {}", project_path, e))?;

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| format!("Failed to read directory entry: {}", e))?
    {
        let file_path = entry.path();
        if !entry
            .file_type()
            .await
            .map_err(|e| format!("Failed to get file type: {}", e))?
            .is_file()
        {
            continue;
        }

        let file_name = file_path.file_name().and_then(|n| n.to_str()).unwrap_or("");

        if file_name.ends_with(".jsonl") {
            count += 1;
        }
    }

    Ok(count)
}

/// Count Cursor sessions for a specific project.
async fn count_cursor_sessions_for_project(project_path: &str) -> Result<u32, String> {
    use crate::cursor_history::parser::get_cursor_projects_dir;

    let projects_dir = get_cursor_projects_dir()
        .map_err(|e| format!("Failed to get Cursor projects directory: {}", e))?;

    if !projects_dir.exists() {
        return Ok(0);
    }

    // Convert project path back to slug: `/Users/alex/Documents/pointer` -> `Users-alex-Documents-pointer`
    let slug = project_path.trim_start_matches('/').replace('/', "-");
    let project_dir = projects_dir.join(&slug);

    if !project_dir.exists() || !project_dir.is_dir() {
        return Ok(0);
    }

    // Count all JSON files in agent-transcripts directory
    let transcripts_dir = project_dir.join("agent-transcripts");
    if !transcripts_dir.exists() {
        return Ok(0);
    }

    let mut count = 0u32;
    let mut read_dir = tokio::fs::read_dir(&transcripts_dir).await.map_err(|e| {
        format!(
            "Failed to read transcripts directory {}: {}",
            project_path, e
        )
    })?;

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| format!("Failed to read directory entry: {}", e))?
    {
        let file_path = entry.path();
        if !entry
            .file_type()
            .await
            .map_err(|e| format!("Failed to get file type: {}", e))?
            .is_file()
        {
            continue;
        }

        let file_name = file_path.file_name().and_then(|n| n.to_str()).unwrap_or("");

        // Cursor transcripts can be .json or .txt files
        if file_name.ends_with(".json") || file_name.ends_with(".txt") {
            count += 1;
        }
    }

    Ok(count)
}

/// Count OpenCode sessions for a specific project.
async fn count_opencode_sessions_for_project(project_path: &str) -> Result<u32, String> {
    use crate::opencode_history::parser::get_storage_dir;

    let storage_dir = get_storage_dir()
        .map_err(|e| format!("Failed to get OpenCode storage directory: {}", e))?;
    let sessions_dir = storage_dir.join("session");

    if !sessions_dir.exists() {
        return Ok(0);
    }

    // First, scan projects to get hash -> path mapping
    let project_map = opencode_parser::scan_projects()
        .await
        .map_err(|e| format!("Failed to scan OpenCode projects: {}", e))?;

    // Find project hash for this path
    let project_hash = project_map
        .iter()
        .find(|(_, path)| *path == project_path)
        .map(|(hash, _)| hash.clone());

    let project_hash = match project_hash {
        Some(hash) => hash,
        None => return Ok(0), // Project not found
    };

    // Sessions are stored in a subdirectory named by project hash
    let project_sessions_dir = sessions_dir.join(&project_hash);
    if !project_sessions_dir.exists() || !project_sessions_dir.is_dir() {
        return Ok(0);
    }

    // Count .json session files in the project's session directory
    let mut count = 0u32;
    let mut read_dir = tokio::fs::read_dir(&project_sessions_dir)
        .await
        .map_err(|e| {
            format!(
                "Failed to read sessions directory for {}: {}",
                project_path, e
            )
        })?;

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| format!("Failed to read directory entry: {}", e))?
    {
        if !entry
            .file_type()
            .await
            .map_err(|e| format!("Failed to get file type: {}", e))?
            .is_file()
        {
            continue;
        }

        let file_name = entry.file_name();
        let file_name_str = file_name.to_string_lossy();

        if file_name_str.ends_with(".json") {
            count += 1;
        }
    }

    Ok(count)
}

/// Count Codex sessions for a specific project.
/// Uses fast cwd-only extraction (reads first ~20 lines per file).
async fn count_codex_sessions_for_project(project_path: &str) -> Result<u32, String> {
    codex_scanner::count_sessions_for_project(project_path)
        .await
        .map_err(|e| format!("Failed to count Codex sessions: {}", e))
}

/// List all project paths from all agents without scanning session files.
/// This provides a fast (~20ms) way to discover available projects for the "Open Project" dialog.
///
/// # Returns
/// Vector of project information with paths and agent sources
#[tauri::command]
#[specta::specta]
pub async fn list_all_project_paths() -> Result<Vec<ProjectInfo>, String> {
    // Scan all agents in parallel for project paths only
    let (claude_result, cursor_result, opencode_result, codex_result) = tokio::join!(
        list_claude_project_paths(),
        list_cursor_project_paths(),
        list_opencode_project_paths(),
        list_codex_project_paths()
    );

    let mut projects = Vec::new();

    // Collect Claude projects
    match claude_result {
        Ok(claude_projects) => {
            projects.extend(claude_projects.into_iter().map(|path| ProjectInfo {
                path,
                agent_id: "claude-code".to_string(),
            }));
        }
        Err(e) => tracing::warn!(error = %e, "Failed to list Claude projects"),
    }

    // Collect Cursor projects
    match cursor_result {
        Ok(cursor_projects) => {
            projects.extend(cursor_projects.into_iter().map(|path| ProjectInfo {
                path,
                agent_id: "cursor".to_string(),
            }));
        }
        Err(e) => tracing::warn!(error = %e, "Failed to list Cursor projects"),
    }

    // Collect OpenCode projects
    match opencode_result {
        Ok(opencode_projects) => {
            projects.extend(opencode_projects.into_iter().map(|path| ProjectInfo {
                path,
                agent_id: "opencode".to_string(),
            }));
        }
        Err(e) => tracing::warn!(error = %e, "Failed to list OpenCode projects"),
    }

    // Collect Codex projects
    match codex_result {
        Ok(codex_projects) => {
            projects.extend(codex_projects.into_iter().map(|path| ProjectInfo {
                path,
                agent_id: "codex".to_string(),
            }));
        }
        Err(e) => tracing::warn!(error = %e, "Failed to list Codex projects"),
    }

    // Remove duplicates (same project might be in multiple agents)
    let mut seen = std::collections::HashSet::new();
    projects.retain(|p| seen.insert(p.path.clone()));

    // TEMPORARY: If we only found Claude projects, fall back to the old method
    // to ensure we don't break existing functionality
    if !projects.is_empty() && projects.iter().all(|p| p.agent_id == "claude-code") {
        tracing::warn!("Only found Claude projects, falling back to old discovery method");

        // Call the old discovery method and extract unique project paths
        match discover_all_projects_with_sessions().await {
            Ok(entries) => {
                let mut fallback_projects = Vec::new();
                let mut seen_paths = std::collections::HashSet::new();

                for entry in entries {
                    // Skip "global" - it's not a real project path (OpenCode sessions without a project)
                    if entry.project == "global" {
                        continue;
                    }
                    if !seen_paths.contains(&entry.project) {
                        seen_paths.insert(entry.project.clone());
                        fallback_projects.push(ProjectInfo {
                            path: entry.project,
                            agent_id: entry.agent_id.to_string(),
                        });
                    }
                }

                tracing::info!("Fallback method found {} projects", fallback_projects.len());
                return Ok(fallback_projects);
            }
            Err(e) => {
                tracing::warn!("Fallback method also failed: {}", e);
            }
        }
    }

    Ok(projects)
}

/// Count sessions for a specific project across all agents.
/// This is called per-project to progressively update the UI with session counts.
///
/// # Arguments
/// * `project_path` - The project path to count sessions for
///
/// # Returns
/// Session counts per agent for the specified project
#[tauri::command]
#[specta::specta]
pub async fn count_sessions_for_project(
    project_path: String,
) -> Result<ProjectSessionCounts, String> {
    // Count sessions from all agents in parallel for this specific project
    let (claude_result, cursor_result, opencode_result, codex_result) = tokio::join!(
        count_claude_sessions_for_project(&project_path),
        count_cursor_sessions_for_project(&project_path),
        count_opencode_sessions_for_project(&project_path),
        count_codex_sessions_for_project(&project_path)
    );

    let mut counts = std::collections::HashMap::new();

    // Collect Claude count
    match claude_result {
        Ok(count) if count > 0 => {
            counts.insert("claude-code".to_string(), count);
        }
        Ok(_) => {} // Zero count, don't include
        Err(e) => {
            tracing::warn!(project = %project_path, error = %e, "Failed to count Claude sessions")
        }
    }

    // Collect Cursor count
    match cursor_result {
        Ok(count) if count > 0 => {
            counts.insert("cursor".to_string(), count);
        }
        Ok(_) => {} // Zero count, don't include
        Err(e) => {
            tracing::warn!(project = %project_path, error = %e, "Failed to count Cursor sessions")
        }
    }

    // Collect OpenCode count
    match opencode_result {
        Ok(count) if count > 0 => {
            counts.insert("opencode".to_string(), count);
        }
        Ok(_) => {} // Zero count, don't include
        Err(e) => {
            tracing::warn!(project = %project_path, error = %e, "Failed to count OpenCode sessions")
        }
    }

    // Collect Codex count
    match codex_result {
        Ok(count) if count > 0 => {
            counts.insert("codex".to_string(), count);
        }
        Ok(_) => {} // Zero count, don't include
        Err(e) => {
            tracing::warn!(project = %project_path, error = %e, "Failed to count Codex sessions")
        }
    }

    Ok(ProjectSessionCounts {
        path: project_path,
        counts,
    })
}
