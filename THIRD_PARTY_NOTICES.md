# Third-Party Notices

本插件（dsh-web-low-motion）的「已结束轮次自动折叠」与可搜索隐藏相关适配参考了下列第三方项目的设计与接口。以下许可证文本按其原始形式完整保留，未作修改。

## dsh-turn-fold

- 项目主页：https://github.com/Winter-And-You-Gone/dsh-turn-fold
- 固定引用：tag `v0.5.1`，对应 commit `f07546aec9e4e778ef139fa54a7f1779a566b216`
- 包名与版本：`@winteries/dsh-turn-fold` 0.5.1（`license` 字段为 MIT）
- 用途：会话折叠相关交互与设置项的设计参考。
- 引用说明：会话折叠的行为与设置接口参考上游设计，由本项目自行适配实现；上游包不作为本插件的运行时依赖引入。若后续实现与上游存在实质性代码复用，将在此补充相应署名。上述版本与许可证信息以上述固定 tag/commit 的 `LICENSE` 文件为准，而不是上游可变的默认分支。

### MIT License（原文全文）

```text
MIT License

Copyright (c) 2026 dsh-turn-fold contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```

## DeepSeek Harness

- 项目主页：https://github.com/deepseek-ai/deepseek-harness
- 引用版本：0.1.5-rc.1，git HEAD `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`
- 许可证：MIT License，Copyright (c) 2026 DeepSeek
- 用途：本插件的可搜索隐藏与轮次适配参考了上游的 `packages/client/ui-chat/src/client/chat/searchable-hidden.ts` 与 `packages/client/ui-chat/src/client/conversation-nodes/turn-process.ts` 契约。
- 引用说明：以上仅针对本机该安装版本的适配参考，不表示兼容其他或全部上游版本；相关行为与接口适配由本项目自行实现。以下许可证文本按其原始形式完整保留，未作修改。

### MIT License（原文全文）

```text
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```
