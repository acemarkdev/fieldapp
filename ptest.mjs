import { can as sharedCan } from './packages/shared/src/permissions.ts';
import { can as mobileCan } from './apps/mobile/src/lib/permissions.ts';
const checks = [
  ['surveyor','jobs.manage',false],['surveyor','items.create',true],['surveyor','items.fit',false],
  ['scanner','items.create',true],['scanner','items.edit',false],
  ['fitter','items.fit',true],['fitter','items.create',false],['fitter','items.edit',false],['fitter','snags.raise',true],
  ['office','jobs.manage',true],['office','users.manage',false],['admin','users.manage',true],
];
let ok=true;
for (const [role,cap,exp] of checks){
  const s=sharedCan(role,cap);
  if(s!==exp){ok=false;console.log('SHARED FAIL',role,cap,'got',s,'want',exp);}
  if(['jobs.manage','items.create','items.edit','items.fit','snags.raise','photos.add'].includes(cap)){
    const m=mobileCan(role,cap);
    if(m!==exp){ok=false;console.log('MOBILE FAIL',role,cap,'got',m,'want',exp);}
  }
}
console.log(ok?'ALL MATRIX CHECKS PASS':'CHECKS FAILED');
