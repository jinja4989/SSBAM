'use strict';

const { generateRound, REMOVED } = require('./stage-generator.js');
const { createSession, clickStack, useShuffle, getHint } = require('./slot-core.js');

function playFollowingHintsOnly(round, { shuffleAfterMoves = null } = {}) {
  const session = createSession(round);
  const events = { matches: 0, cardsMoved: 0, shuffled: false };
  const listeners = {
    onCardMoved: () => { events.cardsMoved += 1; },
    onMatch: () => { events.matches += 1; },
    onShuffled: () => { events.shuffled = true; },
  };

  let guard = 0;
  while (session.status === 'playing') {
    guard += 1;
    if (guard > 5000) throw new Error('무한루프 감지 - 힌트가 막다른 상태를 반환했을 가능성');

    if (shuffleAfterMoves != null && session.moves === shuffleAfterMoves) {
      useShuffle(session, listeners);
    }

    const hint = getHint(session);
    if (!hint) break; // 더 이상 카드 없음 (승리 직전)
    clickStack(session, hint.stackIndex, listeners);
  }

  return { session, events };
}

const identityPool = Array.from({ length: 8 }, (_, i) => String.fromCharCode(65 + i));

console.log('=== 테스트 1: 힌트만 따라가는 플레이 (노말, 셔플 없음) ===');
{
  const round = generateRound({ mode: 'normal', identityPool, layoutSource: 'random', totalTriples: 20 });
  const { session, events } = playFollowingHintsOnly(round);
  console.log('결과:', session.status, '(반드시 win)');
  console.log('이동 수:', session.moves, '매칭 수:', events.matches, '(20트리플이므로 매칭 20회 기대)');
}

console.log('\n=== 테스트 2: 힌트만 따라가는 플레이 (헬, 셔플 없음) ===');
{
  const round = generateRound({ mode: 'hell', identityPool, layoutSource: 'random', totalTriples: 20 });
  const { session, events } = playFollowingHintsOnly(round);
  console.log('결과:', session.status, '(반드시 win)');
  console.log('이동 수:', session.moves, '매칭 수:', events.matches);
}

console.log('\n=== 테스트 3: 중간에 셔플 사용 후에도 계속 풀리는지 ===');
{
  const round = generateRound({ mode: 'normal', identityPool, layoutSource: 'random', totalTriples: 20 });
  const { session, events } = playFollowingHintsOnly(round, { shuffleAfterMoves: 15 });
  console.log('결과:', session.status, '(반드시 win)');
  console.log('셔플 발생:', events.shuffled, '이동 수:', session.moves);
}

console.log('\n=== 테스트 4: 하트 템플릿 + 힌트 플레이 ===');
{
  const round = generateRound({ mode: 'normal', identityPool, layoutSource: 'template', templateId: 'heart' });
  const { session } = playFollowingHintsOnly(round);
  console.log('결과:', session.status, '(반드시 win)');
}

console.log('\n=== 테스트 5: 일부러 슬롯을 가득 채워 패배 처리가 올바른지 ===');
{
  const round = generateRound({ mode: 'hell', identityPool, layoutSource: 'random', totalTriples: 20 });
  const session = createSession(round);
  let lost = false;
  const listeners = { onLose: () => { lost = true; } };

  let guard = 0;
  while (session.status === 'playing' && guard < 200) {
    guard += 1;
    let picked = -1;
    for (let i = 0; i < session.stacks.length; i++) {
      const pile = session.stacks[i];
      let top;
      for (let j = pile.length - 1; j >= 0; j--) {
        if (pile[j] !== REMOVED) { top = pile[j]; break; }
      }
      if (top === undefined) continue;
      const alreadyInSlot = session.slot.some(s => s.id === top);
      if (!alreadyInSlot) { picked = i; break; }
    }
    if (picked === -1) {
      picked = session.stacks.findIndex(pile => pile.some(c => c !== REMOVED));
      if (picked === -1) break;
    }
    clickStack(session, picked, listeners);
  }
  console.log('결과:', session.status, 'onLose 콜백 호출됨:', lost);
}
