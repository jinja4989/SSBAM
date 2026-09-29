/**
 * ============================================================
 *  초 고 맛 누 - 슬롯 매칭 코어 로직 (세션 모듈)
 * ============================================================
 *
 * stage-generator.js가 만든 board/order/slotCapacity를 받아서
 * 실제 "한 판을 플레이"하는 상태 머신을 제공한다. 프레임워크(Phaser 등)를
 * 전혀 모르며, 렌더링 계층은 이 모듈이 내보내는 이벤트만 구독하면 된다.
 *
 * 확정된 규칙 (사용자 답변 반영):
 * 1. 패배 판정: 슬롯은 칸 하나에 카드 한 장만 들어간다(물리 모델). 매칭 완성 여부를
 *    항상 용량 체크보다 먼저 판단하므로, 슬롯이 이미 꽉 찬 상태여도 마지막 빈 칸에
 *    들어온 카드가 기존 2장과 짝을 이루는 3번째 카드라면 정상 매칭된다. 게임오버는
 *    "매칭이 안 되는 카드인데 넣을 빈 칸이 없는" 경우에만 발생한다 (pushAutoSlot 참고).
 * 2. 슬롯 정렬: 들어온 순서대로 (session.slot 배열 자체가 곧 그 순서 - 별도 정렬 로직 불필요)
 * 3. 셔플: 슬롯에 있던 카드도 전부 필드로 돌아가 합쳐진 뒤 재배치, 슬롯은 0장으로 리셋
 * 4. 힌트: 스테이지 생성 시 만든 정답 경로(order)를 그대로 사용 - 별도 솔버 없이,
 *    "아직 제거되지 않은 카드 중 order상 가장 앞선 카드"를 반환하면 항상 유효한 힌트가 됨
 *    (각 더미 내부의 order 등장 순서는 항상 쌓인 순서와 같으므로, 플레이어가 정답
 *     경로를 벗어났더라도 이 방식은 항상 "현재 실제로 클릭 가능한" 카드를 가리킨다)
 * 5. 점수/콤보: 이 모듈은 전혀 모름 - listeners 훅으로만 바깥에 알림을 보낸다
 */

'use strict';

const {
  REMOVED,
  pushAutoSlot,
  reshuffleField,
} = require('./stage-generator.js');

/**
 * @param {Object} round - generateRound()의 반환값 (board, order, slotCapacity 등)
 * @returns {Object} session
 */
function createSession(round) {
  return {
    stacks: round.board.map(s => s.slice()),
    order: round.order,
    slot: [], // 낱장 카드 식별자 배열, 예: ['A','C','A'] - 배열 순서 = 들어온 순서
    slotCapacity: round.slotCapacity,
    status: 'playing', // 'playing' | 'win' | 'lose'
    moves: 0,
    hintsUsed: 0,
  };
}

function isCleared(stacks) {
  return !stacks.some(s => s.some(c => c !== REMOVED));
}

function findTopIndex(pile) {
  for (let i = pile.length - 1; i >= 0; i--) {
    if (pile[i] !== REMOVED) return i;
  }
  return -1;
}

/**
 * 카드 클릭 처리. listeners의 각 훅은 선택 사항이며, 렌더링/점수 등
 * 외부 시스템이 여기에 붙는다 (이 모듈 자체는 훅 호출 결과를 전혀 신경 쓰지 않음).
 * @param {Object} session
 * @param {number} stackIndex
 * @param {Object} [listeners]
 * @param {function} [listeners.onCardMoved] - ({stackIndex, id}) => void, 카드가 슬롯으로 이동할 때
 * @param {function} [listeners.onMatch] - ({id}) => void, 3개 모여서 제거될 때
 * @param {function} [listeners.onWin] - () => void
 * @param {function} [listeners.onLose] - () => void, 슬롯이 꽉 차는 순간
 * @returns {{ok: boolean, reason?: string}}
 */
function clickStack(session, stackIndex, listeners = {}) {
  if (session.status !== 'playing') {
    return { ok: false, reason: 'session-over' };
  }
  const pile = session.stacks[stackIndex];
  if (!pile) return { ok: false, reason: 'invalid-stack' };

  const topIndex = findTopIndex(pile);
  if (topIndex === -1) return { ok: false, reason: 'empty-stack' };

  const id = pile[topIndex];
  pile[topIndex] = REMOVED;
  session.moves += 1;
  listeners.onCardMoved && listeners.onCardMoved({ stackIndex, index: topIndex, id });

  const res = pushAutoSlot(session.slot, id, session.slotCapacity);

  if (res.matched) {
    listeners.onMatch && listeners.onMatch({ id });
  }

  if (res.gameOver) {
    session.status = 'lose';
    listeners.onLose && listeners.onLose();
    return { ok: true, matched: res.matched, gameOver: true };
  }

  if (isCleared(session.stacks)) {
    session.status = 'win';
    listeners.onWin && listeners.onWin();
  }

  return { ok: true, matched: res.matched, gameOver: false };
}

/**
 * 셔플 아이템. 슬롯에 있던 카드까지 전부 필드로 돌아가 합쳐진 뒤 재배치된다.
 * 재배치는 항상 클리어 가능한 배치로 보장됨(reshuffleField가 역방향 생성 재사용).
 * @param {Object} session
 * @param {Object} [listeners]
 * @param {function} [listeners.onShuffled] - () => void
 */
function useShuffle(session, listeners = {}) {
  if (session.status !== 'playing') return { ok: false, reason: 'session-over' };

  const maxWidth = Math.max(1, session.slotCapacity - 1); // 정답 경로가 즉시 게임오버 상태를 만들지 않도록
  const result = reshuffleField(session.stacks, session.slot, maxWidth);

  session.stacks = result.stacks;
  session.order = result.order;
  session.slot = result.slot; // 항상 빈 배열

  listeners.onShuffled && listeners.onShuffled();
  return { ok: true };
}

/**
 * 힌트. 정답 경로(session.order)에서 "아직 필드에 남아있는 카드 중 가장 앞선 것"을 반환한다.
 * 플레이어가 정답 경로를 벗어나 다르게 플레이했어도, 이 카드는 항상 현재 클릭 가능한
 * (자기 더미의 맨 위) 카드임이 보장된다 - 각 더미 안에서는 order 등장 순서가 항상
 * 물리적 쌓인 순서와 같기 때문에 별도의 재계산(솔버)이 필요 없다.
 * @param {Object} session
 * @returns {{stackIndex:number, id:string}|null} 더 이상 힌트가 없으면 null (승리 직전 등)
 */
function getHint(session) {
  for (const pos of session.order) {
    const card = session.stacks[pos.stack][pos.index];
    if (card !== REMOVED) {
      session.hintsUsed += 1;
      return { stackIndex: pos.stack, id: card };
    }
  }
  return null;
}

module.exports = {
  createSession,
  clickStack,
  useShuffle,
  getHint,
  isCleared,
};
