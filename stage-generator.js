/**
 * ============================================================
 *  초 고 맛 누 - 역방향 스테이지 생성 알고리즘 프로토타입
 * ============================================================
 *
 * 핵심 아이디어
 * -------------
 * 1) 각 스택(카드 더미)은 내부적으로 "맨 위 → 아래" 순서로만 제거 가능하다.
 *    스택 간의 제거 순서는 자유롭게 섞일 수 있다(인터리빙).
 *    → 여러 스택의 제거 순서를 무작위로 병합(merge)하면,
 *      그 자체로 "무조건 클리어 가능한 정답 경로(안전 경로)"가 된다.
 *      (이게 곧 '역방향 생성'의 핵심 - 순서를 먼저 만들고 카드를 나중에 배정)
 *
 * 2) 정답 경로 위에 카드 식별자(identity)를 배정할 때,
 *    "동시에 몇 개의 식별자가 슬롯에 열려 있을 수 있는가"를
 *    폭 함수 w(t) 로 제어한다. (t = 완성된 트리플 개수 기준 진행도)
 *    - 노말 모드: 폭을 넓게 유지 → 여러 대안 경로가 살아있어 쉬움
 *    - 헬 모드: 초반엔 폭을 유지하다가 후반부에 급격히 좁힘
 *      → 후반으로 갈수록 "정답이 아닌 선택"의 대가가 커짐
 *
 * 3) 별도의 "함정 분기"를 수작업으로 심지 않아도,
 *    폭 함수 + LIFO 슬롯 규칙(헬 모드) 자체가 자연스럽게
 *    오답 선택 시 슬롯 오버플로우 위험을 만들어낸다.
 *    이 프로토타입은 그 효과를 몬테카를로 시뮬레이션으로 검증한다.
 *
 * 최신 결정사항
 * -------------
 * - 슬롯은 노말/헬 모드 모두 "순서 무관(auto)" 방식으로 통일한다.
 *   (LIFO/스택형은 입/출구가 사실상 1개뿐이라 나머지 칸이 무의미해지는
 *    문제로 폐기됨)
 * - 보드 규모는 60장(20트리플) 기준으로 튜닝됨. 카드 종류(identityPool)는
 *   트리플 개수보다 훨씬 적어도 되고, 한 종류가 여러 트리플에 걸쳐 재사용됨
 *   (예: 카드 8종으로 60장 구성 가능).
 * - 노말 모드는 슬롯 7칸, 헬 모드는 슬롯 4칸(그리드 서치로 확정, 목표 성공률 50%
 *   달성). 보드 규모나 카드 종류 수가 바뀌면 tune-difficulty.js를 다시 돌릴 것.
 */

'use strict';

/**
 * 카드 종류 수(totalTriples)만 주어지면 스택 레이아웃을 자동으로 분배한다.
 * 카드 종류가 8개 -> 10개 -> 12개로 늘어나도 이 함수만 그대로 재사용하면 됨.
 * @param {number} totalTriples - 카드 종류 수 (= 트리플 개수)
 * @param {number} numStacks - 사용할 스택 개수 (기본 6)
 * @returns {number[]} 각 스택의 카드 개수 (합계는 항상 totalTriples*3)
 */
function defaultStackHeights(totalTriples, numStacks = 6) {
  const totalTiles = totalTriples * 3;
  const base = Math.floor(totalTiles / numStacks);
  const remainder = totalTiles % numStacks;
  const heights = new Array(numStacks).fill(base);
  for (let i = 0; i < remainder; i++) heights[i] += 1;
  return heights;
}

// ============================================================
// 0. 모양 템플릿 (하트/물음표 등 시각적 배치)
// ============================================================

/**
 * Kyodai Mahjongg 좌표 목록 방식에서 아이디어를 가져온 단순화 포맷.
 * 한 줄에 더미 하나: "x,y,height;" (x,y = 격자 위치, height = 그 자리 카드 더미 높이)
 * 예: "0,0,3; 1,0,2; 2,0,3;" -> 3개의 더미
 * @param {string} text
 * @returns {{x:number, y:number, height:number}[]}
 */
function parseCoordinateLayout(text) {
  return text
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const [x, y, height] = s.split(',').map(Number);
      return { x, y, height };
    });
}

/**
 * 템플릿(더미 좌표 목록)의 총 카드 수가 3의 배수가 아니면 마지막 더미에서
 * 조정해서 맞춘다 (손으로 만든 템플릿의 흔한 실수를 자동 보정).
 */
function normalizeTemplateToMultipleOf3(positions) {
  const total = positions.reduce((a, p) => a + p.height, 0);
  const remainder = total % 3;
  if (remainder === 0) return positions;
  const adjusted = positions.map(p => ({ ...p }));
  adjusted[adjusted.length - 1].height += (3 - remainder);
  return adjusted;
}

/** 템플릿 -> generateStage에 바로 넘길 수 있는 stackHeights 배열로 변환 */
function templateToStackHeights(positions) {
  return positions.map(p => p.height);
}

const HEART_TEMPLATE_ASCII = [
  ' ## ## ',
  '#######',
  '#######',
  '#######',
  ' ##### ',
  '  ###  ',
  '   #   ',
].join('\n');

const STAR_TEMPLATE_ASCII = [
  '    #    ',
  '   ###   ',
  '  #####  ',
  '#########',
  ' ####### ',
  '  ## ##  ',
  ' ##   ## ',
  '##     ##',
].join('\n');

const CIRCLE_TEMPLATE_ASCII = [
  '  #####  ',
  ' ####### ',
  '#########',
  '#########',
  '#########',
  '#########',
  ' ####### ',
  '  #####  ',
].join('\n');

/**
 * ASCII 아트(#=더미 있음, 공백=없음)를 좌표 목록으로 변환.
 * 직접 좌표를 한 줄씩 타이핑하는 것보다 모양을 눈으로 보면서 만들 수 있어 더 쉬움.
 * @param {string} ascii - 줄바꿈으로 구분된 문자열
 * @param {number} baseHeight - 채워진 칸마다 부여할 기본 더미 높이
 */
function parseAsciiTemplate(ascii, baseHeight = 3) {
  const rows = ascii.split('\n');
  const positions = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== ' ') positions.push({ x, y, height: baseHeight });
    });
  });
  return normalizeTemplateToMultipleOf3(positions);
}

const TEMPLATES = {
  heart: () => parseAsciiTemplate(HEART_TEMPLATE_ASCII, 3),
  star: () => parseAsciiTemplate(STAR_TEMPLATE_ASCII, 3),
  circle: () => parseAsciiTemplate(CIRCLE_TEMPLATE_ASCII, 3),
};

// ============================================================
// 1. 정답 경로(안전 경로) 생성
// ============================================================

/**
 * 여러 스택의 제거 순서를 무작위로 병합해 "정답 제거 순서"를 만든다.
 * @param {number[]} stackHeights - 각 스택의 카드 개수
 * @param {function} rng - 0~1 난수 생성기 (테스트용 주입 가능)
 * @returns {{stack:number, index:number}[]} 제거 순서 (앞쪽이 먼저 제거됨)
 */
function buildSolutionOrder(stackHeights, rng = Math.random) {
  const cursors = stackHeights.map(h => h - 1); // 다음에 제거될 배열 인덱스(맨 위부터)
  const remaining = stackHeights.map(h => h);
  const order = [];
  let total = stackHeights.reduce((a, b) => a + b, 0);

  while (total > 0) {
    const candidates = [];
    stackHeights.forEach((h, si) => {
      if (remaining[si] > 0) candidates.push(si);
    });
    const si = candidates[Math.floor(rng() * candidates.length)];
    order.push({ stack: si, index: cursors[si] });
    cursors[si] -= 1;
    remaining[si] -= 1;
    total -= 1;
  }
  return order;
}

// ============================================================
// 2. 폭 함수 (branch width curve)
// ============================================================

/**
 * @param {'normal'|'hell'} mode
 * @param {number} totalTriples - 스테이지의 총 트리플(3매칭) 개수
 * @returns {(t:number)=>number} t(완성된 트리플 수+1 기준) -> 목표 동시-오픈 폭
 *
 * 아래 기본값은 카드 8종, 60장(20트리플) 기준 그리드 서치로 튜닝된 값:
 * - 노말(슬롯 7칸): 휴리스틱 성공률 ~99~100%
 * - 헬(슬롯 4칸): 휴리스틱 성공률 ~50% (목표치와 일치, "슬롯이 꽉 차는 순간 즉시 패배" 규칙 기준)
 * 보드 규모나 카드 종류 수가 바뀌면 tune-difficulty.js를 다시 돌려 값을 갱신할 것.
 */
function widthCurve(mode, totalTriples) {
  return function (t) {
    const progress = t / totalTriples; // 0~1
    if (mode === 'hell') {
      if (progress < 0.4) return 3;
      if (progress < 0.7) return 2;
      if (progress < 0.9) return 1;
      return 1;
    }
    // normal
    if (progress < 0.4) return 5;
    if (progress < 0.7) return 4;
    if (progress < 0.9) return 2;
    return 1;
  };
}

// ============================================================
// 3. 정답 경로 위에 식별자 배정
// ============================================================

/**
 * @param {(t:number)=>number} widthFn - 물리적으로 동시에 점유해도 되는 슬롯 칸 수(목표치, 난이도 조절용)
 * @param {string[]} identityPool - 사용 가능한 카드 종류 목록 (트리플 개수보다 훨씬 적어도 됨,
 *   한 종류가 여러 트리플에 걸쳐 재사용됨 - 실제 카드 게임처럼 8종으로 60장 이상도 구성 가능)
 * @param {number} slotCapacity - 물리적 슬롯 용량. 이 함수는 두 가지 하드 제약을 항상 지킨다:
 *   (1) 물리 제약: 어떤 시점에도 열린 항목들의 점유 칸 수가 slotCapacity-1을 넘지 않음
 *   (2) 예산(feasibility) 제약: "새 식별자를 여는 행동"은 정확히 3칸의 미래 예산을 소모한다
 *       (이후 그 항목을 완성시키는 데 반드시 3번의 배정이 필요하므로). 남은 배열 길이에서
 *       이미 열려 있는 항목들을 마저 완성하는 데 필요한 수를 뺀 "여유(slack)"가 3 미만이면
 *       새로 열지 않는다 - 이걸 지키지 않으면 배열 끝에 도달했을 때 완성 못한 항목이 남는다.
 * @param {function} rng
 * @returns {string[]}
 */
function assignIdentities(order, widthFn, identityPool, slotCapacity = Infinity, rng = Math.random) {
  const assignment = new Array(order.length).fill(null);
  const open = []; // [{id, collected}] collected: 1(싱글) 또는 2(짝)
  let completedTriples = 0;
  const hardCeiling = slotCapacity === Infinity ? Infinity : slotCapacity - 1;
  const total = order.length;

  for (let i = 0; i < total; i++) {
    const remainingBudget = total - i;
    const neededForOpen = open.reduce((sum, o) => sum + (3 - o.collected), 0);
    const slack = remainingBudget - neededForOpen; // "새로 열기"만 정확히 3씩 소모하는 여유 예산

    const occupancy = open.reduce((sum, o) => sum + o.collected, 0);
    const targetOccupancy = Math.min(widthFn(completedTriples + 1), hardCeiling); // 난이도용 소프트 목표

    const completable = open.filter(o => o.collected === 2);
    const singles = open.filter(o => o.collected === 1);
    const availableToOpen = identityPool.filter(id => !open.some(o => o.id === id));

    // 하드 제약: 물리적으로 칸이 남아있어야 성장(싱글->짝, 신규 오픈) 가능
    const canGrowPhysically = occupancy < hardCeiling;
    // 하드 제약: 신규 오픈은 예산이 3 이상 남아있어야만 가능
    const canOpenNew = canGrowPhysically && slack >= 3 && availableToOpen.length > 0;
    // 소프트 선호: 난이도 곡선이 허용하는 범위 안에서만 "성장"을 하고 싶어함
    const wantsToGrow = occupancy < targetOccupancy;

    let chosen;
    if (completable.length > 0 && (!wantsToGrow || rng() < 0.4)) {
      // 완성시키기 - 언제나 안전. 난이도상 더 열고 싶지 않을 때는 무조건 우선.
      chosen = completable[Math.floor(rng() * completable.length)];
    } else if (canGrowPhysically && wantsToGrow && singles.length > 0 && rng() < 0.6) {
      // 기존 싱글을 짝으로 (예산을 소모하지 않는 안전한 진행)
      chosen = singles[Math.floor(rng() * singles.length)];
    } else if (canOpenNew && wantsToGrow) {
      const id = availableToOpen[Math.floor(rng() * availableToOpen.length)];
      chosen = { id, collected: 0 };
      open.push(chosen);
    } else if (completable.length > 0) {
      chosen = completable[0];
    } else if (canGrowPhysically && singles.length > 0) {
      // 안전장치: 난이도 목표는 넘기더라도(물리 한도 안에서) 진행 - 막힘 방지
      chosen = singles[0];
    } else if (canOpenNew) {
      const id = availableToOpen[0];
      chosen = { id, collected: 0 };
      open.push(chosen);
    } else if (singles.length > 0) {
      // 최후 수단: 물리 한도를 살짝 넘기게 되더라도(이론상 도달 시 slack 로직이 미리 막아줌) 진행
      chosen = singles[0];
    } else {
      const id = availableToOpen[0];
      chosen = { id, collected: 0 };
      open.push(chosen);
    }

    assignment[i] = chosen.id;
    chosen.collected += 1;

    if (chosen.collected === 3) {
      open.splice(open.indexOf(chosen), 1);
      completedTriples += 1;
    }
  }

  return assignment;
}

/**
 * 정답 순서 + 식별자 배정 결과를 실제 보드(스택 배열)로 변환
 */
function buildBoard(stackHeights, order, assignment) {
  const stacks = stackHeights.map(h => new Array(h).fill(null));
  order.forEach((pos, i) => {
    stacks[pos.stack][pos.index] = assignment[i];
  });
  return stacks;
}

// ============================================================
// 4. 플레이 시뮬레이터
// ============================================================

const REMOVED = Symbol('removed');

function getAccessible(stacks) {
  const accessible = [];
  stacks.forEach((s, si) => {
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i] !== REMOVED) {
        accessible.push({ stack: si, index: i, id: s[i] });
        break;
      }
    }
  });
  return accessible;
}

/**
 * 슬롯: 물리적으로 slotCapacity "칸"이 있고, 칸 하나에는 카드 한 장만 들어간다
 * (같은 식별자가 2장 있어도 칸 2개를 차지함 - 종류 개수가 아니라 카드 낱장 개수가 용량).
 * slot은 낱장 카드 식별자를 들어온 순서대로 담은 배열이다 (예: ['A','C','A']).
 * 같은 식별자 3장이 모이면 즉시 제거.
 *
 * 규칙(확정): "3번째 카드가 매칭을 완성하는지"를 용량 체크보다 먼저 판단한다.
 * 그래야 슬롯이 이미 꽉 찬 상태여도, 마지막 빈 칸에 들어온 카드가 기존 2장과
 * 매칭되는 3번째 카드라면 게임오버가 아니라 정상적으로 매칭 처리된다.
 * 게임오버는 "매칭이 안 되는 카드인데 넣을 빈 칸이 없는" 경우에만 발생한다.
 */
function pushAutoSlot(slot, id, capacity) {
  const idx1 = slot.indexOf(id);
  if (idx1 !== -1) {
    const idx2 = slot.indexOf(id, idx1 + 1);
    if (idx2 !== -1) {
      // 이미 2장이 슬롯에 있음 -> 이번 카드가 3번째, 매칭 완성
      // (이 카드 자체는 새 칸을 차지할 필요 없이 기존 2장만 제거하면 됨)
      slot.splice(idx2, 1);
      slot.splice(idx1, 1);
      return { gameOver: false, matched: true };
    }
  }

  if (slot.length >= capacity) {
    return { gameOver: true, matched: false };
  }
  slot.push(id);
  return { gameOver: false, matched: false };
}

/**
 * @param {Array} stacks
 * @param {number} slotCapacity
 * @param {function} chooseFn - (accessible, slot) => 선택된 accessible 항목 (없으면 null)
 */
function playout(stacks, slotCapacity, chooseFn) {
  const working = stacks.map(s => s.slice());
  const slot = [];
  const maxMoves = working.reduce((a, s) => a + s.length, 0);
  let moves = 0;

  while (moves < maxMoves) {
    const accessible = getAccessible(working);
    if (accessible.length === 0) break;
    const choice = chooseFn(accessible, slot);
    if (!choice) break;

    working[choice.stack][choice.index] = REMOVED;
    const res = pushAutoSlot(slot, choice.id, slotCapacity);
    moves += 1;
    if (res.gameOver) {
      return { result: 'lose', moves, reason: 'slot-full' };
    }
  }

  const remaining = working.some(s => s.some(c => c !== REMOVED));
  return { result: remaining ? 'stuck' : 'win', moves };
}

/** 정답 순서를 그대로 재생하는 플레이어 (항상 승리해야 정상) */
function makeSolutionPlayer(order) {
  let ptr = 0;
  return (accessible) => {
    while (ptr < order.length) {
      const target = order[ptr];
      ptr += 1;
      const found = accessible.find(a => a.stack === target.stack && a.index === target.index);
      if (found) return found;
    }
    return null;
  };
}

/** 매 순간 접근 가능한 카드 중 무작위로 선택하는 플레이어 (최악의 케이스 검증용) */
function randomPlayer(accessible) {
  return accessible[Math.floor(Math.random() * accessible.length)];
}

/**
 * 슬롯 상태를 살짝이라도 고려하는 플레이어 (실제 플레이어 체감 난이도에 더 가까움).
 * 이미 슬롯에 있는 식별자를 이어서 채울 수 있으면 그걸 우선 선택,
 * 없으면 무작위로 선택.
 */
/**
 * "요령 있는" 플레이어 시뮬레이션. 매칭을 완성시키는 카드(슬롯에 이미 2장 있는 종류)를
 * 최우선으로 선택한다 - 이게 항상 안전하고 슬롯 여유를 만들어주기 때문.
 * 완성 가능한 카드가 없으면 무작위로 선택.
 */
function makeHeuristicPlayer() {
  return (accessible, slot) => {
    const counts = {};
    slot.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
    const completing = accessible.filter(a => counts[a.id] === 2);
    if (completing.length > 0) return completing[Math.floor(Math.random() * completing.length)];
    const extending = accessible.filter(a => counts[a.id] === 1);
    if (extending.length > 0) return extending[Math.floor(Math.random() * extending.length)];
    return accessible[Math.floor(Math.random() * accessible.length)];
  };
}

function simulateSuccessRate(stacks, slotCapacity, trials, chooseFn = randomPlayer) {
  let wins = 0;
  for (let i = 0; i < trials; i++) {
    const r = playout(stacks, slotCapacity, chooseFn);
    if (r.result === 'win') wins += 1;
  }
  return wins / trials;
}

// ============================================================
// 4.5 재셔플(필드 카드 재배치) - 슬롯에 있던 카드도 필드로 돌아와 합쳐진 뒤
//     다시 유효한(클리어 가능한) 배치로 재생성된다.
// ============================================================

/**
 * 고정된 카드 개수(멀티셋)를 받아, 물리적 슬롯 점유 목표(maxOccupancy)를 지키는
 * 유효한 제거 순서를 생성한다. assignIdentities와 같은 원리(완성 가능한 짝 우선)를
 * 쓰지만, 식별자를 무한정 새로 만들 수 있는 게 아니라 이미 정해진 개수만큼만
 * 등장해야 하는 상황(재셔플)에 맞춰 개수 제약을 건다.
 * @param {Object<string, number>} counts - 식별자별 남은 카드 개수 (모두 3의 배수여야 함)
 * @param {number} maxOccupancy - 물리적으로 동시에 점유해도 되는 슬롯 칸 수 목표
 * @param {function} rng
 * @returns {string[]} 카드 개수 합계와 같은 길이의 식별자 배열
 */
function buildOrderForMultiset(counts, maxOccupancy, rng = Math.random) {
  const remaining = { ...counts };
  const total = Object.values(remaining).reduce((a, b) => a + b, 0);
  const open = []; // [{id, collected}]
  const result = [];

  while (result.length < total) {
    const remainingBudget = total - result.length;
    const neededForOpen = open.reduce((sum, o) => sum + (3 - o.collected), 0);
    const slack = remainingBudget - neededForOpen;

    const occupancy = open.reduce((sum, o) => sum + o.collected, 0);
    const completable = open.filter(o => o.collected === 2);
    const singles = open.filter(o => o.collected === 1);
    const idsWithStock = Object.keys(remaining).filter(
      id => remaining[id] > 0 && !open.some(o => o.id === id)
    );

    const canGrowPhysically = occupancy < maxOccupancy;
    const canOpenNew = canGrowPhysically && slack >= 3 && idsWithStock.length > 0;
    const wantsToGrow = occupancy < maxOccupancy;

    let entry;
    if (completable.length > 0 && (!wantsToGrow || rng() < 0.4)) {
      entry = completable[Math.floor(rng() * completable.length)];
    } else if (canGrowPhysically && wantsToGrow && singles.length > 0 && rng() < 0.6) {
      entry = singles[Math.floor(rng() * singles.length)];
    } else if (canOpenNew && wantsToGrow) {
      const id = idsWithStock[Math.floor(rng() * idsWithStock.length)];
      entry = { id, collected: 0 };
      open.push(entry);
    } else if (completable.length > 0) {
      entry = completable[0];
    } else if (canGrowPhysically && singles.length > 0) {
      entry = singles[0];
    } else if (canOpenNew) {
      const id = idsWithStock[0];
      entry = { id, collected: 0 };
      open.push(entry);
    } else if (singles.length > 0) {
      entry = singles[0];
    } else {
      const id = idsWithStock[0];
      entry = { id, collected: 0 };
      open.push(entry);
    }

    result.push(entry.id);
    entry.collected += 1;
    remaining[entry.id] -= 1;

    if (entry.collected === 3) {
      open.splice(open.indexOf(entry), 1);
    }
  }

  return result;
}

/**
 * 필드에 남은 카드 + 슬롯에 있던 카드를 모두 모아 새로운 유효한(클리어 가능한)
 * 배치로 재구성한다. 슬롯은 항상 빈 배열로 리셋된다.
 * @param {Array} stacks - 현재 필드 스택 상태 (REMOVED 마커 포함 가능)
 * @param {string[]} slot - 셔플 직전 슬롯 상태 (낱장 카드 식별자 배열)
 * @param {number} maxOccupancy - 재배치 시 물리적 동시 점유 목표 (보통 slotCapacity-1)
 * @param {function} rng
 * @returns {{stacks: Array, order: Array, slot: Array}}
 */
function reshuffleField(stacks, slot, maxOccupancy, rng = Math.random) {
  const counts = {};
  stacks.forEach(s => s.forEach(c => {
    if (c !== REMOVED) counts[c] = (counts[c] || 0) + 1;
  }));
  slot.forEach(id => {
    counts[id] = (counts[id] || 0) + 1;
  });

  const totalCards = Object.values(counts).reduce((a, b) => a + b, 0);
  const remainingTriples = totalCards / 3;
  const newHeights = defaultStackHeights(remainingTriples, stacks.length);

  const order = buildSolutionOrder(newHeights, rng);
  const assignment = buildOrderForMultiset(counts, maxOccupancy, rng);
  const newStacks = buildBoard(newHeights, order, assignment);

  return { stacks: newStacks, order, slot: [] };
}

// ============================================================
// 5. 데모 실행
// ============================================================

const SLOT_CAPACITY_BY_MODE = { normal: 7, hell: 5 };

/**
 * 한 판(라운드)을 생성한다. "스테이지"(고정 프리셋) 개념은 없음 - 매번 즉석 생성.
 * @param {Object} options
 * @param {'normal'|'hell'} options.mode
 * @param {string[]} options.identityPool - 카드 종류 목록
 * @param {'random'|'template'} [options.layoutSource='random']
 * @param {string} [options.templateId] - layoutSource='template'일 때 사용할 TEMPLATES의 키 (예: 'heart')
 * @param {number[]} [options.stackHeights] - templateId 대신 이미 변환된 더미 배열을 직접 넘길 수도 있음
 * @param {number} [options.totalTriples] - layoutSource='random'일 때 랜덤 분배용 트리플 개수
 * @param {number} [options.numStacks=6] - layoutSource='random'일 때 더미 개수
 * @param {boolean} [options.competitive=false] - true면 layoutSource를 강제로 'random'으로 덮어씀
 *   (경쟁/기록전 모드는 특정 모양을 미리 연습한 사람이 유리해지지 않도록 완전 무작위여야 공정함)
 * @param {function} [options.rng]
 * @param {Object} [options.overrides] - widthFn/slotCapacity 수동 오버라이드 (튜닝용)
 */
function generateRound(options) {
  const {
    mode,
    identityPool,
    layoutSource = 'random',
    templateId,
    stackHeights: explicitStackHeights,
    totalTriples: randomTotalTriples,
    numStacks = 6,
    competitive = false,
    rng = Math.random,
    overrides = {},
  } = options;

  const effectiveLayoutSource = competitive ? 'random' : layoutSource;

  let stackHeights;
  if (effectiveLayoutSource === 'template') {
    if (explicitStackHeights) {
      stackHeights = explicitStackHeights;
    } else {
      if (!templateId || !TEMPLATES[templateId]) {
        throw new Error(`알 수 없는 템플릿: ${templateId}`);
      }
      stackHeights = templateToStackHeights(TEMPLATES[templateId]());
    }
  } else {
    if (!randomTotalTriples) throw new Error('layoutSource가 random이면 totalTriples가 필요합니다.');
    stackHeights = defaultStackHeights(randomTotalTriples, numStacks);
  }

  const totalTiles = stackHeights.reduce((a, b) => a + b, 0);
  const totalTriples = totalTiles / 3;
  const order = buildSolutionOrder(stackHeights, rng);
  const widthFn = overrides.widthFn || widthCurve(mode, totalTriples);
  const slotCapacity = overrides.slotCapacity != null ? overrides.slotCapacity : SLOT_CAPACITY_BY_MODE[mode];
  // 매칭은 두 모드 모두 순서 무관(auto) 방식으로 통일 - LIFO/스택형은 폐기됨
  const assignment = assignIdentities(order, widthFn, identityPool, slotCapacity, rng);
  const board = buildBoard(stackHeights, order, assignment);
  return { board, order, widthFn, totalTriples, slotCapacity, layoutSource: effectiveLayoutSource };
}

function runDemo() {
  const identityPool = Array.from({ length: 8 }, (_, i) => String.fromCharCode(65 + i)); // 카드 8종
  const totalTriples = 20; // 60장 규모
  const trials = 3000;

  console.log('=== 노말 모드 (랜덤 레이아웃) ===');
  const normal = generateRound({ mode: 'normal', identityPool, layoutSource: 'random', totalTriples });
  console.log(`슬롯 용량: ${normal.slotCapacity}칸`);
  console.log('폭 커브 샘플:', [1, 3, 5, 7, 10].map(t => `t${t}=${normal.widthFn(t)}`).join(', '));
  const normalSolutionResult = playout(normal.board, normal.slotCapacity, makeSolutionPlayer(normal.order));
  console.log('정답 경로 재생 결과:', normalSolutionResult.result, '(반드시 win이어야 정상)');
  const normalRandomRate = simulateSuccessRate(normal.board, normal.slotCapacity, trials);
  const normalHeuristicRate = simulateSuccessRate(normal.board, normal.slotCapacity, trials, makeHeuristicPlayer());
  console.log(`무작위 플레이 성공률 (${trials}회): ${(normalRandomRate * 100).toFixed(1)}%`);
  console.log(`휴리스틱 플레이 성공률 (${trials}회): ${(normalHeuristicRate * 100).toFixed(1)}%`);

  console.log('\n=== 헬 모드 (랜덤 레이아웃) ===');
  const hell = generateRound({ mode: 'hell', identityPool, layoutSource: 'random', totalTriples });
  console.log(`슬롯 용량: ${hell.slotCapacity}칸`);
  console.log('폭 커브 샘플:', [1, 3, 5, 7, 10].map(t => `t${t}=${hell.widthFn(t)}`).join(', '));
  const hellSolutionResult = playout(hell.board, hell.slotCapacity, makeSolutionPlayer(hell.order));
  console.log('정답 경로 재생 결과:', hellSolutionResult.result, '(반드시 win이어야 정상)');
  const hellRandomRate = simulateSuccessRate(hell.board, hell.slotCapacity, trials);
  const hellHeuristicRate = simulateSuccessRate(hell.board, hell.slotCapacity, trials, makeHeuristicPlayer());
  console.log(`무작위 플레이 성공률 (${trials}회): ${(hellRandomRate * 100).toFixed(1)}%`);
  console.log(`휴리스틱 플레이 성공률 (${trials}회): ${(hellHeuristicRate * 100).toFixed(1)}%`);

  console.log('\n=== 하트 모양 템플릿 (일반 플레이) ===');
  const heartRound = generateRound({ mode: 'normal', identityPool, layoutSource: 'template', templateId: 'heart' });
  console.log(`더미 개수: ${heartRound.board.length}, 총 카드 수: ${heartRound.board.reduce((a, s) => a + s.length, 0)}`);
  const heartSolutionResult = playout(heartRound.board, heartRound.slotCapacity, makeSolutionPlayer(heartRound.order));
  console.log('정답 경로 재생 결과:', heartSolutionResult.result, '(반드시 win이어야 정상)');

  console.log('\n=== 경쟁 모드 (템플릿을 요청해도 강제로 랜덤 처리되는지 확인) ===');
  const competitiveRound = generateRound({
    mode: 'hell', identityPool, layoutSource: 'template', templateId: 'heart', totalTriples, competitive: true,
  });
  console.log('실제 적용된 layoutSource:', competitiveRound.layoutSource, "(반드시 'random'이어야 정상)");
}

// Node로 직접 실행했을 때만 데모 구동
if (require.main === module) {
  runDemo();
}

module.exports = {
  REMOVED,
  generateRound,
  reshuffleField,
  buildOrderForMultiset,
  parseCoordinateLayout,
  normalizeTemplateToMultipleOf3,
  templateToStackHeights,
  parseAsciiTemplate,
  TEMPLATES,
  defaultStackHeights,
  buildSolutionOrder,
  widthCurve,
  assignIdentities,
  buildBoard,
  getAccessible,
  pushAutoSlot,
  playout,
  makeSolutionPlayer,
  randomPlayer,
  makeHeuristicPlayer,
  simulateSuccessRate,
  SLOT_CAPACITY_BY_MODE,
};
