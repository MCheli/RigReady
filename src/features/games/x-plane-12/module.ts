import { xPlane } from './xplane';

/** X-Plane 12 (Steam app 2014780, or the standalone install). See ./xplane.ts. */
const { module, extras } = xPlane(12, '2014780');

export { extras };
export default module;
