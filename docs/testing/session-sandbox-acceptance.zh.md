# PilotDeck Session 沙箱验收规范

状态：待实现、待执行。日期：2026-10-06。

对应设计：[模块化 Session 沙箱开发文档](../architecture/session-sandbox-development.zh.md)。本文件是验收计划，不是 PASS 报告。新增测试文件名和配置均为计划项，不表示仓库已有运行入口。

## 1. 验收结论规则

核心要求：同一 PilotDeck 实例同时服务多个 session，每个 session 的 agent 不能通过任何已开放能力读取、列举或修改其他 session 的私有文件。

- `PASS`：已执行，结果符合预期，有请求、结果和宿主侧观察证据。
- `FAIL`：与预期不符，或发生任何越界读写、宿主 fallback、身份串用。
- `BLOCKED`：环境缺失、基础设施异常或测试不能可靠执行；不算通过。
- `NOT_RUN`：尚未执行。
- `N/A`：仅用于部署明确禁用的可选能力；必须验证该能力确实不可调用。

任一必测项 FAIL/BLOCKED/NOT_RUN 都不能声明完整验收通过。禁用 MCP 等可选能力可以交付受限版本，但必须在报告中列出支持范围；不能以 N/A 跳过 read、write、Bash、grep 等首版承诺能力。

边界探测返回 ENOENT 或 EACCES 均可，只要没有泄漏私有内容、目录条目或造成副作用。由权限提示提前阻断不能替代 OS 验证：必须允许沙箱内任意 shell/Python 执行测试，并确认 permission mode 不影响隔离。

## 2. Linux 前置条件

记录以下环境信息：

- PilotDeck 测试版本、provider 版本、nsjail 版本、Linux 内核和发行版。
- rootfs 标识及实际可用的 shell、Python、Node、rg 工具版本。
- namespace、UID/GID 映射、capabilities、seccomp、cgroup 和磁盘限额配置。
- 主服务启动方式、网络 profile、session 容量和测试使用的配置。
- 支持工具与明确禁用工具清单。

readiness 应先启动一个最小沙箱并确认实际隔离和限额生效。macOS 上的类型/单元测试不能替代 Linux nsjail 集成验收。运行环境缺少能力时记录 BLOCKED 原因；不切换 host provider 来获得 PASS。

所有探测在专用验收实例和测试目录进行；破坏性写入只针对验收 marker，资源压力仅针对受限测试沙箱。

## 3. 统一夹具与证据

### 3.1 夹具

启动一个 PilotDeck 服务，由真实 Gateway/session 创建链路创建 A、B；C 用于生命周期测试。禁止用两个独立 PilotDeck 服务替代并发 session 测试。

可信测试 harness 在 workspace、home、tmp、会话记录、后台输出和宿主 control 目录分别放置不同随机 marker。先验证本 session 能读写自己的允许目录，再执行越界探测。其他 session 的 marker 不放入被测 agent 提示或工具参数；仅可信 harness 知道预期值。

为 B 创建专用 `write-target.txt`，保存原始字节内容。向 A 提供 B 的宿主绝对路径和相关探测路径，但不提供 marker 内容。每轮尝试后由宿主直接比对 B 目标文件内容、文件是否存在及目录条目，不能只相信工具返回失败。

### 3.2 测试层次

| 层次 | 目的 | 建议实现 |
| --- | --- | --- |
| 契约单元测试 | provider 选择、绑定、generation、dispose、配置拒绝 | fake provider，可在普通开发机执行 |
| Linux provider 集成测试 | 内核隔离、文件/进程/RPC/资源行为 | 真实 nsjail 和测试 rootfs |
| PilotDeck E2E | 真实装配后所有开放工具不绕过 provider | 单实例 A/B 并发；可用确定性模型 fixture 触发真实工具调用 |
| Agent smoke | 验证真实模型能在隔离工作区完成正常任务 | 一个受限编程任务；不能替代确定性边界测试 |

拟新增测试组：`session-execution-provider`、`nsjail-isolation`、`session-sandbox-e2e`。实现后再填写实际命令，不使用占位命令冒充已执行测试。

### 3.3 每项证据

记录 case ID、sessionKey/sandboxKey/generation、工具和请求身份、开始结束时间、输入、结果、退出码、实际进程/挂载/cgroup 观察和 marker 比对结果。敏感测试 marker 仅留在受控验收输出中。

报告目录建议为 `artifacts/session-sandbox/<run-id>/`，包含环境说明、支持范围、逐项结果、请求结果记录和宿主侧校验记录。不要求运行者计算文件校验和。

## 4. 核心必测矩阵

| ID | 操作步骤 | 通过标准 |
| --- | --- | --- |
| CORE-01 自身读写 | A/B 各用 read/write/edit/Bash/Python 在 workspace 创建、读取、修改文件 | 本 session 内容一致，正常功能可用 |
| CORE-02 并发同名路径 | A/B 在 `/workspace/same.txt` 写不同内容，同时执行 shell 和 grep | 各自只见自身内容；输出、事件、退出码不串用 |
| ISO-01 绝对路径 | A 用 read、Bash cat、Python open、grep/glob 访问 B 宿主 workspace/home/tmp/control 路径；再 B→A | 各通道均无对方内容和目录条目，无宿主路径透传 |
| ISO-02 写入越界 | A 对 B 测试目标尝试覆盖、追加、删除、重命名和创建文件，覆盖文件工具与 shell | B 内容和目录条目保持不变；宿主 control 同样不变 |
| ISO-03 路径变体 | 对上述目标使用 `../`、绝对路径、重复分隔符及正规化后越界的路径 | 不因路径解析方式获得越界能力 |
| ISO-04 链接与竞态 | A 创建指向 B 宿主路径的符号链接；通过 shell 尝试硬链接；循环切换指向自身/越界目标的链接，调用读写及导出 | 无跨 session 读写；可信导入不引入共享可写 inode |
| ISO-05 根与挂载 | 沙箱内观察 `/`、mountinfo，并尝试访问 sessions 父目录、宿主 home/control；尝试额外挂载/进入 namespace | 无其他私有目录挂载；无法扩张可见范围 |
| ISO-06 proc 与 FD | A 探测已知宿主/B PID 的 `/proc/<pid>/root`、fd、environ；检查子进程继承 FD | 无对方文件、凭据或主服务管理 FD；仅必要本 session 能力可见 |
| ISO-07 tmp/home/cache | A/B 在相同 tmp、HOME 和缓存路径写不同 marker，再读取 | 只读到自身值；没有共享可写临时目录 |
| ISO-08 配置拒绝 | 使用不存在 provider、缺失 nsjail、不支持策略、非法挂载和失效 rootfs | session 明确失败，无任何宿主工具执行记录 |
| ISO-09 权限模式 | 在产品允许的最宽工具权限模式下重复 ISO-01/02/04 | 工具权限不解除 OS 边界 |
| ISO-10 身份伪造 | 修改工具参数/RPC 中 sessionKey、sandboxKey、宿主目录或其他 session task ID | 拒绝或忽略不可信身份；不能改绑连接或访问 B |
| ISO-11 工具绕路 | 枚举最终开放工具，逐项检查原生 fallback、直接 fs/spawn、后注册扩展和回调 | 每个本地文件/进程能力实际走当前 session；无未分类能力 |
| IO-01 导入导出 | A 上传/下载自身文件；再用 B 路径、越界链接和越界归档条目尝试导入导出 | 自身正常；无越界读写，无设备/外部硬链接注入 |
| NET-01 默认断网 | 从 A 尝试 DNS、外网、宿主管理 API 及 B 测试监听端口 | deny profile 均不可达；本 session 工具 IPC 仍可用 |
| STATE-01 控制数据 | 通过搜索、记忆、任务输出、spill/artifact 查询尝试获取 B 的私有 marker | 无 B 的私有内容；会话查询服务不能绕过文件隔离 |

对 ISO-04 的竞态使用固定测试时长和次数并记录；“没触发”只能作为该运行的证据，必须同时审查宿主文件桥是否采用无竞态的受限打开机制。不能因单次 realpath 检查通过而宣布满足要求。

## 5. 并发与生命周期必测矩阵

| ID | 操作步骤 | 通过标准 |
| --- | --- | --- |
| LIFE-01 并发创建 | 同时申请多个 session；对同一 session 并发 acquire | 不同 session 目录唯一；同一 session 一个有效 generation/worker |
| LIFE-02 请求取消 | A 同时执行两个前台请求，取消其中一个；B 持续写心跳 | 只停止被取消请求及其后代，其余请求和 B 正常 |
| LIFE-03 session 关闭 | A 启动持续派生进程/后台任务后关闭 A；B 持续运行 | A 及后代全部回收；关闭后新调用被拒绝；B 不受影响 |
| LIFE-04 worker 崩溃 | 杀死 A worker，同时保留其可能派生的子进程 | A 不再执行新任务，残余进程被回收；B 正常；无宿主 fallback |
| LIFE-05 恢复 | A 写持久文件并停止，恢复相同 session；投递旧 generation 响应 | 新 worker 读取原文件；旧事件被拒绝，且不会恢复到 B 目录 |
| LIFE-06 主服务崩溃 | 在 A 有运行任务时终止测试主服务并重启 | 识别/回收或受控接管旧 worker，禁止两个 worker 并发写同一 session |
| LIFE-07 不确定副作用 | 命令写入计数后模拟响应丢失/连接断开 | 不盲目重跑导致计数重复；报告或核对未知结果 |
| LIFE-08 重复释放 | stop/dispose 并发、重复调用；创建中途故障 | 释放幂等，不遗留挂载/进程/lease；不误删持久文件 |
| LIFE-09 热更新 | A 运行期间更换 provider/profile，再创建 B | A 固定原绑定；B 使用新策略；无进行中的降级 |
| LIFE-10 文件清理 | 对活跃 A 请求 retention 清理，再清理已停止测试 session | 活跃文件不删除；停止后按策略清理且不影响其他 session |
| LIMIT-01 资源限额 | 在 A 分别施加有界内存、进程和磁盘压力，B 执行短任务 | 已声明限额实际生效；B 不被同组终止；主服务保持响应 |
| LIMIT-02 容量上限 | 按配置启动 N 个 session 后请求 N+1 | 明确排队或容量错误，不静默无界启动；释放后可继续 |
| LIMIT-03 输出背压 | A 持续产生大量 stdout/stderr，B 产生带身份的短输出 | 输出有界、可取消，B 输出不混入 A，主服务内存不无界增长 |

同一 session 不同工具修改同一文件时不承诺自动事务隔离；测试不得把业务级写入冲突与跨 session 串写混淆。

## 6. 对外开放能力专项验收

下列能力一旦宣称支持，就必须执行；未支持时验证工具不可调用后标 N/A。

| ID | 能力与操作 | 通过标准 |
| --- | --- | --- |
| EXT-01 execute_code | Python 直接读写与通过 helper RPC 读写 B 路径；并发 A/B helper | 两条路径都隔离，RPC 不可选择其他 session |
| EXT-02 后台任务 | A/B 同时启动任务；A 查询/取消 B task ID；停止 A | owner 检查生效，仅本 session 输出可读，A 全部后代回收 |
| EXT-03 MCP | A/B 启动本地 MCP 文件工具，分别探测 B 路径及共享连接状态 | MCP 进程在各自沙箱，结果不串用；远程 MCP 另有服务端隔离证据 |
| EXT-04 LSP | 打开各自同路径文件，触发索引/诊断及越界 URI | LSP 进程、索引和 URI 路由隔离，无对方内容 |
| EXT-05 hooks/扩展 | 用 hook 和扩展工具访问 B 路径，包含失败 fallback | 沙箱内执行或明确禁止，无宿主执行 |
| EXT-06 附件/历史 | 导出附件、恢复文件历史、读取 plan/spill，尝试 B 的 ID 和路径 | 文件和元数据都按 session 授权，无任意宿主读取 |
| EXT-07 子 agent | 父 A 派生子 agent，随后尝试改绑 B | 默认继承 A；独立 session 使用独立 workspace，不能访问 B |
| EXT-08 浏览器 | A/B 使用独立 profile 下载文件并检查 Cookie/下载路径 | 无共享可写 profile/download，文件访问只落本 session |
| EXT-09 联网 profile | 访问允许目标、被禁目标、宿主管理 API、B 端口；检查重定向路径 | 允许流量正常，其余不可达；不能借网络绕过 session 隔离 |
| EXT-10 fork/克隆 | fork A 为 D，D 修改同名文件并探测 A 元数据 | 独立可写文件，无共享可写 inode，授权复制范围明确 |

## 7. 可复用探测脚本

以下脚本仅用于受控验收 marker。它们应通过真实 PilotDeck 工具调用进入沙箱执行，不能仅在宿主终端运行后当作 E2E 证据。`TARGET` 由测试 harness 替换为对方测试文件的宿主绝对路径；不要把对方 marker 内容传给被测 session。

读取探测：

```python
import os

p = os.environ["TARGET"]
try:
    with open(p, "rb") as f:
        data = f.read(256)
except OSError as e:
    print("READ_DENIED", type(e).__name__, e.errno)
else:
    # 对其他 session 私有路径，打开成功即判失败，不依赖模型判断。
    print("UNEXPECTED_READ", repr(data))
    raise SystemExit(1)
```

写入探测：

```python
import os

p = os.environ["TARGET"]
try:
    with open(p, "ab") as f:
        f.write(b"\nCROSS_SESSION_WRITE_PROBE\n")
except OSError as e:
    print("WRITE_DENIED", type(e).__name__, e.errno)
else:
    print("UNEXPECTED_WRITE")
    raise SystemExit(1)
```

每次运行后，可信 harness 必须读取 B 的原始文件并直接比较内容、存在性和目录条目。额外执行正向探测：把 TARGET 设置为 A 自身 `/workspace/probe.txt`，确认环境不是通过禁用所有文件操作来“通过”越界测试。

shell、文件工具、grep/glob、附件以及 execute_code helper 应分别执行等价探测；不能用 Python 的成功结果替代其他通道覆盖。

## 8. 性能与功能 smoke

在同一测试机、相同资源配置下记录：冷启动和热工具调用 p50/p95、每 session 空闲/执行内存、目标并发 N 下吞吐、关闭回收时延。N 至少覆盖 2，并覆盖计划部署的容量上限。数值目标在发布前由目标部署确定，未定义阈值不能标记“性能达标”。

功能 smoke：让 A/B 同时创建一个小项目、运行测试并生成同名产物，再通过各自 artifact 通道下载。验证内容正确、产物互不覆盖、会话恢复后仍可读取。记录一次真实模型运行；边界验收仍以确定性调用为准。

## 9. 验收报告模板

```text
运行 ID / 日期：
PilotDeck / provider / nsjail / rootfs 版本：
Linux / namespace / UID / cgroup / 配额环境：
实际执行命令与配置：
支持工具清单：
禁用能力及不可调用的验证：
并发目标 N / 性能阈值：

case ID | PASS/FAIL/BLOCKED/NOT_RUN/N/A | 证据路径 | 失败原因/范围

跨 session 读取或写入：有 / 无 / 未完成验证
宿主 fallback：有 / 无 / 未完成验证
残留进程/挂载/lease：有 / 无 / 未完成验证
恢复、取消与副作用结果：
性能测量及对阈值结论：
已知限制：
发布结论：不通过 / 受限预览通过（明确范围）/ 完整通过
```

当前分支结论：**受限预览，Linux 验收未完成**。已执行的 TypeScript 定向编译和 13 项 provider/execution-world 聚焦测试通过；尚未在 Linux 上运行真实 nsjail，也未完成 MCP/LSP/hooks、cgroup、磁盘配额和主服务崩溃恢复验收。因此 CORE/ISO/LIFE/EXT 矩阵仍保持 `NOT_RUN`，不能声明完整通过。
