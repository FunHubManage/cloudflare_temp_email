# 通过 GitHub Actions 手动同步上游代码

::: warning 注意
有问题请通过 `Github Issues` 反馈，感谢。
上游同步不会执行 D1 数据库的 SQL 文件。当数据库 schema 变动时，需要手动执行对应迁移。
:::

`Upstream Sync` 仅支持手动运行，不会定时同步。

1. 打开仓库的 `Actions` 页面，找到 `Upstream Sync`，如有需要先点击 `enable workflow`。
2. 点击 `Run workflow`，选择 `main` 分支并运行，将上游代码同步到 fork 的 `main` 分支。
3. 检查同步后的代码变更，再分别手动运行 `Deploy Backend` 和 `Deploy Frontend` 发布。

如果同步失败，可到仓库主页点击 `Sync fork` 检查同步状态；有冲突时需先解决冲突。

`Deploy Frontend with page function` 保留自动触发：如果已启用且配置了 `PAGE_TOML`，`Upstream Sync` 完成或推送 tag 后仍会部署前端。希望始终手动发布时，请勿启用该 workflow。
