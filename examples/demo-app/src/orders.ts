import { cartTotal } from './cart.js';

export function reorder(): string {
  return `reorder:${cartTotal()}`;
}
