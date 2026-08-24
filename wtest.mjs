import { WINDOW_STYLES } from './apps/mobile/src/lib/windowStyles.ts';
const types=['window','door','tilt'];
for (const t of types){
  for (const L of [1,2,3]){
    const n=WINDOW_STYLES.filter(s=>s.type===t && (L===3? s.lights>=3 : s.lights===L)).length;
    process.stdout.write(`${t}/${L===3?'3+':L}=${n}  `);
  }
  console.log();
}
// ranking sort stable-ish
const counts={'Style 3':5,'Style 1':2};
const base=WINDOW_STYLES.filter(s=>s.type==='window'&&s.lights===1);
const sorted=[...base].sort((a,b)=>(counts[b.number]??0)-(counts[a.number]??0));
console.log('ranked 1-light window:', sorted.map(s=>s.number).join(' > '));
console.log('total styles:', WINDOW_STYLES.length, '| any empty lines drawn as frame-only:', WINDOW_STYLES.filter(s=>s.lines.length===0).map(s=>s.number).join(','));
