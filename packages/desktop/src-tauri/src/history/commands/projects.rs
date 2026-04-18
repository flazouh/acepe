use super::*;
use crate::acp::provider::{AgentProvider, ProjectDiscoveryCompleteness};
use crate::acp::registry::AgentRegistry;
use crate::commands::observability::{unexpected_command_result, CommandResult};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

fn is_worktree_project_path(project_path: &str) -> bool {
    let repo = match crate::file_index::git::open_repository(std::path::Path::new(project_path)) {
        Ok(repo) => repo,
        Err(_) => return false,
    };
    let git_dir = match repo.path().canonicalize() {
        Ok(path) => path,
        Err(_) => repo.path().to_path_buf(),
    };

    if !git_dir.exists() {
        return false;
    }

    git_dir
        .components()
        .any(|component| component.as_os_str() == "worktrees")
}

#[derive(Debug)]
struct ProviderProjectDiscovery {
    agent_id: String,
    paths: Vec<String>,
    completeness: ProjectDiscoveryCompleteness,
    failed: bool,
}

fn visible_history_providers(app: &AppHandle) -> Vec<Arc<dyn AgentProvider>> {
    let registry = app.state::<Arc<AgentRegistry>>();
    registry
        .list_all_for_ui()
        .into_iter()
        .filter_map(|entry| {
            let canonical = crate::acp::types::CanonicalAgentId::parse(&entry.id);
            registry.get(&canonical)
        })
        .collect()
}

fn dedupe_project_infos(mut projects: Vec<ProjectInfo>) -> Vec<ProjectInfo> {
    let mut seen = HashSet::new();
    projects.retain(|project| seen.insert(project.path.clone()));
    projects
}

fn should_fallback_to_legacy_project_discovery(
    discoveries: &[ProviderProjectDiscovery],
    projects: &[ProjectInfo],
) -> bool {
    let unique_sources = projects
        .iter()
        .map(|project| project.agent_id.as_str())
        .collect::<HashSet<_>>()
        .len();
    let has_incomplete_provider = discoveries.iter().any(|discovery| {
        discovery.failed || discovery.completeness == ProjectDiscoveryCompleteness::Partial
    });

    has_incomplete_provider && unique_sources <= 1
}

#[tauri::command]
#[specta::specta]
pub async fn list_all_project_paths(app: AppHandle) -> CommandResult<Vec<ProjectInfo>> {
    unexpected_command_result("list_all_project_paths", "Failed to list project paths", async {

        let providers = visible_history_providers(&app);
        let mut discoveries = Vec::new();

        for provider in providers {
            let agent_id = provider.id().to_string();
            match provider.list_project_paths().await {
                Ok(listing) => discoveries.push(ProviderProjectDiscovery {
                    agent_id,
                    paths: listing.paths,
                    completeness: listing.completeness,
                    failed: false,
                }),
                Err(error) => {
                    tracing::warn!(agent_id = %agent_id, error = %error, "Failed to list provider projects");
                    discoveries.push(ProviderProjectDiscovery {
                        agent_id,
                        paths: Vec::new(),
                        completeness: ProjectDiscoveryCompleteness::Partial,
                        failed: true,
                    });
                }
            }
        }

        let projects = dedupe_project_infos(
            discoveries
                .iter()
                .flat_map(|discovery| {
                    discovery.paths.iter().map(|path| ProjectInfo {
                        is_worktree: is_worktree_project_path(path),
                        path: path.clone(),
                        agent_id: discovery.agent_id.clone(),
                    })
                })
                .collect(),
        );

        if should_fallback_to_legacy_project_discovery(&discoveries, &projects) {
            tracing::warn!("Project discovery coverage was incomplete, falling back to legacy scan");

            match discover_all_projects_with_sessions().await {
                Ok(entries) => {
                    let mut fallback_projects = Vec::new();
                    let mut seen_paths = HashSet::new();

                    for entry in entries {
                        if entry.project == "global" || !seen_paths.insert(entry.project.clone()) {
                            continue;
                        }

                        fallback_projects.push(ProjectInfo {
                            is_worktree: is_worktree_project_path(&entry.project),
                            path: entry.project,
                            agent_id: entry.agent_id.to_string(),
                        });
                    }

                    tracing::info!("Fallback method found {} projects", fallback_projects.len());
                    return Ok(fallback_projects);
                }
                Err(error) => {
                    tracing::warn!(error = ?error, "Legacy project discovery fallback failed");
                }
            }
        }

        Ok(projects)

    }.await)
}

#[tauri::command]
#[specta::specta]
pub async fn count_sessions_for_project(
    app: AppHandle,
    project_path: String,
) -> CommandResult<ProjectSessionCounts> {
    unexpected_command_result(
        "count_sessions_for_project",
        "Failed to count sessions for project",
        async {
            let providers = visible_history_providers(&app);
            let mut counts = HashMap::new();

            for provider in providers {
                let agent_id = provider.id().to_string();
                match provider.count_sessions_for_project(&project_path).await {
                    Ok(count) if count > 0 => {
                        counts.insert(agent_id, count);
                    }
                    Ok(_) => {}
                    Err(error) => {
                        tracing::warn!(
                            project = %project_path,
                            agent_id = %agent_id,
                            error = %error,
                            "Failed to count provider sessions for project"
                        );
                    }
                }
            }

            Ok(ProjectSessionCounts {
                path: project_path,
                counts,
            })
        }
        .await,
    )
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    use tempfile::TempDir;

    use super::{
        is_worktree_project_path, should_fallback_to_legacy_project_discovery,
        ProviderProjectDiscovery,
    };
    use crate::acp::provider::ProjectDiscoveryCompleteness;
    use crate::history::commands::ProjectInfo;

    fn run_git(dir: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn detects_nested_paths_inside_git_worktrees() {
        let sandbox = TempDir::new().expect("temp dir");
        let repo_dir = sandbox.path().join("repo");
        let worktree_dir = sandbox.path().join("repo-worktree");

        fs::create_dir(&repo_dir).expect("create repo dir");
        run_git(&repo_dir, &["init"]);
        run_git(&repo_dir, &["config", "user.name", "Test User"]);
        run_git(&repo_dir, &["config", "user.email", "test@example.com"]);

        fs::write(repo_dir.join("README.md"), "hello\n").expect("write readme");
        run_git(&repo_dir, &["add", "README.md"]);
        run_git(&repo_dir, &["commit", "-m", "Initial commit"]);

        let worktree_dir_str = worktree_dir.to_string_lossy().to_string();
        run_git(
            &repo_dir,
            &["worktree", "add", "-b", "feature", &worktree_dir_str],
        );

        let nested_dir = worktree_dir.join("nested").join("deeper");
        fs::create_dir_all(&nested_dir).expect("create nested dir");

        assert!(
            is_worktree_project_path(nested_dir.to_string_lossy().as_ref()),
            "nested paths inside a git worktree should be classified as worktrees"
        );
    }

    #[test]
    fn fallback_is_provider_neutral_when_coverage_is_partial() {
        let discoveries = vec![
            ProviderProjectDiscovery {
                agent_id: "claude-code".to_string(),
                paths: vec!["/repo".to_string()],
                completeness: ProjectDiscoveryCompleteness::Complete,
                failed: false,
            },
            ProviderProjectDiscovery {
                agent_id: "cursor".to_string(),
                paths: Vec::new(),
                completeness: ProjectDiscoveryCompleteness::Partial,
                failed: true,
            },
        ];
        let projects = vec![ProjectInfo {
            path: "/repo".to_string(),
            agent_id: "claude-code".to_string(),
            is_worktree: false,
        }];

        assert!(should_fallback_to_legacy_project_discovery(
            &discoveries,
            &projects
        ));
    }
}
