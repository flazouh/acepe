use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use super::ids::{computer_element_fingerprint, computer_element_id};
use super::types::{
    ComputerActionInput, ComputerActionVerb, ComputerElement, ComputerEnvironment, ComputerError,
    ComputerObservation, ComputerProviderEnvironment, ComputerProviderSnapshot,
};

#[async_trait]
pub trait ComputerProvider: Send + Sync {
    async fn environment(&self) -> Result<ComputerProviderEnvironment, ComputerError>;
    async fn observe(
        &self,
        action: &ComputerActionInput,
    ) -> Result<ComputerProviderSnapshot, ComputerError>;
    async fn act(
        &self,
        action: &ComputerActionInput,
    ) -> Result<ComputerProviderSnapshot, ComputerError>;
}

pub struct ComputerRuntime {
    provider: Box<dyn ComputerProvider>,
    state: Arc<Mutex<ComputerRuntimeState>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ComputerAppWindowScope {
    pub app: Option<String>,
    pub window: Option<String>,
}

#[derive(Debug, Default)]
struct ComputerRuntimeState {
    current_epoch: Option<String>,
    current_environment: Option<ComputerProviderEnvironment>,
    target_fingerprints: HashMap<String, String>,
    allowed_app_window_scopes: HashSet<ComputerAppWindowScope>,
}

impl ComputerRuntime {
    pub fn new(provider: Box<dyn ComputerProvider>) -> Self {
        Self {
            provider,
            state: Arc::new(Mutex::new(ComputerRuntimeState::default())),
        }
    }

    pub async fn execute(
        &self,
        input: ComputerActionInput,
    ) -> Result<ComputerObservation, ComputerError> {
        if input.verb != ComputerActionVerb::Observe {
            self.validate_action_target(&input).await?;
            self.validate_action_arguments(&input)?;
            self.validate_action_scope().await?;
        }

        let snapshot = match input.verb {
            ComputerActionVerb::Observe => self.provider.observe(&input).await?,
            ComputerActionVerb::Click
            | ComputerActionVerb::Type
            | ComputerActionVerb::Key
            | ComputerActionVerb::Scroll
            | ComputerActionVerb::Drag => self.provider.act(&input).await?,
        };

        Ok(self.normalize_snapshot(snapshot, &input).await)
    }

    pub async fn allow_app_window_scope(&self, scope: ComputerAppWindowScope) {
        let mut state = self.state.lock().await;
        state.allowed_app_window_scopes.insert(scope);
    }

    pub async fn allow_app_window_scopes(&self, scopes: &[ComputerAppWindowScope]) {
        let mut state = self.state.lock().await;
        for scope in scopes {
            state.allowed_app_window_scopes.insert(scope.clone());
        }
    }

    pub async fn replace_allowed_app_window_scopes(&self, scopes: &[ComputerAppWindowScope]) {
        let mut state = self.state.lock().await;
        state.allowed_app_window_scopes = scopes.iter().cloned().collect();
    }

    pub async fn deny_app_window_scope(&self, scope: &ComputerAppWindowScope) {
        let mut state = self.state.lock().await;
        state.allowed_app_window_scopes.remove(scope);
    }

    #[cfg(test)]
    pub async fn is_app_window_scope_allowed(&self, scope: &ComputerAppWindowScope) -> bool {
        let state = self.state.lock().await;
        state.allowed_app_window_scopes.contains(scope)
    }

    async fn validate_action_target(
        &self,
        input: &ComputerActionInput,
    ) -> Result<(), ComputerError> {
        let Some(target_id) = input.target_id.as_deref() else {
            return Err(ComputerError::missing_target());
        };
        let Some(epoch) = input.epoch.as_deref() else {
            return Err(ComputerError::missing_epoch());
        };

        let state = self.state.lock().await;
        if state.current_epoch.as_deref() != Some(epoch) {
            return Err(ComputerError::stale_epoch(state.current_epoch.clone()));
        }
        if !state.target_fingerprints.contains_key(target_id) {
            return Err(ComputerError::missing_target());
        }

        Ok(())
    }

    fn validate_action_arguments(&self, input: &ComputerActionInput) -> Result<(), ComputerError> {
        match input.verb {
            ComputerActionVerb::Observe | ComputerActionVerb::Click => Ok(()),
            ComputerActionVerb::Type => has_non_empty_text(input.text.as_deref())
                .then_some(())
                .ok_or_else(|| {
                    ComputerError::invalid_input("type action requires non-empty text.")
                }),
            ComputerActionVerb::Key => has_non_empty_text(input.key.as_deref())
                .then_some(())
                .ok_or_else(|| ComputerError::invalid_input("key action requires key.")),
            ComputerActionVerb::Scroll => {
                has_non_zero_delta(input).then_some(()).ok_or_else(|| {
                    ComputerError::invalid_input("scroll action requires delta_x or delta_y.")
                })
            }
            ComputerActionVerb::Drag => has_non_zero_delta(input).then_some(()).ok_or_else(|| {
                ComputerError::invalid_input("drag action requires delta_x or delta_y.")
            }),
        }
    }

    async fn validate_action_scope(&self) -> Result<(), ComputerError> {
        let observed_environment = {
            let state = self.state.lock().await;
            state.current_environment.clone()
        };
        let Some(observed_environment) = observed_environment else {
            return Ok(());
        };

        let current_environment = self.provider.environment().await?;
        if current_environment.app == observed_environment.app
            && current_environment.window == observed_environment.window
        {
            return Ok(());
        }

        let current_scope = ComputerAppWindowScope {
            app: current_environment.app.clone(),
            window: current_environment.window.clone(),
        };
        let state = self.state.lock().await;
        if state.allowed_app_window_scopes.contains(&current_scope) {
            drop(state);
            return Err(ComputerError::app_window_scope_changed(
                current_environment.app,
                current_environment.window,
                "Focused app or window changed after observation; observe again before acting.",
            ));
        }
        drop(state);

        Err(ComputerError::app_window_scope_required(
            current_environment.app,
            current_environment.window,
            "Focused app or window changed after observation; observe again before acting.",
        ))
    }

    async fn normalize_snapshot(
        &self,
        snapshot: ComputerProviderSnapshot,
        input: &ComputerActionInput,
    ) -> ComputerObservation {
        let epoch = format!("s_{}", snapshot.revision);
        let mut target_fingerprints = HashMap::new();
        let mut changed = Vec::new();
        let mut changed_elements = Vec::new();
        let mut focused_target_id = None;
        let changed_fingerprints = snapshot.changed_fingerprints;
        let provider_environment = snapshot.environment;

        let all_elements: Vec<ComputerElement> = snapshot
            .elements
            .into_iter()
            .map(|element| {
                let id = computer_element_id(&element);
                let fingerprint = computer_element_fingerprint(&element);
                if element.focused {
                    focused_target_id = Some(id.clone());
                }
                target_fingerprints.insert(id.clone(), fingerprint);

                ComputerElement {
                    id,
                    role: element.role,
                    label: element.label,
                    value: element.value,
                    bounds: if input.include_bounds {
                        element.bounds
                    } else {
                        None
                    },
                    enabled: element.enabled,
                }
            })
            .collect();

        for element in &all_elements {
            if let Some(fingerprint) = target_fingerprints.get(&element.id) {
                if changed_fingerprints.contains(fingerprint) {
                    changed.push(element.id.clone());
                    changed_elements.push(element.clone());
                }
            }
        }

        let elements = if input.verb == ComputerActionVerb::Observe {
            all_elements
        } else {
            changed_elements
        };

        let screenshot_ref = if input.include_screenshot {
            snapshot.screenshot_ref
        } else {
            None
        };

        let mut state = self.state.lock().await;
        state.current_epoch = Some(epoch.clone());
        state.current_environment = Some(ComputerProviderEnvironment {
            app: provider_environment.app.clone(),
            window: provider_environment.window.clone(),
            busy: provider_environment.busy,
        });
        state.target_fingerprints = target_fingerprints;

        ComputerObservation {
            ok: true,
            epoch,
            settled_ms: snapshot.settled_ms,
            environment: Some(ComputerEnvironment {
                app: provider_environment.app,
                window: provider_environment.window,
                focused_target_id,
                busy: provider_environment.busy,
            }),
            elements,
            changed,
            screenshot_ref,
        }
    }
}

fn has_non_empty_text(value: Option<&str>) -> bool {
    value.map(str::trim).is_some_and(|value| !value.is_empty())
}

fn has_non_zero_delta(input: &ComputerActionInput) -> bool {
    input.delta_x.unwrap_or(0) != 0 || input.delta_y.unwrap_or(0) != 0
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use tokio::sync::Mutex;

    use super::*;
    use crate::computer_use::permissions::ComputerPermissionKind;
    use crate::computer_use::types::{ComputerBounds, ComputerProviderElement};

    #[derive(Clone)]
    struct ScopeChangingProvider {
        state: Arc<Mutex<ScopeChangingProviderState>>,
        act_calls: Arc<AtomicUsize>,
    }

    #[derive(Debug, Clone)]
    struct ScopeChangingProviderState {
        environment: ComputerProviderEnvironment,
        elements: Vec<ComputerProviderElement>,
    }

    impl ScopeChangingProvider {
        fn new() -> Self {
            Self {
                state: Arc::new(Mutex::new(ScopeChangingProviderState {
                    environment: ComputerProviderEnvironment {
                        app: Some("Acepe".to_string()),
                        window: Some("Main".to_string()),
                        busy: Some(false),
                    },
                    elements: vec![ComputerProviderElement {
                        scope_key: Some("app:Acepe/window:Main".to_string()),
                        identity_key: Some("button/run".to_string()),
                        role: "button".to_string(),
                        label: "Run".to_string(),
                        value: None,
                        bounds: Some(ComputerBounds {
                            x: 10,
                            y: 10,
                            width: 40,
                            height: 20,
                        }),
                        enabled: true,
                        focused: true,
                    }],
                })),
                act_calls: Arc::new(AtomicUsize::new(0)),
            }
        }

        async fn set_environment(&self, environment: ComputerProviderEnvironment) {
            let mut state = self.state.lock().await;
            state.environment = environment;
        }

        fn act_calls(&self) -> usize {
            self.act_calls.load(Ordering::Relaxed)
        }
    }

    fn observe_input() -> ComputerActionInput {
        ComputerActionInput {
            verb: ComputerActionVerb::Observe,
            target_id: None,
            epoch: None,
            text: None,
            key: None,
            delta_x: None,
            delta_y: None,
            include_bounds: false,
            include_screenshot: false,
        }
    }

    fn action_input(
        verb: ComputerActionVerb,
        target_id: &str,
        epoch: &str,
        text: Option<&str>,
        key: Option<&str>,
        delta_x: Option<i32>,
        delta_y: Option<i32>,
    ) -> ComputerActionInput {
        ComputerActionInput {
            verb,
            target_id: Some(target_id.to_string()),
            epoch: Some(epoch.to_string()),
            text: text.map(str::to_string),
            key: key.map(str::to_string),
            delta_x,
            delta_y,
            include_bounds: false,
            include_screenshot: false,
        }
    }

    #[async_trait]
    impl ComputerProvider for ScopeChangingProvider {
        async fn environment(&self) -> Result<ComputerProviderEnvironment, ComputerError> {
            let state = self.state.lock().await;
            Ok(state.environment.clone())
        }

        async fn observe(
            &self,
            _action: &ComputerActionInput,
        ) -> Result<ComputerProviderSnapshot, ComputerError> {
            let state = self.state.lock().await;
            Ok(ComputerProviderSnapshot {
                revision: 1,
                settled_ms: None,
                environment: state.environment.clone(),
                elements: state.elements.clone(),
                changed_fingerprints: Vec::new(),
                screenshot_ref: None,
            })
        }

        async fn act(
            &self,
            _action: &ComputerActionInput,
        ) -> Result<ComputerProviderSnapshot, ComputerError> {
            self.act_calls.fetch_add(1, Ordering::Relaxed);
            let state = self.state.lock().await;
            Ok(ComputerProviderSnapshot {
                revision: 2,
                settled_ms: Some(0),
                environment: state.environment.clone(),
                elements: state.elements.clone(),
                changed_fingerprints: Vec::new(),
                screenshot_ref: None,
            })
        }
    }

    #[tokio::test]
    async fn action_blocks_when_app_window_changes_after_observe() {
        let provider = ScopeChangingProvider::new();
        let provider_handle = provider.clone();
        let runtime = ComputerRuntime::new(Box::new(provider));

        let observed = runtime
            .execute(ComputerActionInput {
                verb: ComputerActionVerb::Observe,
                target_id: None,
                epoch: None,
                text: None,
                key: None,
                delta_x: None,
                delta_y: None,
                include_bounds: false,
                include_screenshot: false,
            })
            .await
            .expect("observe");
        let target_id = observed.elements[0].id.clone();

        provider_handle
            .set_environment(ComputerProviderEnvironment {
                app: Some("Safari".to_string()),
                window: Some("GitHub".to_string()),
                busy: Some(false),
            })
            .await;

        let error = runtime
            .execute(ComputerActionInput {
                verb: ComputerActionVerb::Click,
                target_id: Some(target_id),
                epoch: Some(observed.epoch),
                text: None,
                key: None,
                delta_x: None,
                delta_y: None,
                include_bounds: false,
                include_screenshot: false,
            })
            .await
            .expect_err("scope drift should block before act");

        assert_eq!(error.code, "computer_permission_required");
        assert_eq!(
            error.permission_kind,
            Some(ComputerPermissionKind::AppWindowScope)
        );
        assert_eq!(error.app.as_deref(), Some("Safari"));
        assert_eq!(error.window.as_deref(), Some("GitHub"));
        assert_eq!(provider_handle.act_calls(), 0);
    }

    #[tokio::test]
    async fn invalid_action_arguments_fail_before_provider_act() {
        let provider = ScopeChangingProvider::new();
        let provider_handle = provider.clone();
        let runtime = ComputerRuntime::new(Box::new(provider));

        let observed = runtime.execute(observe_input()).await.expect("observe");
        let target_id = observed.elements[0].id.clone();

        let invalid_actions = [
            (
                action_input(
                    ComputerActionVerb::Type,
                    &target_id,
                    &observed.epoch,
                    Some("   "),
                    None,
                    None,
                    None,
                ),
                "type action requires non-empty text.",
            ),
            (
                action_input(
                    ComputerActionVerb::Key,
                    &target_id,
                    &observed.epoch,
                    None,
                    Some("   "),
                    None,
                    None,
                ),
                "key action requires key.",
            ),
            (
                action_input(
                    ComputerActionVerb::Scroll,
                    &target_id,
                    &observed.epoch,
                    None,
                    None,
                    Some(0),
                    Some(0),
                ),
                "scroll action requires delta_x or delta_y.",
            ),
            (
                action_input(
                    ComputerActionVerb::Drag,
                    &target_id,
                    &observed.epoch,
                    None,
                    None,
                    None,
                    None,
                ),
                "drag action requires delta_x or delta_y.",
            ),
        ];

        for (input, message) in invalid_actions {
            let error = runtime
                .execute(input)
                .await
                .expect_err("invalid action should fail before provider");
            assert_eq!(error.code, "invalid_computer_input");
            assert_eq!(error.message, message);
        }
        assert_eq!(provider_handle.act_calls(), 0);
    }

    #[tokio::test]
    async fn approved_app_window_scope_requires_fresh_observe_before_action() {
        let provider = ScopeChangingProvider::new();
        let provider_handle = provider.clone();
        let runtime = ComputerRuntime::new(Box::new(provider));

        let observed = runtime
            .execute(ComputerActionInput {
                verb: ComputerActionVerb::Observe,
                target_id: None,
                epoch: None,
                text: None,
                key: None,
                delta_x: None,
                delta_y: None,
                include_bounds: false,
                include_screenshot: false,
            })
            .await
            .expect("observe");
        let target_id = observed.elements[0].id.clone();

        provider_handle
            .set_environment(ComputerProviderEnvironment {
                app: Some("Safari".to_string()),
                window: Some("GitHub".to_string()),
                busy: Some(false),
            })
            .await;

        runtime
            .allow_app_window_scope(ComputerAppWindowScope {
                app: Some("Safari".to_string()),
                window: Some("GitHub".to_string()),
            })
            .await;

        let error = runtime
            .execute(ComputerActionInput {
                verb: ComputerActionVerb::Click,
                target_id: Some(target_id),
                epoch: Some(observed.epoch),
                text: None,
                key: None,
                delta_x: None,
                delta_y: None,
                include_bounds: false,
                include_screenshot: false,
            })
            .await
            .expect_err("approved scope still requires fresh observe");

        assert_eq!(error.code, "computer_scope_changed");
        assert_eq!(error.permission_kind, None);
        assert_eq!(error.app.as_deref(), Some("Safari"));
        assert_eq!(error.window.as_deref(), Some("GitHub"));
        assert_eq!(error.reobserve, Some(true));
        assert_eq!(provider_handle.act_calls(), 0);
    }

    #[tokio::test]
    async fn action_after_observing_allowed_scope_uses_fresh_target() {
        let provider = ScopeChangingProvider::new();
        let provider_handle = provider.clone();
        let runtime = ComputerRuntime::new(Box::new(provider));

        let allowed_scope = ComputerAppWindowScope {
            app: Some("Safari".to_string()),
            window: Some("GitHub".to_string()),
        };
        runtime.allow_app_window_scope(allowed_scope.clone()).await;
        provider_handle
            .set_environment(ComputerProviderEnvironment {
                app: allowed_scope.app,
                window: allowed_scope.window,
                busy: Some(false),
            })
            .await;

        let observed = runtime
            .execute(ComputerActionInput {
                verb: ComputerActionVerb::Observe,
                target_id: None,
                epoch: None,
                text: None,
                key: None,
                delta_x: None,
                delta_y: None,
                include_bounds: false,
                include_screenshot: false,
            })
            .await
            .expect("observe allowed scope");
        let target_id = observed.elements[0].id.clone();

        runtime
            .execute(ComputerActionInput {
                verb: ComputerActionVerb::Click,
                target_id: Some(target_id),
                epoch: Some(observed.epoch),
                text: None,
                key: None,
                delta_x: None,
                delta_y: None,
                include_bounds: false,
                include_screenshot: false,
            })
            .await
            .expect("freshly observed allowed scope should allow act");

        assert_eq!(provider_handle.act_calls(), 1);
    }

    #[tokio::test]
    async fn denied_app_window_scope_keeps_blocking_action() {
        let provider = ScopeChangingProvider::new();
        let provider_handle = provider.clone();
        let runtime = ComputerRuntime::new(Box::new(provider));

        let observed = runtime
            .execute(ComputerActionInput {
                verb: ComputerActionVerb::Observe,
                target_id: None,
                epoch: None,
                text: None,
                key: None,
                delta_x: None,
                delta_y: None,
                include_bounds: false,
                include_screenshot: false,
            })
            .await
            .expect("observe");
        let target_id = observed.elements[0].id.clone();

        let denied_scope = ComputerAppWindowScope {
            app: Some("Safari".to_string()),
            window: Some("GitHub".to_string()),
        };
        runtime.allow_app_window_scope(denied_scope.clone()).await;
        runtime.deny_app_window_scope(&denied_scope).await;

        provider_handle
            .set_environment(ComputerProviderEnvironment {
                app: Some("Safari".to_string()),
                window: Some("GitHub".to_string()),
                busy: Some(false),
            })
            .await;

        let error = runtime
            .execute(ComputerActionInput {
                verb: ComputerActionVerb::Click,
                target_id: Some(target_id),
                epoch: Some(observed.epoch),
                text: None,
                key: None,
                delta_x: None,
                delta_y: None,
                include_bounds: false,
                include_screenshot: false,
            })
            .await
            .expect_err("denied scope should block");

        assert_eq!(error.code, "computer_permission_required");
        assert_eq!(provider_handle.act_calls(), 0);
    }
}
