use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use super::types::{
    AuthStatus, GitHubComment, GitHubIssue, GitHubLabel, GitHubReactions, GitHubUser,
    IssueListResult,
};

const OWNER: &str = "flazouh";
const REPO: &str = "acepe";

const MAX_TITLE_LENGTH: usize = 256;
const MAX_BODY_LENGTH: usize = 65536;
const MAX_COMMENT_LENGTH: usize = 65536;

const VALID_REACTION_CONTENTS: &[&str] = &[
    "+1", "-1", "laugh", "confused", "heart", "hooray", "rocket", "eyes",
];

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("acepe-desktop")
            .https_only(true)
            .build()
            .expect("Failed to build reqwest client")
    })
}

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

pub fn parse_issue(json: &serde_json::Value) -> Option<GitHubIssue> {
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

fn make_error(code: &str, message: &str) -> String {
    format!("{}: {}", code, message)
}

pub fn github_error_code(message: &str) -> Option<&str> {
    message.split_once(':').map(|(code, _)| code.trim())
}

pub fn is_expected_github_api_error(message: &str) -> bool {
    matches!(
        github_error_code(message),
        Some("auth_required" | "rate_limited" | "not_found")
    )
}

fn parse_gh_error(stderr: &str, exit_code: Option<i32>) -> String {
    if stderr.contains("HTTP 401") || exit_code == Some(4) {
        make_error(
            "auth_required",
            "GitHub authentication required. Run 'gh auth login' to authenticate.",
        )
    } else if stderr.contains("rate limit") || stderr.contains("HTTP 403") {
        make_error(
            "rate_limited",
            "GitHub API rate limit exceeded. Please try again later.",
        )
    } else if stderr.contains("HTTP 404") {
        make_error("not_found", "Not found on GitHub.")
    } else {
        make_error("unknown", "GitHub API error occurred.")
    }
}

fn parse_http_error(status: u16, body: &str) -> String {
    if status == 401 {
        make_error("auth_required", "GitHub authentication required.")
    } else if status == 403 && body.contains("rate limit") {
        make_error(
            "rate_limited",
            "GitHub API rate limit exceeded. Sign in with 'gh auth login' for higher limits.",
        )
    } else if status == 404 {
        make_error("not_found", "Not found on GitHub.")
    } else {
        make_error("unknown", &format!("GitHub API returned status {}", status))
    }
}

fn gh_api_get(endpoint: &str) -> Result<serde_json::Value, String> {
    let output = Command::new("gh")
        .args(["api", endpoint])
        .output()
        .map_err(|e| make_error("gh_not_installed", &format!("Failed to run gh: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(parse_gh_error(&stderr, output.status.code()));
    }

    serde_json::from_slice(&output.stdout).map_err(|e| {
        make_error(
            "unknown",
            &format!("Failed to parse GitHub API response: {}", e),
        )
    })
}

fn gh_api_post(endpoint: &str, body: &serde_json::Value) -> Result<serde_json::Value, String> {
    let mut child = Command::new("gh")
        .args(["api", endpoint, "-X", "POST", "--input", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| make_error("gh_not_installed", &format!("Failed to spawn gh: {}", e)))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(body.to_string().as_bytes())
            .map_err(|e| make_error("unknown", &format!("Failed to write to gh stdin: {}", e)))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| make_error("unknown", &format!("gh command failed: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(parse_gh_error(&stderr, output.status.code()));
    }

    serde_json::from_slice(&output.stdout).map_err(|e| {
        make_error(
            "unknown",
            &format!("Failed to parse GitHub API response: {}", e),
        )
    })
}

fn gh_api_delete(endpoint: &str) -> Result<(), String> {
    let output = Command::new("gh")
        .args(["api", "--method", "DELETE", endpoint])
        .output()
        .map_err(|e| make_error("gh_not_installed", &format!("Failed to run gh: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(parse_gh_error(&stderr, output.status.code()));
    }

    Ok(())
}

fn gh_api_get_with_pagination(endpoint: &str) -> Result<(serde_json::Value, bool), String> {
    let output = Command::new("gh")
        .args(["api", "--include", endpoint])
        .output()
        .map_err(|e| make_error("gh_not_installed", &format!("Failed to run gh: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(parse_gh_error(&stderr, output.status.code()));
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|e| make_error("unknown", &format!("Invalid UTF-8 in gh output: {}", e)))?;

    let (headers, body) = stdout
        .split_once("\r\n\r\n")
        .or_else(|| stdout.split_once("\n\n"))
        .unwrap_or(("", &stdout));

    let has_next = headers.contains("rel=\"next\"");

    let json: serde_json::Value = serde_json::from_str(body).map_err(|e| {
        make_error(
            "unknown",
            &format!("Failed to parse GitHub API response: {}", e),
        )
    })?;

    Ok((json, has_next))
}

async fn http_get(url: &str) -> Result<serde_json::Value, String> {
    let resp = http_client()
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| make_error("network", &format!("HTTP request failed: {}", e)))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(parse_http_error(status, &body));
    }

    resp.json()
        .await
        .map_err(|e| make_error("unknown", &format!("Failed to parse response: {}", e)))
}

async fn http_get_with_pagination(url: &str) -> Result<(serde_json::Value, bool), String> {
    let resp = http_client()
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| make_error("network", &format!("HTTP request failed: {}", e)))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(parse_http_error(status, &body));
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
        .map_err(|e| make_error("unknown", &format!("Failed to parse response: {}", e)))?;

    Ok((json, has_next))
}

pub fn check_auth() -> AuthStatus {
    let gh_check = Command::new("gh").arg("--version").output();
    if gh_check.is_err() {
        return AuthStatus {
            authenticated: false,
            username: None,
            gh_installed: false,
        };
    }

    let auth_check = Command::new("gh").args(["auth", "token"]).output();

    match auth_check {
        Ok(output) if output.status.success() => {
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

fn validate_reaction_content(content: &str) -> Result<(), String> {
    if VALID_REACTION_CONTENTS.contains(&content) {
        Ok(())
    } else {
        Err(make_error(
            "unknown",
            &format!("Invalid reaction content: {}", content),
        ))
    }
}

fn current_gh_user_login() -> Result<String, String> {
    let user_output = Command::new("gh")
        .args(["api", "user", "--jq", ".login"])
        .output()
        .map_err(|e| {
            make_error(
                "auth_required",
                &format!("Failed to get current user: {}", e),
            )
        })?;
    let login = String::from_utf8(user_output.stdout)
        .map_err(|_| make_error("unknown", "Invalid user response"))?
        .trim()
        .to_string();
    Ok(login)
}

pub async fn list_issues(
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
        OWNER, REPO, state_param, sort_param, direction_param, page_param, per_page_param
    );

    if let Some(ref label_str) = labels {
        if !label_str.is_empty() {
            query.push_str(&format!("&labels={}", label_str));
        }
    }

    let (json, has_next) = if check_auth().authenticated {
        gh_api_get_with_pagination(&query)?
    } else {
        let url = format!("https://api.github.com/{}", query);
        http_get_with_pagination(&url).await?
    };

    let items = json
        .as_array()
        .ok_or_else(|| make_error("unknown", "Expected array response from GitHub API"))?
        .iter()
        .filter_map(parse_issue)
        .collect();

    Ok(IssueListResult {
        items,
        total_count: None,
        has_next_page: has_next,
    })
}

pub async fn search_issues(
    query: String,
    state: Option<String>,
    labels: Option<String>,
    sort: Option<String>,
    page: Option<i32>,
    per_page: Option<i32>,
) -> Result<IssueListResult, String> {
    let page_param = page.unwrap_or(1);
    let per_page_param = per_page.unwrap_or(30);

    let mut q = format!("repo:{}/{} is:issue", OWNER, REPO);
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

    let json = if check_auth().authenticated {
        gh_api_get(&endpoint)?
    } else {
        let url = format!("https://api.github.com/{}", endpoint);
        http_get(&url).await?
    };

    let total_count = json["total_count"].as_i64().map(|n| n as i32);
    let items = json["items"]
        .as_array()
        .ok_or_else(|| make_error("unknown", "Expected items array in search response"))?
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

pub async fn get_issue(number: i32) -> Result<GitHubIssue, String> {
    let endpoint = format!("repos/{}/{}/issues/{}", OWNER, REPO, number);

    let json = if check_auth().authenticated {
        gh_api_get(&endpoint)?
    } else {
        let url = format!("https://api.github.com/{}", endpoint);
        http_get(&url).await?
    };

    parse_issue(&json).ok_or_else(|| make_error("not_found", "Failed to parse issue"))
}

pub fn create_issue(
    title: String,
    body: String,
    labels: Option<Vec<String>>,
) -> Result<GitHubIssue, String> {
    if title.is_empty() || title.len() > MAX_TITLE_LENGTH {
        return Err(make_error(
            "unknown",
            &format!(
                "Title must be between 1 and {} characters",
                MAX_TITLE_LENGTH
            ),
        ));
    }
    if body.len() > MAX_BODY_LENGTH {
        return Err(make_error(
            "unknown",
            &format!("Body must not exceed {} characters", MAX_BODY_LENGTH),
        ));
    }

    let mut payload = serde_json::json!({
        "title": title,
        "body": body,
    });

    if let Some(label_list) = labels {
        payload["labels"] = serde_json::json!(label_list);
    }

    let endpoint = format!("repos/{}/{}/issues", OWNER, REPO);
    let json = gh_api_post(&endpoint, &payload)?;
    parse_issue(&json).ok_or_else(|| make_error("unknown", "Failed to parse created issue"))
}

pub async fn list_issue_comments(
    number: i32,
    page: Option<i32>,
    per_page: Option<i32>,
) -> Result<Vec<GitHubComment>, String> {
    let page_param = page.unwrap_or(1);
    let per_page_param = per_page.unwrap_or(100);

    let endpoint = format!(
        "repos/{}/{}/issues/{}/comments?page={}&per_page={}",
        OWNER, REPO, number, page_param, per_page_param
    );

    let json = if check_auth().authenticated {
        gh_api_get(&endpoint)?
    } else {
        let url = format!("https://api.github.com/{}", endpoint);
        http_get(&url).await?
    };

    let comments = json
        .as_array()
        .ok_or_else(|| make_error("unknown", "Expected array response"))?
        .iter()
        .filter_map(parse_comment)
        .collect();

    Ok(comments)
}

pub fn create_issue_comment(number: i32, body: String) -> Result<GitHubComment, String> {
    if body.is_empty() || body.len() > MAX_COMMENT_LENGTH {
        return Err(make_error(
            "unknown",
            &format!(
                "Comment must be between 1 and {} characters",
                MAX_COMMENT_LENGTH
            ),
        ));
    }

    let payload = serde_json::json!({ "body": body });
    let endpoint = format!("repos/{}/{}/issues/{}/comments", OWNER, REPO, number);
    let json = gh_api_post(&endpoint, &payload)?;
    parse_comment(&json).ok_or_else(|| make_error("unknown", "Failed to parse created comment"))
}

fn toggle_reaction(
    list_endpoint: &str,
    delete_endpoint_for: impl Fn(i64) -> String,
    content: &str,
) -> Result<bool, String> {
    validate_reaction_content(content)?;

    let reactions_json = gh_api_get(list_endpoint)?;
    let reactions = reactions_json
        .as_array()
        .ok_or_else(|| make_error("unknown", "Expected array of reactions"))?;

    let current_user = current_gh_user_login()?;

    let existing = reactions.iter().find(|r| {
        r["user"]["login"].as_str() == Some(&current_user) && r["content"].as_str() == Some(content)
    });

    if let Some(reaction) = existing {
        let reaction_id = reaction["id"]
            .as_i64()
            .ok_or_else(|| make_error("unknown", "Missing reaction ID"))?;
        gh_api_delete(&delete_endpoint_for(reaction_id))?;
        Ok(false)
    } else {
        let payload = serde_json::json!({ "content": content });
        gh_api_post(list_endpoint, &payload)?;
        Ok(true)
    }
}

pub fn toggle_issue_reaction(number: i32, content: String) -> Result<bool, String> {
    let list_endpoint = format!("repos/{}/{}/issues/{}/reactions", OWNER, REPO, number);
    toggle_reaction(
        &list_endpoint,
        |reaction_id| {
            format!(
                "repos/{}/{}/issues/{}/reactions/{}",
                OWNER, REPO, number, reaction_id
            )
        },
        &content,
    )
}

pub fn toggle_comment_reaction(comment_id: i64, content: String) -> Result<bool, String> {
    let list_endpoint = format!(
        "repos/{}/{}/issues/comments/{}/reactions",
        OWNER, REPO, comment_id
    );
    toggle_reaction(
        &list_endpoint,
        |reaction_id| {
            format!(
                "repos/{}/{}/issues/comments/{}/reactions/{}",
                OWNER, REPO, comment_id, reaction_id
            )
        },
        &content,
    )
}

#[cfg(test)]
mod tests {
    use super::{parse_issue, validate_reaction_content};

    #[test]
    fn parse_issue_filters_pull_requests() {
        let json = serde_json::json!({
            "number": 1,
            "title": "PR disguised as issue",
            "pull_request": { "url": "https://api.github.com/repos/o/r/pulls/1" }
        });
        assert!(parse_issue(&json).is_none());
    }

    #[test]
    fn validate_reaction_content_accepts_known_values() {
        assert!(validate_reaction_content("+1").is_ok());
        assert!(validate_reaction_content("rocket").is_ok());
    }

    #[test]
    fn validate_reaction_content_rejects_unknown_values() {
        assert!(validate_reaction_content("invalid").is_err());
    }
}
