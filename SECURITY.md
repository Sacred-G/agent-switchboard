# Security Policy

The Agent Switchboard maintainers appreciate responsible reports of security vulnerabilities.

## Supported Versions

Security fixes are generally considered for the latest released version and the current default development branch.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Default branch | Yes |
| Older releases | Best effort |

## Reporting a Vulnerability

Please do not open a public issue for security vulnerabilities.

Use GitHub's private vulnerability reporting for this repository when available:

https://github.com/farion1231/agent-switchboard/security/advisories/new

If private reporting is not available, contact the maintainers through a private channel listed in the repository profile or project metadata.

## What to Include

Please include as much detail as possible:

- A clear description of the vulnerability.
- Affected versions, platforms, and configurations.
- Reproduction steps or proof-of-concept details.
- Potential impact.
- Any known workarounds or mitigations.

Do not include real API keys, tokens, or private user data in your report. If sample secrets are needed for reproduction, use clearly fake values.

## Response Expectations

Maintainers will make a best-effort attempt to:

1. Acknowledge the report.
2. Validate the issue and assess impact.
3. Develop and test a fix when appropriate.
4. Coordinate disclosure timing with the reporter.

Response times may vary depending on maintainer availability.

## Scope

Relevant security concerns may include, but are not limited to:

- Unsafe handling of provider credentials, tokens, or environment variables.
- Privilege escalation or arbitrary code execution in the desktop app.
- Insecure update, packaging, or deep-link behavior.
- Exposure of sensitive local configuration.

General bugs, crashes, and non-security feature requests should be reported through the normal support channels described in [SUPPORT.md](SUPPORT.md).
