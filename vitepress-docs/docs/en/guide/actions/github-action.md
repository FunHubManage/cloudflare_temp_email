# Deploy via GitHub Actions

::: warning Notice
Currently only supports Worker and Pages deployment.
If you encounter any issues, please report them via `GitHub Issues`. Thank you.

The `worker.dev` domain is inaccessible in China, please use a custom domain
:::

## Deployment Steps

### Fork Repository and Enable Actions

- Fork this repository on GitHub
- Open the `Actions` page of the repository
- Find `Deploy Backend` and click `enable workflow` to enable the `workflow`
- If you need separate frontend and backend deployment that talks to Worker directly, find `Deploy Frontend` and click `enable workflow` to enable the `workflow`
- If you need Pages deployment with Page Functions forwarding backend requests, find `Deploy Frontend with page function` and click `enable workflow` to enable the `workflow`

### Configure Site Environments

`Deploy Backend` and `Deploy Frontend` share the same branch. Choose the deployment target with the `site` input when starting a manual run.

1. Open repository `Settings` -> `Environments` and create `funhub` and `subsubman`.
2. Add each site's `BACKEND_TOML`, `FRONTEND_ENV`, and `FRONTEND_NAME` (its existing Pages project name) under its `Environment secrets`. Set `FRONTEND_BRANCH` to that project's production branch, defaulting to `main` when omitted. FunHub uses project `funhubmail` and production branch `main`.
3. Deployment jobs in both workflows read secrets from the selected environment. Shared Cloudflare credentials can remain under `Settings` -> `Secrets and variables` -> `Actions` -> `Repository secrets`; add same-named secrets to an environment to override credentials for that site.

| Setting | `funhub` | `subsubman` |
| --- | --- | --- |
| Backend Worker name | `funhubmailapi` | `subsubmanmailapi` |
| Database name bound as `DB` | `funhubmail` | `subsubmanmail` |
| `VITE_API_BASE` in `FRONTEND_ENV` | `https://apimail.funhub.tw` | `https://apimail.subsubman.com` |
| Frontend target | Pages project `funhubmail`, production branch `main` | Existing Pages project, selected with `FRONTEND_NAME` and `FRONTEND_BRANCH` |

Keep each site's existing D1/KV IDs in `BACKEND_TOML` and set `keep_vars = true` to preserve dashboard variables. Before deploying, the workflows check the backend Worker name, `DB` database name, and frontend API URL, and stop if they do not match the selected site. GitHub may fall back to a same-named repository secret when an environment secret is missing, so configure site settings in both environments and remove old repository-level site settings after verifying deployment.

Both frontends are hosted on Pages and deploy to the selected environment's project and production branch. Each site builds its own frontend and connects directly to its own backend; neither needs `USE_WORKER_ASSETS` or `PAGE_TOML`.

### Secret Reference

Store site settings in the corresponding `Environment secrets`. Shared credentials can continue to use `Repository secrets`:

- Common `secrets`

   | Name                    | Description                                                                                                            |
   | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID, [Reference Documentation](https://developers.cloudflare.com/workers/wrangler/ci-cd/#cloudflare-account-id) |
   | `CLOUDFLARE_API_TOKEN`  | Cloudflare API Token, [Reference Documentation](https://developers.cloudflare.com/workers/wrangler/ci-cd/#api-token)           |

- Worker backend `secrets`

   | Name                           | Description                                                                                                                                    |
   | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
   | `BACKEND_TOML`                 | Backend configuration file, [see here](/en/guide/cli/worker.html#modify-wrangler-toml-configuration-file)                                      |
   | `DEBUG_MODE`                   | (Optional) Whether to enable debug mode, set to `true` to enable. By default, worker deployment logs are not output to GitHub Actions page, enabling this will output them |
   | `BACKEND_USE_MAIL_WASM_PARSER` | (Optional) Whether to use WASM to parse emails, set to `true` to enable. For features, refer to [Configure Worker to use WASM Email Parser](/en/guide/feature/mail_parser_wasm_worker) |
   | `USE_WORKER_ASSETS`            | (Optional) Deploy Worker with frontend assets, set to `true` to enable                                                                         |

- Separate frontend `secrets`

   > [!warning] Notice
   > If you choose to deploy Worker with frontend assets, these `secrets` are not required

   | Name               | Description                                                                                                                                                                      |
   | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `FRONTEND_ENV`     | Frontend configuration file used by the `Deploy Frontend` workflow. Copy the content from `frontend/.env.example` and modify it according to [Frontend Variables](/en/guide/frontend-vars) |
   | `FRONTEND_NAME`    | The selected site's existing Pages project name; use `funhubmail` for FunHub and SubSubMan's own Pages project name for SubSubMan |
   | `FRONTEND_BRANCH`  | (Optional) The selected Pages project's production branch, defaults to `main`; optional Telegram Pages deployment still defaults to `production` when omitted |
   | `PAGE_TOML`        | (Optional, still a Repository secret) Used only by the `Deploy Frontend with page function` workflow. Required when using page functions to forward backend requests. Please copy the content of `pages/wrangler.toml` and set `service` to your backend Worker name. This workflow builds in Pages mode, uses same-origin requests, and does not read `FRONTEND_ENV` |
   | `TG_FRONTEND_NAME` | (Optional) The project name you created in Cloudflare Pages, same as `FRONTEND_NAME`. Fill this in if you need Telegram Mini App functionality                                  |

### Deploy

- Open the `Actions` page of the repository
- Find `Deploy Backend`, click `Run workflow`, and select a branch (usually `main`) and `site` (`funhub` or `subsubman`) to deploy that backend manually
- Find `Deploy Frontend`, click `Run workflow`, and select the same branch and `site` to publish its Pages frontend
- If you need Pages deployment with Page Functions forwarding backend requests, find `Deploy Frontend with page function` and click `Run workflow` to deploy manually

`Deploy Backend` and `Deploy Frontend` run only when started manually. Code pushes, tag pushes, and upstream sync completion do not trigger these two workflows.

Deployments of the same component and site are queued; a new run does not interrupt an active deployment. Deploying an existing backend does not automatically create, initialize, or migrate its database. Back up before the first switch and handle schema migrations separately.

### Upstream Sync with Page Functions Forwarding

If Pages needs to forward backend requests through Page Functions, use the `Deploy Frontend with page function` workflow.

- Enable `Upstream Sync`, `Deploy Backend`, and `Deploy Frontend with page function`
- Configure the `PAGE_TOML` repository secret by copying the content of `pages/wrangler.toml`
- Change the `service` field in `PAGE_TOML` to your Worker backend name
- This workflow runs `pnpm build:pages`, uses same-origin frontend requests, and does not read `FRONTEND_ENV`
- Start `Upstream Sync` manually. After each completed sync, `Deploy Frontend with page function` still deploys the frontend automatically when `PAGE_TOML` is configured; tag pushes also trigger this workflow
- To deploy the backend after syncing, run `Deploy Backend` manually

If the frontend must also be published only manually, do not enable `Deploy Frontend with page function`; use `Deploy Frontend` for a separate frontend that connects directly to Worker.

## Sync Upstream Code Manually

`Upstream Sync` has no schedule. Start it with `Run workflow` on the `Actions` page. Review the changes after syncing, then run each deployment workflow manually. See [Sync Upstream Code](/en/guide/actions/auto-update).
