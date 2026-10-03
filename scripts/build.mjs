import {mkdirSync,copyFileSync,rmSync} from 'node:fs';
import './build-condition-assets.mjs';
rmSync('dist',{recursive:true,force:true});mkdirSync('dist/server',{recursive:true});copyFileSync('src/worker.mjs','dist/server/index.js');

copyFileSync('src/page.mjs','dist/server/page.mjs');
copyFileSync('src/condition-screen-page.mjs','dist/server/condition-screen-page.mjs');
copyFileSync('src/condition-screen-assets.mjs','dist/server/condition-screen-assets.mjs');

copyFileSync('src/quote-routing.mjs','dist/server/quote-routing.mjs');

copyFileSync('src/history-routing.mjs','dist/server/history-routing.mjs');

copyFileSync('src/auction-routing.mjs','dist/server/auction-routing.mjs');

for(const name of ['public-xlsx','public-mainboard-directory','mainboard-universe','mainboard-screening-page','hithink-redaction','stock-directory','stock-directory-page','swing-screening','swing-screening-page','version','market-session','data-integrity','market-context','auction-quality','sector-context','security-fields','context-fetch','stock-context','stock-search','public-profile'])copyFileSync('src/'+name+'.mjs','dist/server/'+name+'.mjs');
