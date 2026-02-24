# Guardrails and Permissions

**Guardrails** define what agents are allowed to do and how they should behave. **Permissions** control which tools and data they can access.

## 1. Guardrail Types

- **Policy instructions**
  - High-level rules in system prompts and agent configs (e.g., no secrets, respect architecture rules).
- **Tool-level restrictions**
  - Some tools are read-only; others are mutating and require extra care.
- **Human-in-the-loop checks**
  - Certain actions (large refactors, deletes, deployments) may require explicit user approval.

## 2. Permissions Model in ai-team

- Each agent has:
  - A list of allowed tools.
  - `contextPaths` defining where it can read and write.
- The tool gateway enforces these rules at call time:
  - Rejects disallowed tools.
  - Validates paths and arguments.
  - Applies timeouts and rate limits.

## 3. Safety Principles

- Treat all model outputs, including tool arguments, as **untrusted input**.
- Keep destructive operations behind explicit tools with narrow scopes.
- Prefer read-only exploration before making changes.

Guardrails are implemented partly in prompts (for behavior) and mostly in code (for permissions and validation). Both are needed.

## Further Reading

- Microsoft – Safety for AI systems: https://learn.microsoft.com/azure/ai-services/openai/concepts/safety
- Anthropic – Responsible use of Claude: https://docs.anthropic.com/en/docs/safety
- OWASP – Top 10 for Large Language Model Applications: https://owasp.org/www-project-top-10-for-large-language-model-applications/
