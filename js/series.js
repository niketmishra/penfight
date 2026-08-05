// The Daav: a betting series over multiple rounds. Everyone starts with
// Rs 100. Stakes climb every three rounds. Winner takes the big share,
// runner-up gets change, everyone else donates. Go broke and you are out.
// Pure state machine, no rendering, no network: every client that feeds it
// the same round results computes identical balances.

export const START_BALANCE = 100;
export const MAX_ROUNDS = 9;
export const KO_BOUNTY = 5;    // rupees per pen you knock off, paid from the pot

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

  // positions: participant ids ranked best first.
  // kills: id -> pens that player knocked off this round.
  //
  // Bounties are paid first, out of the same pot, and position splits what
  // is left. The pot is a closed system: what the table anted is exactly
  // what the table takes home, so knocking pens off moves money between
  // players rather than minting it.
  function settle(positions, kills = {}) {
    if (!anted) return {};
    const n = positions.length;
    const shares = SHARES[n] || SHARES[2];
    const pot = currentStake * n;

    // Bounty pool, clamped to the pot for the pathological case of a tiny
    // all-in stake with a lot of carnage.
    const bounty = {};
    let bountyTotal = 0;
    for (const id of positions) {
      const k = Math.max(0, Math.floor(kills[id] || 0));
      if (k > 0) { bounty[id] = k * KO_BOUNTY; bountyTotal += bounty[id]; }
    }
    if (bountyTotal > pot) {
      const k = pot / bountyTotal;
      bountyTotal = 0;
      for (const id of Object.keys(bounty)) {
        bounty[id] = Math.floor(bounty[id] * k);
        bountyTotal += bounty[id];
      }
    }

    // Split the remainder by position. Integer rupees only; the rounding
    // crumbs go to the winner so the pot still balances to the paisa.
    const rest = pot - bountyTotal;
    const unit = Math.floor(rest / n);
    let paid = 0;
    const byPos = positions.map((id, i) => {
      const win = (shares[i] || 0) * unit;
      paid += win;
      return win;
    });
    if (byPos.length) byPos[0] += rest - paid;

    const deltas = {};
    positions.forEach((id, i) => {
      const win = byPos[i] + (bounty[id] || 0);
      deltas[id] = win - currentStake;
      balances.set(id, (balances.get(id) || 0) + win);
    });
    history.push({ round: roundIdx, stake: currentStake, deltas, bounty });
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
