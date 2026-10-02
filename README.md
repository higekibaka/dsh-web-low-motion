# DSH 性能与动效插件

适配 **DSH 0.2.0-rc.2**，保留旧版动效处理。**从 0.4.5 升级：本版本移除了插件提供的轮次折叠**；需要此功能时请使用支持原生工作详情显示选项的 DSH。见 [0.2 兼容说明](docs/compatibility-020.md)及 [0.1.7 兼容说明](docs/compatibility-017.md)。

[![CI](https://github.com/higekibaka/dsh-web-low-motion/actions/workflows/ci.yml/badge.svg)](https://github.com/higekibaka/dsh-web-low-motion/actions/workflows/ci.yml)

**dsh-web-low-motion 0.5.3** 为 DeepSeek Harness Web 提供三档动效、装饰动效帧率控制、可选 WebGL 文字流光。使用 DSH 的设置、React 和槽位接口，不修改宿主源码或构建产物。

[已发布版本](https://github.com/higekibaka/dsh-web-low-motion/releases) · [npm](https://www.npmjs.com/package/dsh-web-low-motion) · [变更记录](CHANGELOG.md)

## 安装

从 [GitHub Releases](https://github.com/higekibaka/dsh-web-low-motion/releases) 下载对应版本的 `.tgz` 和 `SHA256SUMS`，核对校验和后安装：

```sh
dsh plugin --profile web add /path/to/dsh-web-low-motion-0.5.3.tgz --offline --ignore-scripts
```

安装到目标 profile 后，重启 DSH 并刷新页面。打开 **设置 → 性能优化**；浏览器内的选项即时生效，不需要再次重启。

## 功能与默认值

| 选项 | 默认 | 行为 |
| --- | --- | --- |
| 动效模式 | 保留动效优化 | 保留扫光、状态点和横向文字流光，减少已识别装饰效果的重复绘制，离屏或页面隐藏时暂停。 |
| 动效帧率 | 跟随屏幕 | 可选 24、30、60、120、280 FPS 或跟随屏幕；仅控制优化模式下的扫光与文字流光。 |
| 文字流光渲染 | 合成层 | WebGL GPU 为可选试验模式，不默认启用。 |

### 三档动效

- **原生**：由 DSH 保持原有动画，不应用动效覆盖。
- **保留动效优化**：将已识别的扫光改为 transform，保留渐变、方向、周期、缓动和像素状态点；文字流光缓存字形遮罩后移动渐变层。遵循系统减少动态效果偏好。
- **低动态效果**：停止装饰性循环动画，保留文字与静态状态点。

帧率控制保留动画周期和速度，不限制页面滚动、视频或模型输出。未知样式、复杂标记和不支持的动画保留原生渲染。默认合成层没有逐帧 JavaScript 循环，也不逐 token 扫描正文。

### WebGL 试验模式

DSH 0.2 的文字高亮保留宿主原生合成层，同时遵循帧率与暂停设置；WebGL 选项仅适用于旧版文字流光。新版鲸尾保留宿主节奏，不受文字帧率上限影响。rc.1 的 SVG 动画在低动态模式、离屏、后台和系统减少动效时暂停；rc.2 的 APNG 动画在这些情况下改为静态 SVG，再次可见时恢复原生图像。APNG 的播放位置不由插件控制。

WebGL 绘制文字流光的移动渐变，保留原字形遮罩、文字和计时器；扫光仍走合成层。使用一个共享 rAF 调度器，按目标帧率采样，隐藏、离屏或系统减少动效时暂停。同页最多使用四个流光 GPU 上下文；不支持的效果、上下文丢失或超出限额时回退合成层。

**现有测量没有证明 WebGL 稳定快于合成层**，因此默认仍为合成层。它不改变模型速度，也不保证改善视频掉帧或整个浏览器的 GPU 占用。历史合成测量及边界见 [性能记录](docs/performance.md)。

## 偏好与关闭

选项存于当前浏览器，同地址标签页同步；不同浏览器、设备或端口相互独立。存储失败时当前页面仍可切换并提示无法持久化，损坏数据有明确回退提示。升级保留旧的原生／低动态偏好，不强制改为默认优化模式。

关闭全部显示效果：选择 **原生**。若需在 profile 层禁用整个插件，可在目标 profile 的 `cordis.patch.yml` 现有数组中追加：

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

- 当前主要验证目标：**DSH 0.2.0-rc.2**；CI 同时固定验证 **0.2.0-rc.1、0.1.7-rc.1、0.1.6-alpha.2**。Node.js **22.19.0 以上**。旧宿主也不会恢复插件折叠功能。
- 回归覆盖设置、偏好、动效与帧率、WebGL 回退、窄窗口和卸载；具体结果见兼容说明。
- 测试使用真实 Chromium，不等于真实用户视频掉帧或模型长时输出的性能验收。
- 原生 CSS、DOM 或槽位契约升级后需重新验证；无法识别的情况保留内容和原生效果。
- 只识别已知原生动效，不承诺控制主题插件自己的 Canvas、Worker 或背景动画。默认主题与终末地玻璃可同时使用，各自的动效预算相互独立。

## 开发

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
export DSH_CHECKOUT=/path/to/deepseek-harness-with-dependencies
# 对 0.2.0-rc.2 必须执行 APNG 回归；rc.1 改为 smil，旧版不设置此变量
export DSH_MODERN_VARIANT=apng
pnpm test
pnpm check:build
npm pack --ignore-scripts
```

设置回归只读使用指定 DSH 检出的 React/ReactDOM 依赖；新版动效测试直接编译目标组件和 CSS，依赖宿主的 lightningcss。只需安装宿主依赖，不需构建或启动 DSH。宿主模块加载、store、locale、slots 等服务使用测试替身，不是实际 Loader/槽位的全栈集成验收。CI 使用固定提交的独立检出；浏览器测试启动自己的临时 Chromium，不访问日常页面或会话。

版本、安装包名、当前变更记录与发布文档链接由测试检查；修改源码后必须更新并校验构建产物。Git tag 触发的 CI 通过后发布 GitHub Release；npm 发布由独立的 [release.yml 工作流](https://github.com/higekibaka/dsh-web-low-motion/actions/workflows/release.yml) 处理，详见下方发布说明。不把 GitHub Release 成功视为 npm 已更新。

发布包包含 Host 配置入口、构建的客户端、插件补丁、README、变更记录、性能与兼容说明、第三方说明和许可证。安装后无需重新构建。开发源码、测试和工作流位于本仓库；本地部署笔记与认证材料不属于发布内容。

## 维护者发布（npm Trusted Publishing）

npm 自动发布使用 GitHub Actions OIDC，不设置长期 npm 令牌。包维护者须先在 [npm 包设置](https://www.npmjs.com/package/dsh-web-low-motion/access) 的 Trusted Publisher 中选择 GitHub Actions，并填写：

| 字段 | 值 |
| --- | --- |
| Organization or user | `higekibaka` |
| Repository | `dsh-web-low-motion` |
| Workflow filename | `release.yml`（不是 CI 文件名，不带目录） |
| Environment name | 留空（工作流未声明 environment） |
| Allowed actions（若显示） | 允许直接 `npm publish`，不只是 `npm stage publish` |

此授权只适用于本包，不能沿用其他包的 Trusted Publisher。配置方法见 [npm 官方说明](https://docs.npmjs.com/trusted-publishers/)。工作流使用 Node.js 24、npm 11，在独立 publish job 中申请 `id-token: write`，并以 `--ignore-scripts --provenance --access public` 发布。

- **新版本**：同步包版本、README 和变更记录，构建、测试并提交后推送稳定版标签 `vX.Y.Z`。npm 工作流等待同一标签、同一提交的四宿主 CI 及 GitHub Release 全部成功；main/PR 的绿灯不能替代标签 CI。
- **补发/重试**：在 Actions 的 `npm release` 工作流中选择默认分支，使用 `workflow_dispatch` 输入已有标签（例如 `v0.5.3`）。原标签与 GitHub 安装包不变，不重新标记旧版本。旧标签自身不必包含新增工作流。
- **内容一致性**：从已通过 CI 的精确提交打包，禁用生命周期脚本，与 GitHub Release 安装包逐字节比较并验证 SHA256SUMS。已存在的 npm 版本仅在 SHA512 integrity 一致时跳过；不同内容直接失败，不覆盖版本，也不改变已有 dist-tag。
- **来源证明边界**：普通标签发布记录标签工作流身份；补发记录执行补发的默认分支工作流身份，不伪装成旧标签上的工作流。旧源码提交由标签 CI 和安装包一致性检查绑定。
- **认证失败**：检查 npm 侧的仓库、文件名和环境字段后重试；本机 `npm login` 或 GitHub PAT 不是此流程的 npm 发布凭据。只有工作流成功且 npm 可查到目标版本，才算双渠道发布完成。

本节描述默认分支新增的发布自动化；已有标签内的历史文档和安装包不会被回写。

## 许可证与致谢

[MIT](LICENSE)。历史折叠功能的引用记录与原始许可证保留在 [第三方说明](THIRD_PARTY_NOTICES.md)。
