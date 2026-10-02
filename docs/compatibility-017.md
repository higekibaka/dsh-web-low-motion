# DSH 0.1.7-rc.1 兼容说明

插件 0.5.3 保留旧版动效处理。CI 的旧宿主目标固定为：

| DSH | 提交 |
| --- | --- |
| 0.1.6-alpha.2 | `ddefc45fbc7f8e46dd73185e68295696d1297887` |
| 0.1.7-rc.1 | `46a7f68b0922371ce7144b668b90e377d8e799f4` |

相对公开版本 0.4.5，已删除补充轮次折叠的 Definition、renderer、DOM 处理、偏好监听、设置、文案和样式，并移除 conversation/chat 注入依赖。插件在所有宿主版本中都不再提供折叠；旧浏览器折叠偏好保持原样，但不再读取或写入。需要折叠时使用支持原生工作详情显示选项的 DSH。

动效模式、帧率、文字流光渲染选项继续独立工作。回归覆盖偏好、动效与卸载、帧率、WebGL 回退、中英文设置、窄窗口及旧折叠偏好不再激活覆盖层。旧宿主没有新版组件，0.2 专属测试会跳过；这些跳过不代表 0.2 兼容通过，新版由独立 CI 目标执行。

```sh
# DSH 检出只需已安装依赖，不需运行宿主
DSH_CHECKOUT=/path/to/dsh-with-dependencies pnpm test
pnpm check:build
```

测试使用独立 Chromium，不访问日常浏览器数据，也不提交模型请求。设置中的宿主服务使用替身，不是全栈集成验收；通过不代表已经重新测量实际用户视频掉帧或整个浏览器的 GPU 性能。当前 CI 结果见 [工作流](https://github.com/higekibaka/dsh-web-low-motion/actions/workflows/ci.yml)。
