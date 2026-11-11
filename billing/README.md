# P10 billing simulation

This module is adapted from the P10 offline ledger and **has no public payment endpoint**. It is safe to run locally for SQL invariants only. Pancake (Waffo) signature verification, actual order API, subscriptions, user login, real Cloudflare D1 migration and live payments are NOT implemented. Do not publish as a payment product.

Test with `node --experimental-sqlite billing/tests/test_d1_adapter.mjs`.
