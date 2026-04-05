import { describe, it, expect } from 'vitest';
import { maps} from '../../src/state/appState';
import { drawClick, drawComplete } from '../../src/map/drawSession';
import { findSectorAt, setSectorProperty, expectMapIsValid, dumpMapJSON } from './setup';

describe('islandInheritsWaterProps', () => {
  it('should produce correct map state', async () => {
    await drawClick(-240, 272);
    await drawClick(208, 256);
    await drawClick(272, -160);
    await drawClick(-224, -144);
    await drawComplete();
    setSectorProperty(findSectorAt(4, 56)!, 'floorTex', 'NUKAGE1');
    await drawClick(-64, 144);
    await drawClick(64, 112);
    await drawClick(-32, 16);
    await drawComplete();
    dumpMapJSON('islandinheritswaterprops');

    for (const [sid, sector] of maps.sectors) {
      expect(sector.floorTex, `sector ${sid} should have floorTex NUKAGE1`).toBe('NUKAGE1');
    }

    expectMapIsValid();
  });
});
