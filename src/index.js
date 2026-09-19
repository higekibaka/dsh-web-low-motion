import { enabled } from './config.js';

export const name = 'web-low-motion';

/** Host companion validates configuration; it changes no Host services. */
export function apply(_ctx, config) {
  enabled(config);
}
