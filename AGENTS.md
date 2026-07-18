所有安装依赖使用 pnpm。

日常开发、检查和验证不要运行 build 命令。

仅在用户明确要求生成 Release 或部署产物时，允许运行对应的 pnpm build:*SkipTag 命令；不要使用会自动创建 Git Tag 的构建命令。

仅在所有代码编写完成的最后运行类型检查，只使用 npx tsc --noEmit。不要使用 eslint。
