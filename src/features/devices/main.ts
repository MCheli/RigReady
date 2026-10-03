import { bind, defineFeatureMain } from '../../core/feature';
import { devicesContract } from './contract';
import { deviceCapture, deviceConnectedCheck } from './core/deviceCheck';

export default defineFeatureMain({
  id: 'devices',
  setup(ctx) {
    ctx.checks.registerCheck(deviceConnectedCheck);
    ctx.checks.registerCapture(deviceCapture);
    return [
      bind(devicesContract, {
        list: () => ctx.ports.devices.list(),
      }),
    ];
  },
});
