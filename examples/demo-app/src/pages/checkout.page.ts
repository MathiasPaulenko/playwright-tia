import { addItem } from '../cart.js';
import { checkout } from '../checkout.js';
import { renderShell } from '../shell.js';

globalThis.app = { addItem, checkout };
document.body.innerHTML = renderShell('Checkout');
export {};
