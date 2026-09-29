'use strict';

const {
  defaultStackHeights,
  buildSolutionOrder,
  assignIdentities,
  buildBoard,
  playout,
  makeSolutionPlayer,
  makeHeuristicPlayer,
  randomPlayer,
} = require('./stage-generator.js');

const IDENTITY_COUNT = 8; // 카드 종류 수 (트리플 개수와는 별개)
const identityPool = Array.from({ length: IDENTITY_COUNT }, (_, i) => String.fromCharCode(65 + i));
const totalTriples = 20; // 60장 규모 (실제 목표 규모)
const stackHeights = defaultStackHeights(totalTriples);

const STAGES_PER_COMBO = 6;
const TRIALS_PER_STAGE = 150;
const REFINE_STAGES = 20;
const REFINE_TRIALS = 500;

// 목표: 노말은 요령만 있으면 거의 항상 클리어, 헬은 요령 있어도 절반 정도만 클리어
const TARGET_HEURISTIC = { normal: 0.95, hell: 0.50 };
const MAX_ALLOWED_RANDOM_HELL = 0.20;

function makeWidthFn(values) {
  // values: [progress<0.4, progress<0.7, progress<0.9, else]
  return function (t) {
    const progress = t / totalTriples;
    if (progress < 0.4) return values[0];
    if (progress < 0.7) return values[1];
    if (progress < 0.9) return values[2];
    return values[3];
  };
}

function evaluateCombo(widthValues, slotCapacity, stagesN, trialsN) {
  const widthFn = makeWidthFn(widthValues);
  let solutionFails = 0;
  let randomSum = 0;
  let heuristicSum = 0;

  for (let s = 0; s < stagesN; s++) {
    const order = buildSolutionOrder(stackHeights);
    const assignment = assignIdentities(order, widthFn, identityPool, slotCapacity);
    const board = buildBoard(stackHeights, order, assignment);

    const solResult = playout(board, slotCapacity, makeSolutionPlayer(order));
    if (solResult.result !== 'win') solutionFails += 1;

    let randomWins = 0;
    let heuristicWins = 0;
    for (let i = 0; i < trialsN; i++) {
      if (playout(board, slotCapacity, randomPlayer).result === 'win') randomWins += 1;
      if (playout(board, slotCapacity, makeHeuristicPlayer()).result === 'win') heuristicWins += 1;
    }
    randomSum += randomWins / trialsN;
    heuristicSum += heuristicWins / trialsN;
  }

  return {
    widthValues,
    slotCapacity,
    solutionFails,
    randomRate: randomSum / stagesN,
    heuristicRate: heuristicSum / stagesN,
  };
}

function search(mode) {
  const w1Candidates = [4, 6, 8, 10, 12, 14];
  const w2Candidates = [3, 4, 6, 8, 10];
  const w3Candidates = [2, 3, 4, 6];
  const capacityCandidates = mode === 'normal' ? [10, 12, 14, 16, 18, 20] : [6, 7, 8, 9, 10, 12, 14];

  const results = [];
  for (const capacity of capacityCandidates) {
    for (const w1 of w1Candidates) {
      if (w1 > capacity) continue;
      for (const w2 of w2Candidates) {
        if (w2 > w1) continue;
        for (const w3 of w3Candidates) {
          if (w3 > w2) continue;
          const values = [w1, w2, w3, 1];
          results.push(evaluateCombo(values, capacity, STAGES_PER_COMBO, TRIALS_PER_STAGE));
        }
      }
    }
  }
  return results;
}

function report(mode) {
  console.log(`\n========== ${mode.toUpperCase()} 모드 그리드 서치 (넓은 탐색, 저정밀) ==========`);
  const results = search(mode).filter(r => r.solutionFails === 0);

  const target = TARGET_HEURISTIC[mode];
  results.sort((a, b) => Math.abs(a.heuristicRate - target) - Math.abs(b.heuristicRate - target));

  console.log(`목표 휴리스틱 성공률: ${(target * 100).toFixed(0)}%, 후보 수: ${results.length}`);
  console.log('상위 8개 후보 (저정밀):');
  results.slice(0, 8).forEach((r, i) => {
    console.log(
      `${i + 1}. widths=[${r.widthValues.join(',')}] capacity=${r.slotCapacity} `
      + `| 무작위=${(r.randomRate * 100).toFixed(1)}% 휴리스틱=${(r.heuristicRate * 100).toFixed(1)}%`
    );
  });

  // 상위 8개를 고정밀로 재검증
  console.log('재검증 중 (고정밀)...');
  const refined = results.slice(0, 8).map(r => evaluateCombo(r.widthValues, r.slotCapacity, REFINE_STAGES, REFINE_TRIALS));
  refined.sort((a, b) => Math.abs(a.heuristicRate - target) - Math.abs(b.heuristicRate - target));
  console.log('재검증 결과 상위 5개:');
  refined.slice(0, 5).forEach((r, i) => {
    console.log(
      `${i + 1}. widths=[${r.widthValues.join(',')}] capacity=${r.slotCapacity} `
      + `| 무작위=${(r.randomRate * 100).toFixed(1)}% 휴리스틱=${(r.heuristicRate * 100).toFixed(1)}%`
    );
  });

  let best = refined[0];
  if (mode === 'hell') {
    const constrained = refined.filter(r => r.randomRate <= MAX_ALLOWED_RANDOM_HELL);
    if (constrained.length > 0) {
      constrained.sort((a, b) => Math.abs(a.heuristicRate - target) - Math.abs(b.heuristicRate - target));
      best = constrained[0];
      console.log(`(무작위 성공률 ${(MAX_ALLOWED_RANDOM_HELL * 100).toFixed(0)}% 이하 제약 적용된 최적 후보로 채택)`);
    }
  }
  console.log('>> 채택:', JSON.stringify(best));
  return best;
}

const bestNormal = report('normal');
const bestHell = report('hell');

console.log('\n최종 추천 설정:');
console.log(`normal: widths=[${bestNormal.widthValues}] capacity=${bestNormal.slotCapacity}`);
console.log(`hell:   widths=[${bestHell.widthValues}] capacity=${bestHell.slotCapacity}`);
