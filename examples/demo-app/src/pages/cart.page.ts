import { addItem, cartTotal } from '../cart.js';
import { renderShell } from '../shell.js';

globalThis.app = { addItem, cartTotal };
document.body.innerHTML = renderShell('Cart');
export {};
