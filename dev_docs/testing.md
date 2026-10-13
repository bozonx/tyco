# Unit tests

## Commands

Use Node.js and pnpm versions declared by the repository and the Rust toolchain
pinned in `rust-toolchain.toml`.

| Command                      | Scope                                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| `pnpm test:unit`             | Tooling, frontend, plugins, and Rust unit tests                  |
| `pnpm test:unit:ui`          | All desktop UI unit and component tests                          |
| `pnpm test:unit:models`      | The DOM-independent desktop UI project                           |
| `pnpm test:unit:rust`        | Workspace library/binary tests, excluding `integration_` tests   |
| `pnpm test:integration:rust` | Local socket/process tests and all integration test targets      |
| `pnpm test`                  | Tooling, frontend, and plugin tests                              |
| `pnpm test:rust`             | All Rust test targets and doc tests                              |
| `pnpm test:cov`              | Frontend and plugin coverage with package coverage floors        |
| `pnpm test:cov:rust`         | Rust unit coverage in `coverage/rust/lcov.info`                  |
| `pnpm validate:all`          | Frontend checks, tests/build, Rust formatting, Clippy, and tests |

Extra command-line arguments can be passed directly to the package runner, for
example `pnpm --filter @tyco/desktop-ui exec vitest run --project unit-dom
src/components/common/Button.test.ts`.

## Frontend environments and isolation

`apps/desktop-ui/vitest.config.ts` defines two projects with disjoint file sets:

- `unit-node` runs explicitly selected DOM-independent models and build tooling.
- `unit-dom` runs components and modules requiring browser APIs in jsdom.

Add a file to the Node patterns only after confirming that neither it nor its
imports require DOM APIs. Vue reactivity alone does not require jsdom. Both
projects use the same application transforms and aliases. File isolation remains
enabled; the desktop runner caps workers at four to bound memory use.

The DOM setup automatically unmounts Vue Test Utils wrappers, clears storage and
the body, and restores real timers. Unexpected Vue warnings fail tests. Install
Pinia in the mounted application's `global.plugins` when a component uses real
stores; setting active Pinia alone does not provide Vue's injection context.
Restore any shared mounting configuration in `afterEach`.

Both projects automatically restore spies, clear mock call history, and restore
`vi.stubGlobal`/`vi.stubEnv` changes. This does not dispose application resources:
models, scopes, subscriptions, and in-flight operations must still be disposed by
the test. Use `afterEach` or `try/finally` for cleanup that must survive assertion
failures. Avoid module-wide mutable fixtures unless every test resets their state.

Use fake timers to test deadlines. Use explicitly controlled promises to test
operation ordering; fixed sleeps are not evidence that an operation has reached a
particular state. Assert public behavior and meaningful boundary cases rather
than reproducing the implementation.

All plugin/SDK test files and Vitest configurations are type-checked through
`tsconfig.test.json`; test sources stay out of published build output. Desktop
tests are checked by `tsconfig.tooling.json`.

## Rust isolation

Keep unit tests in `#[cfg(test)]` modules. Inject platform/session inputs into pure
logic and test each relevant session explicitly instead of deriving expectations
from the host environment.

Use `services::test_support::TestDir` for temporary filesystem fixtures. It creates
unique directories atomically and removes them on drop, including assertion
panics. For tests of directory creation, keep a guard for an existing parent and
use a missing child path. Keep handles and stores scoped so they close before the
directory guard drops, especially on Windows.

Tests that launch actual child processes or bind local sockets have an
`integration_` name prefix, even when colocated in a source module to access
private APIs. The default full suite still runs them; the fast unit command skips
them. Pure tests of protocol encoding, validation, queues, and process control
state remain in the unit suite. Local transport tests use ephemeral ports.

The real system keychain test remains ignored and is only run explicitly with
`cargo test --manifest-path src-tauri/Cargo.toml keychain -- --ignored`. It requires
a working, unlocked session keychain; unit tests use the in-memory vault instead.

## Coverage

CI runs frontend tests with V8 coverage and uploads HTML, LCOV, and JSON summaries
for the desktop UI and every tested plugin package. Plugin package floors are
80% lines/statements/functions and 75% branches, below their measured starting
coverage. Desktop history, LLM, and command models require 85% lines/statements, 90%
functions, and 80% branches; the entire UI is
reported without a blanket 100% requirement. Raise floors intentionally as useful
behavioral tests are added, rather than excluding uncovered production code.

Rust coverage uses `cargo-llvm-cov` 0.9.1 and the pinned Rust toolchain's LLVM tools.
To run it locally, install the tools once:

```sh
cargo install cargo-llvm-cov --version 0.9.1 --locked
rustup component add llvm-tools-preview
pnpm test:cov:rust
```

With a distribution-managed Rust toolchain, matching LLVM binaries can instead be
provided through `LLVM_COV` and `LLVM_PROFDATA`.

CI runs the full Rust suite and uploads a separate Rust unit LCOV report. Rust coverage is initially informational: platform adapters cannot be
fully exercised by a Linux unit runner. Reports exclude tagged integration tests,
while all platforms continue to run the full Rust test suite across CI jobs.
