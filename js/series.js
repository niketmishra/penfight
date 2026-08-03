// The Daav: a betting series over multiple rounds. Everyone starts with
// Rs 100. Stakes climb every three rounds. Winner takes the big share,
// runner-up gets change, everyone else donates. Go broke and you are out.
// Pure state machine, no rendering, no network: every client that feeds it
// the same round results computes identical balances.

export const START_BALANCE = 100;
export const MAX_ROUNDS = 9;

// Payout shares in units of the stake, best position first.
// Sums always equal the player count, so the pot balances exactly.
const SHARES = {
  2: [2],
  3: [2, 1],
  4: [3, 1],
  5: [3, 2],
  6: [3, 2, 1]
};

export function stakeForRound(roundIdx) {
  return Math.min(3, Math.floor(roundIdx / 3) + 1) * 10;
}

export function createSeries(playerIds) {
  const balances = new Map(playerIds.map(id => [id, START_BALANCE]));
  let roundIdx = 0;
  let currentStake = 0;
  let anted = false;
  const history = [];

  function solvent() {
    return playerIds.filter(id => (balances.get(id) || 0) > 0);
  }

  // Stake for the coming round: the schedule, capped by the poorest solvent
  // player's balance (their all-in).
  function stake() {
    const s = solvent();
    if (!s.length) return 0;
    const poorest = Math.min(...s.map(id => balances.get(id)));
    return Math.min(stakeForRound(roundIdx), poorest);
  }

  // Collect the ante from every solvent player. Call once per round.
  function anteAll() {
    currentStake = stake();
    const participants = solvent();
    for (const id of participants) balances.set(id, balances.get(id) - currentStake);
    anted = true;
    return { stake: currentStake, pot: currentStake * participants.length, participants };
  }

  // positions: participant ids ranked best first. Returns per-player deltas.
  function settle(positions) {
    if (!anted) return {};
    const shares = SHARES[positions.length] || SHARES[2];
    const deltas = {};
    positions.forEach((id, i) => {
      const win = (shares[i] || 0) * currentStake;
      deltas[id] = win - currentStake;
      balances.set(id, (balances.get(id) || 0) + win);
    });
    history.push({ round: roundIdx, stake: currentStake, deltas });
    roundIdx += 1;
    anted = false;
    return deltas;
  }

  function over() {
    return solvent().length <= 1 || roundIdx >= MAX_ROUNDS;
  }

  function standings() {
    return [...playerIds]
      .map(id => ({ id, balance: balances.get(id) || 0 }))
      .sort((a, b) => b.balance - a.balance);
  }

  return {
    solvent, stake, anteAll, settle, over, standings, history,
    balance: id => balances.get(id) || 0,
    get roundIdx() { return roundIdx; },
    get roundNumber() { return roundIdx + 1; },
    winnerId: () => standings()[0] && standings()[0].id
  };
}
