import assert from "node:assert/strict";
import { test } from "node:test";
import { checkout } from "../src/checkout.mjs";

const user = { id: "u1", email: "ada@example.com" };

test("totals each item's price times its quantity", () => {
  const cart = [{ price: 250, qty: 2 }, { price: 100, qty: 1 }];
  assert.deepEqual(checkout(cart, user), { user: "u1", total: 600 });
});

test("an empty cart totals 0", () => {
  assert.equal(checkout([], user).total, 0);
});
