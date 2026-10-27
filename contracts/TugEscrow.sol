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

/// Escrow for the Perp Tug of War game. Players deposit a fixed stake on a side; when the
/// roster is full the match starts; after `duration` the operator posts the result; winners
/// split the losing pool minus a rake: payout = e + (1 - r) * e * L / W.
/// Tie, one-sided roster, or an operator who never settles: everyone can reclaim their stake.
/// TRUST: the operator posts the result (computed from public dreamDEX candle data). It cannot
/// take stakes: the only funds it can withdraw are the rake of a settled match.
contract TugEscrow {
    enum Side { None, Bulls, Bears }
    enum Result { Pending, Bulls, Bears, Refund }

    struct Match {
        uint32 bulls;
        uint32 bears;
        uint64 startedAt;
        Result result;
        uint256 rakeOwed;
    }

    IERC20 public immutable token;
    address public immutable operator;
    uint256 public immutable stake;      // e, in token units
    uint32 public immutable size;        // players per match
    uint64 public immutable duration;    // seconds a match runs
    uint64 public immutable graceAfter;  // seconds after the end before refunds open
    uint16 public immutable rakeBps;     // r, 2000 = 20%
    IOperatorPermissions public immutable perms; // dreamDEX's bot permission registry (0 = not used)
    bytes4 internal constant PLACE_ORDER_FOR = 0x80054449;

    // key: keccak256(market symbol, match number)
    mapping(bytes32 => Match) public matches;
    mapping(bytes32 => mapping(address => Side)) public sideOf;
    mapping(bytes32 => mapping(address => bool)) public claimed;

    // An account can approve a bot (the game wallet in its browser), here or through dreamDEX's "Add bot". The bot
    // may stake, leave and claim for the account. It pays the stake itself; refunds and payouts always go to the account.
    mapping(address => mapping(address => bool)) public botOf;
    event BotSet(address indexed player, address indexed bot, bool allowed);

    event Joined(bytes32 indexed key, address indexed player, Side side, uint32 total);
    event Started(bytes32 indexed key, uint64 startedAt);
    event Settled(bytes32 indexed key, Result result);
    event Left(bytes32 indexed key, address indexed player);
    event Claimed(bytes32 indexed key, address indexed player, uint256 amount);

    constructor(IERC20 _token, uint256 _stake, uint32 _size, uint64 _duration, uint64 _graceAfter, uint16 _rakeBps, address _perms) {
        require(_size >= 2 && _rakeBps <= 3000, "bad params");
        token = _token; operator = msg.sender; stake = _stake; size = _size;
        duration = _duration; graceAfter = _graceAfter; rakeBps = _rakeBps;
        perms = IOperatorPermissions(_perms);
    }

    function keyOf(string calldata market, uint256 number) public pure returns (bytes32) {
        return keccak256(abi.encode(market, number));
    }

    function setBot(address bot, bool allowed) external {
        botOf[msg.sender][bot] = allowed;
        emit BotSet(msg.sender, bot, allowed);
    }

    function _auth(address player, address pool) internal view {
        if (player == msg.sender || botOf[player][msg.sender]) return;
        // dreamDEX's own "Add bot" permission counts too: a bot that may place orders for the account may act for it here
        if (address(perms) != address(0)) {
            if (perms.isGloballyApproved(player, msg.sender, PLACE_ORDER_FOR)) return;
            if (pool != address(0) && perms.isApprovedForPool(pool, player, msg.sender, PLACE_ORDER_FOR)) return;
        }
        revert("not allowed");
    }

    function join(bytes32 key, Side side) external {
        _join(msg.sender, msg.sender, key, side);
    }

    /// A bot stakes for an account that approved it. The BOT pays the stake from its own balance; the seat, any
    /// refund and any payout belong to the account, so the bot can never take the account's tokens.
    function joinFor(address player, address pool, bytes32 key, Side side) external {
        _auth(player, pool);
        _join(player, msg.sender, key, side);
    }

    function _join(address player, address payer, bytes32 key, Side side) internal {
        require(side == Side.Bulls || side == Side.Bears, "side");
        Match storage m = matches[key];
        require(m.startedAt == 0, "already started");
        require(sideOf[key][player] == Side.None, "already in");
        sideOf[key][player] = side;
        if (side == Side.Bulls) m.bulls++; else m.bears++;
        require(token.transferFrom(payer, address(this), stake), "stake transfer");
        uint32 total = m.bulls + m.bears;
        emit Joined(key, player, side, total);
    }

    /// Operator closes the staking window (the trade window of the app) and starts the match. With fewer
    /// than two players or only one team, nobody plays and every stake can be taken back with `claim`.
    function start(bytes32 key) external {
        require(msg.sender == operator, "operator only");
        Match storage m = matches[key];
        require(m.startedAt == 0 && m.result == Result.Pending, "already started");
        require(m.bulls + m.bears > 0, "nobody staked");
        m.startedAt = uint64(block.timestamp);
        if (m.bulls + m.bears < 2 || m.bulls == 0 || m.bears == 0) m.result = Result.Refund;
        emit Started(key, m.startedAt);
    }

    /// Before a match starts, a player can take their stake back and give up the seat.
    function leave(bytes32 key) external {
        _leave(msg.sender, key);
    }

    function leaveFor(address player, address pool, bytes32 key) external {
        _auth(player, pool);
        _leave(player, key);
    }

    function _leave(address player, bytes32 key) internal {
        Match storage m = matches[key];
        require(m.startedAt == 0, "already started");
        Side s = sideOf[key][player];
        require(s != Side.None, "not in this match");
        sideOf[key][player] = Side.None;
        if (s == Side.Bulls) m.bulls--; else m.bears--;
        require(token.transfer(player, stake), "refund");
        emit Left(key, player);
    }

    /// Operator posts who won once the match is over. A one-sided roster or a tie is a Refund.
    function settle(bytes32 key, Result result) external {
        require(msg.sender == operator, "operator only");
        Match storage m = matches[key];
        require(m.startedAt != 0 && m.result == Result.Pending, "not settleable");
        require(block.timestamp >= m.startedAt + duration, "still running");
        // once refunds have opened a result can no longer be posted, or early refunds and payouts could exceed the pool
        require(block.timestamp < m.startedAt + duration + graceAfter, "refund window open");
        require(result != Result.Pending, "result");
        if (m.bulls == 0 || m.bears == 0) result = Result.Refund;
        m.result = result;
        if (result == Result.Bulls) m.rakeOwed = (uint256(m.bears) * stake * rakeBps) / 10_000;
        if (result == Result.Bears) m.rakeOwed = (uint256(m.bulls) * stake * rakeBps) / 10_000;
        emit Settled(key, result);
    }

    function _refundOpen(Match storage m) internal view returns (bool) {
        return m.result == Result.Refund || (m.result == Result.Pending && m.startedAt != 0 && block.timestamp >= m.startedAt + duration + graceAfter);
    }

    function claim(bytes32 key) external {
        _claim(msg.sender, key);
    }

    function claimFor(address player, address pool, bytes32 key) external {
        _auth(player, pool);
        _claim(player, key);
    }

    function _claim(address player, bytes32 key) internal {
        Match storage m = matches[key];
        Side s = sideOf[key][player];
        require(s != Side.None && !claimed[key][player], "nothing to claim");
        uint256 amount;
        if (_refundOpen(m)) {
            amount = stake;
        } else if (m.result == Result.Bulls || m.result == Result.Bears) {
            require((m.result == Result.Bulls) == (s == Side.Bulls), "lost");
            uint256 w = m.result == Result.Bulls ? m.bulls : m.bears;
            uint256 l = m.result == Result.Bulls ? m.bears : m.bulls;
            amount = stake + (stake * l * (10_000 - rakeBps)) / (10_000 * w);
        } else {
            revert("not settled");
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
}
