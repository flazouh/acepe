use std::fs;
use std::path::Path;

use super::types::RepoContext;

/// Extracts the GitHub repository context from a remote URL.
/// Returns (owner, repo) tuple from the remote URL.
pub fn parse_github_remote(remote_url: &str) -> Option<(String, String)> {
    if let Some(start) = remote_url.find("github.com") {
        let after_github = &remote_url[start + 10..];

        let path = if after_github.starts_with(':') || after_github.starts_with('/') {
            &after_github[1..]
        } else {
            return None;
        };

        let path = path.trim_end_matches('/').trim_end_matches(".git");
        let parts: Vec<&str> = path.split('/').collect();

        if parts.len() >= 2 {
            return Some((parts[0].to_string(), parts[1].to_string()));
        }
    }

    None
}

fn extract_named_remote_url(config_content: &str, remote_name: &str) -> Option<String> {
    let target_section = format!(r#"[remote "{}"]"#, remote_name);
    let mut in_target_section = false;

    for line in config_content.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_target_section = trimmed == target_section;
            continue;
        }

        if !in_target_section {
            continue;
        }

        let (key, value) = trimmed.split_once('=')?;
        if key.trim() == "url" {
            return Some(value.trim().to_string());
        }
    }

    None
}

/// Reads .git/config and extracts the GitHub remote URL.
pub fn get_repo_context(project_path: &Path) -> Result<RepoContext, String> {
    let git_config_path = project_path.join(".git").join("config");

    if !git_config_path.exists() {
        return Err("Not a git repository".to_string());
    }

    let config_content = fs::read_to_string(&git_config_path)
        .map_err(|e| format!("Failed to read .git/config: {}", e))?;

    let remote_url = extract_named_remote_url(&config_content, "origin")
        .ok_or("Could not find remote.origin.url in .git/config")?;

    let (owner, repo) = parse_github_remote(&remote_url)
        .ok_or("Could not parse GitHub repository from remote URL")?;

    Ok(RepoContext {
        owner,
        repo,
        remote_url,
    })
}

#[cfg(test)]
mod tests {
    use super::parse_github_remote;

    #[test]
    fn parse_github_remote_accepts_https_and_ssh_urls() {
        assert_eq!(
            parse_github_remote("https://github.com/flazouh/acepe.git"),
            Some(("flazouh".to_string(), "acepe".to_string()))
        );
        assert_eq!(
            parse_github_remote("git@github.com:flazouh/acepe.git"),
            Some(("flazouh".to_string(), "acepe".to_string()))
        );
    }

    #[test]
    fn parse_github_remote_rejects_non_github_urls() {
        assert_eq!(parse_github_remote("git@gitlab.com:owner/repo.git"), None);
    }
}
