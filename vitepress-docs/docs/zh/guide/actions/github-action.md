# 通过 Github Actions 部署

::: warning 注意
目前只支持 worker 和 pages 的部署。
有问题请通过 `Github Issues` 反馈，感谢。

`worker.dev` 域名在中国无法访问，请自定义域名
:::

## 部署步骤

### Fork 仓库并启用 Actions

- 在 GitHub fork 本仓库
- 打开仓库的 `Actions` 页面
- 找到 `Deploy Backend` 点击 `enable workflow` 启用 `workflow`
- 如果需要前后端分离并直连 Worker, 找到 `Deploy Frontend` 点击 `enable workflow` 启用 `workflow`
- 如果需要通过 Page Functions 转发后端请求的 Pages 部署, 找到 `Deploy Frontend with page function` 点击 `enable workflow` 启用 `workflow`

### 配置站点环境

`Deploy Backend` 和 `Deploy Frontend` 共用同一个分支，在手动运行时通过 `site` 选择部署站点。

1. 打开仓库 `Settings` -> `Environments`，分别创建 `funhub` 和 `subsubman`。
2. 在每个环境的 `Environment secrets` 中添加该站点的 `BACKEND_TOML`、`FRONTEND_ENV` 和 `FRONTEND_NAME`（现有 Pages 项目名称）。`FRONTEND_BRANCH` 填对应 Pages 的生产分支，不填默认 `main`；FunHub 使用项目 `funhubmail`、生产分支 `main`。
3. 两个 workflow 的部署 job 会读取所选环境的 secrets。公共 Cloudflare 凭证仍可放在 `Settings` -> `Secrets and variables` -> `Actions` -> `Repository secrets`；需要不同凭证时，在对应环境中配置同名 secret 覆盖。

| 配置 | `funhub` | `subsubman` |
| --- | --- | --- |
| 后端 Worker 名称 | `funhubmailapi` | `subsubmanmailapi` |
| `DB` 绑定的数据库名称 | `funhubmail` | `subsubmanmail` |
| `FRONTEND_ENV` 中的 `VITE_API_BASE` | `https://apimail.funhub.tw` | `https://apimail.subsubman.com` |
| 前端目标 | Pages 项目 `funhubmail`，生产分支 `main` | 现有 Pages 项目，项目名和生产分支分别由 `FRONTEND_NAME`、`FRONTEND_BRANCH` 指定 |

`BACKEND_TOML` 必须沿用对应站点现有的 D1/KV ID，并设置 `keep_vars = true` 以保留控制台变量。部署前会检查后端 Worker 名称、`DB` 数据库名称和前端 API 地址，配置与所选站点不符时停止。GitHub 在环境中缺少某个 secret 时可能回退到仓库级同名值，因此请为两个环境分别配置站点参数，确认部署正常后再清理仓库级旧配置。

两个站点的前端都托管在 Pages，分别使用所选环境的项目名称和生产分支发布。前端分别构建并直连各自的后端，不需要启用 `USE_WORKER_ASSETS` 或 `PAGE_TOML`。

### Secrets 说明

站点配置放在对应环境的 `Environment secrets` 中，共享凭证可以继续使用 `Repository secrets`：

- 公共 `secrets`

   | 名称                    | 说明                                                                                                            |
   | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID, [参考文档](https://developers.cloudflare.com/workers/wrangler/ci-cd/#cloudflare-account-id) |
   | `CLOUDFLARE_API_TOKEN`  | Cloudflare API Token, [参考文档](https://developers.cloudflare.com/workers/wrangler/ci-cd/#api-token)           |

- worker 后端 `secrets`

   | 名称                           | 说明                                                                                                                                    |
   | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
   | `BACKEND_TOML`                 | 后端配置文件，[参考此处](/zh/guide/cli/worker.html#修改-wrangler-toml-配置文件)                                                         |
   | `DEBUG_MODE`                   | (可选) 是否开启调试模式，配置为 `true` 开启, 默认 worker 部署日志不会输出到 Github Actions 页面，开启后会输出                           |
   | `BACKEND_USE_MAIL_WASM_PARSER` | (可选) 是否使用 wasm 解析邮件，配置为 `true` 开启, 功能参考 [配置 worker 使用 wasm 解析邮件](/zh/guide/feature/mail_parser_wasm_worker) |
   | `USE_WORKER_ASSETS`            | (可选) 部署带有前端资源的 Worker, 配置为 `true` 开启                                                                                    |

- 独立前端 `secrets`

   > [!warning] 注意
   > 如果选择部署带有前端资源的 Worker, 则无须配置这些 `secrets`

   | 名称               | 说明                                                                                                                                                                                      |
   | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `FRONTEND_ENV`     | `Deploy Frontend` workflow 使用的前端配置文件，请复制 `frontend/.env.example` 的内容，并参考 [前端变量说明](/zh/guide/frontend-vars) 修改 |
   | `FRONTEND_NAME`    | 所选站点现有的 Pages 项目名称；FunHub 填 `funhubmail`，SubSubMan 填自己的 Pages 项目名称 |
   | `FRONTEND_BRANCH`  | (可选) 所选站点 Pages 的生产分支，默认 `main`；可选 Telegram Pages 部署未配置时仍默认 `production` |
   | `PAGE_TOML`        | (可选，仍使用 Repository secret) 仅供 `Deploy Frontend with page function` workflow 使用。通过 page functions 转发后端请求时需要配置，请复制 `pages/wrangler.toml` 的内容，并根据实际情况修改 `service` 字段为你的 worker 后端名称。这个 workflow 会以 Pages 模式构建前端并走同域请求，因此不会读取 `FRONTEND_ENV` |
   | `TG_FRONTEND_NAME` | (可选) 你在 Cloudflare Pages 创建的项目名称，同 `FRONTEND_NAME`，如果需要 Telegram Mini App 功能，请填写                                                                                  |

### 部署

- 打开仓库的 `Actions` 页面
- 找到 `Deploy Backend`，点击 `Run workflow`，选择分支（通常为 `main`）和 `site`（`funhub` 或 `subsubman`）手动部署对应后端
- 找到 `Deploy Frontend`，点击 `Run workflow`，选择同一分支和 `site`，发布对应的 Pages 前端
- 如果需要通过 Page Functions 转发后端请求的 Pages 部署, 找到 `Deploy Frontend with page function`，点击 `Run workflow` 手动部署

`Deploy Backend` 和 `Deploy Frontend` 仅支持手动运行。推送代码、推送 tag 或完成上游同步都不会触发这两个 workflow。

同一站点的同类部署会排队，重新运行不会中断正在发布的任务。部署现有后端不会自动创建、初始化或迁移数据库；首次切换前先备份，数据库结构更新另行处理。

### 上游同步与 Page Functions 转发

如果需要 Pages 通过 Page Functions 转发后端请求，请使用 `Deploy Frontend with page function` workflow。

- 先启用 `Upstream Sync`、`Deploy Backend` 和 `Deploy Frontend with page function`
- 在仓库 `Secrets` 中配置 `PAGE_TOML`，内容复制 `pages/wrangler.toml`
- 将 `PAGE_TOML` 里的 `service` 改成你的 Worker 后端名称
- 这个 workflow 会执行 `pnpm build:pages`，前端走同域请求，不读取 `FRONTEND_ENV`
- `Upstream Sync` 需要手动运行。每次同步完成后，如果 `PAGE_TOML` 已配置，`Deploy Frontend with page function` 仍会自动部署前端；推送 tag 也会触发此 workflow
- 同步后如需部署后端，仍需手动运行 `Deploy Backend`

如果希望前端也始终手动发布，请勿启用 `Deploy Frontend with page function`；前后端分离并直连 Worker 时使用 `Deploy Frontend`。

## 手动同步上游代码

`Upstream Sync` 没有定时任务，需要在 `Actions` 页面点击 `Run workflow` 手动同步。同步后检查代码变更，再分别手动运行部署 workflow。详见 [上游代码同步](/zh/guide/actions/auto-update)。
