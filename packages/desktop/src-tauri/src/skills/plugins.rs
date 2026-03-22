//! Plugin skills discovery module.
//!
//! Scans `~/.claude/plugins/cache/` for installed plugins and their skills.
//! Plugins are organized as: marketplace/plugin-name/version/skills/

use std::cmp::Ordering;
use std::path::PathBuf;

use crate::skills::parser::parse_skill_content;
use crate::skills::types::{PluginInfo, PluginSkill};

/// Service for discovering and managing plugin skills.
pub struct PluginDiscovery {
    /// Base path for plugin cache
    plugins_cache_dir: PathBuf,
}

impl PluginDiscovery {
    /// Create a new PluginDiscovery service.
    pub fn new() -> Self {
        let plugins_cache_dir = dirs::home_dir()
            .map(|home| home.join(".claude").join("plugins").join("cache"))
            .unwrap_or_else(|| PathBuf::from(""));

        Self { plugins_cache_dir }
    }

    /// Discover all installed plugins with skills.
    pub async fn discover_plugins(&self) -> Result<Vec<PluginInfo>, String> {
        if !self.plugins_cache_dir.exists() {
            return Ok(vec![]);
        }

        let mut plugins = Vec::new();

        // Read marketplace directories
        let marketplaces = tokio::fs::read_dir(&self.plugins_cache_dir)
            .await
            .map_err(|e| format!("Failed to read plugins cache: {}", e))?;

        let mut marketplaces = marketplaces;
        while let Some(marketplace_entry) = marketplaces
            .next_entry()
            .await
            .map_err(|e| format!("Failed to read marketplace entry: {}", e))?
        {
            let marketplace_path = marketplace_entry.path();
            if !marketplace_path.is_dir() {
                continue;
            }

            let marketplace_name = marketplace_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            // Skip hidden directories
            if marketplace_name.starts_with('.') {
                continue;
            }

            // Read plugin directories within marketplace
            let plugin_dirs = tokio::fs::read_dir(&marketplace_path)
                .await
                .map_err(|e| format!("Failed to read marketplace dir: {}", e))?;

            let mut plugin_dirs = plugin_dirs;
            while let Some(plugin_entry) = plugin_dirs
                .next_entry()
                .await
                .map_err(|e| format!("Failed to read plugin entry: {}", e))?
            {
                let plugin_path = plugin_entry.path();
                if !plugin_path.is_dir() {
                    continue;
                }

                let plugin_name = plugin_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                // Skip hidden directories
                if plugin_name.starts_with('.') {
                    continue;
                }

                // Find latest version
                if let Some(latest_version) = self.find_latest_version(&plugin_path).await? {
                    let skills_dir = plugin_path.join(&latest_version).join("skills");

                    // Only include plugins that have a skills directory
                    if skills_dir.exists() {
                        let skill_count = self.count_skills(&skills_dir).await?;

                        plugins.push(PluginInfo {
                            id: format!("{}::{}", marketplace_name, plugin_name),
                            marketplace: marketplace_name.clone(),
                            name: plugin_name,
                            version: latest_version,
                            skills_dir: skills_dir.to_string_lossy().to_string(),
                            skill_count,
                        });
                    }
                }
            }
        }

        // Sort plugins by name
        plugins.sort_by(|a, b| a.name.cmp(&b.name));

        Ok(plugins)
    }

    /// Find the latest version directory using semver comparison.
    async fn find_latest_version(&self, plugin_path: &PathBuf) -> Result<Option<String>, String> {
        let versions = tokio::fs::read_dir(plugin_path)
            .await
            .map_err(|e| format!("Failed to read plugin versions: {}", e))?;

        let mut version_strings = Vec::new();
        let mut versions = versions;

        while let Some(version_entry) = versions
            .next_entry()
            .await
            .map_err(|e| format!("Failed to read version entry: {}", e))?
        {
            let version_path = version_entry.path();
            if !version_path.is_dir() {
                continue;
            }

            if let Some(version_name) = version_path.file_name().and_then(|n| n.to_str()) {
                // Skip hidden directories
                if !version_name.starts_with('.') {
                    version_strings.push(version_name.to_string());
                }
            }
        }

        if version_strings.is_empty() {
            return Ok(None);
        }

        // Sort versions using semver comparison (highest first)
        version_strings.sort_by(|a, b| compare_versions(b, a));

        Ok(version_strings.into_iter().next())
    }

    /// Count the number of skills in a directory.
    async fn count_skills(&self, skills_dir: &PathBuf) -> Result<i32, String> {
        let entries = tokio::fs::read_dir(skills_dir)
            .await
            .map_err(|e| format!("Failed to read skills directory: {}", e))?;

        let mut count = 0;
        let mut entries = entries;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| format!("Failed to read skill entry: {}", e))?
        {
            let path = entry.path();
            if path.is_dir() {
                let skill_md = path.join("SKILL.md");
                if skill_md.exists() {
                    count += 1;
                }
            }
        }

        Ok(count)
    }

    /// List all skills for a specific plugin.
    pub async fn list_plugin_skills(&self, plugin_id: &str) -> Result<Vec<PluginSkill>, String> {
        let plugins = self.discover_plugins().await?;

        let plugin = plugins
            .iter()
            .find(|p| p.id == plugin_id)
            .ok_or_else(|| format!("Plugin not found: {}", plugin_id))?;

        let skills_dir = PathBuf::from(&plugin.skills_dir);
        if !skills_dir.exists() {
            return Ok(vec![]);
        }

        let mut skills = Vec::new();

        let entries = tokio::fs::read_dir(&skills_dir)
            .await
            .map_err(|e| format!("Failed to read plugin skills directory: {}", e))?;

        let mut dir_entries = Vec::new();
        let mut entries = entries;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| format!("Failed to read skill entry: {}", e))?
        {
            dir_entries.push(entry);
        }

        // Sort entries alphabetically
        dir_entries.sort_by_key(|a| a.file_name());

        for entry in dir_entries {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let folder_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            // Skip hidden directories
            if folder_name.starts_with('.') {
                continue;
            }

            let skill_md_path = path.join("SKILL.md");
            if !skill_md_path.exists() {
                continue;
            }

            match self
                .load_plugin_skill(&skill_md_path, plugin_id, &folder_name)
                .await
            {
                Ok(skill) => skills.push(skill),
                Err(e) => {
                    tracing::warn!(
                        plugin_id = %plugin_id,
                        folder = %folder_name,
                        error = %e,
                        "Failed to load plugin skill"
                    );
                }
            }
        }

        Ok(skills)
    }

    /// Get a specific plugin skill by ID.
    pub async fn get_plugin_skill(&self, skill_id: &str) -> Result<PluginSkill, String> {
        // Skill ID format: marketplace::plugin::folder_name
        let parts: Vec<&str> = skill_id.split("::").collect();
        if parts.len() != 3 {
            return Err(format!("Invalid plugin skill ID format: {}", skill_id));
        }

        let plugin_id = format!("{}::{}", parts[0], parts[1]);
        let folder_name = parts[2];

        let plugins = self.discover_plugins().await?;
        let plugin = plugins
            .iter()
            .find(|p| p.id == plugin_id)
            .ok_or_else(|| format!("Plugin not found: {}", plugin_id))?;

        let skill_md_path = PathBuf::from(&plugin.skills_dir)
            .join(folder_name)
            .join("SKILL.md");

        if !skill_md_path.exists() {
            return Err(format!("Plugin skill not found: {}", skill_id));
        }

        self.load_plugin_skill(&skill_md_path, &plugin_id, folder_name)
            .await
    }

    /// Load a plugin skill from a SKILL.md file.
    async fn load_plugin_skill(
        &self,
        path: &PathBuf,
        plugin_id: &str,
        folder_name: &str,
    ) -> Result<PluginSkill, String> {
        let content = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| format!("Failed to read plugin skill file: {}", e))?;

        let (metadata, _body) = parse_skill_content(&content)?;

        let modified_at = tokio::fs::metadata(path)
            .await
            .map(|m| {
                m.modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0)
            })
            .unwrap_or(0);

        Ok(PluginSkill {
            id: format!("{}::{}", plugin_id, folder_name),
            plugin_id: plugin_id.to_string(),
            folder_name: folder_name.to_string(),
            path: path.to_string_lossy().to_string(),
            name: metadata.name,
            description: metadata.description,
            content,
            modified_at,
        })
    }
}

impl Default for PluginDiscovery {
    fn default() -> Self {
        Self::new()
    }
}

/// Compare two version strings using semver-like comparison.
/// Handles both semver (1.2.3) and commit hashes (abc123).
fn compare_versions(a: &str, b: &str) -> Ordering {
    // Try to parse as semver
    let a_parts: Vec<u64> = a.split('.').filter_map(|s| s.parse().ok()).collect();
    let b_parts: Vec<u64> = b.split('.').filter_map(|s| s.parse().ok()).collect();

    // If both have semver-like structure
    if !a_parts.is_empty() && !b_parts.is_empty() {
        for (av, bv) in a_parts.iter().zip(b_parts.iter()) {
            match av.cmp(bv) {
                Ordering::Equal => continue,
                other => return other,
            }
        }
        // If equal so far, longer version is greater
        return a_parts.len().cmp(&b_parts.len());
    }

    // Fall back to string comparison for non-semver versions (commit hashes)
    a.cmp(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compare_versions_semver() {
        assert_eq!(compare_versions("1.0.0", "1.0.0"), Ordering::Equal);
        assert_eq!(compare_versions("1.0.1", "1.0.0"), Ordering::Greater);
        assert_eq!(compare_versions("1.0.0", "1.0.1"), Ordering::Less);
        assert_eq!(compare_versions("2.0.0", "1.9.9"), Ordering::Greater);
        assert_eq!(compare_versions("4.0.3", "3.9.9"), Ordering::Greater);
    }

    #[test]
    fn test_compare_versions_different_lengths() {
        assert_eq!(compare_versions("1.0.0.1", "1.0.0"), Ordering::Greater);
        assert_eq!(compare_versions("1.0", "1.0.0"), Ordering::Less);
    }

    #[test]
    fn test_compare_versions_non_semver() {
        // For commit hashes, fall back to string comparison
        assert_eq!(compare_versions("abc123", "abc122"), Ordering::Greater);
    }
}
