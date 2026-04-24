//! Managed agent installer — downloads, caches, and manages agent runtimes.
//!
//! Supports three managed sources:
//! - **Registry**: ACP registry CDN (Cursor, OpenCode)
//! - **Claude SDK cache**: Official Claude CLI via the vendored cc-sdk
//! - **GitHub Release**: Official Codex release binaries from openai/codex

use crate::acp::error::{AcpError, AcpResult};
use crate::acp::types::CanonicalAgentId;
use crate::cc_sdk;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

// ============================================
// CONSTANTS
// ============================================

const REGISTRY_URL: &str = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

const ALLOWED_URL_PREFIXES: &[&str] = &[
    "https://cdn.agentclientprotocol.com/",
    "https://github.com/",
    "https://downloads.cursor.com/",
    // GitHub release downloads redirect here via 302
    "https://release-assets.githubusercontent.com/",
    "https://objects.githubusercontent.com/",
];

const MAX_DOWNLOAD_SIZE: u64 = 500 * 1024 * 1024; // 500 MB
const HTTP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);
const DEFAULT_DOWNLOAD_CAPACITY: usize = 10 * 1024 * 1024; // 10 MB when Content-Length unknown

/// Event name for install progress events (shared with frontend).
pub const INSTALL_PROGRESS_EVENT: &str = "agent-install:progress";

/// Global cache directory, set once at startup (same pattern as RESOURCE_DIR).
static AGENTS_CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Guard against concurrent installs of the same agent.
static INSTALL_GUARD: OnceLock<Mutex<HashSet<CanonicalAgentId>>> = OnceLock::new();

fn install_guard() -> &'static Mutex<HashSet<CanonicalAgentId>> {
    INSTALL_GUARD.get_or_init(|| Mutex::new(HashSet::new()))
}

// ============================================
// PROGRESS EVENTS
// ============================================

#[derive(Debug, Clone, Serialize)]
pub struct AgentInstallProgress {
    pub agent_id: String,
    pub stage: String,
    pub progress: Option<f64>,
    pub message: String,
}

fn emit_progress(
    app: &AppHandle,
    agent_id: &str,
    stage: &str,
    progress: Option<f64>,
    message: &str,
) {
    let _ = app.emit(
        INSTALL_PROGRESS_EVENT,
        AgentInstallProgress {
            agent_id: agent_id.to_string(),
            stage: stage.to_string(),
            progress,
            message: message.to_string(),
        },
    );
}

// ============================================
// REGISTRY TYPES
// ============================================

#[derive(Debug, Deserialize)]
struct Registry {
    agents: Vec<RegistryAgent>,
}

#[derive(Debug, Deserialize)]
struct RegistryAgent {
    id: String,
    version: String,
    distribution: Option<Distribution>,
}

#[derive(Debug, Deserialize)]
struct Distribution {
    binary: Option<std::collections::HashMap<String, BinaryDistribution>>,
}

#[derive(Debug, Deserialize)]
struct BinaryDistribution {
    archive: String,
    cmd: String,
    #[serde(default)]
    args: Vec<String>,
}

// ============================================
// AGENT SOURCE (where to download from)
// ============================================

/// Where an agent runtime is downloaded from.
enum AgentSource {
    /// From cdn.agentclientprotocol.com (Cursor, OpenCode)
    Registry,
    /// From the vendored Claude SDK's official CLI cache.
    ClaudeCli,
    /// From GitHub Releases (official Copilot CLI binaries).
    CopilotGitHubRelease,
    /// From GitHub Releases (official Codex binaries).
    CodexGitHubRelease,
}

struct DownloadInfo {
    archive_url: String,
    version: String,
    cmd: String,
    args: Vec<String>,
    official_sha256: Option<String>,
}

/// Determine the download source for a given agent.
fn agent_source(agent_id: &CanonicalAgentId) -> AgentSource {
    match agent_id {
        CanonicalAgentId::ClaudeCode => AgentSource::ClaudeCli,
        CanonicalAgentId::Copilot => AgentSource::CopilotGitHubRelease,
        CanonicalAgentId::Codex => AgentSource::CodexGitHubRelease,
        _ => AgentSource::Registry,
    }
}

// ============================================
// GITHUB RELEASE TYPES
// ============================================

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

// ============================================
// METADATA (written alongside cached binary)
// ============================================

#[derive(Debug, Serialize, Deserialize)]
struct AgentMeta {
    version: String,
    archive_url: String,
    sha256: Option<String>,
    downloaded_at: String,
    cmd: String,
    args: Vec<String>,
}

// ============================================
// PUBLIC API
// ============================================

/// Set the cache directory at app startup.
pub fn set_cache_dir(dir: PathBuf) {
    if AGENTS_CACHE_DIR.set(dir).is_err() {
        tracing::warn!("Agent cache dir already set, ignoring duplicate call");
    }
}

fn cache_dir() -> AcpResult<&'static PathBuf> {
    AGENTS_CACHE_DIR
        .get()
        .ok_or_else(|| AcpError::InvalidState("Agent cache dir not initialized".to_string()))
}

/// Get the path to a cached agent binary, if installed.
pub fn get_cached_binary(agent_id: &CanonicalAgentId) -> Option<PathBuf> {
    if matches!(agent_id, CanonicalAgentId::ClaudeCode) {
        let path = cc_sdk::cli_download::get_cached_cli_path()?;
        return if path.exists() && path.is_file() {
            Some(path)
        } else {
            None
        };
    }

    let dir = AGENTS_CACHE_DIR.get()?;
    let agent_dir = dir.join(agent_id_str(agent_id));
    let meta_path = agent_dir.join("meta.json");

    if !meta_path.exists() {
        return None;
    }

    // Read meta to get the cmd path
    let meta_content = std::fs::read_to_string(&meta_path).ok()?;
    let meta: AgentMeta = serde_json::from_str(&meta_content).ok()?;

    // cmd is relative like "./dist-package/cursor-agent" — resolve relative to agent_dir
    let cmd = meta.cmd.strip_prefix("./").unwrap_or(&meta.cmd);
    let binary_path = agent_dir.join(cmd);

    if binary_path.exists() {
        Some(binary_path)
    } else {
        None
    }
}

/// Get the spawn args for a cached agent.
pub fn get_cached_args(agent_id: &CanonicalAgentId) -> Vec<String> {
    if matches!(agent_id, CanonicalAgentId::ClaudeCode) {
        return Vec::new();
    }

    let Some(dir) = AGENTS_CACHE_DIR.get() else {
        return Vec::new();
    };
    let meta_path = dir.join(agent_id_str(agent_id)).join("meta.json");
    let Ok(content) = std::fs::read_to_string(&meta_path) else {
        return Vec::new();
    };
    let Ok(meta) = serde_json::from_str::<AgentMeta>(&content) else {
        return Vec::new();
    };
    meta.args
}

/// Get the installed version for a cached agent, if available.
pub fn get_cached_version(agent_id: &CanonicalAgentId) -> Option<String> {
    if matches!(agent_id, CanonicalAgentId::ClaudeCode) {
        return None;
    }

    let dir = AGENTS_CACHE_DIR.get()?;
    let meta_path = dir.join(agent_id_str(agent_id)).join("meta.json");
    let Ok(content) = std::fs::read_to_string(&meta_path) else {
        return None;
    };
    let Ok(meta) = serde_json::from_str::<AgentMeta>(&content) else {
        return None;
    };
    Some(meta.version)
}

/// Check if an agent is installed in the cache.
pub fn is_installed(agent_id: &CanonicalAgentId) -> bool {
    get_cached_binary(agent_id).is_some()
}

/// Whether Acepe can provision the agent automatically.
pub fn can_auto_install(agent_id: &CanonicalAgentId) -> bool {
    matches!(
        agent_id,
        CanonicalAgentId::ClaudeCode
            | CanonicalAgentId::Cursor
            | CanonicalAgentId::Copilot
            | CanonicalAgentId::OpenCode
            | CanonicalAgentId::Codex
    )
}

/// Install an agent by downloading from the appropriate source (registry or GitHub Releases).
pub async fn install_agent(agent_id: CanonicalAgentId, app: AppHandle) -> AcpResult<PathBuf> {
    let id_str = agent_id_str(&agent_id);

    // Guard against concurrent installs
    {
        let mut guard = install_guard().lock().await;
        if guard.contains(&agent_id) {
            return Err(AcpError::InvalidState(format!(
                "Agent {} is already being installed",
                id_str
            )));
        }
        guard.insert(agent_id.clone());
    }

    let result = install_agent_inner(&agent_id, &app).await;

    if result.is_ok() && matches!(agent_id, CanonicalAgentId::Copilot) {
        if let Err(error) =
            crate::acp::providers::copilot_model_catalog::invalidate_catalog_snapshot_for_app(&app)
                .await
        {
            tracing::warn!(error = %error, "Failed invalidating Copilot catalog snapshot after install");
        }

        let warmup_cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        crate::acp::providers::copilot_model_catalog::warm_catalog_in_background(
            app.clone(),
            warmup_cwd,
        );
    }

    if result.is_ok() && matches!(agent_id, CanonicalAgentId::ClaudeCode) {
        if let Err(error) =
            crate::acp::providers::claude_code_model_catalog::invalidate_catalog_snapshot_for_app(
                &app,
            )
            .await
        {
            tracing::warn!(error = %error, "Failed invalidating Claude catalog snapshot after install");
        }

        crate::acp::providers::claude_code_model_catalog::warm_catalog_in_background(app.clone());
    }

    // Always release the guard
    {
        let mut guard = install_guard().lock().await;
        guard.remove(&agent_id);
    }

    result
}

/// Uninstall an agent by removing its cache directory.
pub fn uninstall(agent_id: &CanonicalAgentId) -> AcpResult<()> {
    if matches!(agent_id, CanonicalAgentId::ClaudeCode) {
        if let Some(cache_dir) = cc_sdk::cli_download::get_cache_dir() {
            if cache_dir.exists() {
                std::fs::remove_dir_all(&cache_dir).map_err(|e| {
                    AcpError::InvalidState(format!("Failed to remove Claude CLI cache: {}", e))
                })?;
                tracing::info!(agent = %agent_id_str(agent_id), "Managed agent uninstalled");
            }
        }

        return Ok(());
    }

    let dir = cache_dir()?;
    let agent_dir = dir.join(agent_id_str(agent_id));

    if agent_dir.exists() {
        std::fs::remove_dir_all(&agent_dir)
            .map_err(|e| AcpError::InvalidState(format!("Failed to remove agent cache: {}", e)))?;
        tracing::info!(agent = %agent_id_str(agent_id), "Agent uninstalled");
    }

    Ok(())
}

/// Clean up stale `.tmp` directories from interrupted installs.
pub fn cleanup_stale_temps() {
    let Some(dir) = AGENTS_CACHE_DIR.get() else {
        return;
    };

    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name();
            if name.to_string_lossy().ends_with(".tmp") {
                tracing::info!(path = %path.display(), "Cleaning up stale temp directory");
                let _ = std::fs::remove_dir_all(&path);
            }
        }
    }
}

// ============================================
// INTERNAL
// ============================================

async fn install_agent_inner(agent_id: &CanonicalAgentId, app: &AppHandle) -> AcpResult<PathBuf> {
    let id_str = agent_id_str(agent_id);

    if matches!(agent_source(agent_id), AgentSource::ClaudeCli) {
        return install_claude_cli(app, &id_str).await;
    }

    let base_dir = cache_dir()?;

    // Single HTTP client for the entire install flow (connection reuse)
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .map_err(AcpError::HttpError)?;

    emit_progress(
        app,
        &id_str,
        "downloading",
        Some(0.0),
        "Resolving download source...",
    );

    // 1. Fetch download info from the appropriate source
    let download_info = match agent_source(agent_id) {
        AgentSource::Registry => fetch_download_info(&client, agent_id).await?,
        AgentSource::CopilotGitHubRelease => fetch_copilot_download_info(&client).await?,
        AgentSource::CodexGitHubRelease => fetch_codex_download_info(&client).await?,
        AgentSource::ClaudeCli => unreachable!("Claude install path returns early"),
    };

    // 2. Validate URL against allowlist
    validate_url(&download_info.archive_url)?;

    emit_progress(
        app,
        &id_str,
        "downloading",
        Some(0.05),
        &format!("Downloading {} v{}...", id_str, download_info.version),
    );

    // 3. Download archive with progress
    let archive_bytes = download_archive(&client, &download_info.archive_url, app, &id_str).await?;

    // 4. Compute SHA-256 of downloaded archive
    let mut hasher = Sha256::new();
    hasher.update(&archive_bytes);
    let sha256 = format!("{:x}", hasher.finalize());

    if let Some(expected_sha256) = download_info.official_sha256.as_deref() {
        if sha256 != expected_sha256 {
            return Err(AcpError::InvalidState(format!(
                "Downloaded archive checksum did not match upstream manifest for {}: expected {}, got {}",
                id_str, expected_sha256, sha256
            )));
        }
    }

    emit_progress(app, &id_str, "extracting", Some(0.8), "Extracting...");

    // 5. Delete existing dir if present (upgrade case)
    let agent_dir = base_dir.join(&id_str);
    let tmp_dir = base_dir.join(format!("{}.tmp", id_str));

    if tmp_dir.exists() {
        std::fs::remove_dir_all(&tmp_dir)
            .map_err(|e| AcpError::InvalidState(format!("Failed to clean tmp dir: {}", e)))?;
    }
    std::fs::create_dir_all(&tmp_dir)
        .map_err(|e| AcpError::InvalidState(format!("Failed to create tmp dir: {}", e)))?;

    // 6. Extract with path traversal protection
    if download_info.archive_url.ends_with(".tar.gz") || download_info.archive_url.ends_with(".tgz")
    {
        safe_extract_tar_gz(&archive_bytes, &tmp_dir)?;
    } else if download_info.archive_url.ends_with(".zip") {
        safe_extract_zip(&archive_bytes, &tmp_dir)?;
    } else {
        return Err(AcpError::InvalidState(format!(
            "Unsupported archive format: {}",
            download_info.archive_url
        )));
    }

    // 7. Write meta.json
    let meta = AgentMeta {
        version: download_info.version.clone(),
        archive_url: download_info.archive_url.clone(),
        sha256: Some(sha256),
        downloaded_at: chrono::Utc::now().to_rfc3339(),
        cmd: download_info.cmd.clone(),
        args: download_info.args.clone(),
    };
    let meta_json = serde_json::to_string_pretty(&meta).map_err(AcpError::SerializationError)?;
    std::fs::write(tmp_dir.join("meta.json"), meta_json)
        .map_err(|e| AcpError::InvalidState(format!("Failed to write meta.json: {}", e)))?;

    // 8. Set executable permissions
    let cmd_rel = download_info
        .cmd
        .strip_prefix("./")
        .unwrap_or(&download_info.cmd);
    let binary_path = tmp_dir.join(cmd_rel);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if binary_path.exists() {
            let perms = std::fs::Permissions::from_mode(0o500);
            std::fs::set_permissions(&binary_path, perms)
                .map_err(|e| AcpError::InvalidState(format!("Failed to set permissions: {}", e)))?;
        }
    }

    // 9. Atomic rename: .tmp/ → final/
    if agent_dir.exists() {
        std::fs::remove_dir_all(&agent_dir).map_err(|e| {
            AcpError::InvalidState(format!("Failed to remove old agent dir: {}", e))
        })?;
    }
    std::fs::rename(&tmp_dir, &agent_dir).map_err(|e| {
        AcpError::InvalidState(format!("Failed to finalize install (rename): {}", e))
    })?;

    let final_binary = agent_dir.join(cmd_rel);
    tracing::info!(
        agent = %id_str,
        version = %download_info.version,
        path = %final_binary.display(),
        "Agent installed successfully"
    );

    emit_progress(app, &id_str, "complete", Some(1.0), "Installed");

    Ok(final_binary)
}

async fn install_claude_cli(app: &AppHandle, agent_id: &str) -> AcpResult<PathBuf> {
    emit_progress(
        app,
        agent_id,
        "downloading",
        Some(0.0),
        "Preparing Acepe-managed Claude install...",
    );

    let app_handle = app.clone();
    let agent_id_string = agent_id.to_string();
    let path = cc_sdk::cli_download::download_cli(
        None,
        Some(Box::new(move |downloaded, total| {
            let (progress, message) = if let Some(total_bytes) = total {
                let progress = if total_bytes == 0 {
                    0.5
                } else {
                    downloaded as f64 / total_bytes as f64
                };
                (
                    Some(0.05 + progress * 0.90),
                    format!(
                        "Downloading Acepe-managed Claude CLI... {:.1} MB / {:.1} MB",
                        downloaded as f64 / 1_048_576.0,
                        total_bytes as f64 / 1_048_576.0
                    ),
                )
            } else {
                (
                    Some(0.5),
                    "Downloading Acepe-managed Claude CLI...".to_string(),
                )
            };

            emit_progress(
                &app_handle,
                &agent_id_string,
                "downloading",
                progress,
                &message,
            );
        })),
    )
    .await
    .map_err(|error| AcpError::InvalidState(format!("Failed to install Claude CLI: {}", error)))?;

    emit_progress(
        app,
        agent_id,
        "complete",
        Some(1.0),
        "Acepe-managed Claude ready",
    );
    Ok(path)
}

/// Fetch download info from the ACP registry for a given agent.
async fn fetch_download_info(
    client: &reqwest::Client,
    agent_id: &CanonicalAgentId,
) -> AcpResult<DownloadInfo> {
    let registry: Registry = client
        .get(REGISTRY_URL)
        .send()
        .await
        .map_err(AcpError::HttpError)?
        .json()
        .await
        .map_err(AcpError::HttpError)?;

    let id_str = agent_id_str(agent_id);
    let agent = registry
        .agents
        .iter()
        .find(|a| a.id == id_str)
        .ok_or_else(|| {
            AcpError::AgentNotFound(format!("Agent '{}' not found in ACP registry", id_str))
        })?;

    let platform = platform_key()?;
    let distribution = agent
        .distribution
        .as_ref()
        .and_then(|d| d.binary.as_ref())
        .and_then(|b| b.get(platform))
        .ok_or_else(|| {
            AcpError::InvalidState(format!(
                "No binary distribution for agent '{}' on platform '{}'",
                id_str, platform
            ))
        })?;

    Ok(DownloadInfo {
        archive_url: distribution.archive.clone(),
        version: agent.version.clone(),
        cmd: distribution.cmd.clone(),
        args: distribution.args.clone(),
        official_sha256: None,
    })
}

/// Fetch download info from a GitHub Release asset.
///
/// Finds the latest release matching `tag_prefix` and resolves the expected asset.
async fn fetch_github_release_download_info(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    tag_prefix: &str,
    expected_asset: &str,
    cmd: &str,
) -> AcpResult<DownloadInfo> {
    // Fetch releases and find the latest one matching our tag prefix
    let api_url = format!("https://api.github.com/repos/{}/{}/releases", owner, repo);
    let releases: Vec<GitHubRelease> = client
        .get(&api_url)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "acepe-agent-installer")
        .query(&[("per_page", "5")])
        .send()
        .await
        .map_err(AcpError::HttpError)?
        .error_for_status()
        .map_err(AcpError::HttpError)?
        .json()
        .await
        .map_err(AcpError::HttpError)?;

    let release = releases
        .iter()
        .find(|r| r.tag_name.starts_with(tag_prefix))
        .ok_or_else(|| {
            AcpError::AgentNotFound(format!(
                "No GitHub release found with tag prefix '{}' in {}/{}",
                tag_prefix, owner, repo
            ))
        })?;

    let version = release
        .tag_name
        .strip_prefix(tag_prefix)
        .unwrap_or(&release.tag_name)
        .to_string();

    let asset = release
        .assets
        .iter()
        .find(|a| a.name == expected_asset)
        .ok_or_else(|| {
            AcpError::InvalidState(format!(
                "No asset '{}' found in release '{}' (available: {})",
                expected_asset,
                release.tag_name,
                release
                    .assets
                    .iter()
                    .map(|a| a.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        })?;

    Ok(DownloadInfo {
        archive_url: asset.browser_download_url.clone(),
        version,
        cmd: cmd.to_string(),
        args: vec![],
        official_sha256: None,
    })
}

async fn fetch_codex_download_info(client: &reqwest::Client) -> AcpResult<DownloadInfo> {
    fetch_github_release_download_info(
        client,
        "openai",
        "codex",
        "rust-v",
        codex_release_asset_name(),
        codex_release_command(),
    )
    .await
}

async fn fetch_copilot_download_info(client: &reqwest::Client) -> AcpResult<DownloadInfo> {
    let release = fetch_latest_github_release(client, "github", "copilot-cli").await?;
    let expected_asset =
        copilot_release_asset_name_for(std::env::consts::OS, std::env::consts::ARCH)?;
    let checksum_asset = find_release_asset(&release, "SHA256SUMS.txt")?;
    let archive_asset = find_release_asset(&release, expected_asset)?;
    let checksum_manifest =
        download_text_asset(client, &checksum_asset.browser_download_url).await?;
    let official_sha256 = parse_sha256_manifest(&checksum_manifest, expected_asset)?;

    Ok(DownloadInfo {
        archive_url: archive_asset.browser_download_url.clone(),
        version: normalize_github_release_version(&release.tag_name),
        cmd: copilot_release_command_for(std::env::consts::OS).to_string(),
        args: vec![],
        official_sha256: Some(official_sha256),
    })
}

/// Download archive bytes with streaming progress.
///
/// Validates the final URL after redirects to prevent allowlist bypass.
async fn download_archive(
    client: &reqwest::Client,
    url: &str,
    app: &AppHandle,
    agent_id: &str,
) -> AcpResult<Vec<u8>> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(AcpError::HttpError)?
        .error_for_status()
        .map_err(AcpError::HttpError)?;

    // Validate final URL after redirects to prevent allowlist bypass
    let final_url = response.url().as_str();
    validate_url(final_url).map_err(|_| {
        AcpError::InvalidState(format!(
            "Download redirected to URL outside allowlist: {}",
            final_url
        ))
    })?;

    let total_bytes = response.content_length().unwrap_or(0);
    if total_bytes > MAX_DOWNLOAD_SIZE {
        return Err(AcpError::InvalidState(format!(
            "Download too large: {} bytes (max {})",
            total_bytes, MAX_DOWNLOAD_SIZE
        )));
    }

    if total_bytes == 0 {
        tracing::warn!("Server did not send Content-Length; pre-flight size check skipped");
    }

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let capacity = if total_bytes > 0 {
        total_bytes as usize
    } else {
        DEFAULT_DOWNLOAD_CAPACITY
    };
    let mut buffer = Vec::with_capacity(capacity);

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(AcpError::HttpError)?;
        downloaded += chunk.len() as u64;

        if downloaded > MAX_DOWNLOAD_SIZE {
            return Err(AcpError::InvalidState(
                "Download exceeded size limit".to_string(),
            ));
        }

        buffer.extend_from_slice(&chunk);

        if total_bytes > 0 {
            let progress = 0.05 + (downloaded as f64 / total_bytes as f64) * 0.70;
            emit_progress(
                app,
                agent_id,
                "downloading",
                Some(progress),
                &format!(
                    "Downloading... {:.1} MB / {:.1} MB",
                    downloaded as f64 / 1_048_576.0,
                    total_bytes as f64 / 1_048_576.0
                ),
            );
        }
    }

    Ok(buffer)
}

/// Validate a download URL against the allowlist.
fn validate_url(url: &str) -> AcpResult<()> {
    if !ALLOWED_URL_PREFIXES
        .iter()
        .any(|prefix| url.starts_with(prefix))
    {
        return Err(AcpError::InvalidState(format!(
            "Download URL not in allowlist: {}",
            url
        )));
    }
    Ok(())
}

async fn fetch_latest_github_release(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
) -> AcpResult<GitHubRelease> {
    let api_url = format!(
        "https://api.github.com/repos/{}/{}/releases/latest",
        owner, repo
    );

    client
        .get(&api_url)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "acepe-agent-installer")
        .send()
        .await
        .map_err(AcpError::HttpError)?
        .error_for_status()
        .map_err(AcpError::HttpError)?
        .json()
        .await
        .map_err(AcpError::HttpError)
}

fn find_release_asset<'a>(
    release: &'a GitHubRelease,
    asset_name: &str,
) -> AcpResult<&'a GitHubAsset> {
    release
        .assets
        .iter()
        .find(|asset| asset.name == asset_name)
        .ok_or_else(|| {
            AcpError::InvalidState(format!(
                "No asset '{}' found in release '{}' (available: {})",
                asset_name,
                release.tag_name,
                release
                    .assets
                    .iter()
                    .map(|asset| asset.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        })
}

async fn download_text_asset(client: &reqwest::Client, url: &str) -> AcpResult<String> {
    validate_url(url)?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(AcpError::HttpError)?
        .error_for_status()
        .map_err(AcpError::HttpError)?;

    validate_url(response.url().as_str())?;

    response.text().await.map_err(AcpError::HttpError)
}

fn normalize_github_release_version(tag_name: &str) -> String {
    tag_name.strip_prefix('v').unwrap_or(tag_name).to_string()
}

fn parse_sha256_manifest(manifest: &str, expected_asset: &str) -> AcpResult<String> {
    for line in manifest.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let mut parts = trimmed.split_whitespace();
        let Some(sha256) = parts.next() else {
            continue;
        };
        let Some(asset_name) = parts.next() else {
            continue;
        };

        let asset_name = asset_name.strip_prefix('*').unwrap_or(asset_name);
        let normalized_name = asset_name.strip_prefix("./").unwrap_or(asset_name);

        if normalized_name == expected_asset {
            return Ok(sha256.to_string());
        }
    }

    Err(AcpError::InvalidState(format!(
        "Official checksum manifest did not contain an entry for {}",
        expected_asset
    )))
}

/// Get the current platform key for the ACP registry.
fn platform_key() -> AcpResult<&'static str> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Ok("darwin-aarch64");
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return Ok("darwin-x86_64");
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return Ok("linux-x86_64");
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return Ok("linux-aarch64");
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return Ok("windows-x86_64");
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        return Ok("windows-aarch64");
    }

    #[allow(unreachable_code)]
    Err(AcpError::InvalidState("Unsupported platform".to_string()))
}

/// Map CanonicalAgentId to the registry ID string.
///
/// Exhaustive match ensures compile errors when new variants are added.
/// Registry IDs differ from canonical display IDs because the registry
/// uses the binary/package name, not the product name:
/// - ClaudeCode → "claude-code" (install progress / logical cache key)
/// - Codex → "codex" (official CLI binary and cache directory)
/// - Cursor → "cursor" (matches canonical)
/// - OpenCode → "opencode" (matches canonical)
fn agent_id_str(agent_id: &CanonicalAgentId) -> String {
    match agent_id {
        CanonicalAgentId::Cursor => "cursor".to_string(),
        CanonicalAgentId::Copilot => "copilot".to_string(),
        CanonicalAgentId::OpenCode => "opencode".to_string(),
        CanonicalAgentId::ClaudeCode => "claude-code".to_string(),
        CanonicalAgentId::Codex => "codex".to_string(),
        CanonicalAgentId::Forge => "forge".to_string(),
        CanonicalAgentId::Custom(id) => {
            // Sanitize: reject path separators and traversal to prevent directory escape
            assert!(
                !id.contains('/') && !id.contains('\\') && !id.contains("..") && !id.is_empty(),
                "Custom agent ID contains illegal characters: {}",
                id
            );
            id.clone()
        }
    }
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn codex_release_asset_name() -> &'static str {
    "codex-aarch64-apple-darwin.tar.gz"
}

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
fn codex_release_asset_name() -> &'static str {
    "codex-x86_64-apple-darwin.tar.gz"
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn codex_release_asset_name() -> &'static str {
    "codex-x86_64-unknown-linux-gnu.tar.gz"
}

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
fn codex_release_asset_name() -> &'static str {
    "codex-aarch64-unknown-linux-gnu.tar.gz"
}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
fn codex_release_asset_name() -> &'static str {
    "codex-x86_64-pc-windows-msvc.exe.zip"
}

#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
fn codex_release_asset_name() -> &'static str {
    "codex-aarch64-pc-windows-msvc.exe.zip"
}

#[cfg(not(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "macos", target_arch = "x86_64"),
    all(target_os = "linux", target_arch = "x86_64"),
    all(target_os = "linux", target_arch = "aarch64"),
    all(target_os = "windows", target_arch = "x86_64"),
    all(target_os = "windows", target_arch = "aarch64")
)))]
fn codex_release_asset_name() -> &'static str {
    panic!("Unsupported platform for Codex release asset")
}

#[cfg(windows)]
fn codex_release_command() -> &'static str {
    "./codex.exe"
}

#[cfg(not(windows))]
fn codex_release_command() -> &'static str {
    "./codex"
}

fn copilot_release_asset_name_for(os: &str, arch: &str) -> AcpResult<&'static str> {
    match (os, arch) {
        ("macos", "aarch64") => Ok("copilot-darwin-arm64.tar.gz"),
        ("macos", "x86_64") => Ok("copilot-darwin-x64.tar.gz"),
        ("linux", "aarch64") => Ok("copilot-linux-arm64.tar.gz"),
        ("linux", "x86_64") => Ok("copilot-linux-x64.tar.gz"),
        ("windows", "aarch64") => Ok("copilot-win32-arm64.zip"),
        ("windows", "x86_64") => Ok("copilot-win32-x64.zip"),
        _ => Err(AcpError::InvalidState(format!(
            "Unsupported Copilot platform: {}/{}",
            os, arch
        ))),
    }
}

fn copilot_release_command_for(os: &str) -> &'static str {
    if os == "windows" {
        "./copilot.exe"
    } else {
        "./copilot"
    }
}

// ============================================
// ARCHIVE EXTRACTION (with path traversal protection)
// ============================================

fn safe_extract_tar_gz(data: &[u8], target_dir: &Path) -> AcpResult<()> {
    let gz = flate2::read::GzDecoder::new(data);
    let mut archive = tar::Archive::new(gz);

    for entry in archive
        .entries()
        .map_err(|e| AcpError::InvalidState(format!("Failed to read tar entries: {}", e)))?
    {
        let mut entry = entry
            .map_err(|e| AcpError::InvalidState(format!("Failed to read tar entry: {}", e)))?;

        // Reject symlinks — agent archives should never contain them
        let entry_type = entry.header().entry_type();
        if entry_type == tar::EntryType::Symlink || entry_type == tar::EntryType::Link {
            let path = entry.path().unwrap_or_default();
            return Err(AcpError::InvalidState(format!(
                "Archive contains forbidden symlink: {}",
                path.display()
            )));
        }

        let path = entry
            .path()
            .map_err(|e| AcpError::InvalidState(format!("Invalid tar entry path: {}", e)))?;

        // Zip-slip protection
        validate_archive_path(&path)?;

        entry
            .unpack_in(target_dir)
            .map_err(|e| AcpError::InvalidState(format!("Failed to extract tar entry: {}", e)))?;
    }

    Ok(())
}

fn safe_extract_zip(data: &[u8], target_dir: &Path) -> AcpResult<()> {
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| AcpError::InvalidState(format!("Failed to read zip archive: {}", e)))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| AcpError::InvalidState(format!("Failed to read zip entry: {}", e)))?;

        let name = file.name().to_string();

        // Reject symlinks — agent archives should never contain them
        if file.is_symlink() {
            return Err(AcpError::InvalidState(format!(
                "Archive contains forbidden symlink: {}",
                name
            )));
        }

        // Zip-slip protection
        validate_archive_path(Path::new(&name))?;

        let out_path = target_dir.join(&name);

        if file.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| {
                AcpError::InvalidState(format!("Failed to create directory: {}", e))
            })?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| {
                    AcpError::InvalidState(format!("Failed to create parent dir: {}", e))
                })?;
            }
            let mut outfile = std::fs::File::create(&out_path)
                .map_err(|e| AcpError::InvalidState(format!("Failed to create file: {}", e)))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| AcpError::InvalidState(format!("Failed to write file: {}", e)))?;

            // Set executable permissions, stripping setuid/setgid/sticky bits
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Some(mode) = file.unix_mode() {
                    let safe_mode = mode & 0o755;
                    let perms = std::fs::Permissions::from_mode(safe_mode);
                    let _ = std::fs::set_permissions(&out_path, perms);
                }
            }
        }
    }

    Ok(())
}

/// Validate that an archive entry path does not escape the target directory.
fn validate_archive_path(entry_path: &Path) -> AcpResult<()> {
    let path_str = entry_path.to_string_lossy();

    // Reject absolute paths
    if entry_path.is_absolute() {
        return Err(AcpError::InvalidState(format!(
            "Archive contains absolute path: {}",
            path_str
        )));
    }

    // Reject path traversal
    for component in entry_path.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err(AcpError::InvalidState(format!(
                "Archive contains path traversal: {}",
                path_str
            )));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_uses_official_cache_key() {
        assert_eq!(agent_id_str(&CanonicalAgentId::Codex), "codex");
    }

    #[test]
    fn copilot_uses_official_cache_key() {
        assert_eq!(agent_id_str(&CanonicalAgentId::Copilot), "copilot");
    }

    #[test]
    fn forge_uses_path_backed_cache_key() {
        assert_eq!(agent_id_str(&CanonicalAgentId::Forge), "forge");
    }

    #[test]
    fn all_managed_built_in_agents_are_auto_installable() {
        assert!(can_auto_install(&CanonicalAgentId::ClaudeCode));
        assert!(can_auto_install(&CanonicalAgentId::Cursor));
        assert!(can_auto_install(&CanonicalAgentId::Copilot));
        assert!(can_auto_install(&CanonicalAgentId::OpenCode));
        assert!(can_auto_install(&CanonicalAgentId::Codex));
    }

    #[test]
    fn forge_is_not_auto_installable() {
        assert!(!can_auto_install(&CanonicalAgentId::Forge));
    }

    #[test]
    fn copilot_release_asset_name_supports_all_known_platforms() {
        assert_eq!(
            copilot_release_asset_name_for("macos", "aarch64").unwrap(),
            "copilot-darwin-arm64.tar.gz"
        );
        assert_eq!(
            copilot_release_asset_name_for("macos", "x86_64").unwrap(),
            "copilot-darwin-x64.tar.gz"
        );
        assert_eq!(
            copilot_release_asset_name_for("linux", "aarch64").unwrap(),
            "copilot-linux-arm64.tar.gz"
        );
        assert_eq!(
            copilot_release_asset_name_for("linux", "x86_64").unwrap(),
            "copilot-linux-x64.tar.gz"
        );
        assert_eq!(
            copilot_release_asset_name_for("windows", "aarch64").unwrap(),
            "copilot-win32-arm64.zip"
        );
        assert_eq!(
            copilot_release_asset_name_for("windows", "x86_64").unwrap(),
            "copilot-win32-x64.zip"
        );
    }

    #[test]
    fn copilot_release_asset_name_rejects_unsupported_platform() {
        let error = copilot_release_asset_name_for("freebsd", "x86_64")
            .expect_err("unsupported platform should fail");

        assert!(
            matches!(error, AcpError::InvalidState(message) if message.contains("Unsupported Copilot platform"))
        );
    }

    #[test]
    fn parse_sha256_manifest_returns_checksum_for_matching_asset() {
        let manifest = "abc123  copilot-darwin-arm64.tar.gz\nfff999  copilot-linux-x64.tar.gz\n";

        let checksum = parse_sha256_manifest(manifest, "copilot-linux-x64.tar.gz").unwrap();

        assert_eq!(checksum, "fff999");
    }

    #[test]
    fn parse_sha256_manifest_rejects_missing_asset() {
        let manifest = "abc123  copilot-darwin-arm64.tar.gz\n";

        let error = parse_sha256_manifest(manifest, "copilot-linux-x64.tar.gz")
            .expect_err("missing manifest entry should fail");

        assert!(
            matches!(error, AcpError::InvalidState(message) if message.contains("Official checksum manifest did not contain an entry"))
        );
    }

    #[test]
    fn validate_archive_path_rejects_parent_dir() {
        assert!(validate_archive_path(Path::new("../etc/passwd")).is_err());
        assert!(validate_archive_path(Path::new("foo/../../bar")).is_err());
    }

    #[test]
    fn validate_archive_path_rejects_absolute() {
        assert!(validate_archive_path(Path::new("/etc/passwd")).is_err());
    }

    #[test]
    fn validate_archive_path_allows_normal() {
        assert!(validate_archive_path(Path::new("dist-package/cursor-agent")).is_ok());
        assert!(validate_archive_path(Path::new("opencode")).is_ok());
        assert!(validate_archive_path(Path::new("./foo/bar")).is_ok());
    }

    #[test]
    fn validate_url_allows_listed() {
        assert!(validate_url("https://downloads.cursor.com/lab/v1/foo.tar.gz").is_ok());
        assert!(validate_url("https://github.com/anomalyco/opencode/releases/v1.zip").is_ok());
        assert!(validate_url("https://cdn.agentclientprotocol.com/foo").is_ok());
        // GitHub release downloads redirect to these CDN domains
        assert!(validate_url(
            "https://release-assets.githubusercontent.com/github-production-release-asset/123/abc"
        )
        .is_ok());
        assert!(validate_url(
            "https://objects.githubusercontent.com/github-production-release-asset/123/abc"
        )
        .is_ok());
    }

    #[test]
    fn validate_url_rejects_unlisted() {
        assert!(validate_url("https://evil.com/malware.tar.gz").is_err());
        assert!(validate_url("http://downloads.cursor.com/insecure").is_err());
    }
}
