use crate::cursor_history::parser;
use crate::session_jsonl::types::SessionPlanResponse;
use regex::Regex;

/// Extract plan from Cursor session by reading transcript and finding plan reference.
///
/// Cursor sessions can have associated plans attached via the `<attached_files>` section.
/// Plan files are stored in `~/.cursor/plans/{name}_{uuid}.plan.md` and referenced
/// in the transcript with a path like `path=".../.cursor/plans/...plan.md"`.
pub async fn extract_plan_from_cursor_session(
    session_id: &str,
    project_path: &str,
) -> Result<Option<SessionPlanResponse>, String> {
    let logger_id = format!(
        "cursor_plan_loader_{}",
        session_id.chars().take(8).collect::<String>()
    );
    tracing::info!(
        logger_id = %logger_id,
        session_id = %session_id,
        project_path = %project_path,
        "Extracting plan from Cursor session"
    );

    // Step 1: Find transcript file (JSON or TXT)
    let transcript_path = find_cursor_transcript(session_id, project_path).await?;
    let Some(path) = transcript_path else {
        tracing::debug!(
            logger_id = %logger_id,
            session_id = %session_id,
            "No transcript file found for session"
        );
        return Ok(None);
    };

    // Step 2: Read transcript content
    let content = tokio::fs::read_to_string(&path).await.map_err(|e| {
        tracing::error!(
            logger_id = %logger_id,
            session_id = %session_id,
            transcript_path = %path.display(),
            error = %e,
            "Failed to read transcript file"
        );
        format!("Failed to read transcript: {}", e)
    })?;

    // Step 3: Extract plan path from <attached_files> section
    let plan_path = extract_plan_path(&content);
    let Some(plan_path) = plan_path else {
        tracing::debug!(
            logger_id = %logger_id,
            session_id = %session_id,
            "No plan path found in transcript"
        );
        return Ok(None);
    };

    tracing::info!(
        logger_id = %logger_id,
        session_id = %session_id,
        plan_path = %plan_path,
        "Found plan path in transcript"
    );

    // Step 4: Load and parse plan file
    load_cursor_plan_file(&plan_path).await
}

/// Find the transcript file for a Cursor session.
/// Searches in the project's agent-transcripts directory.
async fn find_cursor_transcript(
    session_id: &str,
    project_path: &str,
) -> Result<Option<std::path::PathBuf>, String> {
    let projects_dir = parser::get_cursor_projects_dir()
        .map_err(|e| format!("Failed to get Cursor projects directory: {}", e))?;

    if !projects_dir.exists() {
        return Ok(None);
    }

    // Convert project path to slug: `/Users/example/Documents/sample-repo` -> `Users-example-Documents-sample-repo`
    let slug = parser::path_to_slug(project_path);
    let project_dir = projects_dir.join(&slug);

    if !project_dir.exists() || !project_dir.is_dir() {
        return Ok(None);
    }

    let transcripts_dir = project_dir.join("agent-transcripts");
    if !transcripts_dir.exists() {
        return Ok(None);
    }

    // Try both .json and .txt extensions
    let json_path = transcripts_dir.join(format!("{}.json", session_id));
    let txt_path = transcripts_dir.join(format!("{}.txt", session_id));

    if json_path.exists() {
        Ok(Some(json_path))
    } else if txt_path.exists() {
        Ok(Some(txt_path))
    } else {
        Ok(None)
    }
}

/// Extract plan path from transcript content.
/// Looks for patterns like: path=".../.cursor/plans/...plan.md"
fn extract_plan_path(content: &str) -> Option<String> {
    // Match: path="...plan.md" within <attached_files> section
    let re = Regex::new(r#"path="([^"]+\.plan\.md)""#).ok()?;
    re.captures(content).map(|c| c[1].to_string())
}

/// Load and parse a Cursor plan file.
/// Plan files are YAML frontmatter + markdown content.
async fn load_cursor_plan_file(path: &str) -> Result<Option<SessionPlanResponse>, String> {
    let logger_id = format!(
        "cursor_plan_file_{}",
        path.chars().take(16).collect::<String>()
    );
    tracing::info!(logger_id = %logger_id, path = %path, "Loading Cursor plan file");

    let content = tokio::fs::read_to_string(path).await.map_err(|e| {
        tracing::error!(
            logger_id = %logger_id,
            path = %path,
            error = %e,
            "Failed to read plan file"
        );
        format!("Failed to read plan: {}", e)
    })?;

    // Parse YAML frontmatter and markdown content
    let (frontmatter, _body) = parse_plan_frontmatter(&content)?;

    Ok(Some(SessionPlanResponse {
        slug: extract_slug_from_path(path),
        title: frontmatter.name,
        summary: Some(frontmatter.overview),
        content,
        file_path: Some(path.to_string()),
    }))
}

/// Extract slug from plan file path.
/// `~/.cursor/plans/my_plan_12345678-1234-1234-1234-123456789abc.plan.md` -> `my_plan_12345678-1234-1234-1234-123456789abc`
fn extract_slug_from_path(path: &str) -> String {
    let stem = std::path::Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown_plan");

    // Remove .plan extension if present
    stem.strip_suffix(".plan").unwrap_or(stem).to_string()
}

/// Frontmatter structure for Cursor plan files.
#[derive(Debug, serde::Deserialize)]
struct PlanFrontmatter {
    name: String,
    overview: String,
}

/// Parse YAML frontmatter and markdown body from plan content.
fn parse_plan_frontmatter(content: &str) -> Result<(PlanFrontmatter, String), String> {
    // Look for YAML frontmatter between --- markers
    let lines: Vec<&str> = content.lines().collect();

    if lines.len() < 3 || lines[0] != "---" {
        return Err("No YAML frontmatter found".to_string());
    }

    // Find the end of frontmatter (closing --- after the opening one)
    let end_idx = lines
        .iter()
        .skip(1)
        .position(|&line| line == "---")
        .map(|pos| pos + 1) // +1 because we skipped the first element
        .unwrap_or(0);
    if end_idx < 3 {
        return Err("Invalid frontmatter format".to_string());
    }

    let frontmatter_yaml = lines[1..end_idx].join("\n");
    let _body = lines[end_idx..].join("\n");

    // Simple YAML parsing for the expected format:
    // name: "Plan Name"
    // overview: "Plan description"
    let mut name = String::new();
    let mut overview = String::new();

    for line in frontmatter_yaml.lines() {
        let line = line.trim();
        if line.starts_with("name:") {
            name = line
                .trim_start_matches("name:")
                .trim()
                .trim_matches('"')
                .to_string();
        } else if line.starts_with("overview:") {
            overview = line
                .trim_start_matches("overview:")
                .trim()
                .trim_matches('"')
                .to_string();
        }
    }

    if name.is_empty() {
        return Err("Plan name not found in frontmatter".to_string());
    }

    let frontmatter = PlanFrontmatter { name, overview };

    Ok((frontmatter, _body))
}
