# DSH 性能与动效插件

[![CI](https://github.com/higekibaka/dsh-web-low-motion/actions/workflows/ci.yml/badge.svg)](https://github.com/higekibaka/dsh-web-low-motion/actions/workflows/ci.yml)

**dsh-web-low-motion 0.4.5** 为 DeepSeek Harness Web 提供三档动效、装饰动效帧率控制、可选 WebGL 文字流光，以及已结束轮次的自动折叠。使用 DSH 的设置、React 和槽位接口，不修改宿主源码或构建产物。

[GitHub Release](https://github.com/higekibaka/dsh-web-low-motion/releases/tag/v0.4.5) · [npm](https://www.npmjs.com/package/dsh-web-low-motion) · [变更记录](CHANGELOG.md)

## 安装

```sh
dsh plugin --profile web add dsh-web-low-motion@0.4.5
```

也可下载 Release 中的 `.tgz` 安装包：

```sh
dsh plugin --profile web add /path/to/dsh-web-low-motion-0.4.5.tgz --offline --ignore-scripts
```

安装到目标 profile 后，重启 DSH 并刷新页面。打开 **设置 → 性能优化**；浏览器内的选项即时生效，不需要再次重启。

## 功能与默认值

| 选项 | 默认 | 行为 |
| --- | --- | --- |
| 动效模式 | 保留动效优化 | 保留扫光、状态点和横向文字流光，减少已识别装饰效果的重复绘制，离屏或页面隐藏时暂停。 |
| 动效帧率 | 跟随屏幕 | 可选 24、30、60、120 FPS 或跟随屏幕；仅控制优化模式下的扫光与文字流光。 |
| 文字流光渲染 | 合成层 | WebGL GPU 为可选试验模式，不默认启用。 |
| 自动折叠已结束轮次 | 开启 | 在原生折叠之外补全已结束轮次的过程折叠，保留正文、用户消息、错误与未知节点。 |

### 三档动效

- **原生**：由 DSH 保持原有动画，不应用动效覆盖。
- **保留动效优化**：将已识别的扫光改为 transform，保留渐变、方向、周期、缓动和像素状态点；文字流光缓存字形遮罩后移动渐变层。遵循系统减少动态效果偏好。
- **低动态效果**：停止装饰性循环动画，保留文字与静态状态点。

帧率控制保留动画周期和速度，不限制页面滚动、视频或模型输出。未知样式、复杂标记和不支持的动画保留原生渲染。默认合成层没有逐帧 JavaScript 循环，也不逐 token 扫描正文。

### WebGL 试验模式

WebGL 绘制文字流光的移动渐变，保留原字形遮罩、文字和计时器；扫光仍走合成层。使用一个共享 rAF 调度器，按目标帧率采样，隐藏、离屏或系统减少动效时暂停。同页最多使用四个流光 GPU 上下文；不支持的效果、上下文丢失或超出限额时回退合成层。

**现有测量没有证明 WebGL 稳定快于合成层**，因此默认仍为合成层。它不改变模型速度，也不保证改善视频掉帧或整个浏览器的 GPU 占用。历史合成测量及边界见 [性能记录](docs/performance.md)。

### 自动折叠

折叠开关独立于动效模式。关闭后恢复 DSH 原生 compact/standard 行为，不改宿主设置。

- 只处理已加载且轮次边界明确的结束轮次；分页截断的首轮不自动补载。
- 运行中、待结算工具、等待用户交互的节点保持可见；没有最终回答时不会拿中间消息当结论。
- 用户消息、错误、最终正文和未知节点保留；没有过程的纯正文不增加空折叠按钮。
- 已有原生折叠继续由宿主处理；遇到其他折叠插件时让位。
- 手动展开按 session + turn 保留，刷新后重置；搜索隐藏内容使用宿主可搜索隐藏契约。
- 0.4.5 按每个渲染列判断控制按钮是否就绪。关闭侧栏不会解除主视图折叠；缺少自己的按钮时，该列保持内容可见。

折叠只影响显示，不删除历史，不改变上下文或模型输入，也不等于减少整个会话的内存占用。

## 偏好与关闭

选项存于当前浏览器，同地址标签页同步；不同浏览器、设备或端口相互独立。存储失败时当前页面仍可切换并提示无法持久化，损坏数据有明确回退提示。升级保留旧的原生／低动态偏好，不强制改为默认优化模式。

关闭全部显示效果：选择 **原生**，并关闭 **自动折叠已结束轮次**。若需在 profile 层禁用整个插件，可在目标 profile 的 `cordis.patch.yml` 现有数组中追加：

```yaml
- id: web-low-motion
  config:
    enabled: false
```

禁用不改写浏览器保存的偏好。卸载使用目标 profile：

```sh
dsh plugin --profile web remove dsh-web-low-motion
```

## 兼容性与验证

- 当前验证目标：**DSH 0.1.6-alpha.2**，Node.js **22.19.0 以上**。
- 140 项现有回归通过，覆盖设置、偏好、动效与帧率、WebGL 回退、折叠、搜索、窄窗口、并列视图和卸载。
- 测试使用真实 Chromium，其中宿主集成采用 DSH 原生组件与合成会话；不等于真实用户视频掉帧或模型长时输出的性能验收。
- 原生 CSS、DOM 或槽位契约升级后需重新验证；无法识别的情况保留内容和原生效果。
- 只识别已知原生动效，不承诺控制主题插件自己的 Canvas、Worker 或背景动画。默认主题与终末地玻璃可同时使用，各自的动效预算相互独立。

## 开发

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
export DSH_CHECKOUT=/path/to/built/deepseek-harness
pnpm test
pnpm check:build
npm pack --ignore-scripts
```

宿主测试只读使用已有 DSH 检出的源码、构建和依赖，不会启动或自动重建日常 DSH。CI 使用固定提交的独立检出；浏览器测试启动自己的临时 Chromium，不访问日常页面或会话。

发布包只包含 Host 配置入口、构建的客户端、插件补丁、README 和许可证。安装后无需重新构建。开发源码、测试和工作流位于本仓库；本地部署笔记与认证材料不属于发布内容。

## 许可证与致谢

[MIT](LICENSE)。折叠适配参考 dsh-turn-fold 和 DeepSeek Harness 的接口设计；原始许可证与引用版本保留在 [第三方说明](THIRD_PARTY_NOTICES.md)。
