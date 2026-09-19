/** Validate the one opt-in presentation setting on both plugin faces. */
export function enabled(config = {}) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('dsh-web-low-motion: config must be an object');
  }
  if (Object.keys(config).some(key => key !== 'enabled')) {
    throw new TypeError('dsh-web-low-motion: only config.enabled is supported');
  }
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
    throw new TypeError('dsh-web-low-motion: enabled must be a boolean');
  }
  return config.enabled ?? true;
}
