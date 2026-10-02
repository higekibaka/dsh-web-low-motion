# DSH 0.2.0-rc.1 / rc.2 兼容说明

插件 0.5.3 适配新版 `RunningStatus`、`RunningWhaleTail` 和 `TextShimmer`，沿用已保存的模式、帧率和渲染偏好，不改变宿主源码。CI 固定源码目标：

| DSH | 提交 | 鲸尾 |
| --- | --- | --- |
| 0.2.0-rc.1 | `4878cdabd87d4041bdaff61d04c966883b9fd07a` | SVG / SMIL |
| 0.2.0-rc.2 | `639ed015397290b3745d163aafe02ffee4aa3f84` | APNG 蒙版 + 静态 SVG |

低动态模式保留可选中文字，隐藏 inert 装饰副本，显示宿主静态鲸尾。rc.1 暂停 SVG 时间线；rc.2 隐藏 APNG 蒙版、显示同级静态 SVG，恢复时还原宿主显示规则，插件不控制 APNG 播放位置。

优化模式保留原生双向 transform 高亮，按目标帧率采样原生缓动（包括 rc.2 的 steps）；鲸尾保持原生节奏。两类动效均遵循离屏、页面隐藏及系统减少动态效果偏好。卸载恢复插件接管的行内样式与暂停状态，不恢复由其他代码预先暂停的 SVG。移除可见或离屏聊天节点时释放观察及旧 DOM 引用。

新版高亮始终使用原生合成层。WebGL 选项仅用于旧版文字流光。帧率上限只控制扫光与文字高亮，不控制鲸尾、滚动或视频。

通过 `animationstart` 和 SVG `beginEvent` 发现后来出现的状态，不观察流式正文。仅匹配原生语义标记及已知动画名称后缀，兼容宿主 CSS Modules 添加的作用域前缀。

## 验证与边界

Chromium 回归直接编译目标组件，使用宿主同款 lightningcss 配置生成样式，覆盖静态模式、帧率、离屏恢复、页面可见性、系统偏好、后插入状态、原有暂停所有权和移除节点清理。设置回归使用宿主 React 依赖，其他宿主服务使用替身；不是全栈 Loader/槽位、整机 GPU 性能或模型长时输出验收。

```sh
# 先在对应宿主检出中安装依赖，无需构建或启动 DSH
DSH_CHECKOUT=/path/to/dsh-0.2.0-rc.2 DSH_MODERN_VARIANT=apng pnpm test
DSH_CHECKOUT=/path/to/dsh-0.2.0-rc.1 DSH_MODERN_VARIANT=smil pnpm test
pnpm check:build
```

CI 强制检查对应组件存在且鲸尾实现匹配，缺少目标时失败，不能静默跳过整组测试。每个现代目标仅跳过另一个鲸尾实现的专属测试。旧宿主回归可通过 `DSH_MODERN_CHECKOUT` 另外指定新版源码，`DSH_CHECKOUT` 仍提供依赖；不设置强制目标且没有新版组件时，专属测试标记跳过，不能计为兼容通过。当前 CI 结果见 [工作流](https://github.com/higekibaka/dsh-web-low-motion/actions/workflows/ci.yml)。
