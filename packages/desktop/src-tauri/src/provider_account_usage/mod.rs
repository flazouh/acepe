use aes::Aes128;
use anyhow::{anyhow, Context, Result};
use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use chrono::{DateTime, Utc};
use ignore::WalkBuilder;
use pbkdf2::pbkdf2_hmac;
use reqwest::header::{
    HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE, COOKIE, REFERER, USER_AGENT,
};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{OnceLock, RwLock};

pub const PROVIDER_ACCOUNT_USAGE_UPDATED_EVENT: &str = "provider-account-usage://updated";
const CLAUDE_USAGE_CACHE_TTL_MS: i64 = 30_000;
const CLAUDE_CODE_CREDENTIALS_SERVICE: &str = "Claude Code-credentials";
const CLAUDE_DESKTOP_COOKIE_SERVICE: &str = "Claude Safe Storage";
const CLAUDE_DESKTOP_COOKIE_ACCOUNT: &str = "Claude";
const CLAUDE_USAGE_API_PLATFORM: &str = "web_claude_ai";
const CLAUDE_OAUTH_USAGE_BETA: &str = "oauth-2025-04-20";

type Aes128CbcDecryptor = cbc::Decryptor<Aes128>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAccountUsage {
    pub provider_id: String,
    pub display_name: String,
    pub plan: Option<String>,
    pub captured_at_ms: i64,
    pub connection: ProviderAccountConnection,
    pub windows: Vec<ProviderUsageWindow>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderAccountConnection {
    Connected,
    NotConnected,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsageWindow {
    pub id: String,
    pub label: String,
    #[serde(default = "default_provider_usage_window_role")]
    pub role: ProviderUsageWindowRole,
    pub used_fraction: f64,
    pub window_minutes: u32,
    pub resets_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ProviderUsageWindowRole {
    PrimaryShort,
    Weekly,
    Overage,
    Other,
}

fn default_provider_usage_window_role() -> ProviderUsageWindowRole {
    ProviderUsageWindowRole::Other
}

#[derive(Debug, Clone, Deserialize)]
struct RolloutRecord {
    timestamp: Option<String>,
    #[serde(rename = "type")]
    record_type: String,
    payload: Option<TokenCountPayload>,
}

#[derive(Debug, Clone, Deserialize)]
struct TokenCountPayload {
    #[serde(rename = "type")]
    payload_type: String,
    rate_limits: Option<CodexRateLimits>,
}

#[derive(Debug, Clone, Deserialize)]
struct CodexRateLimits {
    primary: Option<CodexRateLimitWindow>,
    secondary: Option<CodexRateLimitWindow>,
    plan_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct CodexRateLimitWindow {
    used_percent: f64,
    window_minutes: u32,
    resets_at: Option<i64>,
}

#[derive(Debug, Clone)]
struct CodexRateLimitSnapshot {
    plan_type: Option<String>,
    captured_at_ms: i64,
    primary: Option<CodexRateLimitWindow>,
    secondary: Option<CodexRateLimitWindow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeUsageSnapshot {
    captured_at_ms: i64,
    windows: BTreeMap<String, ProviderUsageWindow>,
    plan: Option<String>,
}

#[derive(Debug, Clone)]
struct ClaudeUsageMemoryCache {
    stored_at_ms: i64,
    snapshot: ClaudeUsageSnapshot,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeAccountConfig {
    has_available_subscription: Option<bool>,
    oauth_account: Option<ClaudeOAuthAccount>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeOAuthAccount {
    organization_uuid: Option<String>,
    billing_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeCodeCredentials {
    claude_ai_oauth: Option<ClaudeCodeOAuthCredentials>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeCodeOAuthCredentials {
    access_token: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ClaudeUsageApiResponse {
    five_hour: Option<ClaudeUsageBucket>,
    seven_day: Option<ClaudeUsageBucket>,
    seven_day_sonnet: Option<ClaudeUsageBucket>,
    seven_day_opus: Option<ClaudeUsageBucket>,
    seven_day_cowork: Option<ClaudeUsageBucket>,
    extra_usage: Option<ClaudeUsageBucket>,
}

#[derive(Debug, Clone, Deserialize)]
struct ClaudeUsageBucket {
    utilization: f64,
    resets_at: Option<String>,
}

static CLAUDE_USAGE_CACHE: OnceLock<RwLock<Option<ClaudeUsageMemoryCache>>> = OnceLock::new();

#[tauri::command]
pub async fn get_provider_account_usage() -> Result<Vec<ProviderAccountUsage>, String> {
    let codex = tokio::task::spawn_blocking(load_codex_usage)
        .await
        .map_err(|error| format!("Provider account usage task failed: {error}"))?
        .map_err(|error| format!("Provider account usage failed: {error}"))?;
    let claude = load_claude_usage().await;
    let mut providers = Vec::new();
    providers.push(codex);
    providers.push(claude);
    providers.push(unavailable_provider(
        "cursor",
        "Cursor",
        "Cursor quota needs the Cursor account API",
    ));
    Ok(providers)
}

fn load_codex_usage() -> Result<ProviderAccountUsage> {
    let Some(sessions_root) = codex_sessions_root() else {
        return Ok(unavailable_provider(
            "codex",
            "Codex",
            "No ~/.codex/sessions directory was found",
        ));
    };

    let Some(snapshot) = find_latest_codex_rate_limit_snapshot(&sessions_root)? else {
        return Ok(unavailable_provider(
            "codex",
            "Codex",
            "No Codex rate limit events were found",
        ));
    };

    let mut windows = Vec::new();
    if let Some(primary) = snapshot.primary {
        windows.push(to_usage_window("primary", "5h window", primary));
    }
    if let Some(secondary) = snapshot.secondary {
        windows.push(to_usage_window("secondary", "Weekly window", secondary));
    }

    if windows.is_empty() {
        return Ok(unavailable_provider(
            "codex",
            "Codex",
            "The latest Codex usage event had no quota windows",
        ));
    }

    Ok(ProviderAccountUsage {
        provider_id: "codex".to_string(),
        display_name: "Codex".to_string(),
        plan: snapshot.plan_type,
        captured_at_ms: snapshot.captured_at_ms,
        connection: ProviderAccountConnection::Connected,
        windows,
        message: None,
    })
}

async fn load_claude_usage() -> ProviderAccountUsage {
    match load_claude_usage_snapshot().await {
        Ok(snapshot) => claude_snapshot_to_usage(snapshot, None),
        Err(error) => {
            if let Some(snapshot) = load_claude_cached_snapshot() {
                return claude_snapshot_to_usage(
                    snapshot,
                    Some("Showing cached Claude usage because live usage could not be refreshed"),
                );
            }

            unavailable_provider("claude-code", "Claude Code", &error.to_string())
        }
    }
}

async fn load_claude_usage_snapshot() -> Result<ClaudeUsageSnapshot> {
    if let Some(snapshot) = read_fresh_claude_memory_cache()? {
        return Ok(snapshot);
    }

    let account = tokio::task::spawn_blocking(read_claude_account_config)
        .await
        .context("Claude account task failed")??;
    let plan = claude_plan_label(&account);
    let response = match tokio::task::spawn_blocking(read_claude_code_oauth_access_token).await {
        Ok(Ok(access_token)) => fetch_claude_oauth_usage_api(&access_token).await?,
        _ => {
            let org_uuid = account
                .oauth_account
                .as_ref()
                .and_then(|oauth| oauth.organization_uuid.as_deref())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .ok_or_else(|| {
                    anyhow!("Claude Code account is missing an organization id in ~/.claude.json")
                })?;
            let cookies = tokio::task::spawn_blocking(read_claude_session_cookies)
                .await
                .context("Claude cookie task failed")??;
            fetch_claude_desktop_usage_api(&org_uuid, &cookies).await?
        }
    };
    let snapshot = claude_usage_response_to_snapshot(response, plan)?;
    write_claude_memory_cache(snapshot.clone())?;
    persist_claude_usage_snapshot(&snapshot);
    Ok(snapshot)
}

fn claude_snapshot_to_usage(
    snapshot: ClaudeUsageSnapshot,
    message: Option<&str>,
) -> ProviderAccountUsage {
    let windows = snapshot.windows.values().cloned().collect::<Vec<_>>();
    if windows.is_empty() {
        return unavailable_provider(
            "claude-code",
            "Claude Code",
            "Claude usage API returned no quota windows",
        );
    }

    ProviderAccountUsage {
        provider_id: "claude-code".to_string(),
        display_name: "Claude Code".to_string(),
        plan: snapshot.plan.or_else(|| Some("Claude Code".to_string())),
        captured_at_ms: snapshot.captured_at_ms,
        connection: ProviderAccountConnection::Connected,
        windows,
        message: message.map(str::to_string),
    }
}

fn unavailable_provider(
    provider_id: &str,
    display_name: &str,
    message: &str,
) -> ProviderAccountUsage {
    ProviderAccountUsage {
        provider_id: provider_id.to_string(),
        display_name: display_name.to_string(),
        plan: None,
        captured_at_ms: Utc::now().timestamp_millis(),
        connection: ProviderAccountConnection::Unavailable,
        windows: Vec::new(),
        message: Some(message.to_string()),
    }
}

#[cfg(test)]
fn persist_claude_usage_snapshot(_snapshot: &ClaudeUsageSnapshot) {}

#[cfg(not(test))]
fn persist_claude_usage_snapshot(snapshot: &ClaudeUsageSnapshot) {
    let Some(path) = claude_usage_cache_path() else {
        return;
    };

    let Some(parent) = path.parent() else {
        return;
    };

    if let Err(error) = std::fs::create_dir_all(parent) {
        tracing::warn!(error = %error, "Failed to create Claude rate limit cache directory");
        return;
    }

    let Ok(json) = serde_json::to_string(snapshot) else {
        tracing::warn!("Failed to serialize Claude usage snapshot");
        return;
    };

    if let Err(error) = std::fs::write(&path, json) {
        tracing::warn!(error = %error, path = %path.display(), "Failed to write Claude usage cache");
    }
}

#[cfg(test)]
fn load_claude_cached_snapshot() -> Option<ClaudeUsageSnapshot> {
    None
}

#[cfg(not(test))]
fn load_claude_cached_snapshot() -> Option<ClaudeUsageSnapshot> {
    let path = claude_usage_cache_path()?;
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<ClaudeUsageSnapshot>(&content).ok()
}

#[cfg(not(test))]
fn claude_usage_cache_path() -> Option<PathBuf> {
    Some(
        dirs::data_dir()?
            .join("com.acepe.app")
            .join("provider-account-usage")
            .join("claude-code-usage.json"),
    )
}

fn read_fresh_claude_memory_cache() -> Result<Option<ClaudeUsageSnapshot>> {
    let now_ms = Utc::now().timestamp_millis();
    let lock = CLAUDE_USAGE_CACHE.get_or_init(|| RwLock::new(None));
    let guard = lock
        .read()
        .map_err(|_| anyhow!("Claude usage cache lock is poisoned"))?;
    Ok(guard
        .as_ref()
        .filter(|entry| now_ms - entry.stored_at_ms < CLAUDE_USAGE_CACHE_TTL_MS)
        .map(|entry| entry.snapshot.clone()))
}

fn write_claude_memory_cache(snapshot: ClaudeUsageSnapshot) -> Result<()> {
    let lock = CLAUDE_USAGE_CACHE.get_or_init(|| RwLock::new(None));
    let mut guard = lock
        .write()
        .map_err(|_| anyhow!("Claude usage cache lock is poisoned"))?;
    *guard = Some(ClaudeUsageMemoryCache {
        stored_at_ms: Utc::now().timestamp_millis(),
        snapshot,
    });
    Ok(())
}

fn read_claude_account_config() -> Result<ClaudeAccountConfig> {
    let path = claude_account_config_path()
        .ok_or_else(|| anyhow!("Could not resolve the Claude Code account file path"))?;
    let content = std::fs::read_to_string(&path)
        .with_context(|| format!("Could not read Claude Code account file {}", path.display()))?;
    serde_json::from_str::<ClaudeAccountConfig>(&content).with_context(|| {
        format!(
            "Could not parse Claude Code account file {}",
            path.display()
        )
    })
}

fn claude_account_config_path() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".claude.json"))
}

fn claude_plan_label(account: &ClaudeAccountConfig) -> Option<String> {
    if account.has_available_subscription != Some(true) {
        return Some("Claude Code".to_string());
    }

    let billing_type = account
        .oauth_account
        .as_ref()
        .and_then(|oauth| oauth.billing_type.as_deref());
    if billing_type == Some("stripe") {
        return Some("Claude Pro".to_string());
    }

    Some("Claude subscription".to_string())
}

fn read_claude_code_oauth_access_token() -> Result<String> {
    let credentials = if cfg!(target_os = "macos") {
        read_claude_code_keychain_credentials()
    } else {
        read_claude_code_credentials_file()
    }?;
    credentials
        .claude_ai_oauth
        .and_then(|oauth| oauth.access_token)
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
        .ok_or_else(|| anyhow!("Claude Code OAuth access token was not found"))
}

fn read_claude_code_keychain_credentials() -> Result<ClaudeCodeCredentials> {
    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-w",
            "-s",
            CLAUDE_CODE_CREDENTIALS_SERVICE,
        ])
        .output()
        .context("Could not read Claude Code credentials from Keychain")?;

    if !output.status.success() {
        return Err(anyhow!(
            "Claude Code credentials were not found in Keychain"
        ));
    }

    let raw = String::from_utf8(output.stdout).context("Claude Code credentials were not UTF-8")?;
    serde_json::from_str::<ClaudeCodeCredentials>(&raw)
        .context("Could not parse Claude Code credentials from Keychain")
}

fn read_claude_code_credentials_file() -> Result<ClaudeCodeCredentials> {
    let path = dirs::home_dir()
        .ok_or_else(|| anyhow!("Could not resolve the home directory"))?
        .join(".claude")
        .join(".credentials.json");
    let raw = std::fs::read_to_string(&path).with_context(|| {
        format!(
            "Could not read Claude Code credentials file {}",
            path.display()
        )
    })?;
    serde_json::from_str::<ClaudeCodeCredentials>(&raw).with_context(|| {
        format!(
            "Could not parse Claude Code credentials file {}",
            path.display()
        )
    })
}

fn read_claude_session_cookies() -> Result<BTreeMap<String, String>> {
    if !cfg!(target_os = "macos") {
        return Err(anyhow!(
            "Claude usage polling currently needs macOS Claude desktop cookies"
        ));
    }

    let encrypted_key = read_chromium_cookie_key()?;
    let cookies_path = claude_desktop_cookies_path()
        .ok_or_else(|| anyhow!("Could not resolve the Claude desktop cookies path"))?;
    if !cookies_path.exists() {
        return Err(anyhow!(
            "Claude desktop cookies were not found at {}",
            cookies_path.display()
        ));
    }

    let temp_file = tempfile::NamedTempFile::new().context("Could not create cookie DB copy")?;
    std::fs::copy(&cookies_path, temp_file.path())
        .with_context(|| format!("Could not copy {}", cookies_path.display()))?;
    let connection =
        Connection::open_with_flags(temp_file.path(), OpenFlags::SQLITE_OPEN_READ_ONLY)
            .context("Could not open Claude desktop cookies DB")?;
    let mut statement = connection
        .prepare("SELECT name, encrypted_value FROM cookies WHERE host_key LIKE '%claude.ai%'")
        .context("Could not prepare Claude cookie query")?;
    let wanted = wanted_claude_cookie_names();
    let mut rows = statement
        .query([])
        .context("Could not query Claude desktop cookies")?;
    let mut cookies = BTreeMap::new();

    while let Some(row) = rows.next().context("Could not read Claude cookie row")? {
        let name: String = row.get(0).context("Could not read Claude cookie name")?;
        if !wanted.contains(name.as_str()) {
            continue;
        }
        let encrypted_value: Vec<u8> = row
            .get(1)
            .context("Could not read Claude encrypted cookie value")?;
        let Ok(value) = decrypt_chromium_cookie_value(&encrypted_value, &encrypted_key) else {
            continue;
        };
        cookies.insert(name, value);
    }

    if !cookies.contains_key("sessionKey") {
        return Err(anyhow!(
            "Claude desktop session cookie was not found; open Claude desktop and sign in"
        ));
    }

    Ok(cookies)
}

fn wanted_claude_cookie_names() -> BTreeSet<&'static str> {
    BTreeSet::from([
        "sessionKey",
        "cf_clearance",
        "anthropic-device-id",
        "lastActiveOrg",
        "__cf_bm",
    ])
}

fn claude_desktop_cookies_path() -> Option<PathBuf> {
    Some(
        dirs::home_dir()?
            .join("Library")
            .join("Application Support")
            .join("Claude")
            .join("Cookies"),
    )
}

fn read_chromium_cookie_key() -> Result<[u8; 16]> {
    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-w",
            "-s",
            CLAUDE_DESKTOP_COOKIE_SERVICE,
            "-a",
            CLAUDE_DESKTOP_COOKIE_ACCOUNT,
        ])
        .output()
        .context("Could not read Claude desktop cookie key from Keychain")?;

    if !output.status.success() {
        return Err(anyhow!(
            "Claude desktop cookie key was not found in Keychain"
        ));
    }

    let password = String::from_utf8(output.stdout)
        .context("Claude desktop cookie key was not valid UTF-8")?
        .trim()
        .to_string();
    let mut key = [0_u8; 16];
    pbkdf2_hmac::<Sha1>(password.as_bytes(), b"saltysalt", 1003, &mut key);
    Ok(key)
}

fn decrypt_chromium_cookie_value(encrypted: &[u8], key: &[u8; 16]) -> Result<String> {
    if encrypted.len() < 3 || &encrypted[0..3] != b"v10" {
        return Err(anyhow!("Unsupported Claude desktop cookie encryption"));
    }

    let mut ciphertext = encrypted[3..].to_vec();
    let iv = [b' '; 16];
    let plaintext = Aes128CbcDecryptor::new_from_slices(key, &iv)
        .map_err(|_| anyhow!("Could not initialize Claude cookie decryptor"))?
        .decrypt_padded_mut::<Pkcs7>(&mut ciphertext)
        .map_err(|_| anyhow!("Could not decrypt Claude desktop cookie"))?;
    if plaintext.len() <= 32 {
        return Err(anyhow!("Claude desktop cookie plaintext was too short"));
    }

    String::from_utf8(plaintext[32..].to_vec())
        .context("Claude desktop cookie plaintext was not valid UTF-8")
}

async fn fetch_claude_oauth_usage_api(access_token: &str) -> Result<ClaudeUsageApiResponse> {
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {access_token}"))
            .context("Claude OAuth authorization header is invalid")?,
    );
    headers.insert(
        "anthropic-beta",
        HeaderValue::from_static(CLAUDE_OAUTH_USAGE_BETA),
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .default_headers(headers)
        .build()
        .context("Could not build Claude OAuth usage HTTP client")?;
    let response = client
        .get("https://api.anthropic.com/api/oauth/usage")
        .send()
        .await
        .context("Claude OAuth usage API request failed")?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "Claude OAuth usage API returned {}: {}",
            status,
            body.chars().take(180).collect::<String>()
        ));
    }

    response
        .json::<ClaudeUsageApiResponse>()
        .await
        .context("Could not parse Claude OAuth usage API response")
}

async fn fetch_claude_desktop_usage_api(
    org_uuid: &str,
    cookies: &BTreeMap<String, String>,
) -> Result<ClaudeUsageApiResponse> {
    let url = format!("https://claude.ai/api/organizations/{org_uuid}/usage");
    let mut headers = HeaderMap::new();
    let cookie_header = cookies
        .iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; ");
    headers.insert(
        COOKIE,
        HeaderValue::from_str(&cookie_header).context("Claude cookie header is invalid")?,
    );
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        ),
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://claude.ai/settings/usage"),
    );
    headers.insert(
        "anthropic-client-platform",
        HeaderValue::from_static(CLAUDE_USAGE_API_PLATFORM),
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .default_headers(headers)
        .build()
        .context("Could not build Claude usage HTTP client")?;
    let response = client
        .get(url)
        .send()
        .await
        .context("Claude usage API request failed")?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "Claude usage API returned {}: {}",
            status,
            body.chars().take(180).collect::<String>()
        ));
    }

    response
        .json::<ClaudeUsageApiResponse>()
        .await
        .context("Could not parse Claude usage API response")
}

fn claude_usage_response_to_snapshot(
    response: ClaudeUsageApiResponse,
    plan: Option<String>,
) -> Result<ClaudeUsageSnapshot> {
    let captured_at_ms = Utc::now().timestamp_millis();
    let mut windows = BTreeMap::new();
    insert_claude_usage_window(
        &mut windows,
        "five-hour",
        "5h window",
        ProviderUsageWindowRole::PrimaryShort,
        300,
        response.five_hour,
    );
    insert_claude_usage_window(
        &mut windows,
        "seven-day",
        "Weekly window",
        ProviderUsageWindowRole::Weekly,
        10_080,
        response.seven_day,
    );
    insert_claude_usage_window(
        &mut windows,
        "seven-day-sonnet",
        "Sonnet weekly",
        ProviderUsageWindowRole::Weekly,
        10_080,
        response.seven_day_sonnet,
    );
    insert_claude_usage_window(
        &mut windows,
        "seven-day-opus",
        "Opus weekly",
        ProviderUsageWindowRole::Weekly,
        10_080,
        response.seven_day_opus,
    );
    insert_claude_usage_window(
        &mut windows,
        "seven-day-cowork",
        "Cowork weekly",
        ProviderUsageWindowRole::Weekly,
        10_080,
        response.seven_day_cowork,
    );
    insert_claude_usage_window(
        &mut windows,
        "extra-usage",
        "Extra usage",
        ProviderUsageWindowRole::Overage,
        0,
        response.extra_usage,
    );

    if windows.is_empty() {
        return Err(anyhow!("Claude usage API returned no quota windows"));
    }

    Ok(ClaudeUsageSnapshot {
        captured_at_ms,
        windows,
        plan,
    })
}

fn insert_claude_usage_window(
    windows: &mut BTreeMap<String, ProviderUsageWindow>,
    id: &str,
    label: &str,
    role: ProviderUsageWindowRole,
    window_minutes: u32,
    bucket: Option<ClaudeUsageBucket>,
) {
    let Some(bucket) = bucket else {
        return;
    };
    let resets_at_ms = parse_reset_timestamp_ms(bucket.resets_at.as_deref());
    let used_fraction = if resets_at_ms.is_some_and(|reset| reset <= Utc::now().timestamp_millis())
    {
        0.0
    } else {
        (bucket.utilization / 100.0).clamp(0.0, 1.0)
    };

    windows.insert(
        id.to_string(),
        ProviderUsageWindow {
            id: id.to_string(),
            label: label.to_string(),
            role,
            used_fraction,
            window_minutes,
            resets_at_ms,
        },
    );
}

fn to_usage_window(id: &str, label: &str, window: CodexRateLimitWindow) -> ProviderUsageWindow {
    ProviderUsageWindow {
        id: id.to_string(),
        label: label.to_string(),
        role: codex_window_role(id),
        used_fraction: (window.used_percent / 100.0).clamp(0.0, 1.0),
        window_minutes: window.window_minutes,
        resets_at_ms: window.resets_at.map(|seconds| seconds * 1_000),
    }
}

fn codex_window_role(id: &str) -> ProviderUsageWindowRole {
    if id == "primary" {
        return ProviderUsageWindowRole::PrimaryShort;
    }

    if id == "secondary" {
        return ProviderUsageWindowRole::Weekly;
    }

    ProviderUsageWindowRole::Other
}

fn parse_reset_timestamp_ms(value: Option<&str>) -> Option<i64> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }

    if let Ok(number) = value.parse::<i64>() {
        if number > 10_000_000_000 {
            return Some(number);
        }

        return Some(number * 1_000);
    }

    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|parsed| parsed.with_timezone(&Utc).timestamp_millis())
}

fn codex_sessions_root() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let sessions_dir = home.join(".codex").join("sessions");
    if sessions_dir.exists() {
        return Some(sessions_dir);
    }
    None
}

fn find_latest_codex_rate_limit_snapshot(
    sessions_root: &Path,
) -> Result<Option<CodexRateLimitSnapshot>> {
    if !sessions_root.exists() {
        return Ok(None);
    }

    let mut rollout_files = Vec::new();
    for walk_entry in WalkBuilder::new(sessions_root)
        .standard_filters(false)
        .build()
    {
        let Ok(walk_entry) = walk_entry else {
            continue;
        };
        if !walk_entry
            .file_type()
            .map(|file_type| file_type.is_file())
            .unwrap_or(false)
        {
            continue;
        }

        let file_name = walk_entry.file_name().to_string_lossy();
        if file_name.starts_with("rollout-") && file_name.ends_with(".jsonl") {
            let modified_ms = walk_entry
                .metadata()
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .map(DateTime::<Utc>::from)
                .map(|modified| modified.timestamp_millis())
                .unwrap_or(0);
            rollout_files.push((modified_ms, walk_entry.path().to_path_buf()));
        }
    }

    rollout_files.sort_by_key(|(modified_ms, _path)| Reverse(*modified_ms));

    for (_modified_ms, path) in rollout_files {
        if let Some(snapshot) = parse_latest_snapshot_from_rollout(&path)? {
            return Ok(Some(snapshot));
        }
    }

    Ok(None)
}

fn parse_latest_snapshot_from_rollout(path: &Path) -> Result<Option<CodexRateLimitSnapshot>> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("Failed to open Codex rollout {}", path.display()))?;
    let reader = std::io::BufReader::new(file);
    let mut latest_snapshot: Option<CodexRateLimitSnapshot> = None;

    for line in reader.lines() {
        let line =
            line.with_context(|| format!("Failed to read Codex rollout {}", path.display()))?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let Ok(record) = serde_json::from_str::<RolloutRecord>(line) else {
            continue;
        };
        if record.record_type != "event_msg" {
            continue;
        }

        let Some(payload) = record.payload else {
            continue;
        };
        if payload.payload_type != "token_count" {
            continue;
        }

        let Some(rate_limits) = payload.rate_limits else {
            continue;
        };

        latest_snapshot = Some(CodexRateLimitSnapshot {
            plan_type: rate_limits.plan_type,
            captured_at_ms: parse_timestamp_ms(record.timestamp.as_deref()),
            primary: rate_limits.primary,
            secondary: rate_limits.secondary,
        });
    }

    Ok(latest_snapshot)
}

fn parse_timestamp_ms(timestamp: Option<&str>) -> i64 {
    timestamp
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|parsed| parsed.with_timezone(&Utc).timestamp_millis())
        .unwrap_or_else(|| Utc::now().timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn reset_claude_usage_for_tests() {
        let lock = CLAUDE_USAGE_CACHE.get_or_init(|| RwLock::new(None));
        let mut guard = lock.write().expect("claude snapshot lock");
        *guard = None;
    }

    #[test]
    fn parses_latest_codex_rate_limit_snapshot_from_rollout() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let rollout_path = temp_dir.path().join("rollout-test.jsonl");
        fs::write(
            &rollout_path,
            r#"{"timestamp":"2026-06-23T10:00:00.000Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":12.0,"window_minutes":300,"resets_at":1782251981},"secondary":{"used_percent":80.0,"window_minutes":10080,"resets_at":1782820779},"plan_type":"pro"}}}
{"timestamp":"2026-06-23T11:00:00.000Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":25.0,"window_minutes":300,"resets_at":1782253000},"secondary":{"used_percent":81.0,"window_minutes":10080,"resets_at":1782821000},"plan_type":"pro"}}}
"#,
        )
        .expect("write rollout");

        let snapshot = parse_latest_snapshot_from_rollout(&rollout_path)
            .expect("parse")
            .expect("snapshot");

        assert_eq!(snapshot.plan_type.as_deref(), Some("pro"));
        assert_eq!(snapshot.captured_at_ms, 1_782_212_400_000);
        assert_eq!(snapshot.primary.expect("primary").used_percent, 25.0);
        assert_eq!(snapshot.secondary.expect("secondary").used_percent, 81.0);
    }

    #[test]
    fn maps_codex_window_to_normalized_fraction() {
        let window = to_usage_window(
            "primary",
            "5h window",
            CodexRateLimitWindow {
                used_percent: 125.0,
                window_minutes: 300,
                resets_at: Some(1782251981),
            },
        );

        assert_eq!(window.used_fraction, 1.0);
        assert!(matches!(window.role, ProviderUsageWindowRole::PrimaryShort));
        assert_eq!(window.resets_at_ms, Some(1_782_251_981_000));
    }

    #[test]
    fn maps_claude_usage_api_response_to_quota_windows() {
        reset_claude_usage_for_tests();

        let snapshot = claude_usage_response_to_snapshot(
            ClaudeUsageApiResponse {
                five_hour: Some(ClaudeUsageBucket {
                    utilization: 42.0,
                    resets_at: Some("2026-06-30T12:00:00Z".to_string()),
                }),
                seven_day: None,
                seven_day_sonnet: None,
                seven_day_opus: Some(ClaudeUsageBucket {
                    utilization: 70.0,
                    resets_at: Some("1782821000".to_string()),
                }),
                seven_day_cowork: None,
                extra_usage: None,
            },
            Some("Claude Pro".to_string()),
        )
        .expect("snapshot");

        let usage = claude_snapshot_to_usage(snapshot, None);

        assert_eq!(usage.provider_id, "claude-code");
        assert!(matches!(
            usage.connection,
            ProviderAccountConnection::Connected
        ));
        assert_eq!(usage.windows.len(), 2);
        assert_eq!(usage.windows[0].id, "five-hour");
        assert_eq!(usage.plan.as_deref(), Some("Claude Pro"));
        assert!(matches!(
            usage.windows[0].role,
            ProviderUsageWindowRole::PrimaryShort
        ));
        assert_eq!(usage.windows[0].used_fraction, 0.42);
        assert_eq!(usage.windows[0].resets_at_ms, Some(1_782_820_800_000));
        assert_eq!(usage.windows[1].id, "seven-day-opus");
        assert_eq!(usage.windows[1].resets_at_ms, Some(1_782_821_000_000));
    }

    #[test]
    fn uses_cached_claude_snapshot_as_connected_usage() {
        let mut windows = BTreeMap::new();
        windows.insert(
            "five-hour".to_string(),
            ProviderUsageWindow {
                id: "five-hour".to_string(),
                label: "5h window".to_string(),
                role: ProviderUsageWindowRole::PrimaryShort,
                used_fraction: 0.18,
                window_minutes: 300,
                resets_at_ms: None,
            },
        );
        let usage = claude_snapshot_to_usage(
            ClaudeUsageSnapshot {
                captured_at_ms: 123,
                windows,
                plan: Some("Claude Code".to_string()),
            },
            Some("Showing cached Claude usage because live usage could not be refreshed"),
        );

        assert_eq!(usage.provider_id, "claude-code");
        assert!(matches!(
            usage.connection,
            ProviderAccountConnection::Connected
        ));
        assert_eq!(usage.windows.len(), 1);
        assert_eq!(
            usage.message.as_deref(),
            Some("Showing cached Claude usage because live usage could not be refreshed")
        );
    }
}
