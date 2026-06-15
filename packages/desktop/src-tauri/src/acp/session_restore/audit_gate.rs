#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProviderRestoreAuditOutcome {
    RestoredNonEmpty,
    MissingHistory,
    UnparseableHistory,
    ProviderUnavailable,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProvenanceKeyStability {
    Stable,
    Unstable,
    Unknown,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CanonicalSafeWellFormedness {
    WellFormed,
    NotWellFormed,
    Unknown,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProviderRestoreAuditCase {
    pub(crate) provider_id: String,
    pub(crate) session_id: String,
    pub(crate) outcome: ProviderRestoreAuditOutcome,
    pub(crate) entry_count: usize,
    pub(crate) time_to_first_entry_render_ms: Option<u128>,
    pub(crate) provenance_key_stability: ProvenanceKeyStability,
    pub(crate) canonical_safe_well_formedness: CanonicalSafeWellFormedness,
}

#[cfg(test)]
impl ProviderRestoreAuditCase {
    pub(crate) fn happy_path(
        provider_id: impl Into<String>,
        session_id: impl Into<String>,
        entry_count: usize,
        time_to_first_entry_render_ms: u128,
    ) -> Self {
        Self {
            provider_id: provider_id.into(),
            session_id: session_id.into(),
            outcome: ProviderRestoreAuditOutcome::RestoredNonEmpty,
            entry_count,
            time_to_first_entry_render_ms: Some(time_to_first_entry_render_ms),
            provenance_key_stability: ProvenanceKeyStability::Stable,
            canonical_safe_well_formedness: CanonicalSafeWellFormedness::WellFormed,
        }
    }

    pub(crate) fn missing_history(
        provider_id: impl Into<String>,
        session_id: impl Into<String>,
    ) -> Self {
        Self {
            provider_id: provider_id.into(),
            session_id: session_id.into(),
            outcome: ProviderRestoreAuditOutcome::MissingHistory,
            entry_count: 0,
            time_to_first_entry_render_ms: None,
            provenance_key_stability: ProvenanceKeyStability::Unknown,
            canonical_safe_well_formedness: CanonicalSafeWellFormedness::Unknown,
        }
    }

    pub(crate) fn unparseable_history(
        provider_id: impl Into<String>,
        session_id: impl Into<String>,
    ) -> Self {
        Self {
            provider_id: provider_id.into(),
            session_id: session_id.into(),
            outcome: ProviderRestoreAuditOutcome::UnparseableHistory,
            entry_count: 0,
            time_to_first_entry_render_ms: None,
            provenance_key_stability: ProvenanceKeyStability::Unknown,
            canonical_safe_well_formedness: CanonicalSafeWellFormedness::Unknown,
        }
    }

    pub(crate) fn provider_unavailable(
        provider_id: impl Into<String>,
        session_id: impl Into<String>,
    ) -> Self {
        Self {
            provider_id: provider_id.into(),
            session_id: session_id.into(),
            outcome: ProviderRestoreAuditOutcome::ProviderUnavailable,
            entry_count: 0,
            time_to_first_entry_render_ms: None,
            provenance_key_stability: ProvenanceKeyStability::Unknown,
            canonical_safe_well_formedness: CanonicalSafeWellFormedness::Unknown,
        }
    }
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProviderRestoreAuditGateStatus {
    pub(crate) ready: bool,
    pub(crate) blocking_reasons: Vec<String>,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProviderRestoreAuditReport {
    pub(crate) cases: Vec<ProviderRestoreAuditCase>,
}

#[cfg(test)]
impl ProviderRestoreAuditReport {
    pub(crate) fn new(cases: Vec<ProviderRestoreAuditCase>) -> Self {
        Self { cases }
    }

    pub(crate) fn deletion_gate_status(
        &self,
        supported_provider_ids: &[&str],
    ) -> ProviderRestoreAuditGateStatus {
        let mut blocking_reasons = Vec::new();

        for provider_id in supported_provider_ids {
            let provider_cases = self
                .cases
                .iter()
                .filter(|case| case.provider_id == *provider_id);

            let has_non_empty_restore = provider_cases.clone().any(|case| {
                case.outcome == ProviderRestoreAuditOutcome::RestoredNonEmpty
                    && case.entry_count > 0
            });
            let has_missing_history = provider_cases
                .clone()
                .any(|case| case.outcome == ProviderRestoreAuditOutcome::MissingHistory);
            let has_unparseable_history = provider_cases
                .clone()
                .any(|case| case.outcome == ProviderRestoreAuditOutcome::UnparseableHistory);
            let has_stable_provenance = provider_cases
                .clone()
                .any(|case| case.provenance_key_stability == ProvenanceKeyStability::Stable);
            let has_any_well_formedness_verdict = provider_cases.clone().any(|case| {
                case.canonical_safe_well_formedness != CanonicalSafeWellFormedness::Unknown
            });
            let has_well_formed_canonical_keys = provider_cases.clone().any(|case| {
                case.canonical_safe_well_formedness == CanonicalSafeWellFormedness::WellFormed
            });

            if !has_non_empty_restore {
                blocking_reasons.push(format!(
                    "{provider_id} lacks a parseable non-empty restore case"
                ));
            }
            if !has_missing_history {
                blocking_reasons.push(format!(
                    "{provider_id} lacks a missing-history restore case"
                ));
            }
            if !has_unparseable_history {
                blocking_reasons.push(format!(
                    "{provider_id} lacks an unparseable-history restore case"
                ));
            }
            if !has_stable_provenance {
                blocking_reasons.push(format!(
                    "{provider_id} lacks a stable provenance-key verdict"
                ));
            }
            if !has_any_well_formedness_verdict {
                blocking_reasons.push(format!(
                    "{provider_id} lacks a canonical-safe well-formedness verdict"
                ));
            } else if !has_well_formed_canonical_keys {
                blocking_reasons.push(format!(
                    "{provider_id} failed the canonical-safe well-formedness check"
                ));
            }
        }

        ProviderRestoreAuditGateStatus {
            ready: blocking_reasons.is_empty(),
            blocking_reasons,
        }
    }

    pub(crate) fn p95_time_to_first_entry_render_ms(&self) -> Option<u128> {
        let mut samples: Vec<u128> = self
            .cases
            .iter()
            .filter_map(|case| case.time_to_first_entry_render_ms)
            .collect();

        if samples.is_empty() {
            return None;
        }

        samples.sort_unstable();
        let index = ((samples.len() * 95).saturating_add(99) / 100).saturating_sub(1);
        samples.get(index).copied()
    }

    pub(crate) fn max_allowed_time_to_first_entry_render_ms(&self) -> Option<u128> {
        self.p95_time_to_first_entry_render_ms()
            .map(|p95| p95.saturating_mul(125).saturating_add(99) / 100)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CanonicalSafeWellFormedness, ProvenanceKeyStability, ProviderRestoreAuditCase,
        ProviderRestoreAuditReport,
    };

    #[test]
    fn restore_audit_gate_requires_minimum_corpus_for_each_supported_provider() {
        let report = ProviderRestoreAuditReport::new(vec![
            ProviderRestoreAuditCase::happy_path("claude-code", "claude-session", 2, 120),
            ProviderRestoreAuditCase::missing_history("claude-code", "missing-claude"),
            ProviderRestoreAuditCase::unparseable_history("claude-code", "bad-claude"),
        ]);

        let gate = report.deletion_gate_status(&["claude-code", "copilot", "cursor"]);

        assert!(!gate.ready);
        assert!(gate
            .blocking_reasons
            .contains(&"copilot lacks a parseable non-empty restore case".to_string()));
        assert!(gate
            .blocking_reasons
            .contains(&"copilot lacks a missing-history restore case".to_string()));
        assert!(gate
            .blocking_reasons
            .contains(&"copilot lacks an unparseable-history restore case".to_string()));
        assert!(gate
            .blocking_reasons
            .contains(&"cursor lacks a parseable non-empty restore case".to_string()));
        assert!(gate
            .blocking_reasons
            .contains(&"cursor lacks a missing-history restore case".to_string()));
        assert!(gate
            .blocking_reasons
            .contains(&"cursor lacks an unparseable-history restore case".to_string()));
        assert!(gate
            .blocking_reasons
            .contains(&"cursor lacks a stable provenance-key verdict".to_string()));
        assert!(gate
            .blocking_reasons
            .contains(&"cursor lacks a canonical-safe well-formedness verdict".to_string()));
    }

    #[test]
    fn restore_audit_gate_requires_stable_provenance_verdict() {
        let mut happy = ProviderRestoreAuditCase::happy_path("copilot", "copilot-session", 2, 80);
        happy.provenance_key_stability = ProvenanceKeyStability::Unstable;
        let report = ProviderRestoreAuditReport::new(vec![
            happy,
            ProviderRestoreAuditCase::missing_history("copilot", "missing-copilot"),
            ProviderRestoreAuditCase::unparseable_history("copilot", "bad-copilot"),
            ProviderRestoreAuditCase::provider_unavailable("copilot", "offline-copilot"),
        ]);

        let gate = report.deletion_gate_status(&["copilot"]);

        assert!(!gate.ready);
        assert_eq!(
            gate.blocking_reasons,
            vec!["copilot lacks a stable provenance-key verdict".to_string()]
        );
    }

    #[test]
    fn restore_audit_gate_requires_canonical_safe_well_formedness_verdict() {
        let mut cursor_happy =
            ProviderRestoreAuditCase::happy_path("cursor", "cursor-session", 2, 90);
        cursor_happy.canonical_safe_well_formedness = CanonicalSafeWellFormedness::NotWellFormed;
        let report = ProviderRestoreAuditReport::new(vec![
            cursor_happy,
            ProviderRestoreAuditCase::missing_history("cursor", "missing-cursor"),
            ProviderRestoreAuditCase::unparseable_history("cursor", "bad-cursor"),
            ProviderRestoreAuditCase::provider_unavailable("cursor", "offline-cursor"),
        ]);

        let gate = report.deletion_gate_status(&["cursor"]);

        assert!(!gate.ready);
        assert_eq!(
            gate.blocking_reasons,
            vec!["cursor failed the canonical-safe well-formedness check".to_string()]
        );
    }

    #[test]
    fn restore_audit_gate_accepts_cursor_when_stable_and_well_formed() {
        let report = ProviderRestoreAuditReport::new(vec![
            ProviderRestoreAuditCase::happy_path("cursor", "cursor-session", 2, 90),
            ProviderRestoreAuditCase::missing_history("cursor", "missing-cursor"),
            ProviderRestoreAuditCase::unparseable_history("cursor", "bad-cursor"),
            ProviderRestoreAuditCase::provider_unavailable("cursor", "offline-cursor"),
        ]);

        let gate = report.deletion_gate_status(&["cursor"]);

        assert!(gate.ready);
        assert!(gate.blocking_reasons.is_empty());
    }

    #[test]
    fn restore_audit_records_p95_and_regression_limit() {
        let report = ProviderRestoreAuditReport::new(vec![
            ProviderRestoreAuditCase::happy_path("copilot", "session-1", 1, 10),
            ProviderRestoreAuditCase::happy_path("copilot", "session-2", 1, 20),
            ProviderRestoreAuditCase::happy_path("copilot", "session-3", 1, 30),
            ProviderRestoreAuditCase::happy_path("copilot", "session-4", 1, 40),
            ProviderRestoreAuditCase::happy_path("copilot", "session-5", 1, 50),
        ]);

        assert_eq!(report.p95_time_to_first_entry_render_ms(), Some(50));
        assert_eq!(report.max_allowed_time_to_first_entry_render_ms(), Some(63));
    }
}
