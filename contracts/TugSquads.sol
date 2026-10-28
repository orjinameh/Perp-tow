// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

struct VaultPosition {
    int128 size;
    uint128 avgEntryPrice;
    int256 entryFundingIndex;
    uint64 lastUpdatedTimestampNs;
}

interface IVaultBank {
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function getWithdrawableCollateral(address account) external view returns (uint256);
    function getPosition(address account, address perpPool) external view returns (VaultPosition memory);
}

interface IPerpPoolWrite {
    function placeOrder(bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) external;
}

interface IArenaForVault {
    function mayTrade(bytes32 key, address owner, address caller, address pool) external view returns (bool);
    function tradingOpen(bytes32 key) external view returns (bool);
    function started(bytes32 key) external view returns (bool);
    function releasable(bytes32 key) external view returns (bool);
}

/// One vault per player per match. It holds the player's equal starting bankroll in a dreamDEX margin account that ONLY
/// this contract controls, so nothing outside the match can add to or take from the player's score. It trades only when the
/// arena says the match is live and the caller is the player (or the player's approved bot), and it pays only its owner.
contract TraderVault {
    address public immutable arena;
    address public immutable owner;
    bytes32 public immutable key;
    IERC20 public immutable token;
    IVaultBank public immutable bank;
    uint8 internal constant MARKET = 2;

    constructor(address _arena, address _owner, bytes32 _key, IERC20 _token, IVaultBank _bank) {
        arena = _arena; owner = _owner; key = _key; token = _token; bank = _bank;
    }

    /// Called once by the arena right after it sent the bankroll: puts it all into the margin bank.
    function init() external {
        require(msg.sender == arena, "arena only");
        uint256 b = token.balanceOf(address(this));
        token.approve(address(bank), b);
        bank.deposit(b);
    }

    function _expiry() internal view returns (uint64) {
        return uint64((block.timestamp + 3600) * 1_000_000_000);
    }

    /// A real market order on a dreamDEX perp pool, from this vault's own margin account, only while the match is live.
    function trade(address pool, bool isBid, uint64 userData, uint256 price, uint256 quantity) external {
        require(IArenaForVault(arena).tradingOpen(key), "match is not live");
        require(IArenaForVault(arena).mayTrade(key, owner, msg.sender, pool), "not allowed");
        IPerpPoolWrite(pool).placeOrder(isBid, userData, price, quantity, _expiry(), MARKET, 0, address(0), 0);
    }

    /// Closes this vault's whole position on a pool with a market order the other way. Allowed any time after the lock.
    function close(address pool, uint256 price) external {
        require(IArenaForVault(arena).started(key), "match has not started");
        require(IArenaForVault(arena).mayTrade(key, owner, msg.sender, pool), "not allowed");
        VaultPosition memory p = bank.getPosition(address(this), pool);
        require(p.size != 0, "no position");
        bool isBid = p.size < 0;
        uint256 q = p.size < 0 ? uint256(-int256(p.size)) : uint256(int256(p.size));
        IPerpPoolWrite(pool).placeOrder(isBid, 0, price, q, _expiry(), MARKET, 0, address(0), 0);
    }

    /// Anyone may call this when the arena allows it. Whatever the bank lets out goes to the owner, never anywhere else.
    function release() external {
        require(IArenaForVault(arena).releasable(key), "not releasable yet");
        uint256 w = bank.getWithdrawableCollateral(address(this));
        if (w > 0) bank.withdraw(w);
        uint256 bal = token.balanceOf(address(this));
        if (bal > 0) require(token.transfer(owner, bal), "transfer");
    }
}

interface IMarginBank {
    function tryGetAccountEquity(address account) external view returns (bool ok, int256 equity);
}

interface IOperatorPermissions {
    function isApprovedForPool(address pool, address owner, address operator, bytes4 selector) external view returns (bool);
    function isGloballyApproved(address owner, address operator, bytes4 selector) external view returns (bool);
}

/// Perp Tug of War, squads version. One contract holds the seats AND the stakes.
///
///  1. A player takes a seat and stakes in the same transaction (`enter`). Leaving an open lobby refunds it.
///  2. When the lobby is full, or its timer ended and enough players said "continue", the match LOCKS and the
///     teams are drawn at random: each player is placed by their own random draw, so teams can be uneven. Nobody picks a side.
///  3. Players trade freely on dreamDEX for `duration` seconds from the lock. The two teams are scored on those trades.
///  4. Anyone can call `settle` once the match is over. The contract reads each player's real dreamDEX account equity
///     from the margin bank, once at the lock and once at the end, and the team with the higher average equity
///     change wins (each player's change is capped at +/- scoreCap). Winners split the losers' stakes minus a rake:
///     payout = stake + (1 - r) * stake * L / W. A tie or an unsettled match refunds everyone.
///  5. Anyone may lock a ready lobby, and anyone may claim for a player. Refunds always open after a grace period.
/// TRUST: nobody posts the result: it is computed on chain from dreamDEX's margin bank. The operator can only collect the rake.
/// KNOWN LIMIT: equity also moves when a player deposits or withdraws margin during the match. The cap bounds what that can win.
contract TugSquads {
    struct Seat {
        address player;
        bool confirmed;
    }

    struct Match {
        uint64 firstAt;   // block time of the first seat
        uint64 lockAt;    // block time the match locked (0 while open)
        bytes32 seed;     // randomness of the team draw, set at the lock
        uint8 result;     // 0 pending, 1 team Bulls won, 2 team Bears won, 3 refund
        bool cancelled;   // lobby ended without enough players: every stake is refundable
        uint256 rakeOwed;
        uint32 cap;       // seats in THIS match, chosen by whoever opens it
    }

    IERC20 public immutable token;
    address public immutable operator;
    uint256 public immutable stake;
    uint32 public immutable size;            // the most seats any match may have (the host picks the size of each match, 2..size)
    uint32 public immutable minPlayers;      // fewest players that can play a partly filled lobby
    uint64 public immutable lobbySeconds;    // lobby stays open this long after its first seat
    uint64 public immutable confirmSeconds;  // "continue with fewer players" window
    uint64 public immutable duration;        // seconds from the lock to the end of the match
    uint64 public immutable graceAfter;      // seconds after the end before an unsettled match refunds
    uint16 public immutable rakeBps;
    IMarginBank public immutable bank;       // dreamDEX margin bank: where equity is read
    uint256 public immutable bankroll;       // equal trading bankroll every player gets in their own vault
    int256 public immutable scoreCap;        // each player's equity change is clamped to +/- this many token units
    IOperatorPermissions public immutable perms; // dreamDEX's bot permission registry (0 = not used)
    bytes4 internal constant PLACE_ORDER_FOR = 0x80054449;

    mapping(bytes32 => Match) public matches;
    mapping(bytes32 => Seat[]) private _seats;
    mapping(bytes32 => mapping(address => bool)) public inMatch;
    mapping(bytes32 => mapping(address => bool)) public claimed;
    mapping(bytes32 => uint256) private _latest; // keccak(market) => highest match number used
    mapping(address => mapping(address => bool)) public botOf;
    mapping(bytes32 => mapping(address => TraderVault)) public vaultOf;
    mapping(bytes32 => mapping(address => int256)) public startEquity; // each player's margin-bank equity at the lock

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
        address bank;
        uint256 scoreCap;
        uint256 bankroll;
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
        bank = IMarginBank(p.bank);
        scoreCap = int256(p.scoreCap);
        bankroll = p.bankroll;
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
    /// `wantedSize` is how many seats the match has. Only the player who opens the match sets it; everyone else's is ignored.
    function enter(string calldata market, uint256 number, uint32 wantedSize) external {
        _enter(msg.sender, msg.sender, market, number, wantedSize);
    }

    /// A bot takes a seat for an account it may act for. The BOT pays the stake; seat, refund and payout belong to the account.
    function enterFor(address player, address pool, string calldata market, uint256 number, uint32 wantedSize) external {
        _auth(player, pool);
        _enter(player, msg.sender, market, number, wantedSize);
    }

    function _enter(address player, address payer, string calldata market, uint256 number, uint32 wantedSize) internal {
        require(number >= 1, "match number");
        bytes32 mh = keccak256(bytes(market));
        // numbers run in order: nobody can jump the counter far ahead and hide the real lobbies
        require(number <= _latest[mh] + 1, "match number too high");
        bytes32 key = keccak256(abi.encode(market, number));
        Match storage m = matches[key];
        require(!inMatch[key][player], "already in this match");
        if (m.firstAt == 0) {
            require(wantedSize >= 2 && wantedSize >= minPlayers && wantedSize <= size, "bad match size");
            m.cap = wantedSize;
            m.firstAt = uint64(block.timestamp);
        }
        require(_seats[key].length < m.cap, "match is full");
        require(m.lockAt == 0 && !m.cancelled && block.timestamp < m.firstAt + lobbySeconds, "lobby is closed");
        inMatch[key][player] = true;
        _seats[key].push(Seat(player, false));
        if (number > _latest[mh]) _latest[mh] = number;
        require(token.transferFrom(payer, address(this), stake), "stake transfer");
        _newVault(key, player, payer);
        uint32 seat = uint32(_seats[key].length);
        emit Entered(mh, number, player, seat);
        if (seat == m.cap) _lock(key, mh, number, m.cap); // a full match locks at once
    }

    /// The player's own vault: equal bankroll, controlled by nobody but the arena rules.
    function _newVault(bytes32 key, address player, address payer) internal {
        TraderVault v = new TraderVault(address(this), player, key, token, IVaultBank(address(bank)));
        require(token.transferFrom(payer, address(v), bankroll), "bankroll transfer");
        v.init();
        vaultOf[key][player] = v;
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
        vaultOf[key][player].release(); // the untouched bankroll goes back too
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
        // snapshot each playing account's real equity so the end can be compared with it
        Seat[] storage s = _seats[key];
        bool full = s.length == m.cap;
        for (uint256 i = 0; i < s.length; i++) {
            if (!full && !s[i].confirmed) continue;
            startEquity[key][s[i].player] = _equity(address(vaultOf[key][s[i].player]));
        }
        emit Locked(mh, number, players, m.seed);
    }

    // ----------------------------------------------------------------- teams

    /// 0 = not playing (no seat, not confirmed, or not locked yet), 1 = Bulls, 2 = Bears.
    /// Every playing seat is placed by its own random draw from the match seed, so a match can split 15/5 or 10/10.
    /// If the draw would put everybody on one side, the player with the lowest draw is moved across so both teams exist.
    function teamOf(bytes32 key, address player) public view returns (uint8) {
        Match storage m = matches[key];
        if (m.lockAt == 0 || m.cancelled || !inMatch[key][player]) return 0;
        Seat[] storage s = _seats[key];
        bool full = s.length == m.cap;
        uint256 n;
        uint256 bullsN;
        bool playing;
        address lowest;
        bytes32 lowestHash = bytes32(type(uint256).max);
        for (uint256 i = 0; i < s.length; i++) {
            if (!full && !s[i].confirmed) continue;
            n++;
            bytes32 h = keccak256(abi.encode(m.seed, s[i].player));
            if (uint256(h) & 1 == 1) bullsN++;
            if (h < lowestHash) { lowestHash = h; lowest = s[i].player; }
            if (s[i].player == player) playing = true;
        }
        if (!playing) return 0;
        uint8 t = (uint256(keccak256(abi.encode(m.seed, player))) & 1 == 1) ? 1 : 2;
        if (n >= 2 && (bullsN == 0 || bullsN == n) && player == lowest) t = (t == 1) ? 2 : 1;
        return t;
    }

    function teamSizes(bytes32 key) public view returns (uint32 bulls, uint32 bears) {
        Match storage m = matches[key];
        if (m.lockAt == 0 || m.cancelled) return (0, 0);
        Seat[] storage s = _seats[key];
        for (uint256 i = 0; i < s.length; i++) {
            uint8 t = teamOf(key, s[i].player);
            if (t == 1) bulls++; else if (t == 2) bears++;
        }
    }

    // ---------------------------------------------------------------- result

    function _equity(address a) internal view returns (int256 e) {
        try bank.tryGetAccountEquity(a) returns (bool ok, int256 eq) {
            return ok ? eq : int256(0);
        } catch {
            return 0;
        }
    }

    /// One player's score: their account equity now minus at the lock, clamped to +/- scoreCap. Computed live.
    function scoreOf(bytes32 key, address player) public view returns (int256) {
        int256 d = _equity(address(vaultOf[key][player])) - startEquity[key][player];
        if (d > scoreCap) return scoreCap;
        if (d < -scoreCap) return -scoreCap;
        return d;
    }

    /// Team averages right now, times 1e18 for precision: (bulls, bears).
    function teamScores(bytes32 key) public view returns (int256 bulls, int256 bears) {
        (uint32 rn, uint32 bn) = teamSizes(key);
        Seat[] storage s = _seats[key];
        int256 rs;
        int256 bs;
        for (uint256 i = 0; i < s.length; i++) {
            uint8 t = teamOf(key, s[i].player);
            if (t == 0) continue;
            int256 sc = scoreOf(key, s[i].player);
            if (t == 1) rs += sc; else bs += sc;
        }
        if (rn > 0) bulls = (rs * 1e18) / int256(uint256(rn));
        if (bn > 0) bears = (bs * 1e18) / int256(uint256(bn));
    }

    /// ANYONE can settle once the match is over. The winner is computed from dreamDEX equity, not posted by anybody.
    function settle(bytes32 key) external {
        Match storage m = matches[key];
        require(m.lockAt != 0 && m.result == 0 && !m.cancelled, "not settleable");
        require(block.timestamp >= m.lockAt + duration, "still running");
        require(block.timestamp < m.lockAt + duration + graceAfter, "refund window open");
        (uint32 bulls, uint32 bears) = teamSizes(key);
        uint8 result = 3;
        if (bulls > 0 && bears > 0) {
            (int256 rs, int256 bs) = teamScores(key);
            if (rs > bs) result = 1; else if (bs > rs) result = 2;
        }
        m.result = result;
        if (result == 1) m.rakeOwed = (uint256(bears) * stake * rakeBps) / 10_000;
        if (result == 2) m.rakeOwed = (uint256(bulls) * stake * rakeBps) / 10_000;
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
                if (t == m.result) {
                    (uint32 bulls, uint32 bears) = teamSizes(key);
                    uint256 w = m.result == 1 ? bulls : bears;
                    uint256 l = m.result == 1 ? bears : bulls;
                    amount = stake + (stake * l * (10_000 - rakeBps)) / (10_000 * w);
                } // a losing player gets nothing from the prize pool, only their bankroll back
            }
        } else if (block.timestamp >= m.firstAt + lobbySeconds + confirmSeconds + graceAfter && m.firstAt != 0) {
            amount = stake; // the lobby was never finished: everyone is refunded
        } else {
            revert("lobby still running");
        }
        claimed[key][player] = true;
        if (amount > 0) require(token.transfer(player, amount), "payout");
        try vaultOf[key][player].release() {} catch {} // the bankroll goes back to the player; never blocks the prize
        emit Claimed(key, player, amount);
    }

    /// Anyone can send a player's leftover bankroll back to them (for example after closing a position late).
    function release(bytes32 key, address player) external {
        vaultOf[key][player].release();
    }

    // ------------------------------------------------------------ vault rules

    function mayTrade(bytes32, address owner, address caller, address pool) external view returns (bool) {
        if (owner == caller || botOf[owner][caller]) return true;
        if (address(perms) != address(0)) {
            if (perms.isGloballyApproved(owner, caller, PLACE_ORDER_FOR)) return true;
            if (pool != address(0) && perms.isApprovedForPool(pool, owner, caller, PLACE_ORDER_FOR)) return true;
        }
        return false;
    }

    function tradingOpen(bytes32 key) external view returns (bool) {
        Match storage m = matches[key];
        return m.lockAt != 0 && !m.cancelled && block.timestamp < m.lockAt + duration;
    }

    function started(bytes32 key) external view returns (bool) {
        Match storage m = matches[key];
        return m.lockAt != 0 && !m.cancelled;
    }

    /// A vault pays out only when it cannot change a score: before the lock, after a cancel, after the result is posted,
    /// or once the refund window is open. Releasing earlier could be used to wreck a player's score.
    function releasable(bytes32 key) external view returns (bool) {
        Match storage m = matches[key];
        if (m.cancelled || m.lockAt == 0) return true;
        return m.result != 0 || block.timestamp >= m.lockAt + duration + graceAfter;
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
        returns (address[] memory players, bool[] memory confirmed, uint8[] memory teams, uint64 firstAt, uint64 lockAt, bool cancelled, uint8 result, uint32 cap)
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
        return (players, confirmed, teams, m.firstAt, m.lockAt, m.cancelled, m.result, m.cap);
    }
}
