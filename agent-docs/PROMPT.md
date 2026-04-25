Run mode: Live Claude (interactive terminal run)

Run context:
- This is a restart attempt after a prior autonomous run.
- The repo may contain partial implementation changes, prior artifacts, and blocked status from earlier attempts.
- First task is reconciliation: inspect git status/diff and existing FR artifacts, then decide keep/fix/revert scope for the current FR.
- Treat existing work as candidate input, not ground truth.

Kickoff instruction:
- Read `AGENTS.md` and execute it.

Immediate startup steps:
1) Summarize queue status from `agent-docs/fr-backlog.yaml` and work on the next incomplete FR
2) Declare which FR you are executing and only work on that FR.
3) When work is complete on the FR or the build fails, stop, summarize the status, suggest next steps and wait for feedback.
4) Begin work on the first unfinished FR now.
