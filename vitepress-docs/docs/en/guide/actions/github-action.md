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

### Configure Secrets

Then go to the repository page `Settings` -> `Secrets and variables` -> `Actions` -> `Repository secrets`, and add the following `secrets`:

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

- Pages frontend `secrets`

   > [!warning] Notice
   > If you choose to deploy Worker with frontend assets, these `secrets` are not required

   | Name               | Description                                                                                                                                                                      |
   | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `FRONTEND_ENV`     | Frontend configuration file used by the `Deploy Frontend` workflow. Copy the content from `frontend/.env.example` and modify it according to [Frontend Variables](/en/guide/frontend-vars) |
   | `FRONTEND_NAME`    | The project name you created in Cloudflare Pages, can be created via [UI](https://temp-mail-docs.awsl.uk/en/guide/ui/pages.html) or [Command Line](https://temp-mail-docs.awsl.uk/en/guide/cli/pages.html) |
   | `FRONTEND_BRANCH`  | (Optional) Branch for pages deployment, can be left unconfigured, defaults to `production`                                                                                      |
   | `PAGE_TOML`        | (Optional) Used only by the `Deploy Frontend with page function` workflow. Required when using page functions to forward backend requests. Please copy the content from `pages/wrangler.toml` and modify the `service` field to your worker backend name according to actual situation. This workflow builds the frontend in Pages mode and uses same-origin requests, so it does not read `FRONTEND_ENV` |
   | `TG_FRONTEND_NAME` | (Optional) The project name you created in Cloudflare Pages, same as `FRONTEND_NAME`. Fill this in if you need Telegram Mini App functionality                                  |

### Deploy

- Open the `Actions` page of the repository
- Find `Deploy Backend` and click `Run workflow` to select a branch and deploy manually
- If you need separate frontend and backend deployment that talks to Worker directly, find `Deploy Frontend` and click `Run workflow` to select a branch and deploy manually
- If you need Pages deployment with Page Functions forwarding backend requests, find `Deploy Frontend with page function` and click `Run workflow` to deploy manually

`Deploy Backend` and `Deploy Frontend` run only when started manually. Code pushes, tag pushes, and upstream sync completion do not trigger these two workflows.

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
