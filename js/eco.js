import { clamp } from './noise.js';
// Deliberately simple ecology model: plants raise the carrying capacity and slowly clean waste.
export function createEco() {
  const s = { quality: 88, waste: 0, capacity: 0, load: 0 };
  return {
    s,
    waste(n) { s.waste += n; },
    update(dt, { koi, gold, plantScore, floating }) {
      s.capacity = 6 + plantScore * 0.55;
      s.load = koi + gold * 0.35;
      const over = Math.max(0, s.load - s.capacity);
      const target = clamp(97 - over * 7 - floating * 0.12 - s.waste * 1.5, 5, 100);
      s.waste = Math.max(0, s.waste - dt * 0.03 * (1 + plantScore * 0.12));
      s.quality += (target - s.quality) * Math.min(1, dt * 0.06);
    },
    grade() { const q = s.quality; return q >= 80 ? ['优', 'good'] : q >= 60 ? ['良', 'ok'] : q >= 40 ? ['一般', 'warn'] : ['较差', 'bad']; },
  };
}
