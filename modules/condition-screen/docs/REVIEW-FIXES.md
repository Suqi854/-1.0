# 0.1.1–0.1.3 独立审查修复候选

父任务审查复跑原41项测试后发现原实现接受getter/class/继承字段、直接入口未检查共同generation、adapter从任意calendar_version产生2026proof。补充还指出共同target/calendar/policy tuple、ISO时钟/因果关系和available/state冲突。上述问题已成为合成回归。

## 输入安全

新增`src/json-input.js`，所有公开入口先检查输入，再读取字段。Node使用内置util.types.isProxy无trap检测，然后按属性描述符复制到净化副本；不读accessor，不调用toJSON或用户toString，不遍历自定义原型。类实例、继承字段、隐藏属性、循环、稀疏数组、函数/Symbol/非有限数及危险键均拒绝。支持JSON文本和纯数据对象；单次净化边界为深度32、1000万访问、对象5万属性/数组2.4万长度、JSON文本128Mi字符。

浏览器缺少无trap的Proxy检测原语，因此公共API**只接受JSON文本**。任何对象立即拒绝而不反射，包括getter/class/Proxy。UI只序列化内部构建的公开合成数据/规则，再调用引擎。最终私人规则只在本地执行保存，未新增云API。

## 共同冻结代与日历

新增`src/provenance.js`，集中定义ID格式、精确日历版本/范围和时钟规则。portable当前dataset_id=manifest.run_id；每个所用series.datasetId必须等于snapshot.generation，content_hash可分别不同。共同targetSession/calendarVersion/policyVersion在adapter和直接screen中均逐项核对。W/M完成末根可不同；各周期/股票收据时钟可以不同。

未知calendar_version只得到unknown证据，不能生成固定2026proof。已知exchange-announced-2026-v1范围固定为2026；更宽范围不升级历史确定性。合成专用calendar/policy不能用于真实快照。

ISO收据必须有日期、T、时分秒和timezone，可选毫秒；`0`、无timezone、日期/时分秒溢出拒绝。fetched_at不能早于request_started_at，且中国观察日期须达到targetSession。0.1.2依据父明确的portable v1写入语义，要求每序列completion_cutoff与request_started_at为同一绝对时刻（解析后毫秒相等）；早/晚1毫秒均关闭。不同ISO写法的同一时刻合法，不同D/W/M序列各自时钟不同也合法。available=true必须配state=ready，失败/partial状态冲突关闭。末观察标签须达到target，不能把旧完整月K伪装成整个bundle已观察到目标日。

## 共享质量与分批修复

新增`src/quality.js`。direct screen及adapter共用series/coverage/bar/proof/cache/units类型和白名单；missing_scheduled_session_dates={}或null、字符串flag、known_final、pointInTime=true、adjusted_volume、缺hash和缺gap flag均关闭，不再默认补齐。coverage与实际窗口数量/日期对应；OHLCV显式null保留缺字段语义，nullable observedLatest不能证明最终性。逐质量字段覆盖null/wrong type/missing并验证没有未捕获异常。validateSnapshot的结构valid不是数据就绪或策略通过证明；所用周期另须完整校验。

新增`src/batch-ledger.js`，默认≤20股，同run/target/calendar/policy/manifest跨批一致；每symbol恰一状态，全局节点和股数预算累计；不在ledger保存行情数组。消费请求不携带privateRule；宿主已有store/readDataset负责逐批读取，模块不造collector。原3052共享fixture降为40股逻辑样本，不当独立容量证据；独立缩比40股×四键564根分两批验证，静态边界算式不加载全池或提高JSON界限。

最新范围：UI默认行业龙头池，symbol列表由研究任务提供，要求版本/来源说明；本包仅10条合成池记录，真实池尚未接入，coverage分母按冻结列表。支持旧全主板输入兼容，未重新造分类器。UI改用本地合成分批reader。

## 验证证据

合成单元/回归共190项通过，浏览器32项通过。Node与浏览器公共API getter/Proxy调用数均0；初始14个资源请求后编辑、运行、下载、审查场景网络请求0。UI截图包括generation/calendar/receipt、cutoff早晚与跨批manifest拒合；可见规则/限制与审查场景保持一致。`ui/app.js`的renderReport是宿主可信内存report的内部渲染函数，不是`src/index.js`的公开数据API，安全JSON边界承诺仅覆盖公开入口。

未改Site、已有插件/技能身份或无关仓库，未取真实行情或读取私人配置，未进行Git上传、部署或激活数据更新内核。最终包更新同一个Library文件的新版本，保留0.1.0/0.1.1历史。交给父统一独审，并非已批准整合。

## 0.1.3 返回值别名修复

父独审确认0.1.2的finish虽复制rows，但浅展开initial使directory/excluded/frozenFrames与内部共享。0.1.3仅将完整finish报告一次structuredClone，包含所有嵌套初始和运行元数据，不改规则阈值或预算。新增3项回归：递归修改每个嵌套字段/数组后再次finish与consume；修改构造配置的池/规则/截止/预算；修改消费输入及receipt后验证快照隔离。浏览器另验证catalogTotal/excluded/frozenFrames篡改不影响后续账本与批次处理。此前187项仍通过，合计190项；浏览器32项通过。
