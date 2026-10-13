// Run: npx tsx apps/api/src/manuals.test.ts
import { MANUALS, MANUAL_IMAGES, manualHtml, manualPage, manualsFor } from './manuals';

let fail = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { fail++; console.error('✗ ' + name, got === undefined ? '' : JSON.stringify(got)); } };

// Markdown → HTML
ok('headings', manualHtml('# A\n\n## B\n\n### C') === '<h1>A</h1>\n<h2>B</h2>\n<h3>C</h3>');
ok('paragraph lines join, bold and italic', manualHtml('one **two**\nthree *four*') === '<p>one <b>two</b> three <i>four</i></p>', manualHtml('one **two**\nthree *four*'));
ok('html is escaped everywhere', manualHtml('<script>x</script> **<b>**\n\n| <i> |\n\n- <u>') === '<p>&lt;script&gt;x&lt;/script&gt; <b>&lt;b&gt;</b></p>\n<div class="mtw"><table><tbody><tr><td>&lt;i&gt;</td></tr></tbody></table></div>\n<ul><li>&lt;u&gt;</li></ul>', manualHtml('<script>x</script> **<b>**\n\n| <i> |\n\n- <u>'));
ok('numbered and bullet lists', manualHtml('1. a\n2. b\n\n- c\n- d') === '<ol><li>a</li><li>b</li></ol>\n<ul><li>c</li><li>d</li></ul>');
ok('a list ends the paragraph before it', manualHtml('Steps:\n1. a') === '<p>Steps:</p>\n<ol><li>a</li></ol>');
ok('table with a header row', manualHtml('| A | B |\n| --- | --- |\n| 1 | **2** |') === '<div class="mtw"><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td><b>2</b></td></tr></tbody></table></div>');
ok('image + caption', manualHtml('![Lista "x"](jc1.png)\n\n*Zrzut.*') === '<figure><img loading="lazy" alt="Lista &quot;x&quot;" src="/api/manual-image/jc1.png"></figure>\n<p class="cap">Zrzut.</p>', manualHtml('![Lista "x"](jc1.png)\n\n*Zrzut.*'));
ok('an image may only name a plain png file', !manualHtml('![x](../secret.png)').includes('<img') && !manualHtml('![x](http://e.com/a.png)').includes('<img') && !manualHtml('![x](a.png" onerror="x)').includes('<img'));

// Who sees which manual
const keys = (caps: string[]) => manualsFor((c) => caps.includes(c)).map((m) => m.key).join(',');
ok('finance sees all three', keys(['finops.view', 'sales.orders']) === 'job-costs,sales,orders');
ok('a sales rep sees only the orders manual', keys(['sales.orders']) === 'orders');
ok('no Fin&Ops capability, no manuals', keys(['items.view']) === '');

// The real files: every manual renders, and every picture it shows exists
for (const m of MANUALS) {
  const html = manualPage(m);
  ok(m.key + ' renders with a title and sections', html.startsWith('<h1>') && (html.match(/<h2>/g) || []).length >= 5, html.slice(0, 80));
  ok(m.key + ' leaves no raw markdown behind', !/\*\*|^#|\]\(|^\|/m.test(html), (html.match(/.*(\*\*|\]\().*/) || [])[0]);
  const imgs = [...html.matchAll(/src="\/api\/manual-image\/([^"]+)"/g)].map((x) => x[1]);
  ok(m.key + ' has screenshots and all exist', imgs.length >= 2 && imgs.every((f) => MANUAL_IMAGES.has(f)), imgs);
}
ok('no unused screenshots', [...MANUAL_IMAGES].every((f) => MANUALS.some((m) => manualPage(m).includes('/' + f + '"'))), [...MANUAL_IMAGES]);

if (fail) { console.error(fail + ' failed'); process.exit(1); }
console.log('manuals: all passed');
