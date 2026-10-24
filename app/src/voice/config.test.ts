import { expect, it } from 'vitest';
import { approvedText, fallbackKey } from './config.ts';
it('maps the exact approved templates to their conservative fallback', () => {
  expect(
    fallbackKey('Left turn ahead onto Ashby Avenue. Check for pedestrians before turning.'),
  ).toBe('turn');
  expect(fallbackKey('Right turn ahead onto Ashby Avenue. Check your mirror and blind spot.')).toBe(
    'turn',
  );
  expect(fallbackKey('Stop sign ahead. Prepare for a complete stop.')).toBe('stopSign');
  expect(fallbackKey('Crosswalk ahead. Scan both sides.')).toBe('crosswalk');
  expect(approvedText('Traffic light ahead. Be ready to stop.')).toBe(true);
  expect(fallbackKey('Traffic light ahead. Be ready to stop.')).toBeUndefined();
});
it('rejects changed phrases and unsupported directions', () => {
  expect(approvedText('Left turn ahead onto Ashby Avenue. Check your mirror and blind spot.')).toBe(
    false,
  );
  expect(approvedText('The lane is clear.')).toBe(false);
  expect(approvedText('Brake now.')).toBe(false);
});
