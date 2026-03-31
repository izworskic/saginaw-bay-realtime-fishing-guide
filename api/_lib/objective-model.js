const MODEL_CONFIG = require("./model-config.json");

function normalizeWeights(inputWeights, constraints = MODEL_CONFIG.constraints) {
  const raw = {
    safety: Math.max(0, Number(inputWeights?.safety ?? MODEL_CONFIG.weights.safety)),
    fishability: Math.max(0, Number(inputWeights?.fishability ?? MODEL_CONFIG.weights.fishability)),
    recentSignal: Math.max(0, Number(inputWeights?.recentSignal ?? MODEL_CONFIG.weights.recentSignal)),
    confidence: Math.max(0, Number(inputWeights?.confidence ?? MODEL_CONFIG.weights.confidence)),
    friction: Math.max(0, Number(inputWeights?.friction ?? MODEL_CONFIG.weights.friction)),
  };

  const minSafety = Number(constraints?.minSafetyWeight ?? 0);
  if (raw.safety < minSafety) {
    raw.safety = minSafety;
  }

  let total = raw.safety + raw.fishability + raw.recentSignal + raw.confidence + raw.friction;
  if (total <= 0) {
    return { ...MODEL_CONFIG.weights };
  }

  const targetOtherTotal = Math.max(0, 1 - raw.safety);
  const currentOtherTotal = Math.max(0, total - raw.safety);
  if (currentOtherTotal > 0) {
    const scale = targetOtherTotal / currentOtherTotal;
    raw.fishability *= scale;
    raw.recentSignal *= scale;
    raw.confidence *= scale;
    raw.friction *= scale;
  } else {
    const even = targetOtherTotal / 4;
    raw.fishability = even;
    raw.recentSignal = even;
    raw.confidence = even;
    raw.friction = even;
  }

  total = raw.safety + raw.fishability + raw.recentSignal + raw.confidence + raw.friction;
  if (total <= 0) {
    return { ...MODEL_CONFIG.weights };
  }

  return {
    safety: raw.safety / total,
    fishability: raw.fishability / total,
    recentSignal: raw.recentSignal / total,
    confidence: raw.confidence / total,
    friction: raw.friction / total,
  };
}

function computeObjectiveJ({ htdr, safetyMissRate, calibrationError }) {
  const a = toBoundedNumber(htdr, 0, 1);
  const b = toBoundedNumber(safetyMissRate, 0, 1);
  const c = toBoundedNumber(calibrationError, 0, 1);
  return a - 5 * b - 0.5 * c;
}

function proposeWeeklyWeights({
  currentWeights,
  htdr,
  safetyMissRate,
  calibrationError,
  learningRate = 0.12,
}) {
  const targets = MODEL_CONFIG.learningObjective.targets;
  const weights = normalizeWeights(currentWeights);
  const lr = Math.max(0.01, Math.min(0.4, Number(learningRate) || 0.12));

  const proposed = { ...weights };
  const safetyGap = toBoundedNumber(safetyMissRate, 0, 1) - targets.safetyMissRateMax;
  const calibrationGap = toBoundedNumber(calibrationError, 0, 1) - targets.calibrationErrorMax;
  const htdrGap = targets.htdrMin - toBoundedNumber(htdr, 0, 1);

  if (safetyGap > 0) {
    proposed.safety += Math.min(0.08, safetyGap * lr * 2.2);
    proposed.fishability -= Math.min(0.04, safetyGap * lr * 1.1);
    proposed.recentSignal -= Math.min(0.03, safetyGap * lr);
  } else if (htdrGap > 0) {
    proposed.fishability += Math.min(0.03, htdrGap * lr * 1.5);
    proposed.recentSignal += Math.min(0.02, htdrGap * lr);
    proposed.safety -= Math.min(0.015, htdrGap * lr * 0.5);
  }

  if (calibrationGap > 0) {
    proposed.confidence += Math.min(0.04, calibrationGap * lr * 1.8);
    proposed.recentSignal -= Math.min(0.02, calibrationGap * lr * 0.7);
  }

  const normalized = normalizeWeights(proposed);
  return {
    currentWeights: normalizeWeights(weights),
    proposedWeights: normalized,
    objective: {
      j: computeObjectiveJ({ htdr, safetyMissRate, calibrationError }),
      inputs: {
        htdr: toBoundedNumber(htdr, 0, 1),
        safetyMissRate: toBoundedNumber(safetyMissRate, 0, 1),
        calibrationError: toBoundedNumber(calibrationError, 0, 1),
      },
      formula: MODEL_CONFIG.learningObjective.formula,
    },
  };
}

function resolveActiveWeights() {
  const override = process.env.MODEL_WEIGHT_OVERRIDE_JSON;
  if (!override) {
    return normalizeWeights(MODEL_CONFIG.weights);
  }

  try {
    return normalizeWeights(JSON.parse(override));
  } catch {
    return normalizeWeights(MODEL_CONFIG.weights);
  }
}

function toBoundedNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.max(min, Math.min(max, numeric));
}

module.exports = {
  MODEL_CONFIG,
  computeObjectiveJ,
  normalizeWeights,
  proposeWeeklyWeights,
  resolveActiveWeights,
};
