# 安全说明

本开发副本暂时携带共享 Ark API Key，仅适合点对点交付给受信任同事。

包含密钥的文件：

```text
beauty-studio.local.ps1
.ohmo-beauty-studio\settings.json
```

要求：

1. 不上传公共 Git 仓库、网盘公开链接或聊天群。
2. 不把打包后的校验清单和密钥文件拆开公开传播。
3. 同事部署成功后尽快换成自己的 Key。
4. 共享结束后在火山引擎控制台轮换当前 Key。
5. 对外发布源码时只保留 `beauty-studio.local.example.ps1`，删除真实配置。

