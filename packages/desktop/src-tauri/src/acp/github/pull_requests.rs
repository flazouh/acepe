use std::process::{Command, Output};

use super::types::{FileDiff, PrDiff, PrListItem, PrMetadata, RepoContext};

pub fn gh_api_output_is_not_found(output: &Output) -> bool {
    String::from_utf8_lossy(&output.stderr).contains("HTTP 404")
}

pub fn gh_api_output_summary(action: &str, output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let trimmed = stderr.trim();
    if trimmed.is_empty() {
        format!("{action} failed with status {}", output.status)
    } else {
        format!("{action} failed: {trimmed}")
    }
}

pub fn fetch_pr_diff(owner: String, repo: String, pr_number: i32) -> Result<PrDiff, String> {
    let meta_owner = owner.clone();
    let meta_repo = repo.clone();
    let meta_handle = std::thread::spawn(move || {
        Command::new("gh")
            .args([
                "api",
                &format!("repos/{}/{}/pulls/{}", meta_owner, meta_repo, pr_number),
            ])
            .output()
    });

    let files_owner = owner.clone();
    let files_repo = repo.clone();
    let files_handle = std::thread::spawn(move || {
        Command::new("gh")
            .args([
                "api",
                &format!(
                    "repos/{}/{}/pulls/{}/files",
                    files_owner, files_repo, pr_number
                ),
            ])
            .output()
    });

    let pr_output = meta_handle
        .join()
        .map_err(|_| "PR metadata thread panicked".to_string())?
        .map_err(|e| format!("Failed to fetch PR: {}", e))?;
    let files_output = files_handle
        .join()
        .map_err(|_| "PR files thread panicked".to_string())?
        .map_err(|e| format!("Failed to fetch PR files: {}", e))?;

    if !pr_output.status.success() {
        if gh_api_output_is_not_found(&pr_output) {
            return Err("PR not found".to_string());
        }
        return Err(gh_api_output_summary(
            "Failed to fetch PR metadata",
            &pr_output,
        ));
    }

    let pr_json: serde_json::Value = serde_json::from_slice(&pr_output.stdout)
        .map_err(|e| format!("Failed to parse PR response: {}", e))?;

    let title = pr_json["title"]
        .as_str()
        .ok_or("Missing PR title")?
        .to_string();
    let author = pr_json["user"]["login"]
        .as_str()
        .ok_or("Missing PR author")?
        .to_string();
    let state = match pr_json["state"].as_str() {
        Some("open") => "open".to_string(),
        Some("closed") => {
            if pr_json["merged"].as_bool().unwrap_or(false) {
                "merged".to_string()
            } else {
                "closed".to_string()
            }
        }
        _ => "closed".to_string(),
    };
    let description = pr_json["body"].as_str().map(|s| s.to_string());

    let pr_metadata = PrMetadata {
        number: pr_number,
        title,
        author,
        state,
        description,
    };

    let files = if files_output.status.success() {
        if let Ok(files_json) = serde_json::from_slice::<serde_json::Value>(&files_output.stdout) {
            if let Some(files_array) = files_json.as_array() {
                files_array
                    .iter()
                    .filter_map(|f| {
                        Some(FileDiff {
                            path: f["filename"].as_str()?.to_string(),
                            status: f["status"].as_str()?.to_string(),
                            additions: f["additions"].as_i64()? as i32,
                            deletions: f["deletions"].as_i64()? as i32,
                            patch: f["patch"].as_str()?.to_string(),
                        })
                    })
                    .collect()
            } else {
                vec![]
            }
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    Ok(PrDiff {
        pr: pr_metadata,
        files,
        repo_context: RepoContext {
            owner: owner.clone(),
            repo: repo.clone(),
            remote_url: format!("https://github.com/{}/{}", owner, repo),
        },
    })
}

pub fn list_pull_requests(
    owner: String,
    repo: String,
    state: String,
    limit: i32,
) -> Result<Vec<PrListItem>, String> {
    let gh_state = match state.as_str() {
        "open" => "open",
        "closed" => "closed",
        "all" => "all",
        _ => "open",
    };

    let output = Command::new("gh")
        .args([
            "api",
            &format!(
                "repos/{}/{}/pulls?state={}&per_page={}&sort=updated&direction=desc",
                owner, repo, gh_state, limit
            ),
        ])
        .output()
        .map_err(|e| format!("Failed to run gh api: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to list pull requests: {}", stderr));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse PR list response: {}", e))?;

    let prs = json
        .as_array()
        .ok_or("Expected array response from GitHub API")?;

    let items: Vec<PrListItem> = prs
        .iter()
        .filter_map(|pr| {
            let state_str = match pr["state"].as_str()? {
                "open" => "open",
                "closed" if pr["merged_at"].is_string() => "merged",
                "closed" => "closed",
                _ => "closed",
            };

            Some(PrListItem {
                number: pr["number"].as_i64()? as i32,
                title: pr["title"].as_str()?.to_string(),
                author: pr["user"]["login"].as_str()?.to_string(),
                state: state_str.to_string(),
                head_ref: pr["head"]["ref"].as_str()?.to_string(),
                base_ref: pr["base"]["ref"].as_str()?.to_string(),
                updated_at: pr["updated_at"].as_str()?.to_string(),
                additions: pr["additions"].as_i64().unwrap_or(0) as i32,
                deletions: pr["deletions"].as_i64().unwrap_or(0) as i32,
                changed_files: pr["changed_files"].as_i64().unwrap_or(0) as i32,
            })
        })
        .collect();

    Ok(items)
}
