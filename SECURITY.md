# Security Policy

## Scope

CrowdPulse is a prototype for crowd monitoring and incident response. Security reports are welcome for the application, API, deployment configuration, and AI service.

Please do not treat this project as a production-grade emergency-response system. Simulated readings and model predictions are not validated real-world safety performance.

## Reporting a vulnerability

Please **do not** report exploitable vulnerabilities in a public issue or pull request.

- If GitHub's **Private vulnerability reporting** feature is enabled for this repository, use it to submit the report privately.
- Otherwise, contact the repository owner through their GitHub profile: https://github.com/Warrior1012

Include, where possible:

- A concise description of the issue and its potential impact.
- Affected routes, files, versions, or deployment configuration.
- Reproduction steps or a minimal proof of concept.
- Any suggested mitigation.

Please avoid including real credentials, personal information, attendee data, or production database contents in a report. Redact sensitive values from logs and screenshots.

## Coordinated disclosure

Give the maintainer a reasonable opportunity to investigate and prepare a fix before publicly disclosing a vulnerability. Please do not access, modify, or delete data that is not yours, disrupt deployed services, or conduct testing against systems without authorization.

## Secrets and data

Never commit API keys, passwords, JWT secrets, real environment files, production database URLs, attendee information, or private media. If a secret is exposed, revoke or rotate it promptly; deleting it from the latest commit alone may not be sufficient.
