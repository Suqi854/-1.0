> Development only1.28.0-dev.2 / condition0.1.4: explicit research_only emits version2 research_rows/counts and safe strict placeholders; the strict190 baseline remains. See ../../docs/research-only-next-contract.md. No actual101 pool/source/local activation or Git/deployment.

# 独立条件选股模块 · 开发 0.1.4

本模块是既有 **ashare-analysis-companion** 行情服务/技能的新增消费组件。它不创建另一个行情管道或插件身份，也不读取 key、持仓、自选、私人策略文件。本阶段只有通用规则和合成/mock数据。此目录由原工程集成；静态入口仅提供合成演示，不启动真实采集或上传私人规则。正式技能仍由原插件发布流程独立管理。

## 一期交付

- 零运行依赖的 ESM 纯函数引擎 `screen(snapshot, rule, limits)`，Node ≥20 或支持 ESM 的浏览器可调用。
- 有界声明式规则：AND/OR嵌套、D/W/M、字段和指标比较、数值阈值、窗口/偏移、上穿/下穿。无 `eval`、函数操作数、任意脚本、网络或存储。
- 由实际OHLCV窗口派生价格MA、量均线、涨跌幅、前高、量比；波段是一个可编辑公开示例，不是唯一规则。
- 逐股三值 `decision: pass|fail|unknown` 和 `passed: true|false|null`，并区分命中、不符、数据失败、样本/状态不足、未处理。每个条件提供来源、日期、复权、样本窗口及原因。
- D/W/M分别冻结截止，默认完成周期。显式允许形成中周期时，输出与UI均标记 `partialUsed`。不强迫三周期末根日期一致。
- `adaptPortableDatasets(input)` 消费父工程正式 **local OHLCV dataset v1** 返回值，只做映射、身份/单位/完成证据检查，不调用 updater、来源或数据库。
- 所有入口在读取字段前检查纯JSON边界：Node拒绝accessor/class/继承字段/Proxy且不执行getter/trap；浏览器只接收JSON文本，避免对象反射触发Proxy。共同run/target/calendar/policy冻结tuple在直接screen入口也检查；未知日历版本不制造2026完成证据。
- `createScreenLedger(config)`冻结明确版本/来源的行业龙头子池，默认每批≤20股，跨批去重及累计预算；只请求已有本地数据，不传私人规则给读取方。
- 可交互浏览器条件工作台，支持增删条件/分组、指标/阈值比较、窗口/偏移/交叉、股票子范围、预算、周期模式及本地规则下载。只绑定合成适配；真实数据接入由父任务负责。

## 使用

```sh
npm test
npm run example
npm run demo
# 浏览器打开 http://127.0.0.1:4173/ （仅回环地址，合成样例）
```

无需 `npm install` 即可执行纯引擎测试和演示。`npm run test:ui` 另需已有 Playwright 和 Chromium；它不会下载浏览器或安装依赖。可用 `PLAYWRIGHT_MODULE` 指定模块路径、`CHROMIUM_PATH` 指定可执行文件。静态演示不是对外部署；页面无云API，CSP禁止连接。浏览器规则只驻留内存，下载由用户主动触发，未写 localStorage/IndexedDB。

```js
import { screen, swingPreset } from './src/index.js';
import { createMockSnapshot } from './src/mock.js';
const report = screen(createMockSnapshot(), swingPreset, { maxProcessed: 100 });
console.log(report.counts); // 合成覆盖统计
// 浏览器公共API只接收JSON文本：
// screen(JSON.stringify(localSnapshot), JSON.stringify(localRule), JSON.stringify(localLimits));
```

## 合并接口

父工程将整个目录放到新模块目录（如 `modules/condition-screen/`），从 `src/index.js` 导入即可；不要覆盖行情工程。获授权的本地消费方读取已冻结的 `readDataset` 结果，再交给适配器和引擎；当前合成页面尚未接通真实读取。云 Worker 没有行情数据库读写或持久回退，`get_archive` 在云端是 unsupported。显式 127.0.0.1 Node 宿主的手工留存路径须有 NodeSQLite 工厂签发的开放能力，不会接通准备中的 OHLCV 内核；此次源码交付未启动实际本地服务。更改策略不重新拉取行情。分批接线见 [本地分批消费合同](docs/BATCH-CONSUMER.md)。详情见 [数据与适配合同](docs/INTERFACE.md)、[规则与指标语义](docs/RULES.md)、[上游合同参考](docs/UPSTREAM-CONTRACT.md)。

独立审查修订及反例见 [审查修复说明](docs/REVIEW-FIXES.md)。

```js
import { adaptPortableDatasets, screen } from './src/index.js';
const adapted = adaptPortableDatasets({
  runId, directory, frames, records, suspensionBySymbol
});
if (!adapted.valid) throw new Error('Invalid adapter input');
const report = screen(adapted.snapshot, privateRule, localLimits);
// privateRule/localLimits/records/report 始终在本地；不要发送到云API或遥测。
```

默认选股范围为研究任务提供的沪深主板非ST行业龙头子池，每行业2–5只的名单由该任务研究；本模块只消费有版本和来源说明的明确symbol列表，未自行研究或接入真实名单。UI的10条池记录全部虚构，范围内8股；覆盖分母是本次冻结池，不硬编码全主板数。保留全主板枚举作为兼容输入，进一步限制只能缩小。未知ST状态仍列出并计为不足，绝不冒充已确认非ST候选。目录不包含的代码单独列出。名称含ST/退和范围外证券不参加策略评估。上游名称过滤不是官方状态证明。

## 验证边界

`tests/fixtures/local-ohlcv-synthetic.json` 是父任务提供的全合成合同样例；`src/mock.js` 是独立虚构演示。独立缩比测试40股、每股四键564根、每批≤20股；旧3052体量仅作静态边界算式，不构造全池输入。共享小样本仅测试逻辑，不能证明独立全池容量。公共目录不可用（例如访问拒绝）时，本模块不会重试、换源或绕过拒绝，而是明确 `blocked`、`counts:null`。

一期未提供财务、资金流、市值、换手、历史成交额条件。`amount_cny`保持null。日历真实验证只到2026范围；早于2026的自然周期已结束不等于交易日历验证，不能自动升级为完整样本。qfq历史不是 point-in-time，来源最终修订仍 `unknown`，本模块不证明收益或回测有效性。

开发测试通过、模块可调用、真实龙头池数据完成、收益验证是四个不同状态。本产物只完成前两项（合成数据190项测试、浏览器32项检查）；真实本地数据接入和更新内核启用不由此合成模块证明。本模块没有真实龙头池验收、交易执行或服务收费能力。
