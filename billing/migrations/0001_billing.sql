-- SQLite/D1 billing ledger only. NOT an authentication or Pancake checkout implementation.
CREATE TABLE IF NOT EXISTS app_users (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 8 AND 100)
) STRICT;
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 8 AND 100),
 user_id TEXT NOT NULL REFERENCES app_users(id),
 product_code TEXT NOT NULL CHECK(product_code IN ('batch_20')),
 amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
 currency TEXT NOT NULL CHECK(length(currency)=3),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','paid','refunded','chargeback'))
) STRICT;
CREATE TABLE IF NOT EXISTS payment_events (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 8 AND 150),
 order_id TEXT NOT NULL REFERENCES orders(id),
 event_kind TEXT NOT NULL CHECK(event_kind IN ('paid','refunded','chargeback')),
 fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),
 processed_at TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS credits (
 order_id TEXT PRIMARY KEY REFERENCES orders(id),
 user_id TEXT NOT NULL REFERENCES app_users(id),
 granted INTEGER NOT NULL CHECK(granted >= 0),
 consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed >= 0),
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
 CHECK(consumed <= granted)
) STRICT;
CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS credits_user ON credits(user_id,revoked);
