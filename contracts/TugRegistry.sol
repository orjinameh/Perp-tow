// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Seat registry for the Perp Tug of War game. It holds no money. It records who took a seat in
/// which match and on which side, enforces the seat limit, and handles the "continue?" step when a
/// lobby ends without being full. The app derives every phase (filling, confirming, opening,
/// running) from the timestamps stored here.
contract TugRegistry {
    uint32 public immutable size;
    uint64 public immutable lobbySeconds;   // how long a lobby stays open after its first player
    uint64 public immutable confirmSeconds; // how long players have to say "continue" if it is not full

    struct Seat {
        address player;
        uint8 side; // 1 = Bulls (long), 2 = Bears (short)
        bool confirmed;
    }

    mapping(bytes32 => Seat[]) private _seats;     // key: keccak256(abi.encode(market, matchNumber))
    mapping(bytes32 => uint64) private _firstAt;   // block time of the first seat
    mapping(bytes32 => uint64) private _fullAt;    // block time the last seat was taken (0 while not full)
    mapping(bytes32 => mapping(address => bool)) public inMatch;
    mapping(bytes32 => uint32) private _bulls;
    mapping(bytes32 => uint256) private _latest;   // key: keccak256(market): highest match number used

    event Entered(bytes32 indexed marketHash, uint256 indexed matchNumber, address indexed player, uint8 side, uint32 seat);
    event Confirmed(bytes32 indexed marketHash, uint256 indexed matchNumber, address indexed player);
    event Left(bytes32 indexed marketHash, uint256 indexed matchNumber, address indexed player);

    constructor(uint32 _size, uint64 _lobbySeconds, uint64 _confirmSeconds) {
        require(_size >= 2, "size");
        size = _size;
        lobbySeconds = _lobbySeconds;
        confirmSeconds = _confirmSeconds;
    }

    function enter(string calldata market, uint256 matchNumber, uint8 side) external {
        require(side == 1 || side == 2, "side");
        require(matchNumber >= 1, "match number");
        bytes32 key = keccak256(abi.encode(market, matchNumber));
        require(!inMatch[key][msg.sender], "already in this match");
        require(_seats[key].length < size, "match is full");
        if (_firstAt[key] == 0) _firstAt[key] = uint64(block.timestamp);
        require(block.timestamp < _firstAt[key] + lobbySeconds, "lobby is closed");
        inMatch[key][msg.sender] = true;
        _seats[key].push(Seat(msg.sender, side, false));
        if (side == 1) _bulls[key]++;
        uint32 seat = uint32(_seats[key].length);
        if (seat == size) {
            // A full match locks at once, and it needs both teams.
            require(_bulls[key] > 0 && _bulls[key] < size, "last seat must take the other side");
            _fullAt[key] = uint64(block.timestamp);
        }
        bytes32 mh = keccak256(bytes(market));
        if (matchNumber > _latest[mh]) _latest[mh] = matchNumber;
        emit Entered(mh, matchNumber, msg.sender, side, seat);
    }

    /// Say "yes, continue with fewer players" during the confirm window of a lobby that did not fill.
    function confirm(string calldata market, uint256 matchNumber) external {
        bytes32 key = keccak256(abi.encode(market, matchNumber));
        require(_fullAt[key] == 0, "match is full");
        uint64 lobbyEnd = _firstAt[key] + lobbySeconds;
        require(_firstAt[key] != 0 && block.timestamp >= lobbyEnd, "lobby still open");
        require(block.timestamp < lobbyEnd + confirmSeconds, "confirm window closed");
        Seat[] storage s = _seats[key];
        for (uint256 i = 0; i < s.length; i++) {
            if (s[i].player == msg.sender) {
                s[i].confirmed = true;
                emit Confirmed(keccak256(bytes(market)), matchNumber, msg.sender);
                return;
            }
        }
        revert("not in this match");
    }

    /// Give up a seat while the lobby is still open and not full.
    function leave(string calldata market, uint256 matchNumber) external {
        bytes32 key = keccak256(abi.encode(market, matchNumber));
        require(_fullAt[key] == 0, "match is full");
        require(block.timestamp < _firstAt[key] + lobbySeconds, "lobby is closed");
        require(inMatch[key][msg.sender], "not in this match");
        Seat[] storage s = _seats[key];
        for (uint256 i = 0; i < s.length; i++) {
            if (s[i].player == msg.sender) {
                if (s[i].side == 1) _bulls[key]--;
                s[i] = s[s.length - 1];
                s.pop();
                break;
            }
        }
        inMatch[key][msg.sender] = false;
        emit Left(keccak256(bytes(market)), matchNumber, msg.sender);
    }

    /// Highest match number anyone has entered on this market (0 if none).
    function latestMatch(string calldata market) external view returns (uint256) {
        return _latest[keccak256(bytes(market))];
    }

    function roster(string calldata market, uint256 matchNumber)
        external
        view
        returns (address[] memory players, uint8[] memory sides, bool[] memory confirmed, uint64 firstAt, uint64 fullAt)
    {
        bytes32 key = keccak256(abi.encode(market, matchNumber));
        Seat[] storage s = _seats[key];
        players = new address[](s.length);
        sides = new uint8[](s.length);
        confirmed = new bool[](s.length);
        for (uint256 i = 0; i < s.length; i++) {
            players[i] = s[i].player;
            sides[i] = s[i].side;
            confirmed[i] = s[i].confirmed;
        }
        firstAt = _firstAt[key];
        fullAt = _fullAt[key];
    }
}
