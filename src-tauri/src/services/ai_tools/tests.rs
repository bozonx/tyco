use std::collections::HashMap;
use std::fs;
use std::path::Path;

use super::files::*;
use crate::errors::AppError;
use crate::services::ai_vault::{
    self, AiProfile, AiProject, ProfileToolSettings, ProjectAccessMode, ProjectPermission,
    ToolGroupSettings,
};
use crate::services::test_support::TestDir;

use ProjectAccessMode::{Allow, Ask, Deny};

fn root(path: &str, dir: &Path, read: ProjectAccessMode, write: ProjectAccessMode) -> AiFileRoot {
    AiFileRoot::for_test(path, dir, read, write, path.starts_with("projects/"))
}

/// The workspace and two projects: `docs` to read only, `site` to change.
fn fixture(label: &str) -> (TestDir, ProfileFiles) {
    let dir = TestDir::new(label);
    for sub in ["workspace", "docs", "site"] {
        fs::create_dir_all(dir.join(sub)).unwrap();
    }
    fs::write(dir.join("docs/project.json"), "{}").unwrap();
    fs::write(dir.join("docs/readme.md"), "first\nsecond\nthird\n").unwrap();
    let files = ProfileFiles::from_roots(vec![
        root("workspace", &dir.join("workspace"), Allow, Allow),
        root("projects/docs", &dir.join("docs"), Allow, Deny),
        root("projects/site", &dir.join("site"), Ask, Ask),
    ]);
    (dir, files)
}

fn run(files: &ProfileFiles, request: serde_json::Value) -> Result<AiFileToolOutput, AppError> {
    files.run_with(serde_json::from_value(request).unwrap(), |path| {
        if path.is_dir() {
            fs::remove_dir_all(path)?;
        } else {
            fs::remove_file(path)?;
        }
        Ok(())
    })
}

fn message(result: Result<AiFileToolOutput, AppError>) -> String {
    result.unwrap_err().to_string()
}

#[test]
fn paths_stay_inside_their_root() {
    let (dir, files) = fixture("ai_files_traversal");
    fs::write(dir.join("secret.txt"), "secret").unwrap();

    for path in [
        "workspace/../secret.txt",
        "workspace/..\\secret.txt",
        "projects/docs/../../secret.txt",
        "/etc/passwd",
        "secret.txt",
        "projects/unknown/file.txt",
    ] {
        let error = message(run(
            &files,
            serde_json::json!({"operation": "readFile", "path": path}),
        ));
        assert!(
            error.contains("up with ..")
                || error.contains("Unknown path")
                || error.contains("no access"),
            "{path}: {error}"
        );
    }
}

#[cfg(unix)]
#[test]
fn a_link_out_of_the_root_is_refused() {
    let (dir, files) = fixture("ai_files_symlink");
    fs::create_dir_all(dir.join("outside")).unwrap();
    fs::write(dir.join("outside/secret.txt"), "secret").unwrap();
    std::os::unix::fs::symlink(dir.join("outside"), dir.join("workspace/out")).unwrap();
    std::os::unix::fs::symlink(
        dir.join("outside/secret.txt"),
        dir.join("workspace/secret.txt"),
    )
    .unwrap();
    fs::write(dir.join("workspace/real.txt"), "real").unwrap();
    std::os::unix::fs::symlink(
        dir.join("workspace/real.txt"),
        dir.join("workspace/inside.txt"),
    )
    .unwrap();

    for path in ["workspace/out/secret.txt", "workspace/secret.txt"] {
        let error = message(run(
            &files,
            serde_json::json!({"operation": "readFile", "path": path}),
        ));
        assert!(error.contains("leads outside"), "{path}: {error}");
    }
    let error = message(run(
        &files,
        serde_json::json!({"operation": "writeFile", "path": "workspace/out/new.txt", "content": "x"}),
    ));
    assert!(error.contains("leads outside"), "{error}");
    assert!(!dir.join("outside/new.txt").exists());

    // a link inside the root is followed to read, and deleted as a link
    let read = run(
        &files,
        serde_json::json!({"operation": "readFile", "path": "workspace/inside.txt"}),
    )
    .unwrap();
    assert!(matches!(read, AiFileToolOutput::ReadFile { content, .. } if content == "real"));
    run(
        &files,
        serde_json::json!({"operation": "deletePath", "path": "workspace/inside.txt"}),
    )
    .unwrap();
    assert!(dir.join("workspace/real.txt").exists());
    assert!(fs::symlink_metadata(dir.join("workspace/inside.txt")).is_err());
}

#[test]
fn tyco_and_git_files_are_hidden() {
    let (dir, files) = fixture("ai_files_hidden");
    fs::create_dir_all(dir.join("site/.git")).unwrap();
    fs::write(dir.join("site/.git/config"), "[core]").unwrap();
    fs::write(dir.join("site/index.html"), "<h1>Hi</h1>").unwrap();

    for (operation, path) in [
        ("readFile", "projects/docs/project.json"),
        ("readFile", "projects/site/.git/config"),
        ("readFile", "projects/site/.GIT/config"),
    ] {
        let error = message(run(
            &files,
            serde_json::json!({"operation": operation, "path": path}),
        ));
        assert!(error.contains("not available"), "{path}: {error}");
    }

    let AiFileToolOutput::ListDir { entries, .. } = run(
        &files,
        serde_json::json!({"operation": "listDir", "path": "projects/docs"}),
    )
    .unwrap() else {
        panic!("not a listing")
    };
    assert_eq!(
        entries.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(),
        ["projects/docs/readme.md"]
    );

    let AiFileToolOutput::SearchFiles { matches, .. } = run(
        &files,
        serde_json::json!({"operation": "searchFiles", "path": "projects/site", "namePattern": "*"}),
    )
    .unwrap() else {
        panic!("not a search")
    };
    assert_eq!(
        matches.iter().map(|m| m.path.as_str()).collect::<Vec<_>>(),
        ["projects/site/index.html"]
    );
}

#[test]
fn denied_access_is_enforced() {
    let (dir, files) = fixture("ai_files_deny");
    let error = message(run(
        &files,
        serde_json::json!({"operation": "writeFile", "path": "projects/docs/new.md", "content": "x"}),
    ));
    assert!(error.contains("may not change"), "{error}");
    assert!(!dir.join("docs/new.md").exists());

    let error = message(run(
        &files,
        serde_json::json!({"operation": "deletePath", "path": "projects/docs/readme.md"}),
    ));
    assert!(error.contains("may not change"), "{error}");
    assert!(dir.join("docs/readme.md").exists());

    let error = message(run(
        &files,
        serde_json::json!({"operation": "movePath", "from": "projects/docs/readme.md", "to": "workspace/readme.md"}),
    ));
    assert!(error.contains("may not change"), "{error}");
}

#[test]
fn the_roots_are_listed_and_cannot_be_removed() {
    let (_dir, files) = fixture("ai_files_roots");
    let AiFileToolOutput::ListDir { entries, .. } =
        run(&files, serde_json::json!({"operation": "listDir"})).unwrap()
    else {
        panic!("not a listing")
    };
    assert_eq!(
        entries.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(),
        ["workspace/", "projects/docs/", "projects/site/"]
    );
    let error = message(run(
        &files,
        serde_json::json!({"operation": "deletePath", "path": "workspace"}),
    ));
    assert!(error.contains("cannot be deleted"), "{error}");
}

#[test]
fn files_are_read_by_lines() {
    let (_dir, files) = fixture("ai_files_read");
    let read = |request: serde_json::Value| match run(&files, request).unwrap() {
        AiFileToolOutput::ReadFile {
            content,
            start_line,
            end_line,
            total_lines,
            next_offset,
            ..
        } => (content, start_line, end_line, total_lines, next_offset),
        other => panic!("{other:?}"),
    };
    assert_eq!(
        read(
            serde_json::json!({"operation": "readFile", "path": "projects/docs/readme.md", "offset": 2, "limit": 1})
        ),
        ("second\n".into(), 2, 2, 3, Some(3))
    );
    assert_eq!(
        read(
            serde_json::json!({"operation": "readFile", "path": "projects/docs/readme.md", "maxCharacters": 13})
        ),
        ("first\nsecond\n".into(), 1, 2, 3, Some(3))
    );
    let error = message(run(
        &files,
        serde_json::json!({"operation": "readFile", "path": "projects/docs/readme.md", "offset": 9}),
    ));
    assert!(error.contains("past the end"), "{error}");
}

#[test]
fn a_long_first_line_is_cut_to_the_limit() {
    let page = page_lines("abcdef\nx\n", 1, 10, 3).unwrap();
    assert_eq!(page.content, "abc");
    assert_eq!(page.next_offset, Some(2));
}

#[test]
fn binary_and_large_files_are_not_read() {
    let (dir, files) = fixture("ai_files_binary");
    fs::write(dir.join("workspace/blob.bin"), [1u8, 0, 2]).unwrap();
    let error = message(run(
        &files,
        serde_json::json!({"operation": "readFile", "path": "workspace/blob.bin"}),
    ));
    assert!(error.contains("binary"), "{error}");

    let large = fs::File::create(dir.join("workspace/large.txt")).unwrap();
    large.set_len(MAX_READ_BYTES + 1).unwrap();
    let error = message(run(
        &files,
        serde_json::json!({"operation": "readFile", "path": "workspace/large.txt"}),
    ));
    assert!(error.contains("too large"), "{error}");

    fs::write(dir.join("workspace/report.PDF"), b"%PDF").unwrap();
    assert_eq!(
        run(
            &files,
            serde_json::json!({"operation": "readFile", "path": "workspace/report.PDF"})
        )
        .unwrap(),
        AiFileToolOutput::ReadDocument {
            path: "workspace/report.PDF".into(),
            media_type: "application/pdf".into(),
        }
    );
    assert_eq!(files.read_bytes("workspace/report.PDF").unwrap(), b"%PDF");
}

#[test]
fn writes_create_folders_and_report_what_they_did() {
    let (dir, files) = fixture("ai_files_write");
    assert_eq!(
        run(
            &files,
            serde_json::json!({"operation": "writeFile", "path": "projects/site/src/app.js", "content": "let a = 1\n"})
        )
        .unwrap(),
        AiFileToolOutput::WriteFile {
            path: "projects/site/src/app.js".into(),
            is_created: true,
            bytes: 10,
        }
    );
    assert_eq!(
        fs::read_to_string(dir.join("site/src/app.js")).unwrap(),
        "let a = 1\n"
    );

    let error = message(run(
        &files,
        serde_json::json!({"operation": "writeFile", "path": "workspace/big.txt", "content": "x".repeat(MAX_WRITE_BYTES + 1)}),
    ));
    assert!(error.contains("larger than"), "{error}");
}

#[test]
fn an_edit_replaces_one_unique_fragment() {
    assert_eq!(
        apply_edit("a b a", "b", "c", false).unwrap(),
        ("a c a".into(), 1)
    );
    assert!(apply_edit("a b a", "a", "c", false)
        .unwrap_err()
        .to_string()
        .contains("2 times"));
    assert_eq!(
        apply_edit("a b a", "a", "c", true).unwrap(),
        ("c b c".into(), 2)
    );
    assert!(apply_edit("a", "z", "c", false)
        .unwrap_err()
        .to_string()
        .contains("not found"));
    assert!(apply_edit("a", "", "c", false).is_err());
    // the model writes \n; the file keeps its own line ends
    assert_eq!(
        apply_edit("one\r\ntwo\r\n", "one\ntwo", "1\n2", false).unwrap(),
        ("1\r\n2\r\n".into(), 1)
    );
}

#[test]
fn a_preview_changes_nothing() {
    let (dir, files) = fixture("ai_files_preview");
    fs::write(dir.join("site/page.md"), "Hello world\n").unwrap();
    let preview = files
        .preview(
            serde_json::from_value(serde_json::json!({
                "operation": "editFile", "path": "projects/site/page.md",
                "oldText": "world", "newText": "there"
            }))
            .unwrap(),
        )
        .unwrap();
    assert_eq!(
        preview,
        AiFileChangePreview {
            path: "projects/site/page.md".into(),
            before: Some("Hello world\n".into()),
            after: "Hello there\n".into(),
        }
    );
    assert_eq!(
        fs::read_to_string(dir.join("site/page.md")).unwrap(),
        "Hello world\n"
    );

    let preview = files
        .preview(
            serde_json::from_value(serde_json::json!({
                "operation": "writeFile", "path": "workspace/new.md", "content": "New"
            }))
            .unwrap(),
        )
        .unwrap();
    assert_eq!(preview.before, None);
    assert!(!dir.join("workspace/new.md").exists());
}

#[test]
fn moves_keep_both_ends_inside_writable_roots() {
    let (dir, files) = fixture("ai_files_move");
    fs::write(dir.join("workspace/draft.md"), "draft").unwrap();
    fs::write(dir.join("site/taken.md"), "taken").unwrap();

    let error = message(run(
        &files,
        serde_json::json!({"operation": "movePath", "from": "workspace/draft.md", "to": "projects/site/taken.md"}),
    ));
    assert!(error.contains("already exists"), "{error}");

    assert_eq!(
        run(
            &files,
            serde_json::json!({"operation": "movePath", "from": "workspace/draft.md", "to": "projects/site/posts/draft.md"})
        )
        .unwrap(),
        AiFileToolOutput::MovePath {
            from: "workspace/draft.md".into(),
            to: "projects/site/posts/draft.md".into(),
        }
    );
    assert_eq!(
        fs::read_to_string(dir.join("site/posts/draft.md")).unwrap(),
        "draft"
    );

    fs::create_dir_all(dir.join("workspace/folder")).unwrap();
    let error = message(run(
        &files,
        serde_json::json!({"operation": "movePath", "from": "workspace/folder", "to": "workspace/folder/inner"}),
    ));
    assert!(error.contains("into itself"), "{error}");
}

#[test]
fn a_search_finds_lines_and_names() {
    let (dir, files) = fixture("ai_files_search");
    fs::write(dir.join("workspace/notes.md"), "Alpha\nbeta gamma\n").unwrap();
    fs::write(dir.join("workspace/.gitignore"), "build/\n").unwrap();
    fs::create_dir_all(dir.join("workspace/build")).unwrap();
    fs::write(dir.join("workspace/build/out.md"), "beta\n").unwrap();

    let AiFileToolOutput::SearchFiles { matches, .. } = run(
        &files,
        serde_json::json!({"operation": "searchFiles", "query": "beta"}),
    )
    .unwrap() else {
        panic!("not a search")
    };
    assert_eq!(
        matches,
        vec![SearchMatch {
            path: "workspace/notes.md".into(),
            line: Some(2),
            text: Some("beta gamma".into()),
        }]
    );

    let AiFileToolOutput::SearchFiles { matches, .. } = run(
        &files,
        serde_json::json!({"operation": "searchFiles", "query": "^alp", "isRegex": true, "namePattern": "*.md"}),
    )
    .unwrap() else {
        panic!("not a search")
    };
    // a lowercase query matches any case
    assert_eq!(matches.len(), 1);

    let error = message(run(&files, serde_json::json!({"operation": "searchFiles"})));
    assert!(error.contains("query"), "{error}");
}

#[test]
fn listings_go_down_to_the_depth_asked() {
    let (dir, files) = fixture("ai_files_list");
    fs::create_dir_all(dir.join("workspace/a/b")).unwrap();
    fs::write(dir.join("workspace/a/b/deep.txt"), "x").unwrap();
    fs::write(dir.join("workspace/top.txt"), "x").unwrap();
    let paths = |depth: usize| match run(
        &files,
        serde_json::json!({"operation": "listDir", "path": "workspace", "depth": depth}),
    )
    .unwrap()
    {
        AiFileToolOutput::ListDir { entries, .. } => {
            entries.into_iter().map(|e| e.path).collect::<Vec<_>>()
        }
        other => panic!("{other:?}"),
    };
    assert_eq!(paths(1), ["workspace/a/", "workspace/top.txt"]);
    assert_eq!(
        paths(3),
        [
            "workspace/a/",
            "workspace/a/b/",
            "workspace/a/b/deep.txt",
            "workspace/top.txt"
        ]
    );
}

#[test]
fn uploads_get_names_of_their_own() {
    let (dir, files) = fixture("ai_files_uploads");
    assert_eq!(
        files.save_upload("../report.pdf", b"one").unwrap(),
        "workspace/uploads/report.pdf"
    );
    assert_eq!(
        files.save_upload("report.pdf", b"two").unwrap(),
        "workspace/uploads/report (1).pdf"
    );
    assert_eq!(
        files.save_upload("..", b"three").unwrap(),
        "workspace/uploads/file"
    );
    assert_eq!(
        fs::read(dir.join("workspace/uploads/report (1).pdf")).unwrap(),
        b"two"
    );
}

fn profile(tools: Option<ProfileToolSettings>) -> AiProfile {
    AiProfile {
        id: "writer".into(),
        name: "Writer".into(),
        model_id: None,
        temperature: None,
        max_output_tokens: None,
        project_permissions: HashMap::from([
            (
                "book".into(),
                ProjectPermission {
                    read: Allow,
                    write: Ask,
                },
            ),
            (
                "closed".into(),
                ProjectPermission {
                    read: Deny,
                    write: Deny,
                },
            ),
        ]),
        tools,
        created_at: 1,
        updated_at: 1,
    }
}

fn project(id: &str, created_at: u64) -> AiProject {
    AiProject {
        id: id.into(),
        name: format!("Project {id}"),
        description: Some("About it".into()),
        is_external: false,
        target_path: None,
        created_at,
        updated_at: created_at,
    }
}

#[test]
fn a_profile_reaches_its_workspace_and_permitted_projects() {
    let vault = TestDir::new("ai_files_profile");
    let enabled = ProfileToolSettings {
        groups: HashMap::from([(
            FILES_TOOL_GROUP.to_string(),
            ToolGroupSettings {
                is_enabled: true,
                access: Allow,
            },
        )]),
        max_step_count: None,
    };
    ai_vault::create_profile(&vault, profile(Some(enabled)), "").unwrap();
    for (index, id) in ["book", "closed", "other"].iter().enumerate() {
        ai_vault::create_project(&vault, project(id, index as u64)).unwrap();
    }

    let files = ProfileFiles::load(&vault, "writer").unwrap();
    let roots: Vec<_> = files
        .roots()
        .iter()
        .map(|root| (root.path.as_str(), root.read.clone(), root.write.clone()))
        .collect();
    assert_eq!(
        roots,
        [("workspace", Allow, Allow), ("projects/book", Allow, Ask)]
    );
    assert_eq!(
        serde_json::to_value(&files.roots()[1]).unwrap(),
        serde_json::json!({
            "path": "projects/book", "name": "Project book",
            "description": "About it", "read": "allow", "write": "ask"
        })
    );
    let error = message(run(
        &files,
        serde_json::json!({"operation": "readFile", "path": "projects/book/project.json"}),
    ));
    assert!(error.contains("not available"), "{error}");

    ai_vault::save_profile(&vault, profile(None)).unwrap();
    assert!(ProfileFiles::load(&vault, "writer")
        .err()
        .unwrap()
        .to_string()
        .contains("off"));
}

#[test]
fn edits_reject_expansion_beyond_the_limit_before_building_the_result() {
    let input = "a".repeat(1024 * 1024);
    assert!(matches!(
        apply_edit(&input, "a", &"b".repeat(100), true),
        Err(AppError::ResourceLimit(_))
    ));
    let (at_limit, _) = apply_edit("x", "x", &"b".repeat(MAX_WRITE_BYTES), false).unwrap();
    assert_eq!(at_limit.len(), MAX_WRITE_BYTES);
    assert!(matches!(
        apply_edit("x", "x", &"b".repeat(MAX_WRITE_BYTES + 1), false),
        Err(AppError::ResourceLimit(_))
    ));
}

#[test]
fn oversized_edits_and_previews_leave_the_file_unchanged() {
    let (directory, files) = fixture("ai-files-edit-limit");
    fs::write(directory.join("workspace/file.txt"), "aa").unwrap();
    let edit = AiFileToolRequest::EditFile {
        path: "workspace/file.txt".into(),
        old_text: "a".into(),
        new_text: "b".repeat(MAX_WRITE_BYTES / 2 + 1),
        replace_all: true,
    };
    assert!(matches!(
        files.preview(edit.clone()),
        Err(AppError::ResourceLimit(_))
    ));
    assert!(matches!(files.run(edit), Err(AppError::ResourceLimit(_))));
    assert!(matches!(
        files.preview(AiFileToolRequest::WriteFile {
            path: "workspace/file.txt".into(),
            content: "b".repeat(MAX_WRITE_BYTES + 1),
        }),
        Err(AppError::ResourceLimit(_))
    ));
    assert_eq!(
        fs::read_to_string(directory.join("workspace/file.txt")).unwrap(),
        "aa"
    );
}

#[cfg(unix)]
#[test]
fn a_permission_denied_rename_does_not_fall_back_to_copying() {
    use std::os::unix::fs::PermissionsExt;
    let (directory, files) = fixture("ai-files-rename-denied");
    let parent = directory.join("workspace/readonly");
    fs::create_dir(&parent).unwrap();
    fs::write(parent.join("file.txt"), "original").unwrap();
    fs::set_permissions(&parent, fs::Permissions::from_mode(0o555)).unwrap();
    let result = files.run(AiFileToolRequest::MovePath {
        from: "workspace/readonly/file.txt".into(),
        to: "workspace/moved.txt".into(),
    });
    fs::set_permissions(&parent, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(
        matches!(result, Err(AppError::Io(error)) if error.kind() == std::io::ErrorKind::PermissionDenied)
    );
    assert_eq!(
        fs::read_to_string(parent.join("file.txt")).unwrap(),
        "original"
    );
    assert!(!directory.join("workspace/moved.txt").exists());
}
