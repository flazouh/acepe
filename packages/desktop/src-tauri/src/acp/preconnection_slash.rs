use crate::acp::session_update::AvailableCommand;
use crate::skills::parser::parse_skill_content;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub async fn load_preconnection_commands_from_root(
    root: &Path,
) -> Result<Vec<AvailableCommand>, String> {
    load_preconnection_commands_from_roots(&[root.to_path_buf()]).await
}

pub async fn load_preconnection_commands_from_flat_markdown_root(
    root: &Path,
) -> Result<Vec<AvailableCommand>, String> {
    let entries = load_flat_markdown_entries_from_root(root).await?;
    Ok(dedupe_preconnection_commands(entries))
}

pub async fn load_preconnection_commands_from_roots(
    roots: &[PathBuf],
) -> Result<Vec<AvailableCommand>, String> {
    let mut commands = Vec::new();
    let mut seen_names = HashSet::new();

    for root in roots {
        let skill_entries = match load_skill_entries_from_root(root).await {
            Ok(entries) => entries,
            Err(error) => {
                tracing::warn!(
                    root = %root.display(),
                    error = %error,
                    "Skipping unreadable provider-owned preconnection root"
                );
                continue;
            }
        };
        for entry in skill_entries {
            if !seen_names.insert(entry.name.clone()) {
                tracing::warn!(
                    command_name = %entry.name,
                    skill_path = %entry.path.display(),
                    "Skipping duplicate provider-owned preconnection command"
                );
                continue;
            }

            commands.push(AvailableCommand {
                name: entry.name,
                description: entry.description,
                input: None,
            });
        }
    }

    Ok(commands)
}

pub fn dedupe_preconnection_commands(
    commands: impl IntoIterator<Item = AvailableCommand>,
) -> Vec<AvailableCommand> {
    let mut deduped = Vec::new();
    let mut seen_names = HashSet::new();

    for command in commands {
        if !seen_names.insert(command.name.clone()) {
            tracing::warn!(
                command_name = %command.name,
                "Skipping duplicate provider-owned preconnection command"
            );
            continue;
        }

        deduped.push(command);
    }

    deduped
}

#[derive(Debug, Clone)]
struct SkillEntry {
    name: String,
    description: String,
    path: PathBuf,
}

async fn load_skill_entries_from_root(root: &Path) -> Result<Vec<SkillEntry>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut entries = tokio::fs::read_dir(root)
        .await
        .map_err(|error| format!("Failed to read preconnection slash directory: {}", error))?;
    let mut dir_entries = Vec::new();

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| format!("Failed to read preconnection slash entry: {}", error))?
    {
        dir_entries.push(entry);
    }

    dir_entries.sort_by_key(|entry| entry.file_name());

    let mut skill_entries = Vec::new();

    for entry in dir_entries {
        let folder_path = entry.path();
        if !folder_path.is_dir() {
            continue;
        }

        let folder_name = folder_path
            .file_name()
            .and_then(|segment| segment.to_str())
            .unwrap_or("")
            .to_string();
        if folder_name.starts_with('.') {
            continue;
        }

        let skill_md_path = folder_path.join("SKILL.md");
        if !skill_md_path.exists() {
            continue;
        }

        let content = match tokio::fs::read_to_string(&skill_md_path).await {
            Ok(content) => content,
            Err(error) => {
                tracing::warn!(
                    skill_path = %skill_md_path.display(),
                    error = %error,
                    "Skipping unreadable provider-owned preconnection skill"
                );
                continue;
            }
        };

        let metadata = match parse_skill_content(&content) {
            Ok((metadata, _body)) => metadata,
            Err(error) => {
                tracing::warn!(
                    skill_path = %skill_md_path.display(),
                    error = %error,
                    "Skipping invalid provider-owned preconnection skill"
                );
                continue;
            }
        };

        skill_entries.push(SkillEntry {
            name: metadata.name,
            description: metadata.description,
            path: skill_md_path,
        });
    }

    Ok(skill_entries)
}

async fn load_flat_markdown_entries_from_root(root: &Path) -> Result<Vec<AvailableCommand>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut entries = tokio::fs::read_dir(root)
        .await
        .map_err(|error| format!("Failed to read preconnection slash directory: {}", error))?;
    let mut dir_entries = Vec::new();

    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| format!("Failed to read preconnection slash entry: {}", error))?
    {
        dir_entries.push(entry);
    }

    dir_entries.sort_by_key(|entry| entry.file_name());

    let mut commands = Vec::new();

    for entry in dir_entries {
        let path = entry.path();
        if path.is_dir() {
            continue;
        }

        let file_name = path
            .file_name()
            .and_then(|segment| segment.to_str())
            .unwrap_or("")
            .to_string();
        if file_name.starts_with('.') || !file_name.ends_with(".agent.md") {
            continue;
        }

        let content = match tokio::fs::read_to_string(&path).await {
            Ok(content) => content,
            Err(error) => {
                tracing::warn!(
                    agent_path = %path.display(),
                    error = %error,
                    "Skipping unreadable provider-owned preconnection agent"
                );
                continue;
            }
        };

        let command = match parse_flat_agent_command(&content, &path) {
            Ok(command) => command,
            Err(error) => {
                tracing::warn!(
                    agent_path = %path.display(),
                    error = %error,
                    "Skipping invalid provider-owned preconnection agent"
                );
                continue;
            }
        };

        commands.push(command);
    }

    Ok(commands)
}

fn parse_flat_agent_command(content: &str, path: &Path) -> Result<AvailableCommand, String> {
    let command_name = agent_name_from_path(path)?;

    match parse_skill_content(content) {
        Ok((metadata, _body)) => {
            return Ok(AvailableCommand {
                name: command_name,
                description: metadata.description,
                input: None,
            })
        }
        Err(error) if error.contains("Required field 'name'") => {}
        Err(error) => return Err(error),
    }

    let frontmatter = extract_frontmatter(content)?;
    let mut description: Option<String> = None;

    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("description:") {
            description = Some(extract_yaml_value(trimmed, "description:"));
        }
    }

    let description =
        description.ok_or("Required field 'description' not found in frontmatter".to_string())?;

    Ok(AvailableCommand {
        name: command_name,
        description,
        input: None,
    })
}

fn extract_frontmatter(content: &str) -> Result<String, String> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() || lines[0] != "---" {
        return Err("No YAML frontmatter found. Agent files must start with ---".to_string());
    }

    let end_idx = lines
        .iter()
        .skip(1)
        .position(|line| *line == "---")
        .map(|position| position + 1)
        .ok_or("Invalid frontmatter: missing closing ---".to_string())?;

    if end_idx < 2 {
        return Err("Invalid frontmatter format".to_string());
    }

    Ok(lines[1..end_idx].join("\n"))
}

fn extract_yaml_value(line: &str, prefix: &str) -> String {
    line.trim_start_matches(prefix)
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

fn agent_name_from_path(path: &Path) -> Result<String, String> {
    let file_name = path
        .file_name()
        .and_then(|segment| segment.to_str())
        .ok_or("Agent filename is missing".to_string())?;

    if let Some(name) = file_name.strip_suffix(".agent.md") {
        return Ok(name.to_string());
    }

    Err(format!(
        "Agent filename must end with .agent.md: {}",
        path.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn skill_file_content(name: &str, description: &str) -> String {
        format!(
            "---\nname: \"{}\"\ndescription: \"{}\"\n---\n\n# {}\n",
            name, description, name
        )
    }

    #[tokio::test]
    async fn load_preconnection_commands_from_root_skips_invalid_siblings() {
        let temp = tempdir().expect("temp dir");
        let valid_dir = temp.path().join("valid-skill");
        let invalid_dir = temp.path().join("invalid-skill");
        let hidden_dir = temp.path().join(".hidden-skill");

        tokio::fs::create_dir_all(&valid_dir)
            .await
            .expect("create valid dir");
        tokio::fs::create_dir_all(&invalid_dir)
            .await
            .expect("create invalid dir");
        tokio::fs::create_dir_all(&hidden_dir)
            .await
            .expect("create hidden dir");
        tokio::fs::write(
            valid_dir.join("SKILL.md"),
            skill_file_content("ce:review", "Review changes"),
        )
        .await
        .expect("write valid skill");
        tokio::fs::write(invalid_dir.join("SKILL.md"), "# missing frontmatter")
            .await
            .expect("write invalid skill");
        tokio::fs::write(
            hidden_dir.join("SKILL.md"),
            skill_file_content("ce:hidden", "Hidden skill"),
        )
        .await
        .expect("write hidden skill");

        let commands = load_preconnection_commands_from_root(temp.path())
            .await
            .expect("load commands");

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "ce:review");
        assert_eq!(commands[0].description, "Review changes");
        assert!(commands[0].input.is_none());
    }

    #[tokio::test]
    async fn load_preconnection_commands_from_roots_dedupes_duplicate_names() {
        let temp = tempdir().expect("temp dir");
        let primary_root = temp.path().join("primary");
        let secondary_root = temp.path().join("secondary");
        let primary_skill = primary_root.join("ce-plan");
        let secondary_skill = secondary_root.join("ce-plan-duplicate");

        tokio::fs::create_dir_all(&primary_skill)
            .await
            .expect("create primary skill dir");
        tokio::fs::create_dir_all(&secondary_skill)
            .await
            .expect("create secondary skill dir");
        tokio::fs::write(
            primary_skill.join("SKILL.md"),
            skill_file_content("ce:plan", "Plan implementation"),
        )
        .await
        .expect("write primary skill");
        tokio::fs::write(
            secondary_skill.join("SKILL.md"),
            skill_file_content("ce:plan", "Duplicate plan"),
        )
        .await
        .expect("write secondary skill");

        let commands = load_preconnection_commands_from_roots(&[primary_root, secondary_root])
            .await
            .expect("load commands");

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "ce:plan");
        assert_eq!(commands[0].description, "Plan implementation");
        assert!(commands[0].input.is_none());
    }

    #[tokio::test]
    async fn load_preconnection_commands_from_roots_skips_unreadable_root_and_keeps_fallback() {
        let temp = tempdir().expect("temp dir");
        let unreadable_root = temp.path().join("not-a-directory");
        let fallback_root = temp.path().join("fallback");
        let fallback_skill = fallback_root.join("ce-review");

        tokio::fs::write(&unreadable_root, "not a directory")
            .await
            .expect("write unreadable root placeholder");
        tokio::fs::create_dir_all(&fallback_skill)
            .await
            .expect("create fallback skill dir");
        tokio::fs::write(
            fallback_skill.join("SKILL.md"),
            skill_file_content("ce:review", "Review changes"),
        )
        .await
        .expect("write fallback skill");

        let commands = load_preconnection_commands_from_roots(&[unreadable_root, fallback_root])
            .await
            .expect("load commands");

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "ce:review");
        assert_eq!(commands[0].description, "Review changes");
        assert!(commands[0].input.is_none());
    }

    #[tokio::test]
    async fn load_preconnection_commands_from_flat_markdown_root_reads_agent_files() {
        let temp = tempdir().expect("temp dir");
        let agent_path = temp.path().join("security-auditor.agent.md");
        let ignored_path = temp.path().join("README.md");

        tokio::fs::write(
            &agent_path,
            skill_file_content("security-auditor", "Review security-sensitive changes"),
        )
        .await
        .expect("write agent file");
        tokio::fs::write(&ignored_path, "# not an agent")
            .await
            .expect("write ignored markdown file");

        let commands = load_preconnection_commands_from_flat_markdown_root(temp.path())
            .await
            .expect("load commands");

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "security-auditor");
        assert_eq!(commands[0].description, "Review security-sensitive changes");
        assert!(commands[0].input.is_none());
    }

    #[tokio::test]
    async fn load_preconnection_commands_from_flat_markdown_root_falls_back_to_filename_when_name_missing() {
        let temp = tempdir().expect("temp dir");
        let agent_path = temp.path().join("security-auditor.agent.md");

        tokio::fs::write(
            &agent_path,
            "---\ndescription: \"Review security-sensitive changes\"\n---\n\n# Security\n",
        )
        .await
        .expect("write agent file");

        let commands = load_preconnection_commands_from_flat_markdown_root(temp.path())
            .await
            .expect("load commands");

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "security-auditor");
        assert_eq!(commands[0].description, "Review security-sensitive changes");
        assert!(commands[0].input.is_none());
    }

    #[tokio::test]
    async fn load_preconnection_commands_from_flat_markdown_root_uses_filename_when_name_differs() {
        let temp = tempdir().expect("temp dir");
        let agent_path = temp.path().join("security-auditor.agent.md");

        tokio::fs::write(
            &agent_path,
            skill_file_content("Security Reviewer", "Review security-sensitive changes"),
        )
        .await
        .expect("write agent file");

        let commands = load_preconnection_commands_from_flat_markdown_root(temp.path())
            .await
            .expect("load commands");

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].name, "security-auditor");
        assert_eq!(commands[0].description, "Review security-sensitive changes");
        assert!(commands[0].input.is_none());
    }
}
