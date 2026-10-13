<h1 align="center">SpeakMore</h1>

<p align="center">
  按一下热键说话，再按一下，整理好的文字就贴进你正在用的输入框。<br>
  macOS 上的开源语音输入，用你自己的 Gemini API key。
</p>

这个仓库里有两样东西：

| 目录 | 是什么 |
| --- | --- |
| [speakmore/](speakmore/README.md) | **SpeakMore 本身。** 一条命令启动，填一把 Gemini key 就能用 |
| [targets/typeless/](targets/typeless/README.md) | 对语音输入工具 Typeless 的逆向分析，18 篇文档。SpeakMore 是照着它做的 |

## 一分钟跑起来

需要 macOS 12 以上、Node 22.13 以上、Xcode 命令行工具，以及一把 [Gemini API key](https://aistudio.google.com/apikey)。

```bash
git clone https://github.com/zephyr4123/speakmore.git
cd speakmore/speakmore
npm install
npm link
speakmore
```

`speakmore` 会在终端里问你要 key（输入不会显示出来），然后在后台运行。点进任意输入框，按一下右 Option，说话，再按一下。

```bash
speakmore history    # 看说过的话
speakmore status     # 在不在运行、还差什么
speakmore config     # 热键、模型、数据放在哪
speakmore stop       # 停掉
```

系统权限怎么给、数据存在哪、发了什么出去、和 Typeless 比还差什么，都在 [speakmore/README.md](speakmore/README.md) 里。

## 它是怎么来的

先对 Typeless 的 macOS 客户端做了一遍逆向：拆安装包、读还原出来的代码、看本机数据、抓自己账号的流量，弄清楚它为什么快、发了什么出去、文字是怎么贴进输入框的。结论写成了 [targets/typeless/docs/](targets/typeless/docs/00-overview.md) 下的文档，出处记在[证据台账](targets/typeless/docs/90-evidence-ledger.md)里。

然后照着文档里的协议和交互重新写了一个，只保留语音转写：服务端换成自己的（一次 Gemini 调用完成识别和整理），不采集屏幕和输入框内容，不需要账号。SpeakMore 和 Typeless 官方没有关系，仓库里也不含 Typeless 的代码和密钥。

## 仓库里的其他东西

| 路径 | 是什么 |
| --- | --- |
| `AGENTS.md`、`.memory/` | 和 AI 编程助手协作时用的工作约定和项目记忆 |
| `scripts/`、`.machine.env.example` | 开发时用的脚本：按每台机器自己的配置加载 key、核对 GitHub 账号、检查本机信息有没有漏进仓库 |
| `.claude/`、`.mcp.json` | 逆向用的工具 [REA](https://github.com/morluto/rea) 的项目级配置。`.claude/skills/` 下是 REA 自带的说明文件，版权归它的作者，MIT 许可 |

## 许可

[MIT](LICENSE)。`.claude/skills/reverse-engineer-anything/` 来自 REA，按它自己的 MIT 许可。
