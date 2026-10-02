import { Scene } from 'foldkit';
import { describe, it } from 'vitest';
import { init, update, view } from './app.gtsx';

describe('Foldkit views written in gtsx', () => {
  it('routes interactions through the correct submodel boundary', () => {
    Scene.scene(
      { update, view },
      Scene.given(init().model),
      Scene.inside(
        Scene.role('region', { name: 'Left counter' }),
        Scene.click(Scene.role('button', { name: 'Increment' })),
        Scene.click(Scene.role('button', { name: 'Increment' })),
        Scene.expect(Scene.role('status')).toHaveText('2'),
      ),
      Scene.inside(
        Scene.role('region', { name: 'Right counter' }),
        Scene.expect(Scene.role('status')).toHaveText('0'),
        Scene.click(Scene.role('button', { name: 'Decrement' })),
        Scene.expect(Scene.role('status')).toHaveText('-1'),
      ),
      Scene.expect(Scene.selector('#total')).toHaveText('Combined total 1'),
      Scene.inside(
        Scene.role('region', { name: 'Left counter' }),
        Scene.expect(Scene.role('status')).toHaveText('2'),
      ),
    );
  });

  it('resets each child through its update and then resets both from the parent', () => {
    Scene.scene(
      { update, view },
      Scene.given(init().model),
      Scene.inside(
        Scene.role('region', { name: 'Left counter' }),
        Scene.click(Scene.role('button', { name: 'Increment' })),
        Scene.click(Scene.role('button', { name: 'Reset' })),
        Scene.expect(Scene.role('status')).toHaveText('0'),
        Scene.click(Scene.role('button', { name: 'Increment' })),
      ),
      Scene.inside(
        Scene.role('region', { name: 'Right counter' }),
        Scene.click(Scene.role('button', { name: 'Increment' })),
      ),
      Scene.expect(Scene.selector('#total')).toHaveText('Combined total 2'),
      Scene.click(Scene.role('button', { name: 'Reset both counters' })),
      Scene.expectAll(Scene.all.role('status')).toHaveCount(2),
      Scene.inside(
        Scene.role('region', { name: 'Left counter' }),
        Scene.expect(Scene.role('status')).toHaveText('0'),
      ),
      Scene.inside(
        Scene.role('region', { name: 'Right counter' }),
        Scene.expect(Scene.role('status')).toHaveText('0'),
      ),
      Scene.expect(Scene.selector('#total')).toHaveText('Combined total 0'),
    );
  });
});
