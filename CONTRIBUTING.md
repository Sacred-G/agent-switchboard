# Contributing to Agent Switchboard

Thank you for your interest in contributing to Agent Switchboard. This guide explains how to prepare changes, run checks, and submit contributions.

## Ways to Contribute

- Report reproducible bugs.
- Suggest improvements to the app, documentation, or packaging.
- Fix issues in the React/TypeScript frontend or Tauri/Rust backend.
- Improve tests, accessibility, localization, or user documentation.

## Before You Start

1. Search existing issues and pull requests to avoid duplicate work.
2. For larger changes, open an issue first so maintainers and contributors can agree on the approach.
3. Review the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development Setup

Install the required tooling:

- Node.js matching `.node-version`
- pnpm
- Rust toolchain matching `rust-toolchain.toml`
- Tauri system dependencies for your operating system

Install project dependencies:

```sh
pnpm install
```

Run the app locally:

```sh
pnpm dev
```

## Project Structure

- `src/` - React, TypeScript, UI, application state, and frontend logic.
- `src-tauri/` - Tauri configuration and Rust backend code.
- `tests/` - shared test setup.
- `docs/` - user-facing documentation.
- `flatpak/` - Linux Flatpak packaging assets.

## Coding Guidelines

- Follow existing code style and naming conventions.
- Keep changes focused and avoid unrelated refactors.
- Prefer clear, typed TypeScript and idiomatic Rust.
- Do not introduce new dependencies unless they are necessary and justified.
- Keep user-facing text localizable where the existing codebase expects localization.
- Avoid committing generated artifacts unless the repository already tracks them for release or packaging purposes.

## Checks

Run these before opening a pull request whenever possible:

```sh
pnpm typecheck
pnpm test:unit
pnpm format:check
```

For changes that affect the Tauri shell or packaging, also run:

```sh
pnpm build
```

## Commit and Pull Request Guidance

- Use concise, descriptive commit messages.
- Include tests or explain why tests are not applicable.
- Update documentation when behavior, setup, or user workflows change.
- In the pull request description, include:
  - What changed
  - Why it changed
  - How it was tested
  - Screenshots or recordings for UI changes when helpful

## Reporting Bugs

When filing a bug, include:

- App version or commit SHA.
- Operating system and architecture.
- Steps to reproduce.
- Expected behavior and actual behavior.
- Relevant logs, screenshots, or configuration details with secrets removed.

## Security Issues

Do not disclose security vulnerabilities in public issues. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.
