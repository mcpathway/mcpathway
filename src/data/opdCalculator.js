// OPD points estimate. Pure calculation: no database, nothing is stored.
// All the rules live in OPD_CATEGORIES below, so a change of rate or cap is a one-line edit.
//
// Rules (per training):
//   A  first time 100% of the hours, repeat 50%, maximum 10 points
//   B  50% of the hours, maximum 5 points
//   C  1 point per hour, maximum 50 points
// Every result is rounded UP to the next half point (0.5, 1, 1.5, ...), the minimum is 0.5,
// and the maximum of the category is applied last.

export const OPD_STEP = 0.5; // points are given in steps of half a point

export const OPD_CATEGORIES = {
  A: {
    code: "A",
    name: "Core counselling skills & theories",
    cap: 10,
    hasRepeat: true,
    firstTimeRate: [1, 1], // [numerator, denominator] = 100%
    repeatRate: [1, 2], // 50%
    rule: "First time: 100% of the training hours. Repeat: 50%. Maximum 10 points per training.",
    evidenceRequired: true,
    evidence: "Required: submit a certificate or a reflective essay to claim these points (kept for audit).",
    trainings: [
      "Counselling skills training (listening, empathy, formulation)",
      "Counselling theories (CBT foundations, person-centred, psychodynamic)",
      "Trauma-informed counselling for counsellors",
      "Clinical MHPSS with counselling application",
      "Supervised skills-based training",
      "PFA (basic / intermediate)",
      "MHPSS awareness or community-focused training",
    ],
  },
  B: {
    code: "B",
    name: "Professional enrichment (related counselling)",
    cap: 5,
    hasRepeat: false,
    firstTimeRate: [1, 2], // 50%
    repeatRate: [1, 2],
    rule: "50% of the training hours. Maximum 5 points per training.",
    evidenceRequired: false,
    evidence: "Optional: a certificate or a reflective essay can be submitted (kept for audit).",
    trainings: [
      "Mindfulness workshops (including those led by counsellors)",
      "Ethics refreshers (non-clinical)",
      "Self-care, burnout prevention, reflective practice",
    ],
  },
  C: {
    code: "C",
    name: "Specialisation / increased scope of practice",
    cap: 50,
    hasRepeat: false,
    firstTimeRate: [1, 1], // 1 point per hour
    repeatRate: [1, 1],
    rule: "1 point per training hour. Maximum 50 points per training.",
    evidenceRequired: true,
    evidence: "Required: submit a certificate or a reflective essay to claim these points (kept for audit).",
    trainings: [
      "EMDR (Levels 1–4)",
      "Play therapy certification",
      "Art / drama therapy (clinical level)",
      "Addiction counselling certification",
      "Couples / family therapy training",
    ],
  },
};

export function formatPoints(points) {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

export function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!rest) return `${hours} h`;
  return hours ? `${hours} h ${rest} min` : `${rest} min`;
}

// Returns { ok: true, ...result } or { ok: false, error }.
export function calculateOpd({ category, hours, minutes, firstTime }) {
  const rules = OPD_CATEGORIES[category];
  if (!rules) return { ok: false, error: "Choose a category." };

  const h = Number(hours || 0);
  const m = Number(minutes || 0);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0) {
    return { ok: false, error: "Enter whole numbers for hours and minutes." };
  }
  if (m > 59) return { ok: false, error: "Minutes must be between 0 and 59." };
  if (h > 999) return { ok: false, error: "Hours cannot be more than 999." };

  const totalMinutes = h * 60 + m;
  if (totalMinutes === 0) return { ok: false, error: "Enter the training time in hours and minutes." };

  const repeat = rules.hasRepeat && !firstTime;
  const [num, den] = repeat ? rules.repeatRate : rules.firstTimeRate;
  const percent = Math.round((num / den) * 100);

  // Whole numbers only (no floating point surprises): points in half-point units,
  // rounded up, never below 1 unit (0.5) and never above the category cap.
  const halfUnits = Math.max(1, Math.floor((totalMinutes * num * 2 + 60 * den - 1) / (60 * den)));
  const capped = halfUnits > rules.cap * 2;
  const points = Math.min(halfUnits, rules.cap * 2) / 2;

  const raw = Math.round((totalMinutes * num * 100) / (60 * den)) / 100;
  const minimumApplied = raw < OPD_STEP;

  const steps = [`${percent}% of ${formatDuration(totalMinutes)} = ${raw}`];
  if (minimumApplied) steps.push(`minimum ${formatPoints(OPD_STEP)}`);
  else if (halfUnits / 2 !== raw) steps.push(`rounded up to ${formatPoints(halfUnits / 2)}`);
  if (capped) steps.push(`capped at ${rules.cap}`);

  return {
    ok: true,
    category,
    totalMinutes,
    repeat,
    percent,
    points,
    capped,
    explanation: steps.join(" → "),
    evidence: rules.evidence,
    evidenceRequired: rules.evidenceRequired,
  };
}
