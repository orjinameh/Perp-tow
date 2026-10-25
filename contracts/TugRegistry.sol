// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Seat registry for the Perp Tug of War game. It holds no money: it records who took a seat in
/// which match and on which side, and refuses extra players once a match is full. The roster and
/// the start time are kept in storage, so the app reads them with plain calls (no log scanning).
contract TugRegistry {
    uint32 public immutable size;

    struct Seat {
        address player;
        uint8 side; // 1 = Bulls (long), 2 = Bears (short)
    }

    mapping(bytes32 => Seat[]) private _seats;          // key: keccak256(abi.encode(market, matchNumber))
    mapping(bytes32 => uint64) private _startedAt;      // block time when the last seat was taken
    mapping(bytes32 => mapping(address => bool)) public inMatch;
    mapping(bytes32 => uint256) private _latest;        // key: keccak256(market): highest match number used

    event Entered(bytes32 indexed marketHash, uint256 indexed matchNumber, address indexed player, uint8 side, uint32 seat);

    constructor(uint32 _size) {
        require(_size >= 2, "size");
        size = _size;
    }

    function enter(string calldata market, uint256 matchNumber, uint8 side) external {
        require(side == 1 || side == 2, "side");
        require(matchNumber >= 1, "match number");
        bytes32 key = keccak256(abi.encode(market, matchNumber));
        require(!inMatch[key][msg.sender], "already in this match");
        require(_seats[key].length < size, "match is full");
        inMatch[key][msg.sender] = true;
        _seats[key].push(Seat(msg.sender, side));
        uint32 seat = uint32(_seats[key].length);
        if (seat == size) _startedAt[key] = uint64(block.timestamp);
        bytes32 mh = keccak256(bytes(market));
        if (matchNumber > _latest[mh]) _latest[mh] = matchNumber;
        emit Entered(mh, matchNumber, msg.sender, side, seat);
    }

    /// Highest match number anyone has entered on this market (0 if none).
    function latestMatch(string calldata market) external view returns (uint256) {
        return _latest[keccak256(bytes(market))];
    }

    /// The roster of one match in seat order, and when it started (0 while it is still filling).
    function roster(string calldata market, uint256 matchNumber)
        external
        view
        returns (address[] memory players, uint8[] memory sides, uint64 startedAt)
    {
        bytes32 key = keccak256(abi.encode(market, matchNumber));
        Seat[] storage s = _seats[key];
        players = new address[](s.length);
        sides = new uint8[](s.length);
        for (uint256 i = 0; i < s.length; i++) {
            players[i] = s[i].player;
            sides[i] = s[i].side;
        }
        startedAt = _startedAt[key];
    }
}
