# Third-party notices

## dsh-trace-compare (v0.5.1)

来源：https://github.com/lamost423/dsh-trace-compare

本包固定并内嵌 `maze-upload.html`、`verdict.js`、`verdict.d.ts`。上游仓库当前固定提交：`9512521`。文件保留其 MIT License 和 NOTICE；Maze UI、判定逻辑、空闲折叠、缩放、过滤、详情和导出均按上游实现使用。

本地仅对时间线节点和支路标签加入 22 字符截断（完整文本仍在详情面板展示），并恢复 hover 卡片在时间线画布内的边界定位。

## Codex Dream Skin Studio CDP 片段

`src/cdp.mjs` 仅移植 loopback URL 校验、Codex renderer target 过滤、重连/清理所需的最小思路，参考本机 Skin Studio `scripts/injector.mjs` 和 `assets/renderer-inject.js`。Skin Studio 仍是独立项目，本包不读取其主题、视频或运行状态，也不修改其文件。

本项目新增代码以 MIT 许可发布；上游完整许可文本见 `vendor/dsh-trace-compare/LICENSE`。
