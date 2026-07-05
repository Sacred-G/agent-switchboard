# Agent Switchboard

All-in-One Assistant for Claude Code, Codex & Gemini CLI.

Agent Switchboard is a cross-platform desktop app for managing and switching between multiple AI coding assistant/provider configurations. It is built with Tauri 2, React, TypeScript, Vite, Tailwind CSS, and Rust.

## Features

- Switch between Claude Code, Codex, and Gemini CLI provider configurations.
- Preserve existing tool configuration by backing it up as a default provider on first run.
- Manage provider settings, environment variables, models, and related assistant configuration from a desktop UI.
- Cross-platform desktop packaging through Tauri.
- Local-first configuration management.

## Repository

- Application source: `src/`
- Tauri/Rust backend: `src-tauri/`
- Tests and setup: `tests/`
- Distribution assets: `public/`, `dist/`, and `flatpak/`
- User manual: `docs/user-manual/`

## Prerequisites

- Node.js matching `.node-version`
- pnpm
- Rust toolchain matching `rust-toolchain.toml`
- Tauri system dependencies for your operating system

For Tauri platform setup, see the official Tauri prerequisites documentation: https://tauri.app/start/prerequisites/

## Getting Started

Install dependencies:

```sh
pnpm install
```

Start the desktop app in development mode:

```sh
pnpm dev
```

Run the renderer only:

```sh
pnpm dev:renderer
```

## Build

Build the full Tauri desktop application:

```sh
pnpm build
```

Build only the web renderer:

```sh
pnpm build:renderer
```

## Quality Checks

Type-check the TypeScript code:

```sh
pnpm typecheck
```

Run unit tests:

```sh
pnpm test:unit
```

Check formatting:

```sh
pnpm format:check
```

Format source files:

```sh
pnpm format
```

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request.

## Support

For help, troubleshooting, and questions, see [SUPPORT.md](SUPPORT.md).

## Security

Please do not report security vulnerabilities in public issues. Follow the process in [SECURITY.md](SECURITY.md).

## Code of Conduct

Participation in this project is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
