use serde::{Deserialize, Serialize};

use super::permissions::ComputerPermissionKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerActionVerb {
    Observe,
    Click,
    Type,
    Key,
    Scroll,
    Drag,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComputerActionInput {
    #[serde(alias = "v")]
    pub verb: ComputerActionVerb,
    #[serde(alias = "t", default, skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    #[serde(alias = "e", default, skip_serializing_if = "Option::is_none")]
    pub epoch: Option<String>,
    #[serde(alias = "txt", default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(alias = "k", default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(alias = "dx", default, skip_serializing_if = "Option::is_none")]
    pub delta_x: Option<i32>,
    #[serde(alias = "dy", default, skip_serializing_if = "Option::is_none")]
    pub delta_y: Option<i32>,
    #[serde(alias = "b", default)]
    pub include_bounds: bool,
    #[serde(alias = "s", default)]
    pub include_screenshot: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComputerBounds {
    #[serde(alias = "x")]
    pub x: i32,
    #[serde(alias = "y")]
    pub y: i32,
    #[serde(alias = "w")]
    pub width: i32,
    #[serde(alias = "h")]
    pub height: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputerProviderElement {
    pub scope_key: Option<String>,
    pub identity_key: Option<String>,
    pub role: String,
    pub label: String,
    pub value: Option<String>,
    pub bounds: Option<ComputerBounds>,
    pub enabled: bool,
    pub focused: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputerProviderEnvironment {
    pub app: Option<String>,
    pub window: Option<String>,
    pub busy: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputerProviderSnapshot {
    pub revision: u64,
    pub settled_ms: Option<u64>,
    pub environment: ComputerProviderEnvironment,
    pub elements: Vec<ComputerProviderElement>,
    pub changed_fingerprints: Vec<String>,
    pub screenshot_ref: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComputerElement {
    #[serde(alias = "i")]
    pub id: String,
    #[serde(alias = "r")]
    pub role: String,
    #[serde(alias = "l")]
    pub label: String,
    #[serde(alias = "v", default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(alias = "b", default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<ComputerBounds>,
    #[serde(alias = "en", default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComputerEnvironment {
    #[serde(alias = "a", default, skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    #[serde(alias = "w", default, skip_serializing_if = "Option::is_none")]
    pub window: Option<String>,
    #[serde(alias = "f", default, skip_serializing_if = "Option::is_none")]
    pub focused_target_id: Option<String>,
    #[serde(alias = "b", default, skip_serializing_if = "Option::is_none")]
    pub busy: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComputerObservation {
    #[serde(default = "default_true")]
    pub ok: bool,
    #[serde(alias = "e")]
    pub epoch: String,
    #[serde(alias = "ms", default, skip_serializing_if = "Option::is_none")]
    pub settled_ms: Option<u64>,
    #[serde(alias = "env", default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<ComputerEnvironment>,
    #[serde(alias = "els", default)]
    pub elements: Vec<ComputerElement>,
    #[serde(alias = "c", default, skip_serializing_if = "Vec::is_empty")]
    pub changed: Vec<String>,
    #[serde(alias = "sr", default, skip_serializing_if = "Option::is_none")]
    pub screenshot_ref: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComputerError {
    #[serde(alias = "c")]
    pub code: String,
    #[serde(alias = "m")]
    pub message: String,
    #[serde(alias = "pk", default, skip_serializing_if = "Option::is_none")]
    pub permission_kind: Option<ComputerPermissionKind>,
    #[serde(alias = "a", default, skip_serializing_if = "Option::is_none")]
    pub app: Option<Box<str>>,
    #[serde(alias = "w", default, skip_serializing_if = "Option::is_none")]
    pub window: Option<Box<str>>,
    #[serde(alias = "ce", default, skip_serializing_if = "Option::is_none")]
    pub current_epoch: Option<String>,
    #[serde(alias = "r", default, skip_serializing_if = "Option::is_none")]
    pub reobserve: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ComputerActionOutput {
    Observation(ComputerObservation),
    Error { ok: bool, error: ComputerError },
}

fn default_true() -> bool {
    true
}

impl ComputerActionOutput {
    pub fn error(error: ComputerError) -> Self {
        Self::Error { ok: false, error }
    }
}

impl ComputerError {
    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self {
            code: "invalid_computer_input".to_string(),
            message: message.into(),
            permission_kind: None,
            app: None,
            window: None,
            current_epoch: None,
            reobserve: None,
        }
    }

    pub fn missing_target() -> Self {
        Self {
            code: "missing_computer_target".to_string(),
            message: "Computer action requires target_id from a prior observation.".to_string(),
            permission_kind: None,
            app: None,
            window: None,
            current_epoch: None,
            reobserve: Some(true),
        }
    }

    pub fn missing_epoch() -> Self {
        Self {
            code: "missing_computer_epoch".to_string(),
            message: "Computer action requires epoch from a prior observation.".to_string(),
            permission_kind: None,
            app: None,
            window: None,
            current_epoch: None,
            reobserve: Some(true),
        }
    }

    pub fn stale_epoch(current_epoch: Option<String>) -> Self {
        Self {
            code: "stale_computer_epoch".to_string(),
            message: "Computer snapshot changed before the action could run; observe again."
                .to_string(),
            permission_kind: None,
            app: None,
            window: None,
            current_epoch,
            reobserve: Some(true),
        }
    }

    pub fn permission_required(
        permission_kind: ComputerPermissionKind,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code: "computer_permission_required".to_string(),
            message: message.into(),
            permission_kind: Some(permission_kind),
            app: None,
            window: None,
            current_epoch: None,
            reobserve: None,
        }
    }

    pub fn app_window_scope_required(
        app: Option<String>,
        window: Option<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code: "computer_permission_required".to_string(),
            message: message.into(),
            permission_kind: Some(ComputerPermissionKind::AppWindowScope),
            app: app.map(String::into_boxed_str),
            window: window.map(String::into_boxed_str),
            current_epoch: None,
            reobserve: None,
        }
    }

    pub fn app_window_scope_changed(
        app: Option<String>,
        window: Option<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code: "computer_scope_changed".to_string(),
            message: message.into(),
            permission_kind: None,
            app: app.map(String::into_boxed_str),
            window: window.map(String::into_boxed_str),
            current_epoch: None,
            reobserve: Some(true),
        }
    }
}
