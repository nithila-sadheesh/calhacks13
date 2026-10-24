import { describe, expect, it } from 'vitest';
import type { MapFeature, MapFeatureKind } from '../../../shared/types.ts';
import { CUE_RULES, cueText, decideCue, featureLabel, speechMs } from './cues.ts';

// AGENTS.md section 8, copied by hand so a template edit fails this test.
const APPROVED = [
  'Left turn ahead onto {street}. Check for pedestrians before turning.',
  'Right turn ahead onto {street}. Check your mirror and blind spot.',
  'Stop sign ahead. Prepare for a complete stop.',
  'Crosswalk ahead. Scan both sides.',
  'Traffic light ahead. Be ready to stop.',
];

const KINDS: MapFeatureKind[] = ['turnLeft', 'turnRight', 'stopSign', 'crosswalk', 'signal'];

const feature = (kind: MapFeatureKind, extra: Partial<MapFeature> = {}): MapFeature => ({
  id: `${kind}-1`,
  kind,
  lat: 0,
  lon: 0,
  routeDistM: 0,
  street: 'Oak Street',
  source: 'osm',
  ...extra,
});

describe('cueText', () => {
  it('uses only the approved phrases', () => {
    const texts = KINDS.map((k) => cueText(k, '{street}'));
    expect(texts).toEqual(APPROVED);
  });

  it('fills in and trims the street name', () => {
    expect(cueText('turnLeft', ' Oak Street ')).toBe(
      'Left turn ahead onto Oak Street. Check for pedestrians before turning.',
    );
  });

  it('gives no text for a turn without a street', () => {
    expect(cueText('turnLeft')).toBeUndefined();
    expect(cueText('turnRight', '  ')).toBeUndefined();
    expect(cueText('stopSign')).toBe('Stop sign ahead. Prepare for a complete stop.');
  });
});

describe('decideCue', () => {
  it('fires inside the window with timing, priority and reason', () => {
    // Stop sign 80 m ahead at 10 m/s: 8 s, inside 9-6 s.
    const d = decideCue(feature('stopSign'), 80, 10, 20_000);
    expect(d?.ttaS).toBeCloseTo(8, 6);
    expect(d?.cue).toMatchObject({
      featureId: 'stopSign-1',
      featureKind: 'stopSign',
      text: 'Stop sign ahead. Prepare for a complete stop.',
      priority: 1,
      earliestMs: 20_000,
      expiresMs: 23_000,
    });
    expect(d?.cue.reason).toBe('stop sign 80 m ahead at 10 m/s, about 8.0 s away');
  });

  it('does not fire before or after the window', () => {
    expect(decideCue(feature('stopSign'), 95, 10, 0)).toBeUndefined();
    expect(decideCue(feature('stopSign'), 55, 10, 0)).toBeUndefined();
    expect(decideCue(feature('stopSign'), 0, 10, 0)).toBeUndefined();
    expect(decideCue(feature('stopSign'), -5, 10, 0)).toBeUndefined();
  });

  it('fires at both window edges', () => {
    expect(decideCue(feature('stopSign'), 90, 10, 0)).toBeDefined();
    expect(decideCue(feature('stopSign'), 60, 10, 0)).toBeDefined();
  });

  it('uses each kind its own window, drop-after and priority', () => {
    for (const kind of KINDS) {
      const rule = CUE_RULES[kind];
      const [closesS, opensS] = rule.windowS;
      const mid = (closesS + opensS) / 2;
      const d = decideCue(feature(kind), mid * 10, 10, 0);
      expect(d?.cue.priority).toBe(rule.priority);
      expect(d?.cue.expiresMs).toBeLessThanOrEqual(rule.dropAfterS * 1000);
      expect(decideCue(feature(kind), (opensS + 0.5) * 10, 10, 0)).toBeUndefined();
      expect(decideCue(feature(kind), (closesS - 0.5) * 10, 10, 0)).toBeUndefined();
    }
  });

  it('expires early enough to finish speaking before arrival', () => {
    // Left turn at the 6 s edge: the line takes about 5 s, so it must start within about 1 s.
    const d = decideCue(feature('turnLeft'), 60, 10, 0);
    const talk = speechMs(d?.cue.text ?? '');
    expect(d?.cue.expiresMs).toBeCloseTo(6000 - talk, 6);
    expect(d?.cue.expiresMs).toBeLessThan(3000);
  });

  it('opens the window earlier for a line too long for it', () => {
    const street = 'Martin Luther King Junior Way Frontage Road Northbound Extension';
    const long = feature('turnRight', { street });
    const talkS = speechMs(cueText('turnRight', street) ?? '') / 1000;
    expect(talkS + 1).toBeGreaterThan(8);
    expect(decideCue(long, (talkS + 0.9) * 10, 10, 0)).toBeDefined();
  });

  it('treats very slow speed as 2 m/s', () => {
    // 16 m at 0 m/s -> 8 s at the 2 m/s floor.
    expect(decideCue(feature('stopSign'), 16, 0, 0)?.ttaS).toBeCloseTo(8, 6);
  });

  it('skips turns without a street name', () => {
    expect(decideCue(feature('turnLeft', { street: undefined }), 75, 10, 0)).toBeUndefined();
  });

  it('labels curated features in the reason', () => {
    const d = decideCue(feature('crosswalk', { source: 'curated' }), 60, 10, 0);
    expect(d?.cue.reason).toContain('curated map data');
  });

  it('labels turns with their street', () => {
    expect(featureLabel(feature('turnLeft'))).toBe('left turn onto Oak Street');
    expect(featureLabel(feature('signal'))).toBe('traffic light');
  });
});
