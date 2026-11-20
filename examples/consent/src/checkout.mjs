/** The checkout: a cart becomes an order. docs/spec.md states what it does. */
export function checkout(cart, user) {
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  return { user: user.id, total };
}
