import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createOrder,applyVerifiedEvent,remainingCredits,consumeStatement} from '../ledger.mjs';
const db=new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
db.exec(readFileSync(new URL('../migrations/0001_billing.sql',import.meta.url),'utf8'));
class MockD1 {
 prepare(q){return {bind:(...a)=>{const stmt=db.prepare(q);return {run:async()=>({meta:{changes:stmt.run(...a).changes}}),first:async()=>stmt.get(...a)||null,exec:()=>stmt.run(...a)}}}}
 async batch(a){db.exec('BEGIN IMMEDIATE');try{const r=a.map(x=>({meta:{changes:x.exec().changes}}));db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}
}
function assert(ok,message){if(!ok)throw Error(message)}
const d1=new MockD1(), id='order_test_00001', uid='user_test_00001';
db.prepare('INSERT INTO app_users(id) VALUES(?)').run(uid);
await createOrder(d1,{id,userId:uid,amountMinor:490,currency:'USD'});
assert(await remainingCredits(d1,uid)===0,'pending must not grant credits');
const paid={eventId:'event_paid_001',orderId:id,kind:'paid'};
assert((await applyVerifiedEvent(d1,paid)).duplicate===false,'first event new');
assert((await applyVerifiedEvent(d1,paid)).duplicate===true,'replayed event duplicate');
assert(await remainingCredits(d1,uid)===20,'expected 20 credits');
const use=db.prepare(consumeStatement);
for(let i=0;i<20;i++)assert(use.run(uid,uid).changes===1,'spend failed '+i);
assert(use.run(uid,uid).changes===0,'overspend was allowed');
await applyVerifiedEvent(d1,{eventId:'event_refund_001',orderId:id,kind:'refunded'});
assert(await remainingCredits(d1,uid)===0,'refund must revoke');
await applyVerifiedEvent(d1,{eventId:'event_paid_late',orderId:id,kind:'paid'});
assert(db.prepare('SELECT state FROM orders WHERE id=?').get(id).state==='refunded','late success must not reactivate');
let rejected=false;try{await applyVerifiedEvent(d1,{eventId:'event_paid_001',orderId:id,kind:'chargeback'})}catch{rejected=true}
assert(rejected,'conflicting ID must reject');
rejected=false;try{await applyVerifiedEvent(d1,{eventId:'event_unknown_01',orderId:'unknown_order_01',kind:'paid'})}catch{rejected=true}
assert(rejected,'unknown order must reject');
console.log('PASSED: D1-shaped SQLite billing ledger, 20 redemptions, idempotent webhook, refunds, late success and unknown order rejection');
