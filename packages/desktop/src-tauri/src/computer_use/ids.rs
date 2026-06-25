use sha2::{Digest, Sha256};

use super::types::ComputerProviderElement;

pub fn computer_element_id(element: &ComputerProviderElement) -> String {
    let mut hasher = Sha256::new();
    if let Some(scope_key) = &element.scope_key {
        hasher.update(normalize_identity_part(scope_key));
        hasher.update([0]);
    }
    hasher.update(normalize_identity_part(&element.role));
    hasher.update([0]);
    if let Some(identity_key) = &element.identity_key {
        hasher.update(normalize_identity_part(identity_key));
        hasher.update([0]);
    } else {
        hasher.update(normalize_identity_part(&element.label));
        hasher.update([0]);
    }
    let digest = hasher.finalize();

    format!("e_{}", hex::encode(&digest[..8]))
}

pub fn computer_element_fingerprint(element: &ComputerProviderElement) -> String {
    let mut hasher = Sha256::new();
    hasher.update(computer_element_id(element));
    hasher.update([0]);
    hasher.update(normalize_identity_part(&element.label));
    hasher.update([0]);
    if let Some(value) = &element.value {
        hasher.update(normalize_identity_part(value));
    }
    hasher.update([0]);
    hasher.update(if element.enabled {
        b"enabled".as_slice()
    } else {
        b"disabled".as_slice()
    });
    let digest = hasher.finalize();

    format!("f_{}", hex::encode(&digest[..8]))
}

fn normalize_identity_part(value: &str) -> String {
    value.trim().to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::computer_use::types::ComputerProviderElement;

    #[test]
    fn element_id_ignores_provider_list_position() {
        let first = ComputerProviderElement {
            scope_key: None,
            identity_key: Some("window/0".to_string()),
            role: "button".to_string(),
            label: "Run".to_string(),
            value: None,
            bounds: None,
            enabled: true,
            focused: false,
        };
        let moved = ComputerProviderElement {
            scope_key: None,
            identity_key: Some("window/0".to_string()),
            role: "button".to_string(),
            label: "Run".to_string(),
            value: None,
            bounds: None,
            enabled: true,
            focused: true,
        };

        assert_eq!(computer_element_id(&first), computer_element_id(&moved));
    }

    #[test]
    fn element_id_uses_structural_identity_when_available() {
        let first = ComputerProviderElement {
            scope_key: None,
            identity_key: Some("window/0".to_string()),
            role: "button".to_string(),
            label: "Run".to_string(),
            value: None,
            bounds: None,
            enabled: true,
            focused: false,
        };
        let second = ComputerProviderElement {
            scope_key: None,
            identity_key: Some("window/1".to_string()),
            role: "button".to_string(),
            label: "Run".to_string(),
            value: None,
            bounds: None,
            enabled: true,
            focused: false,
        };

        assert_ne!(computer_element_id(&first), computer_element_id(&second));
    }

    #[test]
    fn element_id_is_stable_when_value_changes() {
        let empty = ComputerProviderElement {
            scope_key: None,
            identity_key: Some("window/0".to_string()),
            role: "text_field".to_string(),
            label: "Prompt".to_string(),
            value: Some("".to_string()),
            bounds: None,
            enabled: true,
            focused: false,
        };
        let typed = ComputerProviderElement {
            scope_key: None,
            identity_key: Some("window/0".to_string()),
            role: "text_field".to_string(),
            label: "Prompt".to_string(),
            value: Some("hello".to_string()),
            bounds: None,
            enabled: true,
            focused: false,
        };

        assert_eq!(computer_element_id(&empty), computer_element_id(&typed));
        assert_ne!(
            computer_element_fingerprint(&empty),
            computer_element_fingerprint(&typed)
        );
    }

    #[test]
    fn element_id_never_uses_value_as_identity() {
        let empty = ComputerProviderElement {
            scope_key: None,
            identity_key: None,
            role: "text_field".to_string(),
            label: "Prompt".to_string(),
            value: Some("".to_string()),
            bounds: None,
            enabled: true,
            focused: false,
        };
        let typed = ComputerProviderElement {
            scope_key: None,
            identity_key: None,
            role: "text_field".to_string(),
            label: "Prompt".to_string(),
            value: Some("hello".to_string()),
            bounds: None,
            enabled: true,
            focused: false,
        };

        assert_eq!(computer_element_id(&empty), computer_element_id(&typed));
        assert_ne!(
            computer_element_fingerprint(&empty),
            computer_element_fingerprint(&typed)
        );
    }

    #[test]
    fn element_id_is_stable_when_label_changes_with_structural_identity() {
        let before = ComputerProviderElement {
            scope_key: None,
            identity_key: Some("window/status".to_string()),
            role: "static_text".to_string(),
            label: "Click count: 0".to_string(),
            value: None,
            bounds: None,
            enabled: true,
            focused: false,
        };
        let after = ComputerProviderElement {
            scope_key: None,
            identity_key: Some("window/status".to_string()),
            role: "static_text".to_string(),
            label: "Click count: 1".to_string(),
            value: None,
            bounds: None,
            enabled: true,
            focused: false,
        };

        assert_eq!(computer_element_id(&before), computer_element_id(&after));
        assert_ne!(
            computer_element_fingerprint(&before),
            computer_element_fingerprint(&after)
        );
    }

    #[test]
    fn element_id_uses_label_without_structural_identity() {
        let first = ComputerProviderElement {
            scope_key: None,
            identity_key: None,
            role: "button".to_string(),
            label: "Run".to_string(),
            value: None,
            bounds: None,
            enabled: true,
            focused: false,
        };
        let second = ComputerProviderElement {
            scope_key: None,
            identity_key: None,
            role: "button".to_string(),
            label: "Stop".to_string(),
            value: None,
            bounds: None,
            enabled: true,
            focused: false,
        };

        assert_ne!(computer_element_id(&first), computer_element_id(&second));
    }

    #[test]
    fn element_id_is_namespaced_by_app_window_scope() {
        let acepe = ComputerProviderElement {
            scope_key: Some("app:Acepe/window:Main".to_string()),
            identity_key: Some("ax_identifier:submit".to_string()),
            role: "button".to_string(),
            label: "Submit".to_string(),
            value: None,
            bounds: None,
            enabled: true,
            focused: false,
        };
        let safari = ComputerProviderElement {
            scope_key: Some("app:Safari/window:GitHub".to_string()),
            identity_key: Some("ax_identifier:submit".to_string()),
            role: "button".to_string(),
            label: "Submit".to_string(),
            value: None,
            bounds: None,
            enabled: true,
            focused: false,
        };

        assert_ne!(computer_element_id(&acepe), computer_element_id(&safari));
    }

    #[test]
    fn fingerprint_tracks_semantic_state() {
        let base = ComputerProviderElement {
            scope_key: None,
            identity_key: Some("window/button".to_string()),
            role: "button".to_string(),
            label: "Run".to_string(),
            value: None,
            bounds: None,
            enabled: true,
            focused: false,
        };
        let relabeled = ComputerProviderElement {
            label: "Stop".to_string(),
            ..base.clone()
        };
        let disabled = ComputerProviderElement {
            enabled: false,
            ..base.clone()
        };
        let focused = ComputerProviderElement {
            focused: true,
            ..base.clone()
        };

        assert_ne!(
            computer_element_fingerprint(&base),
            computer_element_fingerprint(&relabeled)
        );
        assert_ne!(
            computer_element_fingerprint(&base),
            computer_element_fingerprint(&disabled)
        );
        assert_eq!(
            computer_element_fingerprint(&base),
            computer_element_fingerprint(&focused)
        );
    }
}
