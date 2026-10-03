// Requires an available Playwright installation and Chromium; does not download either.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async()=>{
  const root=path.resolve(__dirname,'..'),port=Number(process.env.TEST_DEMO_PORT||4187);
  const server=fork(path.join(root,'scripts/serve.cjs'),{env:{...process.env,DEMO_PORT:String(port)},silent:true});
  let browser;
  try{
    await Promise.race([once(server.stdout,'data'),once(server,'error').then(([e])=>{throw e})]);
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1440,height:1200}});
    const errors=[],requests=[];page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
    await page.goto(`http://127.0.0.1:${port}/`);await page.getByText('声明式规则验证通过；执行在浏览器内存').waitFor();
    assert.equal(await page.locator('.stock').count(),8);assert.equal(await page.locator('.stock[data-state="match"]').count(),1);
    assert.ok((await page.locator('h1').textContent()).includes('行业龙头池'));assert.ok((await page.locator('.coverage').first().textContent()).includes('尚未接入'));assert.ok((await page.locator('#results').textContent()).includes('本地分批 3批 / 每批≤3股'));
    const beforeRequests=requests.length;
    await page.locator('.stock').first().locator('summary').click();assert.ok((await page.locator('.stock').first().textContent()).includes('左样本'));
    await page.screenshot({path:path.join(root,'evidence/ui-desktop.png'),fullPage:true});
    await page.getByRole('button',{name:'单条件开始'}).click();
    await page.locator('.group-head').first().getByRole('button',{name:'+ 分组',exact:true}).click();assert.equal(await page.locator('.group').count(),2);
    await page.locator('.group').nth(1).getByLabel('分组逻辑').selectOption('OR');
    await page.locator('.condition').first().getByLabel('条件周期').selectOption('M');
    await page.getByLabel('月线周期模式').selectOption('include_partial');
    await page.getByRole('button',{name:'运行合成筛选'}).click();
    assert.ok((await page.locator('.frame-card').last().textContent()).includes('含未完成周期'));
    await page.locator('.stock').first().locator('summary').click();assert.ok((await page.locator('.stock').first().textContent()).includes('使用未完成周期'));
    await page.locator('#budget').fill('1');await page.getByRole('button',{name:'运行合成筛选'}).click();assert.equal(await page.locator('.stock[data-state="unprocessed"]').count(),7);
    await page.locator('#budget').fill('6000');await page.locator('#symbols').fill('SH600001');
    await page.getByRole('button',{name:'运行合成筛选'}).click();assert.equal(await page.locator('.stock').count(),1);
    await page.locator('#symbols').fill('');await page.locator('#exchange').selectOption('SZ');await page.getByRole('button',{name:'运行合成筛选'}).click();assert.equal(await page.locator('.stock').count(),3);
    await page.locator('#exchange').selectOption('ALL');await page.getByRole('button',{name:'运行合成筛选'}).click();
    const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'下载本地规则'}).click();const download=await downloadEvent;await download.saveAs(path.join(root,'evidence/rule-export.synthetic.json'));
    const exported=JSON.parse(fs.readFileSync(path.join(root,'evidence/rule-export.synthetic.json'),'utf8'));assert.equal(exported.root.children.length,2);
    await page.locator('.condition').first().getByLabel('左操作数类型').selectOption('ma');
    await page.locator('.condition').first().getByLabel('样本窗口').fill('0');await page.getByRole('button',{name:'运行合成筛选'}).click();assert.ok((await page.locator('#validation').textContent()).includes('INVALID_WINDOW'));
    const security = await page.evaluate(async()=>{
      const {screen,validateRule,adaptPortableDatasets,createScreenLedger}=await import('/src/index.js');const {createMockSnapshot}=await import('/src/mock.js');
      const c=(tf='D')=>({type:'condition',id:tf,timeframe:tf,left:{kind:'field',field:'close'},op:'gt',right:{kind:'constant',value:0}}),rule=root=>({version:1,root});
      let getterCalls=0,proxyCalls=0;const r=rule(c());Object.defineProperty(r.root.right,'value',{enumerable:true,get(){getterCalls++;return 0;}});
      const getterRejected=!validateRule(r).valid;const proxy=new Proxy(r,{get(){proxyCalls++;return 0;},getPrototypeOf(){proxyCalls++;return null;},ownKeys(){proxyCalls++;return [];}});
      const proxyRejected=!validateRule(proxy).valid&&!adaptPortableDatasets(proxy).valid&&!createScreenLedger(proxy).valid;
      const plainTextAccepted=validateRule(JSON.stringify(rule(c()))).valid;
      const mixed=createMockSnapshot();mixed.stocks[0].series.W.datasetId='synthetic-RUN_B';const q=rule({type:'group',op:'AND',children:['D','W','M'].map(tf=>c(tf))});
      const mixedRejected=screen(JSON.stringify(mixed),JSON.stringify(q),JSON.stringify({symbols:['SH600001']})).rows[0].decision==='unknown';
      const unknown=createMockSnapshot();unknown.calendarVersion=unknown.stocks[0].series.D.calendarVersion='UNVERIFIED_CALENDAR_1900';unknown.stocks[0].series.D.completionEvidence={kind:'calendar',verifiedFrom:'1900-01-01',verifiedThrough:'2099-12-31'};
      const calendarRejected=screen(JSON.stringify(unknown),JSON.stringify(rule(c())),JSON.stringify({symbols:['SH600001']})).rows[0].decision==='unknown';
      return {getterRejected,getterCalls,proxyRejected,proxyCalls,plainTextAccepted,mixedRejected,calendarRejected};
    });
    assert.deepEqual(security,{getterRejected:true,getterCalls:0,proxyRejected:true,proxyCalls:0,plainTextAccepted:true,mixedRejected:true,calendarRejected:true});
    async function reviewScene(scene){
      // Keep the visible public draft and limits aligned with the diagnostic report.
      await page.getByRole('button',{name:'单条件开始'}).click();
      await page.getByLabel('月线周期模式').selectOption('completed');
      await page.locator('#symbols').fill('SH600001');
      await page.locator('.condition').first().getByLabel('阈值').fill('0');
      if(scene==='generation'){
        for(const tf of ['W','M']){
          await page.locator('.group-head').first().getByRole('button',{name:'+ 条件',exact:true}).click();
          await page.locator('.condition').last().getByLabel('条件周期').selectOption(tf);
          await page.locator('.condition').last().getByLabel('阈值').fill('0');
        }
      }
      await page.evaluate(async scene=>{
        const {screen}=await import('/src/index.js');const {createMockSnapshot}=await import('/src/mock.js');const {renderReport}=await import('/ui/app.js');
        const c=(tf='D')=>({type:'condition',id:tf,timeframe:tf,left:{kind:'field',field:'close'},op:'gt',right:{kind:'constant',value:0}}),s=createMockSnapshot();let r={version:1,root:c()};
        if(scene==='getter'){let calls=0;Object.defineProperty(r.root.right,'value',{enumerable:true,get(){calls++;return 0;}});renderReport(screen(JSON.stringify(s),r));if(calls!==0)throw Error('getter invoked');return;}
        if(scene==='generation'){s.stocks[0].series.W.datasetId='synthetic-RUN_B';r.root={type:'group',op:'AND',children:['D','W','M'].map(tf=>c(tf))};}
        if(scene==='calendar'){s.calendarVersion=s.stocks[0].series.D.calendarVersion='UNVERIFIED_CALENDAR_1900';s.stocks[0].series.D.completionEvidence={kind:'calendar',verifiedFrom:'1900-01-01',verifiedThrough:'2099-12-31'};}
        if(scene==='receipt')s.stocks[0].series.D.fetchedAt='2026-01-01T00:00:00Z';
        if(scene==='receipt-cutoff-before')s.stocks[0].series.D.completionCutoff='2026-09-28T09:59:59.999Z';
        if(scene==='receipt-cutoff-after')s.stocks[0].series.D.completionCutoff='2026-09-28T10:00:00.001Z';
        renderReport(screen(JSON.stringify(s),JSON.stringify(r),JSON.stringify({symbols:['SH600001']})));
      },scene);
      if(scene==='getter'){assert.ok((await page.locator('#validation').textContent()).includes('JSON_TEXT_REQUIRED'));return;}
      await page.locator('.stock').first().locator('summary').click();
      const expected=scene==='generation'?'DATASET_GENERATION_MISMATCH':scene==='calendar'?'COMPLETION_UNKNOWN':'RECEIPT_CLOCK_INVALID';
      assert.ok((await page.locator('.stock').first().textContent()).includes(expected));await page.screenshot({path:path.join(root,`evidence/ui-review-${scene}.png`),fullPage:true});
    }
    for(const scene of ['getter','generation','calendar','receipt','receipt-cutoff-before','receipt-cutoff-after'])await reviewScene(scene);
    const independentReceipts=await page.evaluate(async()=>{
      const {screen}=await import('/src/index.js');const {createMockSnapshot}=await import('/src/mock.js');const s=createMockSnapshot();
      for(const [tf,minute] of [['D','00'],['W','01'],['M','02']])Object.assign(s.stocks[0].series[tf],{requestStartedAt:`2026-09-28T10:${minute}:00.000Z`,completionCutoff:`2026-09-28T18:${minute}:00+08:00`,fetchedAt:`2026-09-28T10:${minute}:01Z`});
      const root={type:'group',op:'AND',children:['D','W','M'].map(tf=>({type:'condition',id:tf,timeframe:tf,left:{kind:'field',field:'close'},op:'gt',right:{kind:'constant',value:0}}))};
      return screen(JSON.stringify(s),JSON.stringify({version:1,root}),JSON.stringify({symbols:['SH600001']})).rows[0].decision;
    });assert.equal(independentReceipts,'pass');
    await page.getByRole('button',{name:'单条件开始'}).click();await page.locator('.condition').first().getByLabel('阈值').fill('0');await page.locator('#symbols').fill('');await page.locator('#budget').fill('4');
    const qualityAndBatch=await page.evaluate(async()=>{
      const {screen,createScreenLedger}=await import('/src/index.js');const {createMockSnapshot}=await import('/src/mock.js');const {createSyntheticBatchDemo}=await import('/src/mock-batches.js');const {renderReport}=await import('/ui/app.js');
      const r={version:1,root:{type:'condition',id:'D',timeframe:'D',left:{kind:'field',field:'close'},op:'gt',right:{kind:'constant',value:0}}};
      const mutations=[s=>s.coverage.missing_scheduled_session_dates={},s=>s.coverage.missing_scheduled_session_dates=null,s=>s.coverage.calendar_gaps_unverified='true',s=>s.sourceFinality='known_final',s=>s.pointInTime=true,s=>s.volumeBasis='adjusted_volume',s=>delete s.contentHash,s=>delete s.coverage.calendar_gaps_unverified];
      let closed=0;for(const mutate of mutations){const s=createMockSnapshot();mutate(s.stocks[0].series.D);const report=screen(JSON.stringify(s),JSON.stringify(r),JSON.stringify({symbols:['SH600001']}));if(report.status==='invalid'||report.rows.every(x=>x.decision==='unknown'))closed++;renderReport(report);}
      const d=createSyntheticBatchDemo(),l=createScreenLedger(JSON.stringify({...d.config,rule:r,limits:{maxProcessed:4}}));const pristine=JSON.stringify(l.finish()),altered=l.finish();altered.directory.catalogTotal=999;altered.excluded.push({symbol:'TAMPERED'});altered.frozenFrames.D.cutoffDate='2099-01-01';const reportDetached=JSON.stringify(l.finish())===pristine;let request;while(request=l.nextBatch()){const b=d.readBatch(request);if(request.batchId==='batch-2')b.manifestHash='f'.repeat(64);l.consume(JSON.stringify(b));}const report=l.finish();renderReport(report);
      return {closed,reportDetached,state:report.status,total:report.counts.total,processed:report.counts.processed,failed:report.counts.failure,unprocessed:report.counts.unprocessed};
    });assert.deepEqual(qualityAndBatch,{closed:8,reportDetached:true,state:'budget_exhausted',total:8,processed:4,failed:1,unprocessed:4});
    assert.ok((await page.locator('#results').textContent()).includes('BATCH_FREEZE_MISMATCH'));await page.screenshot({path:path.join(root,'evidence/ui-review-batch-freeze.png'),fullPage:true});
    assert.equal(requests.length,beforeRequests,'规则编辑/执行/下载应不发网络请求');assert.ok(requests.every(r=>r.method==='GET'&&r.url.startsWith(`http://127.0.0.1:${port}/`)));assert.deepEqual(errors,[]);
    await page.getByRole('button',{name:'波段示例'}).click();await page.locator('#symbols').fill('');await page.locator('#budget').fill('8');await page.getByRole('button',{name:'运行合成筛选'}).click();
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'evidence/ui-mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'手机布局不应横向溢出');
    const report={synthetic:true,checks:['default reconciliation','per-condition evidence','nested OR editing','month condition','partial month flag','processing budget','symbol restriction','exchange restriction','local JSON download','invalid window rejected','zero requests after initial load','no page errors','mobile without horizontal overflow','browser getter rejection with zero calls','browser Proxy rejection with zero traps','JSON text rules accepted','mixed generation rejected','unknown calendar rejected','UI renders input rejection','UI renders generation mismatch','UI renders unknown calendar','UI renders receipt chronology failure','UI rejects cutoff before per-series request','UI rejects cutoff after per-series request','equivalent ISO instants and independent D/W/M receipts accepted','explicit synthetic leaders pool label','pool provenance and unavailable real universe visible','UI uses three bounded synthetic batches','ledger rejects browser Proxy without traps','eight quality metadata counterexamples closed without UI errors','cross-batch freeze rejection plus cumulative budget reconciliation','finish nested metadata mutation leaves browser ledger and subsequent consume unchanged'],security,independentReceipts,qualityAndBatch,pass:32,fail:0,initialRequests:beforeRequests,subsequentRequests:requests.length-beforeRequests};
    fs.writeFileSync(path.join(root,'evidence/browser-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
  }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
