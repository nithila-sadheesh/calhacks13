import { describe, expect, it } from 'vitest';
import { approvedText, BASE_KEYTERMS, fallbackKey, inkKeyterms } from './config.ts';
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

describe('Ink keyterms', () => {
  it('puts the voice commands first and adds each route street once', () => {
    const terms = inkKeyterms(['Oxford Street', undefined, ' Oxford Street ', 'Center Street']);
    expect(terms.slice(0, 3)).toEqual(['repeat that', 'repeat', 'say that again']);
    expect(terms.filter((t) => t === 'Oxford Street')).toHaveLength(1);
    expect(terms).toContain('Center Street');
    expect(terms).toHaveLength(BASE_KEYTERMS.length + 2);
  });
});
