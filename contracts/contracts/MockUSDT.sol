// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDT
 * @notice Testnet stand-in for USD₮. 6 decimals to match real Tether.
 *         Anyone can mint from the faucet so judges/testers can fund a wallet.
 *         NOT for production — real USDt has no public mint.
 */
contract MockUSDT is ERC20 {
    uint8 private constant DECIMALS = 6;
    uint256 public constant FAUCET_AMOUNT = 1000 * 10 ** DECIMALS; // 1000 USDt

    constructor() ERC20("Mock Tether USD", "USDT") {}

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /// @notice Faucet: mint the standard faucet amount to the caller.
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Mint an arbitrary amount to `to` (testnet convenience).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
