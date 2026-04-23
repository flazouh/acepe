use crate::acp::error::SerializableAcpError;
use crate::acp::parsers::provider_capabilities::{
    all_provider_capabilities, find_provider_capabilities_by_id,
};
use crate::acp::parsers::AgentType;
use crate::acp::types::CanonicalAgentId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionDescriptorFacts {
    pub local_session_id: String,
    pub provider_session_id: Option<String>,
    pub agent_id: Option<CanonicalAgentId>,
    pub project_path: Option<String>,
    pub worktree_path: Option<String>,
    pub source_path: Option<String>,
}

impl SessionDescriptorFacts {
    pub fn for_session(local_session_id: &str) -> Self {
        Self {
            local_session_id: local_session_id.to_string(),
            provider_session_id: None,
            agent_id: None,
            project_path: None,
            worktree_path: None,
            source_path: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SessionCompatibilityInput {
    pub project_path: Option<String>,
    pub agent_id: Option<CanonicalAgentId>,
    pub source_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionDescriptorMissingFact {
    CanonicalAgentId,
    ProjectPath,
    ProviderSessionId,
}

impl SessionDescriptorMissingFact {
    fn as_str(self) -> &'static str {
        match self {
            Self::CanonicalAgentId => "canonical_agent_id",
            Self::ProjectPath => "project_path",
            Self::ProviderSessionId => "provider_session_id",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionDescriptorCompatibility {
    Canonical,
    ReadOnly {
        missing_facts: Vec<SessionDescriptorMissingFact>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionDescriptor {
    pub local_session_id: String,
    pub provider_session_id: Option<String>,
    pub history_session_id: String,
    pub agent_id: CanonicalAgentId,
    pub project_path: String,
    pub worktree_path: Option<String>,
    pub effective_cwd: String,
    pub source_path: Option<String>,
    pub compatibility: SessionDescriptorCompatibility,
}

impl SessionDescriptor {
    pub fn is_resumable(&self) -> bool {
        matches!(
            self.compatibility,
            SessionDescriptorCompatibility::Canonical
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionReplayContext {
    pub local_session_id: String,
    pub history_session_id: String,
    pub agent_id: CanonicalAgentId,
    pub parser_agent_type: AgentType,
    pub project_path: String,
    pub worktree_path: Option<String>,
    pub effective_cwd: String,
    pub source_path: Option<String>,
    pub compatibility: SessionDescriptorCompatibility,
}

impl From<SessionDescriptor> for SessionReplayContext {
    fn from(descriptor: SessionDescriptor) -> Self {
        Self {
            local_session_id: descriptor.local_session_id,
            history_session_id: descriptor.history_session_id,
            parser_agent_type: AgentType::from_canonical(&descriptor.agent_id),
            agent_id: descriptor.agent_id,
            project_path: descriptor.project_path,
            worktree_path: descriptor.worktree_path,
            effective_cwd: descriptor.effective_cwd,
            source_path: descriptor.source_path,
            compatibility: descriptor.compatibility,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedResumeSession {
    pub descriptor: SessionDescriptor,
    pub launch_cwd: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedForkSession {
    pub descriptor: SessionDescriptor,
    pub launch_agent_id: CanonicalAgentId,
    pub launch_cwd: String,
    pub fork_parent_session_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionDescriptorResolutionError {
    MissingResolvedFacts {
        session_id: String,
        missing_facts: Vec<SessionDescriptorMissingFact>,
    },
    ExistingSessionNotResumable {
        session_id: String,
        missing_facts: Vec<SessionDescriptorMissingFact>,
    },
    ExistingSessionNotForkable {
        session_id: String,
        missing_facts: Vec<SessionDescriptorMissingFact>,
    },
    IncompatibleAgentOverride {
        session_id: String,
        stored_agent_id: CanonicalAgentId,
        override_agent_id: CanonicalAgentId,
    },
}

impl std::fmt::Display for SessionDescriptorResolutionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingResolvedFacts {
                session_id,
                missing_facts,
            } => write!(
                f,
                "session {} is missing resolved descriptor facts: {}",
                session_id,
                format_missing_facts(missing_facts)
            ),
            Self::ExistingSessionNotResumable {
                session_id,
                missing_facts,
            } => write!(
                f,
                "session {} is not resumable because persisted descriptor facts are missing: {}",
                session_id,
                format_missing_facts(missing_facts)
            ),
            Self::ExistingSessionNotForkable {
                session_id,
                missing_facts,
            } => write!(
                f,
                "session {} is not forkable because persisted descriptor facts are missing: {}",
                session_id,
                format_missing_facts(missing_facts)
            ),
            Self::IncompatibleAgentOverride {
                session_id,
                stored_agent_id,
                override_agent_id,
            } => write!(
                f,
                "session {} is bound to {} and cannot resume with override {}",
                session_id,
                stored_agent_id.as_str(),
                override_agent_id.as_str()
            ),
        }
    }
}

impl std::error::Error for SessionDescriptorResolutionError {}

impl From<SessionDescriptorResolutionError> for SerializableAcpError {
    fn from(error: SessionDescriptorResolutionError) -> Self {
        SerializableAcpError::ProtocolError {
            message: error.to_string(),
        }
    }
}

fn format_missing_facts(missing_facts: &[SessionDescriptorMissingFact]) -> String {
    missing_facts
        .iter()
        .map(|fact| fact.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

fn backend_identity_policy(
    agent_id: &CanonicalAgentId,
) -> crate::acp::provider::BackendIdentityPolicy {
    find_provider_capabilities_by_id(all_provider_capabilities(), agent_id.as_str())
        .map(|capabilities| capabilities.backend_identity_policy)
        .unwrap_or_default()
}

fn push_missing_fact(
    missing_facts: &mut Vec<SessionDescriptorMissingFact>,
    fact: SessionDescriptorMissingFact,
) {
    if !missing_facts.contains(&fact) {
        missing_facts.push(fact);
    }
}

pub fn resolve_existing_session_descriptor(
    facts: SessionDescriptorFacts,
    compatibility: SessionCompatibilityInput,
) -> Result<SessionDescriptor, SessionDescriptorResolutionError> {
    let mut missing_facts = Vec::new();

    let resolved_agent_id = match facts.agent_id.clone() {
        Some(agent_id) => agent_id,
        None => {
            push_missing_fact(
                &mut missing_facts,
                SessionDescriptorMissingFact::CanonicalAgentId,
            );
            compatibility.agent_id.clone().ok_or_else(|| {
                SessionDescriptorResolutionError::MissingResolvedFacts {
                    session_id: facts.local_session_id.clone(),
                    missing_facts: missing_facts.clone(),
                }
            })?
        }
    };

    let resolved_project_path = match facts.project_path.clone() {
        Some(project_path) => project_path,
        None => {
            push_missing_fact(
                &mut missing_facts,
                SessionDescriptorMissingFact::ProjectPath,
            );
            compatibility.project_path.clone().ok_or_else(|| {
                SessionDescriptorResolutionError::MissingResolvedFacts {
                    session_id: facts.local_session_id.clone(),
                    missing_facts: missing_facts.clone(),
                }
            })?
        }
    };

    let identity_policy = backend_identity_policy(&resolved_agent_id);

    if identity_policy.missing_provider_session_id(facts.provider_session_id.as_deref()) {
        push_missing_fact(
            &mut missing_facts,
            SessionDescriptorMissingFact::ProviderSessionId,
        );
    }

    let worktree_path = facts.worktree_path.clone();
    let effective_cwd = worktree_path
        .clone()
        .unwrap_or_else(|| resolved_project_path.clone());
    let history_session_id = identity_policy
        .history_session_id(
            &facts.local_session_id,
            facts.provider_session_id.as_deref(),
        )
        .to_string();
    let source_path = facts
        .source_path
        .clone()
        .or_else(|| compatibility.source_path.clone());
    let compatibility = if missing_facts.is_empty() {
        SessionDescriptorCompatibility::Canonical
    } else {
        SessionDescriptorCompatibility::ReadOnly { missing_facts }
    };

    Ok(SessionDescriptor {
        local_session_id: facts.local_session_id,
        provider_session_id: facts.provider_session_id,
        history_session_id,
        agent_id: resolved_agent_id,
        project_path: resolved_project_path,
        worktree_path,
        effective_cwd,
        source_path,
        compatibility,
    })
}

pub fn resolve_existing_session_resume(
    facts: SessionDescriptorFacts,
    requested_cwd: &str,
    explicit_agent_override: Option<CanonicalAgentId>,
) -> Result<ResolvedResumeSession, SessionDescriptorResolutionError> {
    let descriptor =
        resolve_existing_session_descriptor(facts, SessionCompatibilityInput::default())?;

    let SessionDescriptorCompatibility::Canonical = descriptor.compatibility.clone() else {
        let SessionDescriptorCompatibility::ReadOnly { missing_facts } = descriptor.compatibility
        else {
            unreachable!();
        };
        return Err(
            SessionDescriptorResolutionError::ExistingSessionNotResumable {
                session_id: descriptor.local_session_id,
                missing_facts,
            },
        );
    };

    if let Some(override_agent_id) = explicit_agent_override {
        if override_agent_id != descriptor.agent_id {
            return Err(
                SessionDescriptorResolutionError::IncompatibleAgentOverride {
                    session_id: descriptor.local_session_id.clone(),
                    stored_agent_id: descriptor.agent_id.clone(),
                    override_agent_id,
                },
            );
        }
    }

    let launch_cwd = resolve_launch_cwd(&descriptor, requested_cwd);

    Ok(ResolvedResumeSession {
        descriptor,
        launch_cwd,
    })
}

pub fn resolve_live_pending_session_resume(
    facts: SessionDescriptorFacts,
    requested_cwd: &str,
    explicit_agent_override: Option<CanonicalAgentId>,
) -> Result<ResolvedResumeSession, SessionDescriptorResolutionError> {
    let mut descriptor =
        resolve_existing_session_descriptor(facts, SessionCompatibilityInput::default())?;

    if let SessionDescriptorCompatibility::ReadOnly { missing_facts } =
        descriptor.compatibility.clone()
    {
        if missing_facts != vec![SessionDescriptorMissingFact::ProviderSessionId] {
            return Err(
                SessionDescriptorResolutionError::ExistingSessionNotResumable {
                    session_id: descriptor.local_session_id,
                    missing_facts,
                },
            );
        }

        descriptor.compatibility = SessionDescriptorCompatibility::Canonical;
        descriptor.history_session_id = descriptor.local_session_id.clone();
    }

    if let Some(override_agent_id) = explicit_agent_override {
        if override_agent_id != descriptor.agent_id {
            return Err(
                SessionDescriptorResolutionError::IncompatibleAgentOverride {
                    session_id: descriptor.local_session_id.clone(),
                    stored_agent_id: descriptor.agent_id.clone(),
                    override_agent_id,
                },
            );
        }
    }

    let launch_cwd = resolve_launch_cwd(&descriptor, requested_cwd);

    Ok(ResolvedResumeSession {
        descriptor,
        launch_cwd,
    })
}

pub fn resolve_existing_session_fork(
    facts: SessionDescriptorFacts,
    requested_cwd: &str,
    explicit_agent_override: Option<CanonicalAgentId>,
) -> Result<ResolvedForkSession, SessionDescriptorResolutionError> {
    let descriptor =
        resolve_existing_session_descriptor(facts, SessionCompatibilityInput::default())?;

    let SessionDescriptorCompatibility::Canonical = descriptor.compatibility.clone() else {
        let SessionDescriptorCompatibility::ReadOnly { missing_facts } = descriptor.compatibility
        else {
            unreachable!();
        };
        return Err(
            SessionDescriptorResolutionError::ExistingSessionNotForkable {
                session_id: descriptor.local_session_id,
                missing_facts,
            },
        );
    };

    let launch_cwd = resolve_launch_cwd(&descriptor, requested_cwd);
    let fork_parent_session_id = descriptor.history_session_id.clone();
    let launch_agent_id = explicit_agent_override.unwrap_or_else(|| descriptor.agent_id.clone());

    Ok(ResolvedForkSession {
        descriptor,
        launch_agent_id,
        launch_cwd,
        fork_parent_session_id,
    })
}

fn resolve_launch_cwd(descriptor: &SessionDescriptor, requested_cwd: &str) -> String {
    if let Some(worktree_path) = descriptor.worktree_path.clone() {
        if std::path::Path::new(&worktree_path).is_dir() {
            return worktree_path;
        }
    }

    if std::path::Path::new(&descriptor.project_path).is_dir() {
        descriptor.project_path.clone()
    } else {
        requested_cwd.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_existing_session_descriptor_marks_claude_without_provider_id_as_read_only() {
        let descriptor = resolve_existing_session_descriptor(
            SessionDescriptorFacts {
                local_session_id: "session-1".to_string(),
                provider_session_id: None,
                agent_id: Some(CanonicalAgentId::ClaudeCode),
                project_path: Some("/repo".to_string()),
                worktree_path: None,
                source_path: None,
            },
            SessionCompatibilityInput::default(),
        )
        .expect("descriptor");

        assert_eq!(descriptor.history_session_id, "session-1");
        assert_eq!(
            descriptor.compatibility,
            SessionDescriptorCompatibility::ReadOnly {
                missing_facts: vec![SessionDescriptorMissingFact::ProviderSessionId]
            }
        );
        assert!(!descriptor.is_resumable());
    }

    #[test]
    fn resolve_existing_session_resume_rejects_incompatible_override() {
        let error = resolve_existing_session_resume(
            SessionDescriptorFacts {
                local_session_id: "session-1".to_string(),
                provider_session_id: None,
                agent_id: Some(CanonicalAgentId::Copilot),
                project_path: Some("/repo".to_string()),
                worktree_path: None,
                source_path: None,
            },
            "/fallback",
            Some(CanonicalAgentId::ClaudeCode),
        )
        .expect_err("override should fail");

        assert_eq!(
            error,
            SessionDescriptorResolutionError::IncompatibleAgentOverride {
                session_id: "session-1".to_string(),
                stored_agent_id: CanonicalAgentId::Copilot,
                override_agent_id: CanonicalAgentId::ClaudeCode,
            }
        );
    }

    #[test]
    fn resolve_live_pending_session_resume_allows_claude_without_provider_id() {
        let resolved = resolve_live_pending_session_resume(
            SessionDescriptorFacts {
                local_session_id: "session-1".to_string(),
                provider_session_id: None,
                agent_id: Some(CanonicalAgentId::ClaudeCode),
                project_path: Some("/repo".to_string()),
                worktree_path: None,
                source_path: None,
            },
            "/fallback",
            None,
        )
        .expect("live pending session should resume");

        assert_eq!(resolved.descriptor.history_session_id, "session-1");
        assert_eq!(
            resolved.descriptor.compatibility,
            SessionDescriptorCompatibility::Canonical
        );
    }

    #[test]
    fn resolve_existing_session_fork_uses_history_session_id_for_parent() {
        let resolved = resolve_existing_session_fork(
            SessionDescriptorFacts {
                local_session_id: "session-1".to_string(),
                provider_session_id: Some("provider-1".to_string()),
                agent_id: Some(CanonicalAgentId::ClaudeCode),
                project_path: Some("/repo".to_string()),
                worktree_path: None,
                source_path: None,
            },
            "/fallback",
            None,
        )
        .expect("fork target");

        assert_eq!(resolved.fork_parent_session_id, "provider-1");
        assert_eq!(resolved.launch_agent_id, CanonicalAgentId::ClaudeCode);
    }

    #[test]
    fn resolve_existing_session_fork_allows_explicit_override() {
        let resolved = resolve_existing_session_fork(
            SessionDescriptorFacts {
                local_session_id: "session-1".to_string(),
                provider_session_id: None,
                agent_id: Some(CanonicalAgentId::Copilot),
                project_path: Some("/repo".to_string()),
                worktree_path: None,
                source_path: None,
            },
            "/fallback",
            Some(CanonicalAgentId::Cursor),
        )
        .expect("fork target");

        assert_eq!(resolved.launch_agent_id, CanonicalAgentId::Cursor);
        assert_eq!(resolved.fork_parent_session_id, "session-1");
    }

    #[test]
    fn resolve_existing_session_fork_rejects_missing_provider_id_for_claude() {
        let error = resolve_existing_session_fork(
            SessionDescriptorFacts {
                local_session_id: "session-1".to_string(),
                provider_session_id: None,
                agent_id: Some(CanonicalAgentId::ClaudeCode),
                project_path: Some("/repo".to_string()),
                worktree_path: None,
                source_path: None,
            },
            "/fallback",
            None,
        )
        .expect_err("fork target should fail");

        assert_eq!(
            error,
            SessionDescriptorResolutionError::ExistingSessionNotForkable {
                session_id: "session-1".to_string(),
                missing_facts: vec![SessionDescriptorMissingFact::ProviderSessionId]
            }
        );
    }
}
