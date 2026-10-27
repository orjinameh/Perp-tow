// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IOperatorPermissions {
    function isApprovedForPool(address pool, address owner, address operator, bytes4 selector) external view returns (bool);
    function isGloballyApproved(address owner, address operator, bytes4 selector) external view returns (bool);
}

/// Perp Tug of War, squads version. One contract holds the seats AND the stakes.
///
///  1. A player takes a seat and stakes in the same transaction (`enter`). Leaving an open lobby refunds it.
///  2. When the lobby is full, or its timer ended and enough players said "continue", the match LOCKS and the
///     teams are drawn at random, balanced to within one player. Nobody picks a side.
///  3. Players trade freely on dreamDEX for `duration` seconds from the lock. The two teams are scored on those trades.
///  4. The operator posts the winning team (`settle`). Winners split the losers' stakes minus a rake:
///     payout = stake + (1 - r) * stake * L / W. A tie or an unsettled match refunds everyone.
///  5. Anyone may lock a ready lobby, and anyone may claim for a player. Refunds always open after a grace period.
/// TRUST: the operator posts which team won, computed from public dreamDEX data. It cannot take stakes, only the rake.
contract TugSquads {
    struct Seat {
        address player;
        bool confirmed;
    }

    struct Match {
        uint64 firstAt;   // block time of the first seat
        uint64 lockAt;    // block time the match locked (0 while open)
        bytes32 seed;     // randomness of the team draw, set at the lock
        uint8 result;     // 0 pending, 1 team Red won, 2 team Blue won, 3 refund
        bool cancelled;   // lobby ended without enough players: every stake is refundable
        uint256 rakeOwed;
    }

    IERC20 public immutable token;
    address public immutable operator;
    uint256 public immutable stake;
    uint32 public immutable size;            // seats per match
    uint32 public immutable minPlayers;      // fewest players that can play a partly filled lobby
    uint64 public immutable lobbySeconds;    // lobby stays open this long after its first seat
    uint64 public immutable confirmSeconds;  // "continue with fewer players" window
    uint64 public immutable duration;        // seconds from the lock to the end of the match
    uint64 public immutable graceAfter;      // seconds after the end before an unsettled match refunds
    uint16 public immutable rakeBps;
    IOperatorPermissions public immutable perms; // dreamDEX's bot permission registry (0 = not used)
    bytes4 internal constant PLACE_ORDER_FOR = 0x80054449;

    mapping(bytes32 => Match) public matches;
    mapping(bytes32 => Seat[]) private _seats;
    mapping(bytes32 => mapping(address => bool)) public inMatch;
    mapping(bytes32 => mapping(address => bool)) public claimed;
    mapping(bytes32 => uint256) private _latest; // keccak(market) => highest match number used
    mapping(address => mapping(address => bool)) public botOf;

    event Entered(bytes32 indexed marketHash, uint256 indexed number, address indexed player, uint32 seat);
    event Confirmed(bytes32 indexed marketHash, uint256 indexed number, address indexed player);
    event Left(bytes32 indexed marketHash, uint256 indexed number, address indexed player);
    event Locked(bytes32 indexed marketHash, uint256 indexed number, uint32 players, bytes32 seed);
    event Cancelled(bytes32 indexed marketHash, uint256 indexed number);
    event Settled(bytes32 indexed key, uint8 result);
    event Claimed(bytes32 indexed key, address indexed player, uint256 amount);
    event BotSet(address indexed player, address indexed bot, bool allowed);

    struct Params {
        IERC20 token;
        uint256 stake;
        uint32 size;
        uint32 minPlayers;
        uint64 lobbySeconds;
        uint64 confirmSeconds;
        uint64 duration;
        uint64 graceAfter;
        uint16 rakeBps;
        address perms;
    }

    constructor(Params memory p) {
        require(p.size >= 2 && p.minPlayers >= 2 && p.minPlayers <= p.size && p.rakeBps <= 3000, "bad params");
        operator = msg.sender;
        token = p.token;
        stake = p.stake;
        size = p.size;
        minPlayers = p.minPlayers;
        lobbySeconds = p.lobbySeconds;
        confirmSeconds = p.confirmSeconds;
        duration = p.duration;
        graceAfter = p.graceAfter;
        rakeBps = p.rakeBps;
        perms = IOperatorPermissions(p.perms);
    }

    // ------------------------------------------------------------------ bots

    function setBot(address bot, bool allowed) external {
        botOf[msg.sender][bot] = allowed;
        emit BotSet(msg.sender, bot, allowed);
    }

    function _auth(address player, address pool) internal view {
        if (player == msg.sender || botOf[player][msg.sender]) return;
        // dreamDEX's own "Add bot" permission counts too
        if (address(perms) != address(0)) {
            if (perms.isGloballyApproved(player, msg.sender, PLACE_ORDER_FOR)) return;
            if (pool != address(0) && perms.isApprovedForPool(pool, player, msg.sender, PLACE_ORDER_FOR)) return;
        }
        revert("not allowed");
    }

    // ----------------------------------------------------------------- lobby

    function keyOf(string calldata market, uint256 number) public pure returns (bytes32) {
        return keccak256(abi.encode(market, number));
    }

    /// Take a seat and stake. The stake is pulled from the caller.
    function enter(string calldata market, uint256 number) external {
        _enter(msg.sender, msg.sender, market, number);
    }

    /// A bot takes a seat for an account it may act for. The BOT pays the stake; seat, refund and payout belong to the account.
    function enterFor(address player, address pool, string calldata market, uint256 number) external {
        _auth(player, pool);
        _enter(player, msg.sender, market, number);
    }

    function _enter(address player, address payer, string calldata market, uint256 number) internal {
        require(number >= 1, "match number");
        bytes32 mh = keccak256(bytes(market));
        // numbers run in order: nobody can jump the counter far ahead and hide the real lobbies
        require(number <= _latest[mh] + 1, "match number too high");
        bytes32 key = keccak256(abi.encode(market, number));
        Match storage m = matches[key];
        require(!inMatch[key][player], "already in this match");
        require(_seats[key].length < size, "match is full");
        if (m.firstAt == 0) m.firstAt = uint64(block.timestamp);
        require(m.lockAt == 0 && !m.cancelled && block.timestamp < m.firstAt + lobbySeconds, "lobby is closed");
        inMatch[key][player] = true;
        _seats[key].push(Seat(player, false));
        if (number > _latest[mh]) _latest[mh] = number;
        require(token.transferFrom(payer, address(this), stake), "stake transfer");
        uint32 seat = uint32(_seats[key].length);
        emit Entered(mh, number, player, seat);
        if (seat == size) _lock(key, mh, number, size); // a full match locks at once
    }

    /// Give up a seat while the lobby is open. The stake comes back.
    function leave(string calldata market, uint256 number) external {
        _leave(msg.sender, market, number);
    }

    function leaveFor(address player, address pool, string calldata market, uint256 number) external {
        _auth(player, pool);
        _leave(player, market, number);
    }

    function _leave(address player, string calldata market, uint256 number) internal {
        bytes32 key = keccak256(abi.encode(market, number));
        Match storage m = matches[key];
        require(m.lockAt == 0 && !m.cancelled && block.timestamp < m.firstAt + lobbySeconds, "lobby is closed");
        require(inMatch[key][player], "not in this match");
        Seat[] storage s = _seats[key];
        for (uint256 i = 0; i < s.length; i++) {
            if (s[i].player == player) {
                s[i] = s[s.length - 1];
                s.pop();
                break;
            }
        }
        inMatch[key][player] = false;
        require(token.transfer(player, stake), "refund");
        emit Left(keccak256(bytes(market)), number, player);
    }

    /// Say "yes, continue with fewer players" while the confirm window of an unfilled lobby is open.
    function confirm(string calldata market, uint256 number) external {
        _confirm(msg.sender, market, number);
    }

    function confirmFor(address player, address pool, string calldata market, uint256 number) external {
        _auth(player, pool);
        _confirm(player, market, number);
    }

    function _confirm(address player, string calldata market, uint256 number) internal {
        bytes32 key = keccak256(abi.encode(market, number));
        Match storage m = matches[key];
        require(m.lockAt == 0 && !m.cancelled && m.firstAt != 0, "not confirmable");
        uint64 lobbyEnd = m.firstAt + lobbySeconds;
        require(block.timestamp >= lobbyEnd, "lobby still open");
        require(block.timestamp < lobbyEnd + confirmSeconds, "confirm window closed");
        Seat[] storage s = _seats[key];
        for (uint256 i = 0; i < s.length; i++) {
            if (s[i].player == player) {
                s[i].confirmed = true;
                emit Confirmed(keccak256(bytes(market)), number, player);
                return;
            }
        }
        revert("not in this match");
    }

    /// Anyone can finish an unfilled lobby once its confirm window has ended: it locks if enough players confirmed,
    /// and is cancelled (everyone refundable) otherwise.
    function finish(string calldata market, uint256 number) external {
        bytes32 key = keccak256(abi.encode(market, number));
        Match storage m = matches[key];
        require(m.firstAt != 0 && m.lockAt == 0 && !m.cancelled, "nothing to finish");
        require(block.timestamp >= m.firstAt + lobbySeconds + confirmSeconds, "confirm window still open");
        Seat[] storage s = _seats[key];
        uint32 n;
        for (uint256 i = 0; i < s.length; i++) if (s[i].confirmed) n++;
        bytes32 mh = keccak256(bytes(market));
        if (n >= minPlayers) {
            // only the players who confirmed play; the others get their stake back
            _lock(key, mh, number, n);
        } else {
            m.cancelled = true;
            emit Cancelled(mh, number);
        }
    }

    function _lock(bytes32 key, bytes32 mh, uint256 number, uint32 players) internal {
        Match storage m = matches[key];
        m.lockAt = uint64(block.timestamp);
        // random draw from the previous block's hash: good enough for a testnet game
        m.seed = keccak256(abi.encode(blockhash(block.number - 1), key, players, block.timestamp));
        emit Locked(mh, number, players, m.seed);
    }

    // ----------------------------------------------------------------- teams

    /// 0 = not playing (no seat, not confirmed, or not locked yet), 1 = Red, 2 = Blue.
    /// The draw ranks the players by a hash of the seed and their address, then splits them in half.
    function teamOf(bytes32 key, address player) public view returns (uint8) {
        Match storage m = matches[key];
        if (m.lockAt == 0 || m.cancelled || !inMatch[key][player]) return 0;
        Seat[] storage s = _seats[key];
        bool full = s.length == size;
        uint256 n;
        uint256 rank;
        bytes32 mine = keccak256(abi.encode(m.seed, player));
        bool playing;
        for (uint256 i = 0; i < s.length; i++) {
            if (!full && !s[i].confirmed) continue;
            n++;
            if (s[i].player == player) playing = true;
            else if (keccak256(abi.encode(m.seed, s[i].player)) < mine) rank++;
        }
        if (!playing) return 0;
        return rank < (n + 1) / 2 ? 1 : 2;
    }

    function teamSizes(bytes32 key) public view returns (uint32 red, uint32 blue) {
        Match storage m = matches[key];
        if (m.lockAt == 0 || m.cancelled) return (0, 0);
        Seat[] storage s = _seats[key];
        for (uint256 i = 0; i < s.length; i++) {
            uint8 t = teamOf(key, s[i].player);
            if (t == 1) red++; else if (t == 2) blue++;
        }
    }

    // ---------------------------------------------------------------- result

    /// Operator posts the winning team (1 Red, 2 Blue) or 3 for a tie, once the match is over.
    function settle(bytes32 key, uint8 result) external {
        require(msg.sender == operator, "operator only");
        Match storage m = matches[key];
        require(m.lockAt != 0 && m.result == 0 && !m.cancelled, "not settleable");
        require(block.timestamp >= m.lockAt + duration, "still running");
        require(block.timestamp < m.lockAt + duration + graceAfter, "refund window open");
        require(result >= 1 && result <= 3, "result");
        (uint32 red, uint32 blue) = teamSizes(key);
        if (red == 0 || blue == 0) result = 3;
        m.result = result;
        if (result == 1) m.rakeOwed = (uint256(blue) * stake * rakeBps) / 10_000;
        if (result == 2) m.rakeOwed = (uint256(red) * stake * rakeBps) / 10_000;
        emit Settled(key, result);
    }

    function _refundOpen(Match storage m) internal view returns (bool) {
        if (m.cancelled || m.result == 3) return true;
        return m.result == 0 && m.lockAt != 0 && block.timestamp >= m.lockAt + duration + graceAfter;
    }

    /// Pays a player. Anyone can call it: the money always goes to the player.
    function claim(bytes32 key, address player) external {
        _claim(key, player);
    }

    function claimFor(address player, address pool, bytes32 key) external {
        _auth(player, pool);
        _claim(key, player);
    }

    function _claim(bytes32 key, address player) internal {
        Match storage m = matches[key];
        require(inMatch[key][player] && !claimed[key][player], "nothing to claim");
        uint256 amount;
        if (_refundOpen(m)) {
            amount = stake;
        } else if (m.lockAt != 0 && m.result == 0) {
            revert("not settled");
        } else if (m.lockAt != 0) {
            uint8 t = teamOf(key, player);
            if (t == 0) {
                amount = stake; // locked without this player: they did not confirm
            } else {
                require(t == m.result, "lost");
                (uint32 red, uint32 blue) = teamSizes(key);
                uint256 w = m.result == 1 ? red : blue;
                uint256 l = m.result == 1 ? blue : red;
                amount = stake + (stake * l * (10_000 - rakeBps)) / (10_000 * w);
            }
        } else if (block.timestamp >= m.firstAt + lobbySeconds + confirmSeconds + graceAfter && m.firstAt != 0) {
            amount = stake; // the lobby was never finished: everyone is refunded
        } else {
            revert("lobby still running");
        }
        claimed[key][player] = true;
        require(token.transfer(player, amount), "payout");
        emit Claimed(key, player, amount);
    }

    /// Operator collects the rake of a settled match, once.
    function collectRake(bytes32 key) external {
        require(msg.sender == operator, "operator only");
        uint256 r = matches[key].rakeOwed;
        require(r > 0, "no rake");
        matches[key].rakeOwed = 0;
        require(token.transfer(operator, r), "rake");
    }

    // ----------------------------------------------------------------- reads

    function latestMatch(string calldata market) external view returns (uint256) {
        return _latest[keccak256(bytes(market))];
    }

    function roster(string calldata market, uint256 number)
        external
        view
        returns (address[] memory players, bool[] memory confirmed, uint8[] memory teams, uint64 firstAt, uint64 lockAt, bool cancelled, uint8 result)
    {
        bytes32 key = keccak256(abi.encode(market, number));
        Seat[] storage s = _seats[key];
        players = new address[](s.length);
        confirmed = new bool[](s.length);
        teams = new uint8[](s.length);
        for (uint256 i = 0; i < s.length; i++) {
            players[i] = s[i].player;
            confirmed[i] = s[i].confirmed;
            teams[i] = teamOf(key, s[i].player);
        }
        Match storage m = matches[key];
        return (players, confirmed, teams, m.firstAt, m.lockAt, m.cancelled, m.result);
    }
}
