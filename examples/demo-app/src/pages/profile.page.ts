import { greeting } from '../profile.js';
import { renderShell } from '../shell.js';

globalThis.app = { greeting };
document.body.innerHTML = renderShell('Profile');
export {};
