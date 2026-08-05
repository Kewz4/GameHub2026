use anyhow::{bail, Context, Result};
use indexmap::IndexMap;
use serde_yaml_ng::{Mapping, Value};
use sha2::{Digest, Sha256};

use super::types::{ManifestFileRule, ManifestGameEntry, ManifestIndex, ManifestRuleCondition};
use crate::constants::MANIFEST_INDEX_VERSION;

pub const MAX_MANIFEST_BYTES: usize = 32 * 1024 * 1024;
const MAX_MANIFEST_GAMES: usize = 100_000;
const MAX_RULES_PER_GAME: usize = 2_048;
const MAX_MANIFEST_RULES: usize = 1_000_000;
const MAX_MANIFEST_KEY_BYTES: usize = 512;
const MAX_RAW_PATH_BYTES: usize = 16 * 1024;

pub fn manifest_sha256(raw_yaml: &str) -> String {
    format!("{:x}", Sha256::digest(raw_yaml.as_bytes()))
}

fn string_value(value: &Value) -> Option<String> {
    value.as_str().map(ToString::to_string)
}

fn mapping_value<'a>(mapping: &'a Mapping, key: &str) -> Option<&'a Value> {
    mapping.get(Value::String(key.to_string()))
}

fn read_tags(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_sequence)
        .map(|items| items.iter().filter_map(string_value).collect())
        .unwrap_or_default()
}

fn read_conditions(value: Option<&Value>) -> Vec<ManifestRuleCondition> {
    value
        .and_then(Value::as_sequence)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let mapping = item.as_mapping()?;
                    let os = mapping_value(mapping, "os").and_then(string_value);
                    let store = mapping_value(mapping, "store").and_then(string_value);
                    (os.is_some() || store.is_some()).then_some(ManifestRuleCondition { os, store })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn map_game_entry(manifest_key: &str, value: &Value) -> Result<Option<ManifestGameEntry>> {
    let game = value
        .as_mapping()
        .with_context(|| format!("Cloud save manifest game {manifest_key} is not a map"))?;
    let Some(files) = mapping_value(game, "files") else {
        return Ok(None);
    };
    let files = files
        .as_mapping()
        .with_context(|| format!("Cloud save manifest files for {manifest_key} are not a map"))?;
    let mut mapped_files = Vec::with_capacity(files.len());
    for (raw_path, metadata) in files {
        let raw_path = string_value(raw_path).with_context(|| {
            format!("Cloud save manifest game {manifest_key} has a non-text path")
        })?;
        let metadata = match metadata {
            Value::Null => None,
            Value::Mapping(mapping) => Some(mapping),
            _ => bail!("Cloud save manifest metadata for {manifest_key} is not a map"),
        };
        mapped_files.push(ManifestFileRule {
            raw_path,
            tags: metadata
                .map(|mapping| read_tags(mapping_value(mapping, "tags")))
                .unwrap_or_default(),
            when: metadata
                .map(|mapping| read_conditions(mapping_value(mapping, "when")))
                .unwrap_or_default(),
        });
    }

    Ok((!mapped_files.is_empty()).then_some(ManifestGameEntry {
        manifest_key: manifest_key.to_string(),
        files: mapped_files,
    }))
}

pub(super) fn validate_manifest_index(index: &ManifestIndex) -> Result<()> {
    if index.version != MANIFEST_INDEX_VERSION {
        bail!("Cloud save manifest index version is unsupported");
    }
    if index.games.len() > MAX_MANIFEST_GAMES {
        bail!("Cloud save manifest contains too many games");
    }

    let mut total_rules = 0_usize;
    for (key, entry) in &index.games {
        if key.is_empty()
            || key.len() > MAX_MANIFEST_KEY_BYTES
            || entry.manifest_key != *key
            || entry.manifest_key.contains('\0')
        {
            bail!("Cloud save manifest contains an invalid game key");
        }
        if entry.files.len() > MAX_RULES_PER_GAME {
            bail!("Cloud save manifest game contains too many rules");
        }
        for rule in &entry.files {
            if rule.raw_path.is_empty()
                || rule.raw_path.len() > MAX_RAW_PATH_BYTES
                || rule.raw_path.contains('\0')
            {
                bail!("Cloud save manifest contains an invalid rule path");
            }
        }
        total_rules = total_rules
            .checked_add(entry.files.len())
            .context("Cloud save manifest rule count overflow")?;
        if total_rules > MAX_MANIFEST_RULES {
            bail!("Cloud save manifest contains too many rules");
        }
    }

    Ok(())
}

pub fn build_manifest_index(
    raw_yaml: &str,
    source_url: &str,
    fetched_at: i64,
) -> Result<ManifestIndex> {
    if raw_yaml.is_empty() || raw_yaml.len() > MAX_MANIFEST_BYTES {
        bail!("Cloud save manifest size is outside the allowed range");
    }
    let root: Value = serde_yaml_ng::from_str(raw_yaml)
        .with_context(|| format!("Failed to parse cloud save manifest from {source_url}"))?;
    let Some(root) = root.as_mapping() else {
        bail!("Cloud save manifest root from {source_url} must be a YAML map");
    };
    if root.len() > MAX_MANIFEST_GAMES {
        bail!("Cloud save manifest contains too many games");
    }
    let mut games = IndexMap::new();
    let mut total_rules = 0_usize;

    for (key, value) in root {
        let manifest_key =
            string_value(key).context("Cloud save manifest contains a non-text game key")?;
        if manifest_key.is_empty() || manifest_key.len() > MAX_MANIFEST_KEY_BYTES {
            bail!("Cloud save manifest contains an invalid game key");
        }
        if let Some(entry) = map_game_entry(&manifest_key, value)? {
            if entry.files.len() > MAX_RULES_PER_GAME {
                bail!("Cloud save manifest game contains too many rules");
            }
            for rule in &entry.files {
                if rule.raw_path.is_empty()
                    || rule.raw_path.len() > MAX_RAW_PATH_BYTES
                    || rule.raw_path.contains('\0')
                {
                    bail!("Cloud save manifest contains an invalid rule path");
                }
            }
            total_rules = total_rules
                .checked_add(entry.files.len())
                .context("Cloud save manifest rule count overflow")?;
            if total_rules > MAX_MANIFEST_RULES {
                bail!("Cloud save manifest contains too many rules");
            }
            games.insert(manifest_key, entry);
        }
    }

    let index = ManifestIndex {
        version: MANIFEST_INDEX_VERSION,
        fetched_at,
        source_url: source_url.to_string(),
        content_sha256: manifest_sha256(raw_yaml),
        games,
    };
    validate_manifest_index(&index)?;
    Ok(index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud_save::manifest::source::resolve_source_url;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[tokio::test]
    async fn builds_index_from_real_manifest() {
        let source_url = resolve_source_url(None);

        let raw_yaml = reqwest::get(&source_url)
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .text()
            .await
            .unwrap();

        let fetched_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        let index = build_manifest_index(&raw_yaml, &source_url, fetched_at).unwrap();

        let example = index
            .games
            .values()
            .flat_map(|game| game.files.iter().map(move |file| (game, file)))
            .find(|(_, file)| !file.tags.is_empty() || !file.when.is_empty())
            .expect("no file with tags or conditions found");

        println!("{}", serde_json::to_string_pretty(&example).unwrap());

        assert_eq!(index.version, 2);
        assert_eq!(index.source_url, source_url);
        assert_eq!(index.fetched_at, fetched_at);
        assert!(!index.games.is_empty());
    }

    #[test]
    fn rejects_malformed_manifest_roots_and_rule_paths() {
        let non_map = build_manifest_index("- not-a-map\n", "test", 0).unwrap_err();
        assert!(non_map.to_string().contains("must be a YAML map"));

        let nul_path = build_manifest_index("Game:\n  files:\n    \"bad\\0path\": {}\n", "test", 0)
            .unwrap_err();
        assert!(nul_path.to_string().contains("invalid rule path"));

        let malformed_game = build_manifest_index("Game: []\n", "test", 0).unwrap_err();
        assert!(malformed_game.to_string().contains("is not a map"));

        let non_text_path =
            build_manifest_index("Game:\n  files:\n    7: {}\n", "test", 0).unwrap_err();
        assert!(non_text_path.to_string().contains("non-text path"));
    }

    #[test]
    fn rejects_manifest_rule_and_byte_budgets() {
        let mut too_many_rules = String::from("Game:\n  files:\n");
        for index in 0..=MAX_RULES_PER_GAME {
            too_many_rules.push_str(&format!("    save-{index}: {{}}\n"));
        }
        let error = build_manifest_index(&too_many_rules, "test", 0).unwrap_err();
        assert!(error.to_string().contains("too many rules"));

        let oversized = "x".repeat(MAX_MANIFEST_BYTES + 1);
        let error = build_manifest_index(&oversized, "test", 0).unwrap_err();
        assert!(error.to_string().contains("size is outside"));
    }
}
