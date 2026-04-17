use dashmap::DashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Debug, Default)]
struct SessionPolicy {
    autonomous: AtomicBool,
}

impl SessionPolicy {
    fn set_autonomous(&self, enabled: bool) {
        self.autonomous.store(enabled, Ordering::Relaxed);
    }

    fn is_autonomous(&self) -> bool {
        self.autonomous.load(Ordering::Relaxed)
    }
}

pub struct SessionPolicyRegistry {
    policies: DashMap<String, Arc<SessionPolicy>>,
}

impl Default for SessionPolicyRegistry {
    fn default() -> Self {
        Self {
            policies: DashMap::new(),
        }
    }
}

impl SessionPolicyRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_autonomous(&self, session_id: &str, enabled: bool) {
        self.get_or_create(session_id).set_autonomous(enabled);
    }

    pub fn is_autonomous(&self, session_id: &str) -> bool {
        self.policies
            .get(session_id)
            .map(|entry| entry.is_autonomous())
            .unwrap_or(false)
    }

    pub fn remove(&self, session_id: &str) {
        self.policies.remove(session_id);
    }

    fn get_or_create(&self, session_id: &str) -> Arc<SessionPolicy> {
        if let Some(entry) = self.policies.get(session_id) {
            return Arc::clone(entry.value());
        }

        let policy = Arc::new(SessionPolicy::default());
        match self.policies.entry(session_id.to_string()) {
            dashmap::mapref::entry::Entry::Occupied(entry) => Arc::clone(entry.get()),
            dashmap::mapref::entry::Entry::Vacant(entry) => {
                entry.insert(Arc::clone(&policy));
                policy
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SessionPolicyRegistry;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn defaults_to_non_autonomous_for_unknown_session() {
        let registry = SessionPolicyRegistry::new();

        assert!(!registry.is_autonomous("missing-session"));
    }

    #[test]
    fn stores_and_reads_autonomous_state() {
        let registry = SessionPolicyRegistry::new();

        registry.set_autonomous("session-1", true);
        assert!(registry.is_autonomous("session-1"));

        registry.set_autonomous("session-1", false);
        assert!(!registry.is_autonomous("session-1"));
    }

    #[test]
    fn removes_policy_state() {
        let registry = SessionPolicyRegistry::new();

        registry.set_autonomous("session-1", true);
        registry.remove("session-1");

        assert!(!registry.is_autonomous("session-1"));
    }

    #[test]
    fn supports_concurrent_reads_while_writing() {
        let registry = Arc::new(SessionPolicyRegistry::new());
        registry.set_autonomous("session-1", false);

        let writer_registry = Arc::clone(&registry);
        let writer = thread::spawn(move || {
            for index in 0..200 {
                writer_registry.set_autonomous("session-1", index % 2 == 0);
            }
        });

        let reader_registry = Arc::clone(&registry);
        let reader = thread::spawn(move || {
            for _ in 0..200 {
                let _ = reader_registry.is_autonomous("session-1");
            }
        });

        writer.join().expect("writer should complete");
        reader.join().expect("reader should complete");
    }
}
