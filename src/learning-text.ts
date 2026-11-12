import { ZERAIM } from './learning-text-data/zeraim.js';
import { MOED } from './learning-text-data/moed.js';
import { NASHIM } from './learning-text-data/nashim.js';
import { NEZIKIN } from './learning-text-data/nezikin.js';
import { KODASHIM } from './learning-text-data/kodashim.js';
import { TAHAROT } from './learning-text-data/taharot.js';
import { TEHILLIM } from './learning-text-data/tehillim.js';
import type { LearningUnit } from './learning-reminders.js';

const MISHNAYOS = [...ZERAIM, ...MOED, ...NASHIM, ...NEZIKIN, ...KODASHIM, ...TAHAROT];

export function learningText(kind: string, {idx, chapter, mishnah}: LearningUnit): string {
  const text = kind === 'tehillim'
    ? TEHILLIM[idx - 1]?.join('\n')
    : MISHNAYOS[idx]?.[chapter - 1]?.[mishnah - 1];
  if (!text) throw new Error(`Missing Hebrew text for ${kind} ${idx}/${chapter}/${mishnah}`);
  return text;
}
