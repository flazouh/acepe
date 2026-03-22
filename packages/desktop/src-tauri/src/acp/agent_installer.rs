//! Agent binary installer — downloads, caches, and manages Cursor & OpenCode binaries.
//!
//! Follows Zed's pattern: download from the ACP registry CDN, extract to a local cache,
//! and resolve from cache (no PATH fallback).

use crate::acp::error::{AcpError, AcpResult};
use crate::acp::types::CanonicalAgentId;
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

/// Check if an agent is installed in the cache.
pub fn is_installed(agent_id: &CanonicalAgentId) -> bool {
    get_cached_binary(agent_id).is_some()
}

/// Install an agent by downloading from the ACP registry.
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

    // Always release the guard
    {
        let mut guard = install_guard().lock().await;
        guard.remove(&agent_id);
    }

    result
}

/// Uninstall an agent by removing its cache directory.
pub fn uninstall(agent_id: &CanonicalAgentId) -> AcpResult<()> {
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
        "Fetching registry...",
    );

    // 1. Fetch registry and find the agent
    let (archive_url, version, cmd, args) = fetch_download_info(&client, agent_id).await?;

    // 2. Validate URL against allowlist
    validate_url(&archive_url)?;

    emit_progress(
        app,
        &id_str,
        "downloading",
        Some(0.05),
        &format!("Downloading {} v{}...", id_str, version),
    );

    // 3. Download archive with progress
    let archive_bytes = download_archive(&client, &archive_url, app, &id_str).await?;

    // 4. Compute SHA-256 of downloaded archive
    let mut hasher = Sha256::new();
    hasher.update(&archive_bytes);
    let sha256 = format!("{:x}", hasher.finalize());

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
    if archive_url.ends_with(".tar.gz") || archive_url.ends_with(".tgz") {
        safe_extract_tar_gz(&archive_bytes, &tmp_dir)?;
    } else if archive_url.ends_with(".zip") {
        safe_extract_zip(&archive_bytes, &tmp_dir)?;
    } else {
        return Err(AcpError::InvalidState(format!(
            "Unsupported archive format: {}",
            archive_url
        )));
    }

    // 7. Write meta.json
    let meta = AgentMeta {
        version: version.clone(),
        archive_url: archive_url.clone(),
        sha256: Some(sha256),
        downloaded_at: chrono::Utc::now().to_rfc3339(),
        cmd: cmd.clone(),
        args: args.clone(),
    };
    let meta_json = serde_json::to_string_pretty(&meta).map_err(AcpError::SerializationError)?;
    std::fs::write(tmp_dir.join("meta.json"), meta_json)
        .map_err(|e| AcpError::InvalidState(format!("Failed to write meta.json: {}", e)))?;

    // 8. Set executable permissions
    let cmd_rel = cmd.strip_prefix("./").unwrap_or(&cmd);
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
        version = %version,
        path = %final_binary.display(),
        "Agent installed successfully"
    );

    emit_progress(app, &id_str, "complete", Some(1.0), "Installed");

    Ok(final_binary)
}

/// Fetch download info from the ACP registry for a given agent.
async fn fetch_download_info(
    client: &reqwest::Client,
    agent_id: &CanonicalAgentId,
) -> AcpResult<(String, String, String, Vec<String>)> {
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

    Ok((
        distribution.archive.clone(),
        agent.version.clone(),
        distribution.cmd.clone(),
        distribution.args.clone(),
    ))
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
fn agent_id_str(agent_id: &CanonicalAgentId) -> String {
    match agent_id {
        CanonicalAgentId::Cursor => "cursor".to_string(),
        CanonicalAgentId::OpenCode => "opencode".to_string(),
        CanonicalAgentId::ClaudeCode => "claude-code".to_string(),
        CanonicalAgentId::Codex => "codex".to_string(),
        CanonicalAgentId::Custom(id) => id.clone(),
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

            // Set executable permissions for binary files
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Some(mode) = file.unix_mode() {
                    let perms = std::fs::Permissions::from_mode(mode);
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
