# Roadmap: Project-Type Specific Prompt Packages

## Context

Torch currently provides a comprehensive set of agents for repository maintenance, but many of them are implicitly tailored to the Torch repository itself (e.g., specific folder structures like `/workspace/TORCH`, specific tools). As Torch aims to be a generalized tool for *any* project, it needs a way to provide relevant agents without forcing every project to use the same structure or stack.

## Proposal

Implement **Project-Type Specific Prompt Packages**. During initialization (`torch init`), users should be able to select the type of project they are building, and Torch will install a curated set of agent prompts relevant to that project type.

### Goals

1.  **Relevance:** Only install agents that make sense for the project (e.g., don't install a React component auditor for a Python backend).
2.  **Reduced Noise:** Avoid cluttering the `src/prompts/` directory with irrelevant files.
3.  **Faster Onboarding:** Provide immediate value by giving users agents that "understand" their stack out of the box.

### Proposed Packages

We can categorize projects into "Archetypes" or "Packages":

#### 1. The "Base" Package (Core)
*   **Description:** Agents every project needs.
*   **Included Agents:**
    *   `log-fixer-agent`: Monitor task logs for failures.
    *   `prompt-maintenance-agent`: Ensure prompts are valid.
    *   `todo-triage-agent`: Manage TODOs.
    *   `changelog-agent`: Generate changelogs based on commits.

#### 2. The "Node.js Backend" Package
*   **Description:** For server-side JavaScript/TypeScript applications.
*   **Included Agents:**
    *   `deps-security-agent`: Check `npm audit`.
    *   `api-schema-validator-agent`: Validate OpenAPI/Swagger specs.
    *   `express-route-auditor-agent`: Check for common Express.js pitfalls.
    *   `db-migration-agent`: Check for pending database migrations (e.g., Knex, Prisma).

#### 3. The "React Frontend" Package
*   **Description:** For client-side React applications.
*   **Included Agents:**
    *   `component-audit-agent`: Check for large components, prop drilling.
    *   `accessibility-agent`: Check for ARIA attributes, image alts.
    *   `unused-component-agent`: Find components not imported anywhere.
    *   `bundle-size-agent`: Monitor build artifacts size.

#### 4. The "Library / Tool" Package
*   **Description:** For NPM packages or CLI tools intended for distribution.
*   **Included Agents:**
    *   `semantic-version-agent`: Ensure versioning follows SemVer.
    *   `api-docs-agent`: Generate documentation from JSDoc/TSDoc.
    *   `compatibility-agent`: Check `engines` field in `package.json`.

#### 5. The "Python / Django" Package (Future)
*   **Description:** Expanding beyond Node.js.
*   **Included Agents:**
    *   `pip-audit-agent`: Check Python dependencies.
    *   `django-migration-agent`: Check Django migrations.
    *   `flake8-agent`: Python linting.

### Implementation Strategy

1.  **Directory Structure:** Organise `src/prompts/` into subdirectories for packages, or use a central registry.
    ```
    src/prompts/
      ├── core/
      ├── node-backend/
      ├── react-frontend/
      └── library/
    ```
2.  **CLI Update:** Update `torch init` to ask:
    > "What type of project is this?"
    > [ ] Generic / Custom
    > [ ] Node.js Backend
    > [ ] React Frontend
    > [ ] Library / Tool
3.  **Configuration:** Store the selected package(s) in `torch-config.json`.
    ```json
    {
      "projectType": ["node-backend", "react-frontend"],
      "installedPackages": ["core", "node-backend"]
    }
    ```
4.  **Dynamic Roster:** The `roster.json` could be dynamically generated based on installed packages, or simply include all installed agents.

### Success Metrics

*   Reduction in users deleting/ignoring irrelevant agents.
*   Increase in successful agent runs (due to better alignment with project structure).
*   Positive user feedback on "magic" setup experience.
