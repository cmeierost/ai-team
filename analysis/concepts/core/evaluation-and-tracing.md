# Evaluation and Tracing

**Evaluation** checks how well agents and workflows perform. **Tracing** records what happened during a run so you can debug and improve the system.

## 1. Tracing

For each agent run or workflow, ai-team should log:

- Task metadata (who, what, when).
- LLM calls:
  - Model used and parameters.
  - Token counts (prompt vs completion, by section).
  - Which files/chunks were included.
- Tool calls:
  - Tool name, arguments, result type (success/error).
- Ownership and routing decisions.

Traces are stored as JSONL under `.ai-team/logs/` and can be inspected manually or by analysis tools.

## 2. Evaluation Dimensions

- **Relevance and utility** – did the agent actually solve the user’s problem?
- **Groundedness** – are answers consistent with the retrieved context and docs?
- **Cost and latency** – tokens used, runtime per task.
- **Robustness** – behavior under ambiguous instructions or noisy context.

## 3. Usage in ai-team

- Traces power debugging when an agent behaves unexpectedly.
- They provide data for future automated tests and regression checks.
- They help tune context narrowing, tool design, and agent configs.

Evaluation and tracing are essential to iterating on ai-team’s behavior safely and systematically.

## Further Reading

- RAGAS – Evaluation for retrieval-augmented generation: https://github.com/explodinggradients/ragas
- TruLens – Tracing and evaluation for LLM apps: https://www.trulens.org
- Promptfoo – Testing and red-teaming LLM prompts and agents: https://www.promptfoo.dev
