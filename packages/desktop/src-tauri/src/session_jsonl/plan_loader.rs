use crate::session_jsonl::parser;
use crate::session_jsonl::types::{SessionMessage, SessionPlanResponse};

/// Extract plan from Claude session by reading session messages and finding the slug.
///
/// Sessions can have an associated plan when created in plan mode.
/// The plan file is stored in ~/.claude/plans/{slug}.md where slug
/// is a poetic name stored in the session's JSONL messages.
pub async fn extract_plan_from_claude_session(
    session_id: &str,
    project_path: &str,
) -> Result<Option<SessionPlanResponse>, String> {
    let logger_id = format!(
        "plan_loader_{}",
        session_id.chars().take(8).collect::<String>()
    );
    tracing::info!(
        logger_id = %logger_id,
        session_id = %session_id,
        project_path = %project_path,
        "Extracting plan from Claude session"
    );

    // Step 1: Read session messages to find the slug
    let messages = match parser::read_session_messages(session_id, project_path).await {
        Ok(msgs) => msgs,
        Err(e) => {
            tracing::debug!(
                logger_id = %logger_id,
                session_id = %session_id,
                error = %e,
                "Session file not found or unreadable, no plan to extract"
            );
            return Ok(None);
        }
    };

    // Step 2: Find the slug in messages
    let slug = messages.iter().find_map(|msg| {
        if let SessionMessage::Message(m) = msg {
            m.slug.clone()
        } else {
            None
        }
    });

    let Some(slug) = slug else {
        tracing::info!(
            logger_id = %logger_id,
            session_id = %session_id,
            "No slug found in session messages"
        );
        return Ok(None);
    };

    tracing::info!(
        logger_id = %logger_id,
        session_id = %session_id,
        slug = %slug,
        "Found session slug"
    );

    // Step 3: Load plan file using existing logic
    load_plan_by_slug(&slug).await
}

/// Load a plan file by its slug.
///
/// This is the shared logic used by both get_session_plan and get_plan_by_slug commands.
pub async fn load_plan_by_slug(slug: &str) -> Result<Option<SessionPlanResponse>, String> {
    let logger_id = format!("plan_loader_{}", slug.chars().take(8).collect::<String>());
    tracing::info!(logger_id = %logger_id, slug = %slug, "Loading plan by slug");

    let jsonl_root = parser::get_session_jsonl_root().map_err(|e| e.to_string())?;
    let plan_path = jsonl_root.join("plans").join(format!("{}.md", slug));

    if !plan_path.exists() {
        tracing::info!(
            logger_id = %logger_id,
            slug = %slug,
            plan_path = %plan_path.display(),
            "Plan file does not exist"
        );
        return Ok(None);
    }

    let content = tokio::fs::read_to_string(&plan_path).await.map_err(|e| {
        tracing::error!(
            logger_id = %logger_id,
            slug = %slug,
            error = %e,
            "Failed to read plan file"
        );
        e.to_string()
    })?;

    // Step 4: Extract title and summary from markdown
    let (title, summary) = extract_plan_metadata(&content);

    tracing::info!(
        logger_id = %logger_id,
        slug = %slug,
        title = %title,
        content_len = content.len(),
        "Loaded plan file"
    );

    Ok(Some(SessionPlanResponse {
        slug: slug.to_string(),
        content,
        title,
        summary,
        file_path: Some(plan_path.to_string_lossy().to_string()),
    }))
}

/// Extract title and summary from markdown content.
///
/// Title is the first # heading, summary is the first paragraph after ## Summary.
fn extract_plan_metadata(content: &str) -> (String, Option<String>) {
    let mut title = String::from("Untitled Plan");
    let mut summary: Option<String> = None;
    let mut in_summary_section = false;
    let mut summary_lines = Vec::new();

    for line in content.lines() {
        // Extract title from first # heading
        if title == "Untitled Plan" && line.starts_with("# ") {
            title = line.trim_start_matches("# ").trim().to_string();
            continue;
        }

        // Detect ## Summary section
        if line.starts_with("## Summary") {
            in_summary_section = true;
            continue;
        }

        // End summary section on next heading or separator
        if in_summary_section {
            if line.starts_with("## ") || line.starts_with("---") {
                break;
            }
            if !line.trim().is_empty() {
                summary_lines.push(line.trim());
            }
        }
    }

    if !summary_lines.is_empty() {
        summary = Some(summary_lines.join(" "));
    }

    (title, summary)
}
