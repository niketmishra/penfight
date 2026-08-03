// Wire protocol for a room channel. Every payload carries `from`.
// Validators are deliberately shallow: they reject garbage shapes, and the
// turn machine ignores anything out of sequence anyway.

export const EV = {
  HELLO: "hello",
  ROSTER: "roster",
  PEN_PICK: "pen_pick",
  READY: "ready",
  START: "start",
  TURN_START: "turn_start",
  FLICK: "flick",
  SETTLE: "settle",
  GAME_OVER: "game_over",
  REMATCH: "rematch",
  HOST_CHANGE: "host_change",
  EMOJI: "emoji"
};

const num = v => typeof v === "number" && Number.isFinite(v);
const str = v => typeof v === "string" && v.length > 0 && v.length < 200;

const shapes = {
  [EV.HELLO]: p => str(p.name) && str(p.penId),
  [EV.ROSTER]: p => num(p.seq) && str(p.hostId) && Array.isArray(p.players),
  [EV.PEN_PICK]: p => str(p.penId),
  [EV.READY]: p => typeof p.ready === "boolean",
  [EV.START]: p => Array.isArray(p.order) && Array.isArray(p.layout)
    && (p.mode === undefined || str(p.mode))
    && (p.tableId === undefined || str(p.tableId))
    && (p.props === undefined || Array.isArray(p.props))
    && (p.zones === undefined || Array.isArray(p.zones)),
  [EV.TURN_START]: p => num(p.turnIdx) && str(p.playerId) && num(p.deadlineTs),
  [EV.FLICK]: p => num(p.turnIdx) && num(p.dx) && num(p.dy) && num(p.J) && num(p.off)
    && Array.isArray(p.preStates),
  [EV.SETTLE]: p => num(p.turnIdx) && Array.isArray(p.finalStates) && Array.isArray(p.fallen)
    && (p.skipped === undefined || Array.isArray(p.skipped)),
  [EV.GAME_OVER]: p => str(p.winnerId) && (p.winnerTeam === undefined || p.winnerTeam === null || num(p.winnerTeam)),
  [EV.REMATCH]: () => true,
  [EV.HOST_CHANGE]: p => str(p.newHostId),
  [EV.EMOJI]: p => str(p.emoji) && p.emoji.length <= 8
};

export function valid(event, payload) {
  if (!payload || !str(payload.from)) return false;
  const check = shapes[event];
  return check ? Boolean(check(payload)) : false;
}
