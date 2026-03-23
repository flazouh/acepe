/**
 * GitHub Issues integration commands for Tauri.
 * Provides CRUD operations for GitHub Issues as a projection layer.
 * Uses `gh` CLI for authenticated operations, `reqwest` for unauthenticated reads.
 */
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Command, Stdio};

// ─── Data structures ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct AuthStatus {
    pub authenticated: bool,
    pub username: Option<String>,
    pub gh_installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct GitHubUser {
    pub login: String,
    pub avatar_url: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct GitHubLabel {
    pub name: String,
    pub color: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct GitHubReactions {
    pub plus1: i32,
    pub minus1: i32,
    pub heart: i32,
    pub rocket: i32,
    pub eyes: i32,
    pub total_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct GitHubIssue {
    pub number: i32,
    pub title: String,
    pub body: String,
    pub state: String,
    pub labels: Vec<GitHubLabel>,
    pub author: GitHubUser,
    pub comments_count: i32,
    pub reactions: GitHubReactions,
    pub created_at: String,
    pub updated_at: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct GitHubComment {
    pub id: i64,
    pub body: String,
    pub author: GitHubUser,
    pub reactions: GitHubReactions,
    pub created_at: String,
    pub updated_at: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(crate = "serde", rename_all = "camelCase")]
pub struct IssueListResult {
    pub items: Vec<GitHubIssue>,
    pub total_count: Option<i32>,
    pub has_next_page: bool,
}

// ─── JSON parsing helpers ──────────────────────────────────────────

fn parse_user(json: &serde_json::Value) -> Option<GitHubUser> {
    Some(GitHubUser {
        login: json["login"].as_str()?.to_string(),
        avatar_url: json["avatar_url"].as_str().unwrap_or("").to_string(),
        html_url: json["html_url"].as_str().unwrap_or("").to_string(),
    })
}

fn parse_reactions(json: &serde_json::Value) -> GitHubReactions {
    GitHubReactions {
        plus1: json["+1"].as_i64().unwrap_or(0) as i32,
        minus1: json["-1"].as_i64().unwrap_or(0) as i32,
        heart: json["heart"].as_i64().unwrap_or(0) as i32,
        rocket: json["rocket"].as_i64().unwrap_or(0) as i32,
        eyes: json["eyes"].as_i64().unwrap_or(0) as i32,
        total_count: json["total_count"].as_i64().unwrap_or(0) as i32,
    }
}

fn parse_labels(json: &serde_json::Value) -> Vec<GitHubLabel> {
    json.as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|l| {
                    Some(GitHubLabel {
                        name: l["name"].as_str()?.to_string(),
                        color: l["color"].as_str().unwrap_or("").to_string(),
                        description: l["description"].as_str().map(|s| s.to_string()),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_issue(json: &serde_json::Value) -> Option<GitHubIssue> {
    // Filter out pull requests (they appear in /issues endpoint)
    if json.get("pull_request").is_some() {
        return None;
    }

    Some(GitHubIssue {
        number: json["number"].as_i64()? as i32,
        title: json["title"].as_str()?.to_string(),
        body: json["body"].as_str().unwrap_or("").to_string(),
        state: json["state"].as_str().unwrap_or("open").to_string(),
        labels: parse_labels(&json["labels"]),
        author: parse_user(&json["user"])?,
        comments_count: json["comments"].as_i64().unwrap_or(0) as i32,
        reactions: parse_reactions(&json["reactions"]),
        created_at: json["created_at"].as_str().unwrap_or("").to_string(),
        updated_at: json["updated_at"].as_str().unwrap_or("").to_string(),
        html_url: json["html_url"].as_str().unwrap_or("").to_string(),
    })
}

fn parse_comment(json: &serde_json::Value) -> Option<GitHubComment> {
    Some(GitHubComment {
        id: json["id"].as_i64()?,
        body: json["body"].as_str().unwrap_or("").to_string(),
        author: parse_user(&json["user"])?,
        reactions: parse_reactions(&json["reactions"]),
        created_at: json["created_at"].as_str().unwrap_or("").to_string(),
        updated_at: json["updated_at"].as_str().unwrap_or("").to_string(),
        html_url: json["html_url"].as_str().unwrap_or("").to_string(),
    })
}

// ─── gh CLI helpers ────────────────────────────────────────────────

fn gh_api_get(endpoint: &str) -> Result<serde_json::Value, String> {
    let output = Command::new("gh")
        .args(["api", endpoint])
        .output()
        .map_err(|e| format!("Failed to run gh api: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(parse_gh_error(&stderr, output.status.code()));
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse GitHub API response: {}", e))
}

fn gh_api_post(endpoint: &str, body: &serde_json::Value) -> Result<serde_json::Value, String> {
    let mut child = Command::new("gh")
        .args(["api", endpoint, "-X", "POST", "--input", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn gh: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(body.to_string().as_bytes())
            .map_err(|e| format!("Failed to write to gh stdin: {}", e))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("gh command failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(parse_gh_error(&stderr, output.status.code()));
    }

    serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse GitHub API response: {}", e))
}

fn gh_api_delete(endpoint: &str) -> Result<(), String> {
    let output = Command::new("gh")
        .args(["api", "--method", "DELETE", endpoint])
        .output()
        .map_err(|e| format!("Failed to run gh api: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(parse_gh_error(&stderr, output.status.code()));
    }

    Ok(())
}

/// Check if gh api response has a next page by inspecting Link header.
/// We use `--include` to get headers, then check for `rel="next"`.
fn gh_api_get_with_pagination(endpoint: &str) -> Result<(serde_json::Value, bool), String> {
    let output = Command::new("gh")
        .args(["api", "--include", endpoint])
        .output()
        .map_err(|e| format!("Failed to run gh api: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(parse_gh_error(&stderr, output.status.code()));
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|e| format!("Invalid UTF-8 in gh output: {}", e))?;

    // gh --include outputs headers first, then a blank line, then the JSON body
    let (headers, body) = stdout
        .split_once("\r\n\r\n")
        .or_else(|| stdout.split_once("\n\n"))
        .unwrap_or(("", &stdout));

    let has_next = headers.contains("rel=\"next\"");

    let json: serde_json::Value = serde_json::from_str(body)
        .map_err(|e| format!("Failed to parse GitHub API response: {}", e))?;

    Ok((json, has_next))
}

fn parse_gh_error(stderr: &str, exit_code: Option<i32>) -> String {
    if stderr.contains("HTTP 401") || exit_code == Some(4) {
        "GitHub authentication required. Run 'gh auth login' to authenticate.".to_string()
    } else if stderr.contains("rate limit") || stderr.contains("HTTP 403") {
        "GitHub API rate limit exceeded. Please try again later.".to_string()
    } else if stderr.contains("HTTP 404") {
        "Not found on GitHub.".to_string()
    } else {
        format!("GitHub API error: {}", stderr.trim())
    }
}

// ─── reqwest fallback for unauthenticated reads ────────────────────

async fn http_get(url: &str) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .header("User-Agent", "acepe-desktop")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if status.as_u16() == 403 && body.contains("rate limit") {
            return Err("GitHub API rate limit exceeded. Sign in with 'gh auth login' for higher limits.".to_string());
        }
        return Err(format!("GitHub API error: {} {}", status, body));
    }

    resp.json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}

async fn http_get_with_pagination(url: &str) -> Result<(serde_json::Value, bool), String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .header("User-Agent", "acepe-desktop")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub API error: {} {}", status, body));
    }

    let has_next = resp
        .headers()
        .get("link")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.contains("rel=\"next\""))
        .unwrap_or(false);

    let json = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok((json, has_next))
}

// ─── Auth check ────────────────────────────────────────────────────

fn check_auth() -> AuthStatus {
    // Check gh installed
    let gh_check = Command::new("gh").arg("--version").output();
    if gh_check.is_err() {
        return AuthStatus {
            authenticated: false,
            username: None,
            gh_installed: false,
        };
    }

    // Check auth token exists
    let auth_check = Command::new("gh")
        .args(["auth", "token"])
        .output();

    match auth_check {
        Ok(output) if output.status.success() => {
            // Get username via gh api
            let user_output = Command::new("gh")
                .args(["api", "user", "--jq", ".login"])
                .output();
            let username = user_output
                .ok()
                .filter(|o| o.status.success())
                .and_then(|o| String::from_utf8(o.stdout).ok())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            AuthStatus {
                authenticated: true,
                username,
                gh_installed: true,
            }
        }
        _ => AuthStatus {
            authenticated: false,
            username: None,
            gh_installed: true,
        },
    }
}

// ─── Tauri commands ────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn check_github_auth() -> AuthStatus {
    check_auth()
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn list_github_issues(
    owner: String,
    repo: String,
    state: Option<String>,
    labels: Option<String>,
    sort: Option<String>,
    direction: Option<String>,
    page: Option<i32>,
    per_page: Option<i32>,
) -> Result<IssueListResult, String> {
    let state_param = state.as_deref().unwrap_or("open");
    let sort_param = sort.as_deref().unwrap_or("created");
    let direction_param = direction.as_deref().unwrap_or("desc");
    let page_param = page.unwrap_or(1);
    let per_page_param = per_page.unwrap_or(30);

    let mut query = format!(
        "repos/{}/{}/issues?state={}&sort={}&direction={}&page={}&per_page={}",
        owner, repo, state_param, sort_param, direction_param, page_param, per_page_param
    );

    if let Some(ref label_str) = labels {
        if !label_str.is_empty() {
            query.push_str(&format!("&labels={}", label_str));
        }
    }

    // Try gh CLI first (authenticated), fall back to reqwest (unauthenticated)
    let (json, has_next) = if check_auth().authenticated {
        gh_api_get_with_pagination(&query)?
    } else {
        let url = format!("https://api.github.com/{}", query);
        http_get_with_pagination(&url).await?
    };

    let items = json
        .as_array()
        .ok_or("Expected array response from GitHub API")?
        .iter()
        .filter_map(parse_issue)
        .collect();

    Ok(IssueListResult {
        items,
        total_count: None, // list endpoint doesn't provide total_count
        has_next_page: has_next,
    })
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn search_github_issues(
    owner: String,
    repo: String,
    query: String,
    state: Option<String>,
    labels: Option<String>,
    sort: Option<String>,
    page: Option<i32>,
    per_page: Option<i32>,
) -> Result<IssueListResult, String> {
    let page_param = page.unwrap_or(1);
    let per_page_param = per_page.unwrap_or(30);

    // Build search query
    let mut q = format!("repo:{}/{} is:issue", owner, repo);
    if let Some(ref state_str) = state {
        if state_str == "open" || state_str == "closed" {
            q.push_str(&format!(" is:{}", state_str));
        }
    } else {
        q.push_str(" is:open");
    }
    if let Some(ref label_str) = labels {
        for label in label_str.split(',') {
            let label = label.trim();
            if !label.is_empty() {
                q.push_str(&format!(" label:{}", label));
            }
        }
    }
    q.push_str(&format!(" {}", query));

    let sort_param = sort.as_deref().unwrap_or("");
    let mut endpoint = format!(
        "search/issues?q={}&page={}&per_page={}",
        urlencoding::encode(&q),
        page_param,
        per_page_param
    );
    if !sort_param.is_empty() {
        endpoint.push_str(&format!("&sort={}", sort_param));
    }

    // Try gh CLI first, fall back to reqwest
    let json = if check_auth().authenticated {
        gh_api_get(&endpoint)?
    } else {
        let url = format!("https://api.github.com/{}", endpoint);
        http_get(&url).await?
    };

    let total_count = json["total_count"].as_i64().map(|n| n as i32);
    let items = json["items"]
        .as_array()
        .ok_or("Expected items array in search response")?
        .iter()
        .filter_map(parse_issue)
        .collect::<Vec<_>>();

    let has_next = total_count
        .map(|tc| (page_param * per_page_param) < tc)
        .unwrap_or(false);

    Ok(IssueListResult {
        items,
        total_count,
        has_next_page: has_next,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn get_github_issue(
    owner: String,
    repo: String,
    number: i32,
) -> Result<GitHubIssue, String> {
    let endpoint = format!("repos/{}/{}/issues/{}", owner, repo, number);

    let json = if check_auth().authenticated {
        gh_api_get(&endpoint)?
    } else {
        let url = format!("https://api.github.com/{}", endpoint);
        http_get(&url).await?
    };

    parse_issue(&json).ok_or_else(|| "Failed to parse issue".to_string())
}

#[tauri::command]
#[specta::specta]
pub fn create_github_issue(
    owner: String,
    repo: String,
    title: String,
    body: String,
    labels: Option<Vec<String>>,
) -> Result<GitHubIssue, String> {
    let mut payload = serde_json::json!({
        "title": title,
        "body": body,
    });

    if let Some(label_list) = labels {
        payload["labels"] = serde_json::json!(label_list);
    }

    let endpoint = format!("repos/{}/{}/issues", owner, repo);
    let json = gh_api_post(&endpoint, &payload)?;
    parse_issue(&json).ok_or_else(|| "Failed to parse created issue".to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn list_issue_comments(
    owner: String,
    repo: String,
    number: i32,
    page: Option<i32>,
    per_page: Option<i32>,
) -> Result<Vec<GitHubComment>, String> {
    let page_param = page.unwrap_or(1);
    let per_page_param = per_page.unwrap_or(100);

    let endpoint = format!(
        "repos/{}/{}/issues/{}/comments?page={}&per_page={}",
        owner, repo, number, page_param, per_page_param
    );

    let json = if check_auth().authenticated {
        gh_api_get(&endpoint)?
    } else {
        let url = format!("https://api.github.com/{}", endpoint);
        http_get(&url).await?
    };

    let comments = json
        .as_array()
        .ok_or("Expected array response")?
        .iter()
        .filter_map(parse_comment)
        .collect();

    Ok(comments)
}

#[tauri::command]
#[specta::specta]
pub fn create_issue_comment(
    owner: String,
    repo: String,
    number: i32,
    body: String,
) -> Result<GitHubComment, String> {
    let payload = serde_json::json!({ "body": body });
    let endpoint = format!("repos/{}/{}/issues/{}/comments", owner, repo, number);
    let json = gh_api_post(&endpoint, &payload)?;
    parse_comment(&json).ok_or_else(|| "Failed to parse created comment".to_string())
}

#[tauri::command]
#[specta::specta]
pub fn toggle_issue_reaction(
    owner: String,
    repo: String,
    number: i32,
    content: String,
) -> Result<bool, String> {
    let endpoint = format!("repos/{}/{}/issues/{}/reactions", owner, repo, number);

    // Get existing reactions to check if user already reacted
    let reactions_json = gh_api_get(&endpoint)?;
    let reactions = reactions_json
        .as_array()
        .ok_or("Expected array of reactions")?;

    // Get current user login
    let user_output = Command::new("gh")
        .args(["api", "user", "--jq", ".login"])
        .output()
        .map_err(|e| format!("Failed to get current user: {}", e))?;
    let current_user = String::from_utf8(user_output.stdout)
        .map_err(|_| "Invalid user response".to_string())?
        .trim()
        .to_string();

    // Find existing reaction from current user with matching content
    let existing = reactions.iter().find(|r| {
        r["user"]["login"].as_str() == Some(&current_user) && r["content"].as_str() == Some(&content)
    });

    if let Some(reaction) = existing {
        // Remove existing reaction
        let reaction_id = reaction["id"]
            .as_i64()
            .ok_or("Missing reaction ID")?;
        let delete_endpoint = format!(
            "repos/{}/{}/issues/{}/reactions/{}",
            owner, repo, number, reaction_id
        );
        gh_api_delete(&delete_endpoint)?;
        Ok(false) // reaction removed
    } else {
        // Add new reaction
        let payload = serde_json::json!({ "content": content });
        gh_api_post(&endpoint, &payload)?;
        Ok(true) // reaction added
    }
}

#[tauri::command]
#[specta::specta]
pub fn toggle_comment_reaction(
    owner: String,
    repo: String,
    comment_id: i64,
    content: String,
) -> Result<bool, String> {
    let endpoint = format!(
        "repos/{}/{}/issues/comments/{}/reactions",
        owner, repo, comment_id
    );

    let reactions_json = gh_api_get(&endpoint)?;
    let reactions = reactions_json
        .as_array()
        .ok_or("Expected array of reactions")?;

    let user_output = Command::new("gh")
        .args(["api", "user", "--jq", ".login"])
        .output()
        .map_err(|e| format!("Failed to get current user: {}", e))?;
    let current_user = String::from_utf8(user_output.stdout)
        .map_err(|_| "Invalid user response".to_string())?
        .trim()
        .to_string();

    let existing = reactions.iter().find(|r| {
        r["user"]["login"].as_str() == Some(&current_user) && r["content"].as_str() == Some(&content)
    });

    if let Some(reaction) = existing {
        let reaction_id = reaction["id"]
            .as_i64()
            .ok_or("Missing reaction ID")?;
        let delete_endpoint = format!(
            "repos/{}/{}/issues/comments/{}/reactions/{}",
            owner, repo, comment_id, reaction_id
        );
        gh_api_delete(&delete_endpoint)?;
        Ok(false)
    } else {
        let payload = serde_json::json!({ "content": content });
        gh_api_post(&endpoint, &payload)?;
        Ok(true)
    }
}
