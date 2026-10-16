# Sync Upstream Code Manually with GitHub Actions

::: warning Notice
If you encounter any issues, please report them via `GitHub Issues`. Thank you.
Upstream sync does not execute SQL files for the D1 database. When the database schema changes, apply the required migrations manually.
:::

`Upstream Sync` runs only when started manually and has no schedule.

1. Open the repository's `Actions` page, find `Upstream Sync`, and click `enable workflow` if needed.
2. Click `Run workflow`, select `main`, and run it to sync upstream code into your fork's `main` branch.
3. Review the resulting code changes, then run `Deploy Backend` and `Deploy Frontend` manually to publish.

If sync fails, use `Sync fork` on the repository homepage to check its status. Resolve any conflicts before continuing.

`Deploy Frontend with page function` retains its automatic triggers: when enabled with `PAGE_TOML` configured, it still deploys the frontend after `Upstream Sync` completes or a tag is pushed. Leave this workflow disabled if publication must always be manual.
