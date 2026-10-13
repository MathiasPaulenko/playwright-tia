import { cartTotal } from './cart.js';

export function checkout(): string {
  const total = cartTotal();
  return total > 0 ? `checked-out:${total}` : 'empty-cart';
}
