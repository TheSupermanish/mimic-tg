// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PredictionMarket
 * @notice Peer-to-peer football prediction market escrow, settled in USD₮.
 *
 * Head-to-head model:
 *  - A creator opens a challenge on a fixture, picking one outcome (Home/Draw/Away)
 *    and escrowing a stake. The challenge is either OPEN (anyone may take the other
 *    side) or DIRECTED at a specific opponent address.
 *  - A taker accepts with a *different* pick and escrows an equal stake.
 *  - Once the match result is recorded by the resolver, the pot (2x stake) goes to
 *    whoever's pick matches the result. If neither pick matches (e.g. both bet against
 *    a draw that then happened), both stakes are refunded.
 *  - An unmatched OPEN/DIRECTED challenge can be cancelled by its creator for a refund.
 *
 * Custody: this contract is the only place funds sit. Users sign from their own
 * self-custodial WDK wallets; no operator ever holds user keys.
 */
contract PredictionMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Outcome {
        Pending, // 0 — unresolved / invalid as a pick
        Home, // 1
        Draw, // 2
        Away // 3
    }

    enum Status {
        Open, // 0 — created, awaiting a taker
        Matched, // 1 — taker locked opposing stake
        Settled, // 2 — pot paid out / refunded
        Cancelled // 3 — refunded to creator, never matched
    }

    struct Challenge {
        address creator;
        address opponent; // address(0) => open to anyone
        address taker; // set on accept
        uint256 stake; // per side, USD₮ base units
        uint64 kickoff; // unix seconds; no accepts once reached
        Outcome creatorPick;
        Outcome takerPick;
        Status status;
        string matchId; // football-data.org fixture id
    }

    IERC20 public immutable usdt;
    address public resolver;

    uint256 public nextChallengeId;
    mapping(uint256 => Challenge) private challenges;

    /// @notice Final result per fixture, set once by the resolver.
    mapping(string => Outcome) public matchResult;

    event ResolverUpdated(address indexed resolver);
    event ChallengeCreated(
        uint256 indexed id,
        address indexed creator,
        address indexed opponent,
        string matchId,
        Outcome creatorPick,
        uint256 stake,
        uint64 kickoff
    );
    event ChallengeAccepted(uint256 indexed id, address indexed taker, Outcome takerPick);
    event ChallengeCancelled(uint256 indexed id);
    event MatchResolved(string matchId, Outcome result);
    event ChallengeSettled(uint256 indexed id, address indexed winner, uint256 payout);

    modifier onlyResolver() {
        require(msg.sender == resolver, "not resolver");
        _;
    }

    constructor(IERC20 _usdt, address _resolver) Ownable(msg.sender) {
        require(address(_usdt) != address(0), "usdt=0");
        require(_resolver != address(0), "resolver=0");
        usdt = _usdt;
        resolver = _resolver;
    }

    function setResolver(address _resolver) external onlyOwner {
        require(_resolver != address(0), "resolver=0");
        resolver = _resolver;
        emit ResolverUpdated(_resolver);
    }

    // ─── Betting ────────────────────────────────────────────────────────────

    /**
     * @notice Open a challenge on a fixture. Requires prior `usdt.approve(this, stake)`.
     * @param matchId    football-data.org fixture id
     * @param kickoff    fixture start (unix seconds); accepts are blocked once reached
     * @param creatorPick the outcome the creator is backing (Home/Draw/Away)
     * @param stake      per-side stake in USD₮ base units
     * @param opponent   address(0) for an open challenge, or a specific taker
     */
    function createChallenge(
        string calldata matchId,
        uint64 kickoff,
        Outcome creatorPick,
        uint256 stake,
        address opponent
    ) external nonReentrant returns (uint256 id) {
        require(bytes(matchId).length > 0, "matchId empty");
        require(creatorPick != Outcome.Pending, "bad pick");
        require(stake > 0, "stake=0");
        require(kickoff > block.timestamp, "kickoff passed");
        require(opponent != msg.sender, "self opponent");

        id = nextChallengeId++;
        challenges[id] = Challenge({
            creator: msg.sender,
            opponent: opponent,
            taker: address(0),
            stake: stake,
            kickoff: kickoff,
            creatorPick: creatorPick,
            takerPick: Outcome.Pending,
            status: Status.Open,
            matchId: matchId
        });

        usdt.safeTransferFrom(msg.sender, address(this), stake);
        emit ChallengeCreated(id, msg.sender, opponent, matchId, creatorPick, stake, kickoff);
    }

    /**
     * @notice Take the other side of an open/directed challenge with a different pick.
     *         Requires prior `usdt.approve(this, stake)`.
     */
    function acceptChallenge(uint256 id, Outcome takerPick) external nonReentrant {
        Challenge storage c = challenges[id];
        require(c.status == Status.Open, "not open");
        require(block.timestamp < c.kickoff, "kickoff passed");
        require(msg.sender != c.creator, "creator cannot take");
        require(c.opponent == address(0) || c.opponent == msg.sender, "not invited");
        require(takerPick != Outcome.Pending, "bad pick");
        require(takerPick != c.creatorPick, "same pick");

        c.taker = msg.sender;
        c.takerPick = takerPick;
        c.status = Status.Matched;

        usdt.safeTransferFrom(msg.sender, address(this), c.stake);
        emit ChallengeAccepted(id, msg.sender, takerPick);
    }

    /// @notice Creator refunds an as-yet-unmatched challenge.
    function cancelChallenge(uint256 id) external nonReentrant {
        Challenge storage c = challenges[id];
        require(c.status == Status.Open, "not open");
        require(msg.sender == c.creator, "not creator");

        c.status = Status.Cancelled;
        usdt.safeTransfer(c.creator, c.stake);
        emit ChallengeCancelled(id);
    }

    // ─── Resolution & settlement ────────────────────────────────────────────

    /// @notice Record a fixture's final result. Resolver-only, one-shot per fixture.
    function resolve(string calldata matchId, Outcome result) external onlyResolver {
        require(result != Outcome.Pending, "bad result");
        require(matchResult[matchId] == Outcome.Pending, "already resolved");
        matchResult[matchId] = result;
        emit MatchResolved(matchId, result);
    }

    /**
     * @notice Settle a matched challenge once its fixture is resolved. Permissionless:
     *         anyone may trigger it; funds always go to the rightful party.
     */
    function claim(uint256 id) external nonReentrant {
        Challenge storage c = challenges[id];
        require(c.status == Status.Matched, "not matched");

        Outcome result = matchResult[c.matchId];
        require(result != Outcome.Pending, "unresolved");

        c.status = Status.Settled;
        uint256 pot = c.stake * 2;

        if (result == c.creatorPick) {
            usdt.safeTransfer(c.creator, pot);
            emit ChallengeSettled(id, c.creator, pot);
        } else if (result == c.takerPick) {
            usdt.safeTransfer(c.taker, pot);
            emit ChallengeSettled(id, c.taker, pot);
        } else {
            // neither pick hit — refund both sides
            usdt.safeTransfer(c.creator, c.stake);
            usdt.safeTransfer(c.taker, c.stake);
            emit ChallengeSettled(id, address(0), 0);
        }
    }

    // ─── Views ────────────────────────────────────────────────────────────

    function getChallenge(uint256 id) external view returns (Challenge memory) {
        return challenges[id];
    }
}
