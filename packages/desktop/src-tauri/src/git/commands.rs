use std::path::{Path, PathBuf};
use std::process::Command;

use crate::commands::observability::{
    unexpected_command_result, CommandResult, SerializableCommandError,
};
use crate::git::{operations, text_generation};

/// Result of a successful git clone operation
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct CloneResult {
    /// The path where the repository was cloned
    pub path: String,
    /// The name of the repository (extracted from path)
    pub name: String,
}

/// Clone a git repository to a destination folder
#[tauri::command]
#[specta::specta]
pub async fn git_clone(
    url: String,
    destination: String,
    branch: Option<String>,
) -> CommandResult<CloneResult> {
    if !url.starts_with("https://") && !url.starts_with("git@") && !url.starts_with("http://") {
        return Err(SerializableCommandError::expected(
            "git_clone",
            "Invalid repository URL format. URL must start with https://, http://, or git@",
        ));
    }

    if Path::new(&destination).exists() {
        return Err(SerializableCommandError::expected(
            "git_clone",
            format!("Destination folder already exists: {}", destination),
        ));
    }

    unexpected_command_result(
        "git_clone",
        "Git clone failed",
        async {
            tracing::info!(
                url = %url,
                destination = %destination,
                branch = ?branch,
                "Cloning git repository"
            );

            // Build git clone command
            let mut cmd = Command::new("git");
            cmd.arg("clone");

            // Add branch argument if specified
            if let Some(ref branch_name) = branch {
                if !branch_name.is_empty() {
                    cmd.arg("--branch").arg(branch_name);
                }
            }

            cmd.arg(&url).arg(&destination);

            tracing::debug!(command = ?cmd, "Executing git clone");

            // Execute git clone
            let output = cmd.output().map_err(|e| {
                tracing::error!(error = %e, "Failed to execute git command");
                format!("Failed to execute git: {}. Is git installed?", e)
            })?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                tracing::error!(stderr = %stderr, "Git clone failed");
                return Err(format!("Git clone failed: {}", stderr.trim()));
            }

            // Extract repository name from destination path
            let name = Path::new(&destination)
                .file_name()
                .and_then(|n| n.to_str())
                .map(capitalize_name)
                .unwrap_or_else(|| "repository".to_string());

            tracing::info!(
                path = %destination,
                name = %name,
                "Repository cloned successfully"
            );

            Ok(CloneResult {
                path: destination,
                name,
            })
        }
        .await,
    )
}

/// Browse for a destination folder using native file dialog
#[tauri::command]
#[specta::specta]
pub async fn browse_clone_destination() -> CommandResult<Option<String>> {
    unexpected_command_result(
        "browse_clone_destination",
        "Failed to browse for clone destination",
        async {
            use rfd::AsyncFileDialog;

            tracing::debug!("Opening folder picker for clone destination");

            let folder = AsyncFileDialog::new()
                .set_title("Select Destination Folder")
                .pick_folder()
                .await;

            match folder {
                Some(folder_path) => {
                    let path_str = folder_path.path().to_string_lossy().to_string();
                    tracing::info!(path = %path_str, "Destination folder selected");
                    Ok(Some(path_str))
                }
                None => {
                    tracing::debug!("Folder selection cancelled");
                    Ok(None)
                }
            }
        }
        .await,
    )
}

/// Capitalize the first letter of each word in a string.
fn capitalize_name(name: &str) -> String {
    name.split(&[' ', '_', '-'][..])
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => {
                    first.to_uppercase().collect::<String>()
                        + chars.as_str().to_lowercase().as_str()
                }
            }
        })
        .collect::<Vec<String>>()
        .join(" ")
}

// ─── Ship Context ───────────────────────────────────────────────────────────

/// Context returned to the frontend for AI generation via the ShipCard.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ShipContext {
    /// The full prompt to send to the ACP agent.
    pub prompt: String,
    /// Current git branch name.
    pub branch: String,
    /// Summary of staged files (name-status).
    pub staged_summary: String,
}

fn build_ship_context(
    branch: &str,
    context: &operations::StagedContext,
    custom_instructions: Option<&str>,
) -> ShipContext {
    let prompt = text_generation::build_ship_prompt(branch, context, custom_instructions);
    ShipContext {
        prompt,
        branch: branch.to_string(),
        staged_summary: context.summary.clone(),
    }
}

/// Collect staged diff context and build the AI generation prompt.
/// Returns None if nothing is staged.
#[tauri::command]
#[specta::specta]
pub async fn git_collect_ship_context(
    project_path: String,
    custom_instructions: Option<String>,
) -> CommandResult<Option<ShipContext>> {
    let path = PathBuf::from(&project_path);
    if !path.exists() {
        return Err(SerializableCommandError::expected(
            "git_collect_ship_context",
            format!("Path does not exist: {}", project_path),
        ));
    }

    unexpected_command_result(
        "git_collect_ship_context",
        "Failed to collect ship context",
        async {
            let branch = crate::git::worktree::get_current_branch(&path).map_err(|error| {
                if error.contains("Failed to get current branch") {
                    format!("Path is not a git repository: {}", project_path)
                } else {
                    error
                }
            })?;
            let staged = operations::collect_staged_context(&path).await?;
            Ok(staged.map(|ctx| build_ship_context(&branch, &ctx, custom_instructions.as_deref())))
        }
        .await,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::operations::StagedContext;

    #[test]
    fn test_capitalize_name() {
        assert_eq!(capitalize_name("my-project"), "My Project");
        assert_eq!(capitalize_name("my_project"), "My Project");
        assert_eq!(capitalize_name("myproject"), "Myproject");
        assert_eq!(capitalize_name("MY-PROJECT"), "My Project");
    }

    #[test]
    fn build_ship_context_uses_custom_instructions_in_prompt() {
        let context = StagedContext {
            summary: "M\tsrc/lib.rs".to_string(),
            patch: "diff --git a/src/lib.rs b/src/lib.rs".to_string(),
        };

        let ship_context = build_ship_context(
            "feature/custom-prompt",
            &context,
            Some("Custom prompt instructions"),
        );

        assert!(
            ship_context
                .prompt
                .starts_with("Custom prompt instructions"),
            "expected prompt to start with custom instructions"
        );
        assert!(
            !ship_context
                .prompt
                .contains(text_generation::DEFAULT_SHIP_INSTRUCTIONS),
            "expected custom instructions to replace the default template"
        );
        assert!(ship_context
            .prompt
            .contains("Current branch: feature/custom-prompt"));
    }
}
