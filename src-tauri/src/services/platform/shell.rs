//! The shell that runs user commands: `/bin/sh` on Linux, zsh on macOS and
//! PowerShell on Windows, with quoting rules to match.

use std::path::PathBuf;
use std::process::Command;

/// A command that runs `script` in the platform shell.
pub fn command(script: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command", script]);
        crate::services::clipboard::hide_console_window(&mut command);
        command
    }

    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("/bin/zsh");
        command.args(["-c", script]);
        command
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", script]);
        command
    }
}

/// `text` as a single literal argument of the platform shell.
pub fn quote(text: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("'{}'", escape_powershell_single(text))
    } else {
        format!("'{}'", text.replace('\'', r"'\''"))
    }
}

/// A shell expression that runs the script file at `path`.
pub fn script_invocation(path: &str) -> String {
    if cfg!(target_os = "windows") {
        // a quoted string alone is a value in PowerShell, `&` runs it
        format!("& {}", quote(path))
    } else {
        quote(path)
    }
}

pub fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(target_os = "windows") {
        "USERPROFILE"
    } else {
        "HOME"
    };
    std::env::var_os(var)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Context {
    Bare,
    Single,
    Double,
}

/// Replaces every `placeholder` in `script` with `text` as a literal, escaped
/// for the quotes the placeholder stands in: `{{TEXT}}`, `"{{TEXT}}"` and
/// `'{{TEXT}}'` all give the text as it is, never anything the shell expands.
pub fn substitute(script: &str, placeholder: &str, text: &str) -> String {
    let windows = cfg!(target_os = "windows");
    let mut result = String::with_capacity(script.len() + text.len() + 8);
    let mut context = Context::Bare;
    let mut rest = script;

    while !rest.is_empty() {
        if !placeholder.is_empty() && rest.starts_with(placeholder) {
            result.push_str(&literal(context, text, windows));
            rest = &rest[placeholder.len()..];
            continue;
        }

        let mut chars = rest.chars();
        let Some(c) = chars.next() else { break };
        result.push(c);
        rest = chars.as_str();

        let escape = if windows { '`' } else { '\\' };
        match (context, c) {
            (Context::Bare | Context::Double, c) if c == escape => {
                // the escaped character is taken as it is
                if let Some(next) = rest.chars().next() {
                    result.push(next);
                    rest = &rest[next.len_utf8()..];
                }
            }
            (Context::Bare, '\'') => context = Context::Single,
            (Context::Bare, '"') => context = Context::Double,
            (Context::Single, '\'') if windows && rest.starts_with('\'') => {
                result.push('\'');
                rest = &rest[1..];
            }
            (Context::Double, '"') if windows && rest.starts_with('"') => {
                result.push('"');
                rest = &rest[1..];
            }
            (Context::Single, '\'') | (Context::Double, '"') => context = Context::Bare,
            _ => {}
        }
    }

    result
}

fn literal(context: Context, text: &str, windows: bool) -> String {
    match (context, windows) {
        (Context::Bare, _) => quote(text),
        // close the quotes, add the text quoted on its own, reopen them
        (Context::Single, false) => format!("'{}'", quote(text)),
        (Context::Single, true) => escape_powershell_single(text),
        (Context::Double, false) => text
            .chars()
            .flat_map(|c| match c {
                '\\' | '$' | '`' | '"' => vec!['\\', c],
                c => vec![c],
            })
            .collect(),
        (Context::Double, true) => text
            .chars()
            .flat_map(|c| match c {
                '`' | '$' | '"' | '\u{201C}' | '\u{201D}' | '\u{201E}' => vec!['`', c],
                c => vec![c],
            })
            .collect(),
    }
}

fn escape_powershell_single(text: &str) -> String {
    // PowerShell also treats typographic single quotes as quotes
    text.chars()
        .flat_map(|c| match c {
            '\'' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}' => vec![c, c],
            c => vec![c],
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLACEHOLDER: &str = "{{TEXT}}";
    const NASTY: &str = "it's \"quoted\" $HOME `id` \\ ; exit 3 ‘’“”";

    fn run(script: &str) -> String {
        let output = command(script).output().unwrap();
        assert!(
            output.status.success(),
            "{script}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    #[cfg(not(target_os = "windows"))]
    fn print(argument: &str) -> String {
        format!("printf %s {argument}")
    }

    #[cfg(target_os = "windows")]
    fn print(argument: &str) -> String {
        format!("[Console]::Out.Write({argument})")
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn quotes_for_posix_shells() {
        assert_eq!(quote("don't"), r"'don'\''t'");
        assert_eq!(script_invocation("/a b/x.sh"), "'/a b/x.sh'");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn quotes_for_powershell() {
        assert_eq!(quote("don't"), "'don''t'");
        assert_eq!(script_invocation(r"C:\a b\x.ps1"), r"& 'C:\a b\x.ps1'");
    }

    #[test]
    fn substitutes_a_bare_placeholder() {
        let script = substitute(&print(PLACEHOLDER), PLACEHOLDER, NASTY);
        assert_eq!(run(&script), NASTY);
    }

    #[test]
    fn substitutes_a_placeholder_in_double_quotes() {
        let script = substitute(&print("\"<{{TEXT}}>\""), PLACEHOLDER, NASTY);
        assert_eq!(run(&script), format!("<{NASTY}>"));
    }

    #[test]
    fn substitutes_a_placeholder_in_single_quotes() {
        let script = substitute(&print("'<{{TEXT}}>'"), PLACEHOLDER, NASTY);
        assert_eq!(run(&script), format!("<{NASTY}>"));
    }

    #[test]
    fn substitutes_every_placeholder_once() {
        let script = substitute(&print("{{TEXT}}-{{TEXT}}"), PLACEHOLDER, PLACEHOLDER);
        assert_eq!(run(&script), "{{TEXT}}-{{TEXT}}");
    }

    #[test]
    fn keeps_a_script_without_placeholders() {
        assert_eq!(
            substitute("echo 'a' \"b\"", PLACEHOLDER, "x"),
            "echo 'a' \"b\""
        );
    }
}
