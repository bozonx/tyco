//! The shell that runs user commands: `/bin/sh` on Linux, zsh on macOS and
//! PowerShell on Windows, with quoting rules to match.

pub use super::process::kill_tree;
use std::path::PathBuf;
use std::process::Command;

/// The environment variable that carries the text into a command, see
/// [`substitute`].
pub const TEXT_ENV: &str = "TYCO_TEXT";

/// A command that runs `script` in the platform shell, in a process group of
/// its own, so that [`kill_tree`] stops whatever the script started.
pub fn command(script: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command", script]);
        crate::services::platform::process::hide_console_window(&mut command);
        command
    }

    #[cfg(target_os = "macos")]
    {
        use std::os::unix::process::CommandExt;
        let mut command = Command::new("/bin/zsh");
        command.args(["-c", script]).process_group(0);
        command
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        use std::os::unix::process::CommandExt;
        let mut command = Command::new("/bin/sh");
        command.args(["-c", script]).process_group(0);
        command
    }
}

/// A command that runs `script` with every `placeholder` standing for `text`,
/// see [`substitute`].
pub fn command_with_text(script: &str, placeholder: &str, text: &str) -> Command {
    let mut command = command(&substitute(script, placeholder, text));
    command.env(TEXT_ENV, text);
    command
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
enum QuoteContext {
    Bare,
    SingleQuoted,
    DoubleQuoted,
}

/// Replaces every `placeholder` in `script` with a reference to [`TEXT_ENV`],
/// written for the quotes the placeholder stands in: `{{TEXT}}`, `"{{TEXT}}"`
/// and `'{{TEXT}}'` all give the text as it is. The text itself never becomes
/// part of the script, so nothing the parser here does not follow (a here
/// document, a comment, a command substitution) can make the shell run it.
/// Only a PowerShell single-quoted string, which expands nothing, gets the
/// text escaped in place. The command must have `TEXT_ENV` set, see
/// [`command_with_text`].
pub fn substitute(script: &str, placeholder: &str, text: &str) -> String {
    let windows = cfg!(target_os = "windows");
    let mut result = String::with_capacity(script.len() + 16);
    let mut context = QuoteContext::Bare;
    let mut rest = script;

    while !rest.is_empty() {
        if !placeholder.is_empty() && rest.starts_with(placeholder) {
            result.push_str(&reference(context, text, windows));
            rest = &rest[placeholder.len()..];
            continue;
        }

        let mut chars = rest.chars();
        let Some(c) = chars.next() else { break };
        result.push(c);
        rest = chars.as_str();

        let escape = if windows { '`' } else { '\\' };
        match (context, c) {
            (QuoteContext::Bare | QuoteContext::DoubleQuoted, c) if c == escape => {
                // the escaped character is taken as it is
                if let Some(next) = rest.chars().next() {
                    result.push(next);
                    rest = &rest[next.len_utf8()..];
                }
            }
            (QuoteContext::Bare, '\'') => context = QuoteContext::SingleQuoted,
            (QuoteContext::Bare, '"') => context = QuoteContext::DoubleQuoted,
            (QuoteContext::SingleQuoted, '\'') if windows && rest.starts_with('\'') => {
                result.push('\'');
                rest = &rest[1..];
            }
            (QuoteContext::DoubleQuoted, '"') if windows && rest.starts_with('"') => {
                result.push('"');
                rest = &rest[1..];
            }
            (QuoteContext::SingleQuoted, '\'') | (QuoteContext::DoubleQuoted, '"') => {
                context = QuoteContext::Bare
            }
            _ => {}
        }
    }

    result
}

/// What stands for the text in `context`. The braces keep a character right
/// after the placeholder out of the variable name.
fn reference(context: QuoteContext, text: &str, windows: bool) -> String {
    match (context, windows) {
        (QuoteContext::Bare, false) => format!("\"${{{TEXT_ENV}}}\""),
        // close the quotes, add the variable quoted on its own, reopen them
        (QuoteContext::SingleQuoted, false) => format!("'\"${{{TEXT_ENV}}}\"'"),
        (QuoteContext::DoubleQuoted, false) => format!("${{{TEXT_ENV}}}"),
        (QuoteContext::Bare | QuoteContext::DoubleQuoted, true) => format!("${{env:{TEXT_ENV}}}"),
        // a single-quoted string cannot hold a variable, and expands nothing
        (QuoteContext::SingleQuoted, true) => escape_powershell_single(text),
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

    /// Runs `template` with `text` in place of the placeholders.
    fn run(template: &str, text: &str) -> String {
        let script = substitute(template, PLACEHOLDER, text);
        let output = command_with_text(template, PLACEHOLDER, text)
            .output()
            .unwrap();
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
    fn integration_substitutes_a_bare_placeholder() {
        assert_eq!(run(&print(PLACEHOLDER), NASTY), NASTY);
    }

    #[test]
    fn integration_substitutes_a_placeholder_in_double_quotes() {
        assert_eq!(run(&print("\"<{{TEXT}}>\""), NASTY), format!("<{NASTY}>"));
    }

    #[test]
    fn integration_substitutes_a_placeholder_in_single_quotes() {
        assert_eq!(run(&print("'<{{TEXT}}>'"), NASTY), format!("<{NASTY}>"));
    }

    #[test]
    fn integration_substitutes_every_placeholder_once() {
        assert_eq!(
            run(&print("{{TEXT}}-{{TEXT}}"), PLACEHOLDER),
            "{{TEXT}}-{{TEXT}}"
        );
    }

    /// The parser follows quotes only: in a here document or a comment the
    /// placeholder stands outside of them, where an inlined text would run.
    #[cfg(not(target_os = "windows"))]
    #[test]
    fn integration_a_placeholder_in_a_here_document_or_a_comment_runs_nothing() {
        let directory = crate::services::test_support::TestDir::new("shell");
        let marker = directory.join("marker");
        let text = format!("$(touch {0})`touch {0}`\ntouch {0} #", marker.display());

        run(&format!("cat <<EOF\n{PLACEHOLDER}\nEOF"), &text);
        run(&format!("true # {PLACEHOLDER}"), &text);

        assert!(!marker.exists(), "the text ran as a command");
    }

    #[test]
    fn keeps_a_script_without_placeholders() {
        assert_eq!(
            substitute("echo 'a' \"b\"", PLACEHOLDER, "x"),
            "echo 'a' \"b\""
        );
    }
}
