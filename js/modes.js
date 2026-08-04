// Game modes as data, and the single win-condition rule every code path
// consults. game.js checks its own alive map, room.js checks the roster;
// they share the rule here, not the state.

export const MODES = [
  {
    id: "classic",
    name: "Classic",
    desc: "Free for all. Last pen on the desk wins.",
    icon: "swords",
    storm: true,
    minPlayers: 2, maxPlayers: 6,
    unlock: 0
  },
  {
    id: "teams",
    name: "Team Match",
    desc: "Bench vs bench. Friendly fire is on, school rules.",
    icon: "bench",
    teams: true, storm: true,
    minPlayers: 4, maxPlayers: 6,
    unlock: 3
  },
  {
    id: "compassbox",
    name: "Compass Box",
    desc: "Wooden frame, four inkwells. Sink them like carrom, nothing falls off.",
    icon: "inkwell",
    holes: true, storm: false, walls: true,
    minPlayers: 2, maxPlayers: 6,
    unlock: 5
  },
  {
    id: "academy",
    name: "Trick Shot Academy",
    desc: "One pen, limited flicks, impossible angles.",
    icon: "target",
    solo: true, targets: true,
    unlock: 0
  },
  {
    id: "daily",
    name: "Daily Bawaal",
    desc: "Today's desk, everyone gets the same one. Score big, share it.",
    icon: "calendar",
    solo: true, storm: true, scored: true,
    unlock: 0
  }
];

export function modeById(id) {
  return MODES.find(m => m.id === id) || MODES[0];
}

// Seat -> team for team modes. Alternating seats = mixed benches.
export function teamOfSeat(seat) {
  return seat % 2;
}

export const TEAM_NAMES = ["Window Bench", "Door Bench"];
export const TEAM_COLORS = ["#3d7bff", "#ff5470"];

// The one rule. entries: [{id, alive, team?, connected?}] where connected
// defaults to true (practice). Returns {over, winnerId, winnerTeam}.
// lastFallen breaks the everyone-died tie.
export function decideWinner(entries, mode, { lastFallen = null, requireConnected = false } = {}) {
  const live = entries.filter(e => e.alive && (!requireConnected || e.connected !== false));

  if (mode && mode.teams) {
    const teams = new Set(live.map(e => e.team));
    if (teams.size > 1) return { over: false, winnerId: null, winnerTeam: null };
    if (teams.size === 1) {
      const team = live[0].team;
      return { over: true, winnerId: live[0].id, winnerTeam: team };
    }
    // Everyone fell: last team to lose a member wins.
    const fallen = entries.find(e => e.id === lastFallen);
    return {
      over: true,
      winnerId: lastFallen,
      winnerTeam: fallen ? fallen.team : null
    };
  }

  if (live.length > 1) return { over: false, winnerId: null, winnerTeam: null };
  if (live.length === 1) return { over: true, winnerId: live[0].id, winnerTeam: null };
  return { over: true, winnerId: lastFallen, winnerTeam: null };
}
