# Windows：本地转写（2026-10-17）

和[第一轮](asr-round1-2026-10-16.md)同一批样本、同一个判官、同一套标准，换到一台 Windows 机器上跑：看四个本机模型在 Windows 上转得准不准、快不快，显卡（Vulkan）和只用 CPU 各差多少。

本文只放汇总数字。逐条的转写、判语和结果库存在本机的 `bench/_work/archive/asr-windows-2026-10-17/`：只读，附 SHA256SUMS。

## 条件

- **代码**：`8a7b100`（分支 feat/windows），另加 `sensevoice-small-q8@cpu` 这个候选（随本记录提交）。
- **机器**：Windows 11 Pro（内部版本 26200），Intel Core i5-13400F，16 GB 内存，NVIDIA GeForce RTX 4060 Ti（驱动 32.0.16.1088）。
- **运行库**：sherpa-onnx-node 1.13.8，transcribe-cpp 0.4.0（Windows 的 cpu-vulkan 版）。Node 22.19。
- **样本、参照、判官**：同第一轮。97 条真实口述录音，共 42.5 分钟；1 条参照是空的，不判分。转出来的字和第一轮一字不差的格子沿用第一轮的判分，不一样的 163 格（74 条录音）这一轮重判。

## 结果

| 候选 | 跑在 | 体积 | 判官均分 | ≥4 | ≤1 | 耗时 p50 | 耗时 p90 | 实时倍数 | 加载 | 内存峰值 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| qwen3-asr-0.6b-q8 | Vulkan | 850 MB | 4.16 | 78% | 1% | 240 ms | 659 ms | 72.9× | 5129 ms | 509 MB |
| qwen3-asr-0.6b-q8@cpu | CPU | 850 MB | 4.18 | 78% | 1% | 2653 ms | 8386 ms | 6.1× | 1043 ms | 3997 MB |
| qwen3-asr-0.6b-int8 | CPU | 987 MB | 4.06 | 71% | 2% | 3388 ms | 10.8 s | 5.2× | 3182 ms | 2475 MB |
| sensevoice-small-q8 | Vulkan | 253 MB | 3.94 | 68% | 2% | 107 ms | 399 ms | 186.1× | 1329 ms | 917 MB |
| sensevoice-small-q8@cpu | CPU | 253 MB | 3.93 | 68% | 2% | 887 ms | 2801 ms | 19.6× | 1492 ms | 985 MB |
| sensevoice-small-int8 | CPU | 237 MB | 3.75 | 61% | 3% | 463 ms | 1920 ms | 36.8× | 986 ms | 957 MB |

内存峰值是转写进程的常驻内存，跑在显卡上时模型放在显存里，不算在内（所以 Vulkan 那两行比 Mac 的 Metal 小得多：Mac 的显存和内存是同一块）。加载里含第一次在这台机器上编显卡程序的时间（Qwen3 Q8 的 5.1 秒大半是它，之后驱动会缓存）。

### 按语言

| 候选 | 英文（5 条）均分 / p50 | 中英夹杂（45 条）均分 / p50 | 中文（47 条）均分 / p50 |
| --- | --- | --- | --- |
| qwen3-asr-0.6b-q8 | 3.25 / 140 ms | 4.04 / 328 ms | 4.34 / 213 ms |
| qwen3-asr-0.6b-q8@cpu | 3.25 / 1610 ms | 4.04 / 3923 ms | 4.38 / 2443 ms |
| qwen3-asr-0.6b-int8 | 3.50 / 1566 ms | 3.80 / 4867 ms | 4.36 / 3002 ms |
| sensevoice-small-q8 | 3.50 / 48 ms | 3.51 / 124 ms | 4.38 / 106 ms |
| sensevoice-small-q8@cpu | 3.50 / 403 ms | 3.49 / 1196 ms | 4.38 / 738 ms |
| sensevoice-small-int8 | 2.75 / 193 ms | 3.44 / 657 ms | 4.13 / 389 ms |

## 读法

- 准确度和 Apple 芯片上的第一轮在同一个范围里（差 0.05 以内）：同一份模型文件，换系统、换显卡不影响转得准不准。
- 有显卡时，Qwen3-ASR Q8 走 Vulkan，速度和 Apple 芯片上走 Metal 差不多（p50 240 ms 对 231 ms），仍然是最准的那个，Windows 上该选它。SenseVoice Q8 走 Vulkan 更快，体积小。
- 只用 CPU 时，同一个 Q8 文件慢 10 倍左右（这颗 i5 上 6 倍实时，一句 10 秒的话一秒多出字），准确度不变；没有显卡、或者显卡没装起来时会用到它。
- 两个 sherpa-onnx 的 int8 版在这颗 CPU 上比第一轮那台 Mac 慢 3 倍左右。
