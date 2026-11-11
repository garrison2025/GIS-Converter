/** Backend-only D1 ledger. Never use directly as a webhook endpoint.
 * Pancake signatures, amount, currency, environment and merchant MUST be verified upstream.
 * $4.90 is an unapproved sandbox test price, not an active merchant listing.
 */
const catalog=Object.freeze({batch_20:{price:490,currency:'USD',credits:20}});
function valid(s,name){if(typeof s!=='string'||!(/^[A-Za-z0-9_.:-]{8,150}$/).test(s))throw Error('Invalid '+name)}
export async function createOrder(db,{id,userId,amountMinor,currency}){
 valid(id,'order ID');valid(userId,'user ID');
 if(amountMinor!==catalog.batch_20.price||currency!==catalog.batch_20.currency)throw Error('Catalog mismatch');
 return db.prepare('INSERT INTO orders(id,user_id,product_code,amount_minor,currency) VALUES (?,?,?,?,?)')
  .bind(id,userId,'batch_20',amountMinor,currency).run();
}
export async function applyVerifiedEvent(db,{eventId,orderId,kind}){
 valid(eventId,'event ID');valid(orderId,'order ID');
 if(!['paid','refunded','chargeback'].includes(kind))throw Error('Invalid status');
 const bytes=new TextEncoder().encode(JSON.stringify({eventId,orderId,kind}));
 const digest=await crypto.subtle.digest('SHA-256',bytes);
 const fingerprint=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
 const old=await db.prepare('SELECT fingerprint FROM payment_events WHERE id=?').bind(eventId).first();
 if(old&&old.fingerprint!==fingerprint)throw Error('Event ID collision');
 const order=await db.prepare('SELECT id,product_code FROM orders WHERE id=?').bind(orderId).first();
 if(!order||!catalog[order.product_code])throw Error('Unknown order');
 const stmts=[
 ['INSERT OR IGNORE INTO payment_events(id,order_id,event_kind,fingerprint) VALUES(?,?,?,?)',[eventId,orderId,kind,fingerprint]],
 ["UPDATE orders SET state=CASE WHEN ?='paid' AND state='pending' THEN 'paid' WHEN ?='refunded' AND state IN ('pending','paid') THEN 'refunded' WHEN ?='chargeback' AND state IN ('pending','paid','refunded') THEN 'chargeback' ELSE state END WHERE id=? AND EXISTS(SELECT 1 FROM payment_events WHERE id=? AND processed_at IS NULL)",[kind,kind,kind,orderId,eventId]],
 ["INSERT OR IGNORE INTO credits(order_id,user_id,granted) SELECT id,user_id,? FROM orders WHERE id=? AND state='paid' AND EXISTS(SELECT 1 FROM payment_events WHERE id=? AND processed_at IS NULL AND event_kind='paid')",[catalog.batch_20.credits,orderId,eventId]],
 ["UPDATE credits SET revoked=1 WHERE order_id=? AND EXISTS(SELECT 1 FROM payment_events WHERE id=? AND processed_at IS NULL AND event_kind IN ('refunded','chargeback'))",[orderId,eventId]],
 ["UPDATE payment_events SET processed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND processed_at IS NULL",[eventId]]
 ];
 const result=await db.batch(stmts.map(([s,p])=>db.prepare(s).bind(...p)));
 return {duplicate:result[0].meta.changes===0,eventId};
}
export async function remainingCredits(db,userId){
 valid(userId,'user ID');
 const r=await db.prepare('SELECT COALESCE(SUM(granted-consumed),0) AS remaining FROM credits WHERE user_id=? AND revoked=0').bind(userId).first();
 return r?.remaining??0;
}
export const consumeStatement="UPDATE credits SET consumed=consumed+1 WHERE order_id=(SELECT order_id FROM credits WHERE user_id=? AND revoked=0 AND consumed<granted ORDER BY order_id LIMIT 1) AND user_id=? AND revoked=0 AND consumed<granted";
