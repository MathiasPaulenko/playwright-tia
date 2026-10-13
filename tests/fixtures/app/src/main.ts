import { alpha } from './alpha.js';
import { beta } from './beta.js';
import { fakeUtil } from 'fakepkg';

export function boot(): string {
  return [alpha(), beta(), fakeUtil()].join('|');
}
