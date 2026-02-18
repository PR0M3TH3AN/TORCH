# Contributing to TORCH

Thank you for your interest in contributing to TORCH!

## Prerequisites

- Node.js (v22+)
- npm

## Setup

1.  Clone the repository.
2.  Install dependencies:

    ```bash
    npm install
    ```

## Development Workflow

### Building

This project requires a build step for certain artifacts (e.g., distribution files, dashboard assets).

```bash
npm run build
```

### Testing

Run the test suite to ensure your changes don't break existing functionality.

```bash
npm test
```

For faster feedback loop on unit tests (excluding integration):

```bash
npm run test:unit:lock-backend
```

### Linting

Ensure your code follows the project's style guidelines.

```bash
npm run lint
```

## Pull Requests

Please follow the repository conventions for Pull Requests.

> **Note:** Detailed agent policies and conventions are normally documented in `AGENTS.md`. If this file is missing, please refer to existing patterns in the codebase or open an issue for clarification.

## Reporting Issues

If you encounter any bugs or have feature requests, please open an issue on GitHub.
