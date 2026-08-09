use crate::cloud_save::manifest::types::CloudSaveRule;

use super::applicability::{
    path_is_foreign_environment, rule_is_applicable, FOREIGN_ENVIRONMENT_TOKEN,
};
use super::resolve_path::resolve_path;
use super::types::{PathResolutionContext, ResolvedCloudSaveRule};

fn is_dangerously_broad_manifest_path(raw_path: &str) -> bool {
    let normalized = raw_path.trim().replace('\\', "/");
    let normalized = normalized.trim_end_matches('/');
    let root_tokens = [
        "<home>",
        "<winAppData>",
        "%APPDATA%",
        "<winLocalAppData>",
        "%LOCALAPPDATA%",
        "<winDocuments>",
        "<winPublic>",
        "<winProgramData>",
        "<winDir>",
        "<xdgData>",
        "<xdgConfig>",
        "<base>",
        "<root>",
    ];
    let starts_with_glob = |suffix: &str| {
        suffix
            .trim_start_matches('/')
            .split('/')
            .find(|segment| !segment.is_empty())
            .is_none_or(|segment| segment.contains(['*', '?', '[']))
    };

    if let Some(suffix) = root_tokens.iter().find_map(|root| {
        normalized
            .strip_prefix(root)
            .filter(|suffix| suffix.is_empty() || suffix.starts_with('/'))
    }) {
        return starts_with_glob(suffix);
    }

    if normalized.is_empty() || normalized == "/" {
        return true;
    }
    if let Some(unc_path) = normalized.strip_prefix("//") {
        let segments = unc_path
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>();
        return segments.len() <= 2
            || segments[2..]
                .first()
                .is_none_or(|segment| segment.contains(['*', '?', '[']));
    }
    if normalized.starts_with('/') {
        return starts_with_glob(normalized);
    }

    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return starts_with_glob(&normalized[2..]);
    }

    false
}

pub fn resolve_rules(
    rules: Vec<CloudSaveRule>,
    context: &PathResolutionContext,
) -> Vec<ResolvedCloudSaveRule> {
    rules
        .into_iter()
        .map(|rule| {
            if !rule_is_applicable(&rule.when, context)
                || path_is_foreign_environment(&rule.raw_path, context)
            {
                return ResolvedCloudSaveRule {
                    rule_id: rule.rule_id,
                    kind: rule.kind,
                    raw_path: rule.raw_path,
                    source: rule.source,
                    tags: rule.tags,
                    when: rule.when,
                    resolved_paths: vec![],
                    unresolved_tokens: vec![FOREIGN_ENVIRONMENT_TOKEN.to_string()],
                };
            }
            let mut resolved = resolve_path(&rule.raw_path, context);
            let trusted_exact_root =
                rule.raw_path.starts_with("<custom>") || rule.source == "gamehub-emulator";
            if !trusted_exact_root && is_dangerously_broad_manifest_path(&rule.raw_path) {
                resolved.paths.clear();
                resolved.unresolved_tokens = vec!["cloud_save_unsafe_broad_path".to_string()];
            }
            if rule.raw_path.starts_with("<custom>") || rule.source == "gamehub-emulator" {
                if let Some(preferred_path) = &rule.preferred_path {
                    resolved.paths = vec![super::types::ResolvedCloudSavePath {
                        path: preferred_path.replace('\\', "/"),
                        case_sensitive: context.platform == "linux"
                            && !context.windows_compatibility,
                        dynamic: false,
                        scan_root: None,
                    }];
                    resolved.unresolved_tokens.clear();
                }
            }
            ResolvedCloudSaveRule {
                rule_id: rule.rule_id,
                kind: rule.kind,
                raw_path: rule.raw_path,
                source: rule.source,
                tags: rule.tags,
                when: rule.when,
                resolved_paths: resolved.paths,
                unresolved_tokens: resolved.unresolved_tokens,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud_save::manifest::types::CloudSaveRuleCondition;
    use crate::cloud_save::path_resolution::context::build_context;
    use crate::cloud_save::path_resolution::types::ResolveSaveRulesInput;

    #[test]
    fn a_locally_bound_custom_rule_uses_only_its_approved_path() {
        let context = build_context(&ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "1".into(),
            platform: "linux".into(),
            home_dir: "/home/hydra".into(),
            documents_dir: None,
            app_data_dir: None,
            executable_path: Some("/games/game.exe".into()),
            wine_prefix_path: Some("/prefix".into()),
            steam_path: None,
            rules: Vec::new(),
        })
        .unwrap();
        let result = resolve_rules(
            vec![CloudSaveRule {
                rule_id: "custom".into(),
                kind: "dir".into(),
                raw_path: "<custom><windows><winDocuments>/Game".into(),
                source: "custom".into(),
                tags: vec!["save".into()],
                when: Vec::<CloudSaveRuleCondition>::new(),
                preferred_path: Some("/prefix/drive_c/users/player-two/Documents/Game".into()),
            }],
            &context,
        );

        assert_eq!(result[0].resolved_paths.len(), 1);
        assert_eq!(
            result[0].resolved_paths[0].path,
            "/prefix/drive_c/users/player-two/Documents/Game"
        );
        assert!(result[0].unresolved_tokens.is_empty());
    }

    #[test]
    fn filters_manifest_rule_conditions_by_current_os_and_store() {
        let context = build_context(&ResolveSaveRulesInput {
            shop: "xbox".into(),
            object_id: "1".into(),
            platform: "windows".into(),
            home_dir: "C:/Users/player".into(),
            documents_dir: None,
            app_data_dir: None,
            executable_path: None,
            wine_prefix_path: None,
            steam_path: None,
            rules: Vec::new(),
        })
        .unwrap();
        let rule = |rule_id: &str, os: Option<&str>, store: Option<&str>| CloudSaveRule {
            rule_id: rule_id.into(),
            kind: "dir".into(),
            raw_path: format!("<home>/{rule_id}"),
            source: "ludusavi".into(),
            tags: vec!["save".into()],
            when: vec![CloudSaveRuleCondition {
                os: os.map(str::to_string),
                store: store.map(str::to_string),
            }],
            preferred_path: None,
        };

        let result = resolve_rules(
            vec![
                rule("microsoft", Some("windows"), Some("microsoft")),
                rule("wrong-store", Some("windows"), Some("steam")),
                rule("wrong-os", Some("linux"), Some("microsoft")),
                rule("os-only", Some("windows"), None),
            ],
            &context,
        );
        let ids = result
            .iter()
            .filter(|resolved| !resolved.resolved_paths.is_empty())
            .map(|resolved| resolved.rule_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["microsoft", "os-only"]);
        for foreign in result
            .iter()
            .filter(|resolved| matches!(resolved.rule_id.as_str(), "wrong-store" | "wrong-os"))
        {
            assert!(foreign.resolved_paths.is_empty());
            assert_eq!(
                foreign.unresolved_tokens,
                vec![FOREIGN_ENVIRONMENT_TOKEN.to_string()]
            );
        }
    }

    #[test]
    fn rejects_bare_manifest_roots_and_root_level_globs() {
        let context = build_context(&ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "1".into(),
            platform: "windows".into(),
            home_dir: "C:/Users/player".into(),
            documents_dir: Some("C:/Users/player/Documents".into()),
            app_data_dir: Some("C:/Users/player/AppData/Roaming".into()),
            executable_path: Some("C:/Games/Game/game.exe".into()),
            wine_prefix_path: None,
            steam_path: None,
            rules: Vec::new(),
        })
        .unwrap();
        let broad_paths = [
            "<home>",
            "<winAppData>/**",
            "<winLocalAppData>/*/save.dat",
            "<winDocuments>",
            "<base>/*",
            "<root>",
            "/",
            "/**/save.dat",
            "C:/",
            "D:/*",
            "//server/share",
            "//server/share/**/save.dat",
        ];
        let rules = broad_paths
            .iter()
            .enumerate()
            .map(|(index, raw_path)| CloudSaveRule {
                rule_id: format!("broad-{index}"),
                kind: "dir".into(),
                raw_path: (*raw_path).into(),
                source: "ludusavi".into(),
                tags: vec!["save".into()],
                when: vec![],
                preferred_path: None,
            })
            .collect();

        let result = resolve_rules(rules, &context);

        assert_eq!(result.len(), broad_paths.len());
        assert!(result.iter().all(|rule| rule.resolved_paths.is_empty()
            && rule.unresolved_tokens == ["cloud_save_unsafe_broad_path"]));
    }

    #[test]
    fn preserves_exact_game_subdirectories_and_trusted_preferred_roots() {
        let context = build_context(&ResolveSaveRulesInput {
            shop: "steam".into(),
            object_id: "1".into(),
            platform: "windows".into(),
            home_dir: "C:/Users/player".into(),
            documents_dir: Some("C:/Users/player/Documents".into()),
            app_data_dir: Some("C:/Users/player/AppData/Roaming".into()),
            executable_path: Some("C:/Games/Game/game.exe".into()),
            wine_prefix_path: None,
            steam_path: None,
            rules: Vec::new(),
        })
        .unwrap();
        let rules = vec![
            CloudSaveRule {
                rule_id: "manifest".into(),
                kind: "dir".into(),
                raw_path: "<home>/Game/**".into(),
                source: "ludusavi".into(),
                tags: vec![],
                when: vec![],
                preferred_path: None,
            },
            CloudSaveRule {
                rule_id: "emulator".into(),
                kind: "dir".into(),
                raw_path: "<base>".into(),
                source: "gamehub-emulator".into(),
                tags: vec![],
                when: vec![],
                preferred_path: Some("C:/Emulators/Cemu/mlc01/usr/save/title".into()),
            },
        ];

        let result = resolve_rules(rules, &context);

        assert!(!result[0].resolved_paths.is_empty());
        assert_eq!(
            result[1].resolved_paths[0].path,
            "C:/Emulators/Cemu/mlc01/usr/save/title"
        );
    }
}
