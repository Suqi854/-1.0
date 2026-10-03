# 本地冻结池的分批消费合同

`createScreenLedger(config)`属于消费模块，既不采集也不存储行情。Node接受安全JSON对象/文本；浏览器仅接受JSON文本。默认每批20股，上限20。安全JSON体量限制保持原值；不得为了拼接全池行情提高界限。

## 一次冻结的配置

```js
const config = {
  version:1, synthetic:false,
  runId, targetSession, calendarVersion, policyVersion, manifestHash,
  directory: {
    status:'ready', universe:'CN_MAINBOARD_NON_ST_LEADERS',
    universeVersion, source, sourceNotes, asOf,
    entries // 研究任务给出的明确symbol列表与身份；本模块不选行业龙头
  },
  frames, // 各自expectedLastDate/mode/adjustment；共同观察targetSession
  rule:privateRule, limits:localLimits, batchSize:20
};
const ledger = createScreenLedger(config);
```

manifestHash必须为64位小写hex；由本地主机提供冻结manifest的身份。本模块保存并比较它，未实现上游manifest哈希算法验证。run/target/calendar/policy/manifest、目录及规则在构造时复制并冻结。龙头子池必须有版本和来源说明；实际名单/行业研究由另一任务交付，本包未接入真实池。旧全主板模式保留用于兼容，不是UI默认选股范围。子池仍逐项校验主板前缀、板块和非ST状态；用户限制只能缩小。

## 接入既有本地store

```js
// 在已授权的本地宿主运行；模块不接收loader函数，也不执行任意回调。
if (!ledger.valid) return ledger.report ?? {errors:ledger.errors};
let request;
while ((request=ledger.nextBatch()) !== null) {
  const local = await store.read(request.runId, {symbols:request.symbols});
  // 宿主按实际store返回形状映射为[{symbol,key,result:readDatasetResult}]。
  // status用于元数据/entries账本；readDataset也可逐股逐key读取。
  const records = toPortableRecords(local);
  const {symbols,seriesKeys,...frozenReceipt}=request;
  const receipt=ledger.consume({
    ...frozenReceipt, records,
    suspensionBySymbol:localSuspensionAttestations(symbols)
  });
  // 只在本地记录诊断；rejected批次已按股记failure，勿重加其total。
}
const report=ledger.finish();
```

上述`toPortableRecords`/`localSuspensionAttestations`是宿主占位函数，不是新增采集器或本模块实现的store能力。没有真实本地接线就不能声称已可读市场数据。请求仅含batchId、runId、targetSession、calendarVersion、policyVersion、manifestHash、symbols、seriesKeys；不含rule、limits、持仓、自选、key。seriesKeys固定四键，不从用户条件派生来源请求。条件变化仅本地重算冻结数据，privateRule不进入store/updater/loadSeries或云API。浏览器宿主在调用公共API时将内部纯数据序列化为JSON文本。

## 去重、预算与账本

`nextBatch()`在待消费批次存在时返回相同内容的副本。`consume`须匹配token和完整tuple；实际available dataset也必须匹配run/target/calendar/policy。symbol不得超出待消费列表，大小写规范化后同symbol/key不得重复，key只限实际四键。停牌证据不得引入批次外symbol。跨批不同manifest或数据代拒合；该批每股failure/unknown，后续继续，已提交symbol不会重计。未启动批次的重放得到NO_PENDING_BATCH；重放旧token到新批也拒合。

最终coverage分母从冻结池计算一次。`catalogTotal = excludedTotal + restrictionExcludedTotal + counts.total`；`counts.total = successful + failure + insufficient + unprocessed`；`successful = match + no_match`。不相加各批的目录total。`maxProcessed`和100000节点预算全程累计，按每股完整规则节点数保守计费，包括unknown结果；超预算股明确unprocessed。finish可在中途查看pending，也可得到budget_exhausted/completed。completed表示每个池内股已获得一个状态，仍可能全部unknown，不证明历史全备或收益。

ledger仅保留冻结元数据、逐股判断/原因/样本摘要及批次诊断，消费结束不保留OHLCV数组；宿主应逐批读取/释放，不拼接所有历史。若目录/池不可用则blocked、counts:null，不当作零候选。本模块不会重试403。

## 合成容量证据

独立40股测试：两批，每批20股，四键共564根/股；每个数组与每根bar都是独立对象，峰值批次11280根。另有纯元数据身份池的累计节点预算测试，不加载其OHLCV。历史3052×564根的静态体量下界测试只说明为何不拼接全池，不做新全池性能目标，也不把共享DAG计数当独立行情容量证明。该证据不是实际龙头数、真实行情全池完成或每日更新时效承诺。


0.1.3返回隔离保证：finish完整报告通过structuredClone复制，包括directory/excluded/restrictionExcluded/requestedOutsideCatalog/frozenFrames/warnings、rows/tree、freezeTuple、batchLedger和counts。调用者可修改结果副本，但不能改变后续finish或consume的冻结证据。构造配置、消费输入与返回receipt也不与内部共享。
