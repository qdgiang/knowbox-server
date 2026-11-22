const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {chromium} = require('playwright');

const launch = process.env.KNOWBOX_TEST_URL || readFileSync('/checks/launch.private', 'utf8').trim();
const origin = new URL(launch).origin;
const mode = process.argv[2];

(async () => {
  const browser = await chromium.launch({args:['--no-sandbox']});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (process.env.KNOWBOX_BROWSER_DEBUG) {
      page.on('console', message => console.log(message.type(),message.text()));
      page.on('requestfailed', request => console.log('request failed',new URL(request.url()).pathname,request.failure()?.errorText));
    }
    await page.goto(launch);
    await page.getByRole('heading',{name:mode === 'gateway' ? /notes? in \d+ domains?/ : /note in 1 domain/}).waitFor();
    if (mode === 'gateway') {
      const capability = await page.request.get(origin + '/api/capabilities');
      const report = await capability.json();
      assert.equal(report.api_version,1);
      assert.equal(report.writable,false);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('knowbox.explorer.token')),null);
      assert.equal(await page.getByText('Read-only',{exact:true}).isVisible(),true);
      assert.equal(await page.getByRole('link',{name:'Editor',exact:true}).count(),0);
      assert.equal((await page.request.post(origin + '/api/write',{data:{}})).status(),405);
      await page.getByRole('link',{name:'Search',exact:true}).click();
      await page.getByRole('heading',{name:'Search the knowbox'}).waitFor();
    } else if (mode === 'read') {
      assert.equal(await page.getByText('Read-only',{exact:true}).isVisible(),true);
      assert.equal(await page.getByRole('link',{name:'Editor',exact:true}).count(),0);
      await page.goto(origin + '/n/kb-0001');
      await page.getByRole('heading',{name:'Initial note'}).waitFor();
      assert.equal(await page.getByRole('link',{name:'Edit note'}).count(),0);
      const other = await browser.newPage();
      await other.goto(origin);
      await other.getByRole('heading',{name:'Open the Explorer from your terminal'}).waitFor();
      await other.close();
    } else {
      await page.goto(origin + '/n/kb-0001');
      await page.getByRole('link',{name:'Edit note'}).click();
      await page.getByRole('heading',{name:'Edit kb-0001'}).waitFor();
      await page.getByRole('button',{name:'Raw source'}).click();
      assert.match(await page.getByLabel('Complete Markdown source').inputValue(),/^---\nid: kb-0001/m);
      await page.getByRole('button',{name:'Show fields'}).click();
      await page.getByLabel('Summary',{exact:true}).fill('Edited in Chromium');
      await page.getByLabel('Markdown body').fill('Original claim.\n\nBrowser supporting details.\n\n<script>window.previewScriptRan = true</script>');
      await page.getByText('Browser supporting details.',{exact:true}).waitFor();
      assert.equal(await page.evaluate(() => window.previewScriptRan),undefined);
      await page.getByRole('button',{name:'Save changes'}).click();
      await page.getByRole('link',{name:'Open kb-0001'}).click();
      await page.getByText('Edited in Chromium',{exact:true}).waitFor();
      await page.goto(origin + '/review?queue=inbox');
      await page.getByRole('link',{name:'Ingest as new note'}).click();
      await page.getByRole('heading',{name:'Create a note'}).waitFor();
      await page.getByLabel('Domain',{exact:true}).fill('fixture');
      await page.getByLabel('Summary',{exact:true}).fill('Ingested from browser');
      await page.getByLabel('Related IDs',{exact:true}).fill('kb-0001');
      await page.getByRole('button',{name:'Create note'}).click();
      await page.getByRole('link',{name:'Open kb-0002'}).waitFor();
      await page.goto(origin + '/review?queue=inbox');
      await page.getByText('No open proposals.',{exact:true}).waitFor();
      await page.goto(origin + '/n/kb-0001');
      await page.getByRole('link',{name:'Edit note'}).click();
      const body = page.getByLabel('Markdown body');
      await body.fill('Original claim.\n\nLocal draft competing with another writer.');
      const cookieToken = await page.evaluate(() => sessionStorage.getItem('knowbox.explorer.token'));
      const header = {Authorization:'Bearer ' + cookieToken};
      const source = await (await page.request.get(origin + '/api/editor?target=kb-0001',{headers:header})).json();
      const external = await page.request.post(origin + '/api/write',{
        headers:{...header,Origin:origin},
        data:{request_id:'competing-edit',operation:{action:'edit',selector:source.path,base_sha1:source.base_sha1,
          input:{format:'patch',fields:{summary:'Competing writer summary'}}}}
      });
      assert.equal(external.status(),200,await external.text());
      await page.getByRole('button',{name:'Save changes'}).click();
      await page.getByText('The note changed while you edited it',{exact:true}).waitFor();
      await page.getByRole('heading',{name:'Your draft'}).waitFor();
      await page.getByRole('heading',{name:'Current note'}).waitFor();
      assert.match(await body.inputValue(),/Local draft competing/);
      const fillStandalone = async () => {
        await page.goto(origin + '/editor');
        await page.getByLabel('Title',{exact:true}).fill('Pending browser save');
        await page.getByLabel('Domain',{exact:true}).fill('fixture');
        await page.getByLabel('Summary',{exact:true}).fill('Reopen after the response is lost');
        await page.getByLabel('Markdown body').fill('Saved once despite a dropped response.');
      };
      await fillStandalone();
      await page.route('**/api/write', async route => {
        const committed = await route.fetch();
        assert.equal(committed.status(),200,await committed.text());
        await route.abort();
      },{times:1});
      await page.getByRole('button',{name:'Create note'}).click();
      await page.getByRole('button',{name:'Retry the same save'}).waitFor();
      await fillStandalone();
      await page.getByRole('button',{name:'Create note'}).click();
      await page.getByRole('link',{name:'Open kb-0003'}).waitFor();
      await page.getByText('Recovered the earlier save', {exact:false}).waitFor();
      const inventory = await (await page.request.get(origin + '/api/list',{headers:header})).json();
      assert.equal(inventory.notes.length,3);
    }
    const insights = page.getByRole('link',{name:'Insights',exact:true});
    if (await insights.count()) {
      await insights.first().click();
      await page.getByRole('heading',{name:'Knowledge map'}).waitFor();
      await page.getByLabel('Knowledge map',{exact:true}).waitFor();
      if (mode === 'read') {
        await page.getByLabel('Knowledge map',{exact:true}).locator('a').first().click();
        await page.getByRole('heading',{name:'Initial note'}).waitFor();
        await insights.first().click();
      }
      await page.getByRole('link',{name:'Time',exact:true}).click();
      await page.getByRole('heading',{name:'Vital signs'}).waitFor();
      await page.getByText(mode === 'gateway' ? /Measured from|No daily measurements yet/ : /Measured from/).first().waitFor();
      await page.getByRole('link',{name:'Flow',exact:true}).click();
      await page.getByRole('heading',{name:'How searches get answered'}).waitFor();
      await page.getByRole('link',{name:'Agent',exact:true}).click();
      await page.getByLabel('Project',{exact:true}).fill('fixture');
      await page.getByLabel('Host',{exact:true}).fill('test-host');
      await page.getByRole('button',{name:'Show brief'}).click();
      await page.getByRole('heading',{name:'Session-start brief'}).waitFor();
      await page.getByText(/\/ 9000 characters/).waitFor();
      if (mode === 'write') {
        const selector = page.getByLabel('Search note triggers');
        await selector.fill('an unfinished trigger query');
        const node = await selector.elementHandle();
        const token = await page.evaluate(() => sessionStorage.getItem('knowbox.explorer.token'));
        const headers = {Authorization:'Bearer ' + token};
        const source = await (await page.request.get(origin + '/api/editor?target=kb-0001',{headers})).json();
        const changed = await page.request.post(origin + '/api/write',{
          headers:{...headers,Origin:origin},
          data:{request_id:'agent-view-refresh',operation:{action:'edit',selector:source.path,base_sha1:source.base_sha1,
            input:{format:'patch',fields:{triggers:'[an unfinished trigger query]'}}}}
        });
        assert.equal(changed.status(),200,await changed.text());
        await page.waitForFunction(old => !old.isConnected,node,{timeout:12000});
        assert.equal(await selector.inputValue(),'an unfinished trigger query');
        await page.getByText('an unfinished trigger query',{exact:true}).waitFor();
      }
      if (mode === 'read') {
        await page.goto(origin + '/n/kb-0001');
        const framed = page.frameLocator('iframe[title="Mermaid diagram"]');
        await framed.getByRole('img',{name:'Mermaid diagram'}).waitFor();
        assert.equal(await page.locator('iframe.mermaid-frame').getAttribute('sandbox'),'allow-scripts');
        assert.equal(await page.locator('pre:has(code.language-mermaid)').first().isVisible(),false);
        await page.getByRole('link',{name:'Source',exact:true}).click();
        await page.getByText(/flowchart LR/).waitFor();
      }
    }
    assert.deepEqual(errors,[]);
    console.log('Chromium ' + mode + ' checks passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
