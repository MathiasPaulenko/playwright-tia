import { addItem } from '../cart.js';
import { reorder } from '../orders.js';
import { renderShell } from '../shell.js';

globalThis.app = { addItem, reorder };
document.body.innerHTML = renderShell('Orders');
export {};
