// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
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

    // key: keccak256(market symbol, match number)
    mapping(bytes32 => Match) public matches;
    mapping(bytes32 => mapping(address => Side)) public sideOf;
    mapping(bytes32 => mapping(address => bool)) public claimed;

    event Joined(bytes32 indexed key, address indexed player, Side side, uint32 total);
    event Started(bytes32 indexed key, uint64 startedAt);
    event Settled(bytes32 indexed key, Result result);
    event Left(bytes32 indexed key, address indexed player);
    event Claimed(bytes32 indexed key, address indexed player, uint256 amount);

    constructor(IERC20 _token, uint256 _stake, uint32 _size, uint64 _duration, uint64 _graceAfter, uint16 _rakeBps) {
        require(_size >= 2 && _rakeBps <= 3000, "bad params");
        token = _token; operator = msg.sender; stake = _stake; size = _size;
        duration = _duration; graceAfter = _graceAfter; rakeBps = _rakeBps;
    }

    function keyOf(string calldata market, uint256 number) public pure returns (bytes32) {
        return keccak256(abi.encode(market, number));
    }

    function join(bytes32 key, Side side) external {
        require(side == Side.Bulls || side == Side.Bears, "side");
        Match storage m = matches[key];
        require(m.startedAt == 0, "already started");
        require(sideOf[key][msg.sender] == Side.None, "already in");
        sideOf[key][msg.sender] = side;
        if (side == Side.Bulls) m.bulls++; else m.bears++;
        require(token.transferFrom(msg.sender, address(this), stake), "stake transfer");
        uint32 total = m.bulls + m.bears;
        emit Joined(key, msg.sender, side, total);
        if (total == size) { m.startedAt = uint64(block.timestamp); emit Started(key, m.startedAt); }
    }

    /// Before a match starts, a player can take their stake back and give up the seat.
    function leave(bytes32 key) external {
        Match storage m = matches[key];
        require(m.startedAt == 0, "already started");
        Side s = sideOf[key][msg.sender];
        require(s != Side.None, "not in this match");
        sideOf[key][msg.sender] = Side.None;
        if (s == Side.Bulls) m.bulls--; else m.bears--;
        require(token.transfer(msg.sender, stake), "refund");
        emit Left(key, msg.sender);
    }

    /// Operator posts who won once the match is over. A one-sided roster or a tie is a Refund.
    function settle(bytes32 key, Result result) external {
        require(msg.sender == operator, "operator only");
        Match storage m = matches[key];
        require(m.startedAt != 0 && m.result == Result.Pending, "not settleable");
        require(block.timestamp >= m.startedAt + duration, "still running");
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
        Match storage m = matches[key];
        Side s = sideOf[key][msg.sender];
        require(s != Side.None && !claimed[key][msg.sender], "nothing to claim");
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
        claimed[key][msg.sender] = true;
        require(token.transfer(msg.sender, amount), "payout");
        emit Claimed(key, msg.sender, amount);
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
