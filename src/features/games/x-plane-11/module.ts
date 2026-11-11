import { xPlane } from '../x-plane-12/xplane';

/** X-Plane 11 (Steam app 269950, or the standalone install). See ../x-plane-12/xplane.ts. */
const { module, extras } = xPlane(11, '269950');

export { extras };
export default module;
