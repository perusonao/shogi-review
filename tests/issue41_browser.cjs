const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const before = process.argv.includes('--before');
const out = path.join(root, 'docs/reports/issue41');
const server = http.createServer((req,res) => {
  const filename = path.join(root, decodeURIComponent(new URL(req.url,'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url,'http://localhost').pathname));
  if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(filename,(error,data) => {
    if(error) {res.writeHead(404).end();return;}
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json'})[path.extname(filename)] || 'text/plain');res.end(data);
  });
});
(async () => {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({channel:'msedge',headless:true});
  const results = [];
  try {
    for (const [width,height] of [[390,844],[360,800]]) {
      const page = await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:1});
      const errors=[];page.on('pageerror', e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(()=>window.shogiRecentSummaries && document.querySelector('.preGamePriority'));
      const prefix = `${before?'before':'after'}-${width}x${height}`;
      await page.screenshot({path:path.join(out,`${prefix}-home.png`)});
      await page.locator('.tab[data-v="games"]').click();
      await page.screenshot({path:path.join(out,`${prefix}-games-top.png`)});
      if (!before) {
        await page.mouse.move(width / 2, height / 2);
        await page.mouse.wheel(0, 600);
        await page.waitForFunction(()=>document.querySelector('#games').scrollTop>0);
      }
      await page.evaluate(()=>document.querySelector('#games').scrollTop=100000);
      await page.screenshot({path:path.join(out,`${prefix}-games-bottom.png`)});
      const metrics=await page.evaluate(()=>{
        const games=document.querySelector('#games'),last=document.querySelector('.gameRow:last-child'),nav=document.querySelector('.tabs');
        return {count:document.querySelectorAll('.gameRow').length,label:document.querySelector('#gameCount').textContent,scrollTop:games.scrollTop,clientHeight:games.clientHeight,scrollHeight:games.scrollHeight,lastBottom:last.getBoundingClientRect().bottom,navTop:nav.getBoundingClientRect().top,overflow:getComputedStyle(games).overflowY};
      });
      results.push({width,height,...metrics});
      if (!before) {
        assert.equal(metrics.count,JSON.parse(fs.readFileSync(path.join(root,'games/index.json'))).games.length);
        assert.equal(metrics.label,`全${metrics.count}局`);
        assert(metrics.scrollTop>0);assert(metrics.lastBottom<=metrics.navTop);assert.equal(metrics.overflow,'auto');
        await page.locator('.gameRow').last().click();
        await page.waitForFunction(()=>document.querySelector('#reviewView.active') && currentGameId===catalog.at(-1).id);
        await page.locator('.tab[data-v="home"]').click();
        const originalCard=await page.locator('#preGameCoach').textContent();
        assert(!await page.locator('#home #growthDashboard').count());
        assert.equal(await page.locator('.preGamePriority').count(),1);
        const card=await page.evaluate(()=>{
          const model=ShogiPreGameCoach.buildModel(ShogiGrowthDashboard.buildModel(shogiRecentRecords,shogiRecentSummaries[10]).currentTasks,shogiRecentSummaries[10]);
          return {headline:model.focusView.headline,action:model.focusView.action,reason:model.focusView.reason};
        });
        assert.equal(await page.locator('.preGamePriority').textContent(),card.headline);
        assert.equal(await page.locator('.preGameAction p').textContent(),card.action);
        assert.equal(await page.locator('.preGameReason p').textContent(),card.reason);
        assert(await page.evaluate(()=>document.querySelector('#home').scrollWidth<=document.querySelector('#home').clientWidth));
        await page.locator('#preGameCoach button').click();
        await page.waitForFunction(()=>document.querySelector('#reviewView.active'));
        const target=await page.evaluate(()=>({id:currentGameId,ply}));
        const expected=await page.evaluate(()=>ShogiPreGameCoach.buildModel(ShogiGrowthDashboard.buildModel(shogiRecentRecords,shogiRecentSummaries[10]).currentTasks,shogiRecentSummaries[10]).focus.task);
        assert.equal(target.id,expected.sourceGame);assert.equal(target.ply,expected.sourcePly);
        await page.locator('.tab[data-v="analysis"]').click();
        assert(await page.locator('#analysis #growthDashboard').count());
        await page.getByRole('button',{name:'直近30局に切替',exact:true}).click();
        assert.equal(await page.locator('#preGameCoach').textContent(),originalCard);
        await page.evaluate(()=>renderPreGameCoach([],null));
        assert.match(await page.locator('#preGameCoach').textContent(),/次の解析/);
        await page.evaluate(()=>{catalog=[...catalog,...catalog.slice(0,11).map((g,i)=>({...g,id:`fixture-${i}`}))];renderGameList();showView('games');document.querySelector('#games').scrollTop=100000;});
        assert.equal(await page.locator('.gameRow').count(),101);
        assert.equal(await page.locator('#gameCount').innerText(),'全101局');
        assert(await page.evaluate(()=>document.querySelector('.gameRow:last-child').getBoundingClientRect().bottom<=document.querySelector('.tabs').getBoundingClientRect().top));
        for (const view of ['home','reviewView','submitView','analysis']) {
          const valid=await page.evaluate(id=>{showView(id);const e=document.getElementById(id);return getComputedStyle(e).overflowY==='auto'&&e.getBoundingClientRect().bottom<=document.querySelector('.tabs').getBoundingClientRect().top;},view);
          assert(valid,view);
        }
        // Chromium desktop reports zero safe-area inset. Exercise the same CSS
        // with a simulated 34px inset; this is not a physical iPhone Safari test.
        await page.evaluate(()=>{
          for (const style of document.querySelectorAll('style')) style.textContent=style.textContent.replaceAll('env(safe-area-inset-bottom)','34px');
          showView('games');document.querySelector('#games').scrollTop=100000;
        });
        assert(await page.evaluate(()=>document.querySelector('.gameRow:last-child').getBoundingClientRect().bottom<=document.querySelector('.tabs').getBoundingClientRect().top));
        assert.deepEqual(errors,[]);
      }
      await page.close();
    }
    fs.writeFileSync(path.join(out,`${before?'before':'after'}-metrics.json`),JSON.stringify(results,null,2)+'\n');
    console.log(JSON.stringify(results,null,2));
  } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
