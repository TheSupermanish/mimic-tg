// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PropMarket
 * @notice Peer-to-peer YES/NO prediction escrow for arbitrary football props
 *         ("Messi to score", "over 2.5 goals", "red card in the match"), in USD₮.
 *
 * Sibling of PredictionMarket: match-outcome bets stay there with deterministic
 * settlement; freeform props live here and are settled by a grounded AI oracle,
 * which can return VOID (refund both) when it cannot verify the answer.
 *
 *  - A creator poses a `question`, picks a side (backsYes = YES or NO), sets a
 *    `resolveBy` time, and escrows a stake. OPEN to anyone or DIRECTED at one address.
 *  - A taker automatically takes the OPPOSITE side and escrows an equal stake.
 *  - After the event, the resolver records YES / NO / VOID. The pot (2x stake) goes
 *    to the correct side; VOID refunds both.
 *  - An unmatched prop can be cancelled by its creator for a refund.
 *
 * Custody: this contract is the only place funds sit. Users sign from their own
 * self-custodial WDK wallets; no operator ever holds user keys.
 */
contract PropMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Result {
        Pending, // 0 — unresolved
        Yes, // 1
        No, // 2
        Void // 3 — could not be verified; refund both
    }

    enum Status {
        Open, // 0 — awaiting a taker
        Matched, // 1 — taker locked the opposing stake
        Settled, // 2 — paid out / refunded
        Cancelled // 3 — refunded to creator, never matched
    }

    struct Prop {
        address creator;
        address opponent; // address(0) => open to anyone
        address taker; // set on accept
        uint256 stake; // per side, USD₮ base units
        uint64 resolveBy; // unix seconds; no accepts once reached
        bool creatorBacksYes; // true = creator backs YES, taker gets NO
        Result result;
        Status status;
        string question; // human-readable prop, e.g. "Lionel Messi to score"
        string matchId; // football-data.org fixture id this prop belongs to
    }

    IERC20 public immutable usdt;
    address public resolver;

    uint256 public nextPropId;
    mapping(uint256 => Prop) private props;

    event ResolverUpdated(address indexed resolver);
    event PropCreated(
        uint256 indexed id,
        address indexed creator,
        address indexed opponent,
        string matchId,
        string question,
        bool creatorBacksYes,
        uint256 stake,
        uint64 resolveBy
    );
    event PropAccepted(uint256 indexed id, address indexed taker);
    event PropCancelled(uint256 indexed id);
    event PropResolved(uint256 indexed id, Result result);
    event PropSettled(uint256 indexed id, address indexed winner, uint256 payout);

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
     * @notice Open a YES/NO prop. Requires prior `usdt.approve(this, stake)`.
     * @param question    human-readable prop the AI oracle will judge
     * @param matchId     fixture the prop belongs to (for context / grouping)
     * @param resolveBy   when the prop can be settled (unix seconds); accepts blocked after
     * @param backsYes    true if the creator backs YES, false for NO
     * @param stake       per-side stake in USD₮ base units
     * @param opponent    address(0) for an open prop, or a specific taker
     */
    function createProp(
        string calldata question,
        string calldata matchId,
        uint64 resolveBy,
        bool backsYes,
        uint256 stake,
        address opponent
    ) external nonReentrant returns (uint256 id) {
        require(bytes(question).length > 0, "question empty");
        require(stake > 0, "stake=0");
        require(resolveBy > block.timestamp, "resolveBy passed");
        require(opponent != msg.sender, "self opponent");

        id = nextPropId++;
        props[id] = Prop({
            creator: msg.sender,
            opponent: opponent,
            taker: address(0),
            stake: stake,
            resolveBy: resolveBy,
            creatorBacksYes: backsYes,
            result: Result.Pending,
            status: Status.Open,
            question: question,
            matchId: matchId
        });

        usdt.safeTransferFrom(msg.sender, address(this), stake);
        emit PropCreated(id, msg.sender, opponent, matchId, question, backsYes, stake, resolveBy);
    }

    /**
     * @notice Take the OPPOSITE side of an open/directed prop.
     *         Requires prior `usdt.approve(this, stake)`.
     */
    function acceptProp(uint256 id) external nonReentrant {
        Prop storage p = props[id];
        require(p.status == Status.Open, "not open");
        require(block.timestamp < p.resolveBy, "resolveBy passed");
        require(msg.sender != p.creator, "creator cannot take");
        require(p.opponent == address(0) || p.opponent == msg.sender, "not invited");

        p.taker = msg.sender;
        p.status = Status.Matched;

        usdt.safeTransferFrom(msg.sender, address(this), p.stake);
        emit PropAccepted(id, msg.sender);
    }

    /// @notice Creator refunds an as-yet-unmatched prop.
    function cancelProp(uint256 id) external nonReentrant {
        Prop storage p = props[id];
        require(p.status == Status.Open, "not open");
        require(msg.sender == p.creator, "not creator");

        p.status = Status.Cancelled;
        usdt.safeTransfer(p.creator, p.stake);
        emit PropCancelled(id);
    }

    // ─── Resolution & settlement ────────────────────────────────────────────

    /// @notice Record a matched prop's answer. Resolver-only, one-shot.
    function resolve(uint256 id, Result result) external onlyResolver {
        Prop storage p = props[id];
        require(p.status == Status.Matched, "not matched");
        require(result != Result.Pending, "bad result");
        require(p.result == Result.Pending, "already resolved");
        require(block.timestamp >= p.resolveBy, "too early");
        p.result = result;
        emit PropResolved(id, result);
    }

    /**
     * @notice Settle a resolved prop. Permissionless: anyone may trigger it; funds
     *         always go to the rightful party (or both, on VOID).
     */
    function claim(uint256 id) external nonReentrant {
        Prop storage p = props[id];
        require(p.status == Status.Matched, "not matched");
        require(p.result != Result.Pending, "unresolved");

        p.status = Status.Settled;
        uint256 pot = p.stake * 2;

        if (p.result == Result.Void) {
            // could not be verified — refund both sides
            usdt.safeTransfer(p.creator, p.stake);
            usdt.safeTransfer(p.taker, p.stake);
            emit PropSettled(id, address(0), 0);
            return;
        }

        bool yesWon = p.result == Result.Yes;
        address winner = (yesWon == p.creatorBacksYes) ? p.creator : p.taker;
        usdt.safeTransfer(winner, pot);
        emit PropSettled(id, winner, pot);
    }

    // ─── Views ────────────────────────────────────────────────────────────

    function getProp(uint256 id) external view returns (Prop memory) {
        return props[id];
    }
}
