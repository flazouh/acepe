//! YAML frontmatter parser for SKILL.md files.
//!
//! Skills use YAML frontmatter with required `name` and `description` fields:
//! ```markdown
//! ---
//! name: "skill-name"
//! description: "What the skill does"
//! ---
//!
//! # Skill content here...
//! ```

/// Metadata parsed from SKILL.md frontmatter.
#[derive(Debug, Clone)]
pub struct SkillMetadata {
    /// Skill name from frontmatter
    pub name: String,
    /// Description from frontmatter
    pub description: String,
}

/// Parse SKILL.md content to extract frontmatter metadata and body.
///
/// Returns (metadata, body) where body is the content after the frontmatter.
pub fn parse_skill_content(content: &str) -> Result<(SkillMetadata, String), String> {
    let lines: Vec<&str> = content.lines().collect();

    // Check for YAML frontmatter markers
    if lines.is_empty() || lines[0] != "---" {
        return Err("No YAML frontmatter found. Skill files must start with ---".to_string());
    }

    // Find closing marker (skip first line which is opening ---)
    let end_idx = lines
        .iter()
        .skip(1)
        .position(|&line| line == "---")
        .map(|pos| pos + 1) // +1 because we skipped the first element
        .ok_or("Invalid frontmatter: missing closing ---")?;

    if end_idx < 2 {
        return Err("Invalid frontmatter format".to_string());
    }

    let frontmatter_yaml = lines[1..end_idx].join("\n");
    let body = if end_idx + 1 < lines.len() {
        lines[end_idx + 1..].join("\n").trim_start().to_string()
    } else {
        String::new()
    };

    // Parse YAML fields
    let mut name = String::new();
    let mut description = String::new();

    for line in frontmatter_yaml.lines() {
        let line = line.trim();
        if line.starts_with("name:") {
            name = extract_yaml_value(line, "name:");
        } else if line.starts_with("description:") {
            description = extract_yaml_value(line, "description:");
        }
    }

    if name.is_empty() {
        return Err("Required field 'name' not found in frontmatter".to_string());
    }

    Ok((SkillMetadata { name, description }, body))
}

/// Extract value from a YAML line like "key: value" or "key: \"value\""
fn extract_yaml_value(line: &str, prefix: &str) -> String {
    line.trim_start_matches(prefix)
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

/// Generate SKILL.md content from components.
pub fn generate_skill_content(name: &str, description: &str, body: &str) -> String {
    format!(
        "---\nname: \"{}\"\ndescription: \"{}\"\n---\n\n{}",
        name.replace('"', "\\\""),
        description.replace('"', "\\\""),
        body
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_skill_content_basic() {
        let content = r#"---
name: "test-skill"
description: "A test skill"
---

# Test Skill

This is the body."#;

        let result = parse_skill_content(content);
        assert!(result.is_ok());

        let (metadata, body) = result.unwrap();
        assert_eq!(metadata.name, "test-skill");
        assert_eq!(metadata.description, "A test skill");
        assert!(body.contains("# Test Skill"));
    }

    #[test]
    fn test_parse_skill_content_no_frontmatter() {
        let content = "# Just markdown\nNo frontmatter here.";
        let result = parse_skill_content(content);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_skill_content_missing_name() {
        let content = r#"---
description: "Only description"
---

Body content."#;

        let result = parse_skill_content(content);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("name"));
    }

    #[test]
    fn test_generate_skill_content() {
        let content = generate_skill_content("my-skill", "Does something", "# Content");
        assert!(content.contains("name: \"my-skill\""));
        assert!(content.contains("description: \"Does something\""));
        assert!(content.contains("# Content"));
    }
}
