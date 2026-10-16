//! Walking the roots of the file tools: listing a folder and searching files
//! by name and content. `.gitignore` is respected and hidden files are
//! skipped, as in ripgrep, so the model is not buried in build output.

use std::path::Path;

use globset::{Glob, GlobMatcher};
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{sinks, BinaryDetection, SearcherBuilder};
use ignore::{DirEntry as WalkEntry, WalkBuilder};

use super::files::{
    is_forbidden, virtual_path, Access, DirEntry, EntryKind, FileRoot, FileToolOutput,
    ProfileFiles, Resolved, SearchMatch,
};
use crate::errors::AppError;
use crate::services::ai_vault::ProjectAccessMode;

pub const MAX_LIST_ENTRIES: usize = 500;
pub const MAX_LIST_DEPTH: usize = 5;
pub const MAX_SEARCH_MATCHES: usize = 200;
/// Larger files are skipped by a content search.
const MAX_SEARCH_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_MATCH_LINE_CHARACTERS: usize = 300;

fn glob(pattern: &str) -> Result<GlobMatcher, AppError> {
    Glob::new(pattern)
        .map(|glob| glob.compile_matcher())
        .map_err(|error| AppError::InvalidInput(format!("Invalid pattern {pattern}: {error}")))
}

/// Whether a file matches a name pattern: by its name, or by its path inside
/// the folder for a pattern with `/`.
fn matches_name(matcher: &GlobMatcher, pattern: &str, entry: &WalkEntry, base: &Path) -> bool {
    if pattern.contains('/') {
        entry
            .path()
            .strip_prefix(base)
            .is_ok_and(|relative| matcher.is_match(relative))
    } else {
        matcher.is_match(entry.file_name())
    }
}

/// The walker over a folder of a root, without what the tools may not see.
fn walker(target: &Resolved<'_>, max_depth: Option<usize>) -> ignore::Walk {
    let root = target.root.clone();
    let root_dir = target.root_dir.clone();
    WalkBuilder::new(&target.path)
        .max_depth(max_depth)
        .require_git(false)
        .follow_links(false)
        .sort_by_file_name(|a, b| a.cmp(b))
        .filter_entry(move |entry| {
            entry
                .path()
                .strip_prefix(&root_dir)
                .map_or(true, |relative| !is_forbidden(&root, relative))
        })
        .build()
}

/// The entries of a folder, `depth` levels down.
pub(super) fn list(
    target: &Resolved<'_>,
    depth: Option<usize>,
    pattern: Option<&str>,
) -> Result<(Vec<DirEntry>, bool), AppError> {
    let depth = depth.unwrap_or(1).clamp(1, MAX_LIST_DEPTH);
    let matcher = pattern.map(glob).transpose()?;
    let mut entries = Vec::new();
    for entry in walker(target, Some(depth)).flatten() {
        if entry.depth() == 0 {
            continue;
        }
        let is_dir = entry.file_type().is_some_and(|kind| kind.is_dir());
        if let (Some(matcher), Some(pattern)) = (&matcher, pattern) {
            if is_dir || !matches_name(matcher, pattern, &entry, &target.path) {
                continue;
            }
        }
        if entries.len() == MAX_LIST_ENTRIES {
            return Ok((entries, true));
        }
        let mut path = virtual_path(target.root, &target.root_dir, entry.path());
        if is_dir {
            path.push('/');
        }
        entries.push(DirEntry {
            path,
            kind: if is_dir {
                EntryKind::Dir
            } else {
                EntryKind::File
            },
            size: (!is_dir)
                .then(|| entry.metadata().ok().map(|meta| meta.len()))
                .flatten(),
        });
    }
    Ok((entries, false))
}

/// Files by name and lines by content, in one folder or in every root the
/// profile may read.
pub(super) fn search(
    files: &ProfileFiles,
    path: &str,
    query: Option<&str>,
    name_pattern: Option<&str>,
    is_regex: bool,
) -> Result<FileToolOutput, AppError> {
    let query = query.filter(|query| !query.is_empty());
    let name_pattern = name_pattern.filter(|pattern| !pattern.is_empty());
    if query.is_none() && name_pattern.is_none() {
        return Err(AppError::InvalidInput(
            "Give a query, a namePattern, or both".into(),
        ));
    }
    let name_matcher = name_pattern.map(glob).transpose()?;
    let content_matcher = query
        .map(|query| {
            RegexMatcherBuilder::new()
                .case_smart(true)
                .build(&if is_regex {
                    query.to_string()
                } else {
                    regex::escape(query)
                })
                .map_err(|error| AppError::InvalidInput(format!("Invalid query: {error}")))
        })
        .transpose()?;

    let targets: Vec<Resolved<'_>> = if path
        .split(['/', '\\'])
        .all(|part| part.is_empty() || part == ".")
    {
        files
            .roots()
            .iter()
            .filter(|root: &&FileRoot| root.read != ProjectAccessMode::Deny)
            .filter_map(|root| files.resolve(&root.path, Access::Read, true).ok())
            .collect()
    } else {
        vec![files.resolve(path, Access::Read, true)?]
    };

    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(0))
        .line_number(true)
        .build();
    let mut matches = Vec::new();
    for target in &targets {
        for entry in walker(target, None).flatten() {
            if !entry.file_type().is_some_and(|kind| kind.is_file()) {
                continue;
            }
            if let (Some(matcher), Some(pattern)) = (&name_matcher, name_pattern) {
                if !matches_name(matcher, pattern, &entry, &target.path) {
                    continue;
                }
            }
            let shown = virtual_path(target.root, &target.root_dir, entry.path());
            let Some(matcher) = &content_matcher else {
                if matches.len() == MAX_SEARCH_MATCHES {
                    return Ok(FileToolOutput::SearchFiles {
                        matches,
                        is_truncated: true,
                    });
                }
                matches.push(SearchMatch {
                    path: shown,
                    line: None,
                    text: None,
                });
                continue;
            };
            if entry
                .metadata()
                .map_or(true, |meta| meta.len() > MAX_SEARCH_FILE_BYTES)
            {
                continue;
            }
            let mut is_full = false;
            let result = searcher.search_path(
                matcher,
                entry.path(),
                sinks::Lossy(|line_number, line| {
                    if matches.len() == MAX_SEARCH_MATCHES {
                        is_full = true;
                        return Ok(false);
                    }
                    matches.push(SearchMatch {
                        path: shown.clone(),
                        line: Some(line_number),
                        text: Some(
                            line.trim_end()
                                .chars()
                                .take(MAX_MATCH_LINE_CHARACTERS)
                                .collect(),
                        ),
                    });
                    Ok(true)
                }),
            );
            if let Err(error) = result {
                log::debug!(
                    "Skipping {} in a file search: {error}",
                    entry.path().display()
                );
            }
            if is_full {
                return Ok(FileToolOutput::SearchFiles {
                    matches,
                    is_truncated: true,
                });
            }
        }
    }
    Ok(FileToolOutput::SearchFiles {
        matches,
        is_truncated: false,
    })
}
