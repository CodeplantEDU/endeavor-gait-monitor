export const METRICS = {
  pitch_range: '피치 범위', forefoot_peak: '전족부 접촉 피크', heel_peak: '뒤꿈치 접촉 피크',
  pressure_ratio: '전족부/뒤꿈치 피크 비', forefoot_contact: '전족부 접촉시간',
  heel_contact: '뒤꿈치 접촉시간', total_contact: '전체 접촉시간',
  interval_mean: '뒤꿈치 접촉 시작 간격', interval_sd: '간격 SD', interval_cv: '간격 CV',
};
export const GROUPS = { movement: [], rotation: ['pitch_range'], jerk: [], pressure: ['forefoot_peak', 'heel_peak', 'pressure_ratio'], contact: ['total_contact'], rhythm: ['interval_cv'] };
export const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export const sd = values => values.length >= 2 ? Math.sqrt(values.reduce((a, b) => a + (b - mean(values)) ** 2, 0) / (values.length - 1)) : null;
export const wrap = angle => ((angle + 180) % 360 + 360) % 360 - 180;
const circularMean = values => Math.atan2(mean(values.map(x => Math.sin(x * Math.PI / 180))), mean(values.map(x => Math.cos(x * Math.PI / 180)))) * 180 / Math.PI;
const circularSd = values => sd(values.map(x => wrap(x - circularMean(values))));
const span = values => values.length ? Math.max(...values) - Math.min(...values) : null;

export function captureReference(samples, config) {
  if (samples.length < config.minCalibrationSamples) throw Error(`보정 샘플이 부족합니다 (${samples.length}/${config.minCalibrationSamples}개). 연결 상태를 확인하고 다시 측정하세요.`);
  if (samples.some(s => s.status !== 2) || samples.some((s, i) => i && s.pc_timestamp_ms - samples[i - 1].pc_timestamp_ms > config.maxGapMs)) throw Error('보정 중 수신이 끊겼거나 MPU가 준비되지 않았습니다.');
  if (circularSd(samples.map(s => s.roll)) > config.maxCalibrationAngleSd || sd(samples.map(s => s.pitch)) > config.maxCalibrationAngleSd) throw Error('보정 중 자세가 움직였습니다. 기준 자세에서 다시 측정하세요.');
  const channel = key => ({ mean: mean(samples.map(s => s[key])), sd: sd(samples.map(s => s[key])) ?? 0 });
  return { front: channel('front'), rear: channel('rear'), orientation: { roll: circularMean(samples.map(s => s.roll)), pitch: mean(samples.map(s => s.pitch)), yaw: circularMean(samples.map(s => s.yaw)) } };
}
export function finishCalibration(unloaded, loaded, config) {
  const channel = key => {
    const zero = unloaded[key].mean, reference = loaded[key].mean, difference = reference - zero;
    if (difference <= Math.max(1, config.calibrationNoiseMultiplier * Math.max(unloaded[key].sd, loaded[key].sd))) throw Error(`${key === 'front' ? '전족부' : '뒤꿈치'}의 가압 신호가 잡음에 비해 부족합니다. 두 FSR 모두 충분히 가압해 다시 측정하세요.`);
    return { zero, loaded: reference, noise: unloaded[key].sd, span: difference, on: zero + difference * config.contactOnFraction, off: zero + difference * config.contactOffFraction };
  };
  return { front: channel('front'), rear: channel('rear'), orientation: unloaded.orientation };
}

export class SampleStream {
  constructor(config) { this.config = config; this.previous = null; this.filtered = []; this.epoch = 0; this.missing = 0; }
  push(packet, pcMs, calibration) {
    const previous = this.previous;
    if (previous && packet.sequence === previous.sequence && packet.uptime === previous.uptime) return null;
    const reboot = !!previous && packet.uptime < previous.uptime && previous.uptime - packet.uptime < 0x80000000;
    const gap = previous ? pcMs - previous.pc_timestamp_ms : 0;
    let missing = 0;
    if (previous && !reboot) {
      const delta = (packet.sequence - previous.sequence + 65536) % 65536;
      if (delta > 0 && delta < 32768) missing = delta - 1;
      if (packet.uptime < previous.uptime) this.epoch += 0x100000000;
    }
    if (reboot) { this.epoch = 0; calibration = null; }
    if (reboot || gap > this.config.maxGapMs || packet.status !== 2) this.filtered = [];
    this.missing += missing;
    const row = { ...packet, pc_timestamp_ms: pcMs, pc_timestamp: new Date(pcMs).toISOString(), esp_timestamp: packet.uptime, esp_unwrapped_ms: this.epoch + packet.uptime, missing_before: missing, gap_ms: gap, reboot, accel_x: null, accel_y: null, accel_z: null, gyro_x: null, gyro_y: null, gyro_z: null };
    if (calibration && packet.status === 2) {
      row.front_norm = Math.max(0, (packet.front - calibration.front.zero) / calibration.front.span);
      row.rear_norm = Math.max(0, (packet.rear - calibration.rear.zero) / calibration.rear.span);
      row.roll_relative = wrap(packet.roll - calibration.orientation.roll);
      row.pitch_relative = wrap(packet.pitch - calibration.orientation.pitch);
      row.yaw_relative = wrap(packet.yaw - calibration.orientation.yaw);
      this.filtered.push(row);
      this.filtered = this.filtered.slice(-this.config.filterSamples);
      for (const key of ['front_norm', 'rear_norm', 'pitch_relative']) row[`${key}_filtered`] = mean(this.filtered.map(s => s[key]));
    }
    this.previous = row;
    return row;
  }
}

function contactStates(rows, key, config) {
  let active = false;
  return rows.map((row, index) => {
    if (!index || row.pc_timestamp_ms - rows[index - 1].pc_timestamp_ms > config.maxGapMs || row.missing_before > 0) active = false;
    if (row[key] >= config.contactOnFraction) active = true;
    else if (row[key] <= config.contactOffFraction) active = false;
    return active;
  });
}
function segments(rows, states, key, config) {
  const result = [];
  let opened = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const broken = !i || row.pc_timestamp_ms - rows[i - 1].pc_timestamp_ms > config.maxGapMs || row.missing_before > 0;
    if (broken) opened = null;
    if (states[i] && !opened) opened = { start: row.pc_timestamp_ms, peak: row[key] ?? 0, known: !broken };
    if (states[i] && opened) opened.peak = Math.max(opened.peak, row[key] ?? 0);
    if (!states[i] && opened) {
      const duration = (row.pc_timestamp_ms - opened.start) / 1000;
      if (opened.known && duration >= config.minContactSeconds) result.push({ ...opened, duration });
      opened = null;
    }
  }
  return result;
}
export function analyze(rows, config, endMs = rows.at(-1)?.pc_timestamp_ms) {
  const window = rows.filter(r => r.pc_timestamp_ms >= endMs - config.windowSeconds * 1000);
  const valid = window.filter(r => r.status === 2 && Number.isFinite(r.front_norm_filtered) && Number.isFinite(r.rear_norm_filtered));
  const metrics = Object.fromEntries(Object.keys(METRICS).map(key => [key, null]));
  const missing = window.reduce((n, r) => n + r.missing_before, 0);
  const duration = valid.length > 1 ? (valid.at(-1).pc_timestamp_ms - valid[0].pc_timestamp_ms) / 1000 : 0;
  const quality = { samples: valid.length, missing, missingFraction: missing / Math.max(1, window.length + missing), duration, gaps: valid.filter((r, i) => i && r.pc_timestamp_ms - valid[i - 1].pc_timestamp_ms > config.maxGapMs).length, calibrated: valid.length > 0 };
  if (!valid.length) return { metrics, quality, events: { heel: [], forefoot: [], total: [] }, ready: false, reason: '기기 연결과 센서 캘리브레이션이 필요합니다.' };
  const fs = contactStates(valid, 'front_norm_filtered', config), hs = contactStates(valid, 'rear_norm_filtered', config);
  const forefoot = segments(valid, fs, 'front_norm_filtered', config), heel = segments(valid, hs, 'rear_norm_filtered', config);
  const total = segments(valid, fs.map((x, i) => x || hs[i]), 'front_norm_filtered', config);
  // Intervals never bridge a packet gap or reboot boundary.
  const intervals = heel.slice(1).map((h, i) => {
    const prior = heel[i];
    const broken = valid.some((r, j) => j && r.pc_timestamp_ms > prior.start && r.pc_timestamp_ms <= h.start && (r.missing_before > 0 || r.pc_timestamp_ms - valid[j - 1].pc_timestamp_ms > config.maxGapMs));
    return broken ? null : (h.start - prior.start) / 1000;
  }).filter(x => x !== null && x > 0);
  metrics.pitch_range = span(valid.map(r => r.pitch_relative_filtered));
  metrics.forefoot_peak = mean(forefoot.map(s => s.peak)); metrics.heel_peak = mean(heel.map(s => s.peak));
  metrics.pressure_ratio = metrics.heel_peak > 1e-8 && metrics.forefoot_peak !== null ? metrics.forefoot_peak / metrics.heel_peak : null;
  metrics.forefoot_contact = mean(forefoot.map(s => s.duration)); metrics.heel_contact = mean(heel.map(s => s.duration)); metrics.total_contact = mean(total.map(s => s.duration));
  if (intervals.length >= config.minIntervals) {
    metrics.interval_mean = mean(intervals); metrics.interval_sd = sd(intervals);
    metrics.interval_cv = metrics.interval_mean > 1e-8 ? 100 * metrics.interval_sd / metrics.interval_mean : null;
  }
  const ready = duration >= config.minWindowSeconds && intervals.length >= config.minIntervals && quality.missingFraction <= config.maxMissingFraction && window.every(r => r.status === 2);
  const reason = duration < config.minWindowSeconds ? `${config.minWindowSeconds}초 이상 수집하세요.` : intervals.length < config.minIntervals ? '완료된 뒤꿈치 접촉이 부족합니다. 서 있음·연속 접촉·검출 실패를 구분할 수 없습니다.' : quality.missingFraction > config.maxMissingFraction ? '패킷 누락이 많아 점수를 보류합니다.' : !window.every(r => r.status === 2) ? 'MPU가 준비되지 않은 구간이 포함되었습니다.' : '';
  return { metrics, quality, events: { heel, forefoot, total }, ready, reason };
}
export function buildBaseline(observations, minTrials) {
  return Object.fromEntries(Object.keys(METRICS).map(key => {
    const values = observations.map(o => o[key]).filter(Number.isFinite);
    return [key, { n: values.length, mean: mean(values), sd: sd(values), ready: values.length >= minTrials }];
  }));
}
export function deviation(value, reference, config) {
  if (!Number.isFinite(value) || !reference?.ready || !Number.isFinite(reference.mean)) return null;
  const floor = Math.abs(reference.mean) * config.baselineSdFloorRelative;
  const denominator = Math.max(reference.sd ?? 0, floor);
  if (!(denominator > 1e-8)) return { percent: null, z: null, score: null };
  const z = (value - reference.mean) / denominator;
  return { percent: Math.abs(reference.mean) > 1e-8 ? 100 * (value - reference.mean) / Math.abs(reference.mean) : null, z, score: Math.max(0, Math.min(100, 100 * Math.exp(-0.5 * z * z))) };
}
export function score(analysis, baseline, config) {
  const deviations = Object.fromEntries(Object.keys(METRICS).map(key => [key, analysis.ready ? deviation(analysis.metrics[key], baseline?.[key], config) : null]));
  const groups = Object.fromEntries(Object.entries(GROUPS).map(([key, keys]) => {
    const values = keys.map(k => deviations[k]?.score).filter(Number.isFinite);
    return [key, values.length === keys.length && keys.length ? mean(values) : null];
  }));
  return { groups, deviations };
}
export function asymmetry(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left) + Math.abs(right) <= 1e-8) return null;
  return 200 * Math.abs(left - right) / (Math.abs(left) + Math.abs(right));
}
export function composite(sideScores, asymmetryScore, config) {
  const terms = [];
  for (const side of sideScores) for (const [key, value] of Object.entries(side.groups)) if (Number.isFinite(value) && config.scoreWeights[key] > 0) terms.push([value, config.scoreWeights[key]]);
  if (Number.isFinite(asymmetryScore) && config.asymmetryWeight > 0) terms.push([asymmetryScore, config.asymmetryWeight]);
  return terms.length ? terms.reduce((n, [v, w]) => n + v * w, 0) / terms.reduce((n, [, w]) => n + w, 0) : null;
}
