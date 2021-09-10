import { ADDRESS_ZERO } from './constants'
import { Address, BigInt } from '@graphprotocol/graph-ts'
import {
  TokensBurned,
  TokensMinted,
  Transfer,
} from '../generated/rocketTokenRETH/rocketTokenRETH'
import { Staker } from '../generated/schema'
import { rocketEntityUtilities } from './entityutilities'
import { rocketPoolEntityFactory } from './entityfactory'
import { ethereum } from '@graphprotocol/graph-ts'

/**
 * Occurs when a stakers burns rETH for ETH.
 * The ETH he will receive will be based on the current exchange rate of ETH:rETH.
 * This ratio is maintained by the ODAO and is reported back to the RocketPool smart contracts.
 */
export function handleTokensBurned(event: TokensBurned): void {
  // From: owner, To: Zero Address, For: Specific rETH Amount
  handleRocketETHTransaction(
    event,
    event.params.from,
    ADDRESS_ZERO,
    event.params.amount,
  )
}

/**
 * Occurs when a staker asks the rETH contract (via the deposit pool) to mint an rETH amount.
 * The rETH amount will be based on the current exchange rate of ETH:rETH.
 * This ratio is maintained by the ODAO and is reported back to the RocketPool smart contracts.
 */
export function handleTokensMinted(event: TokensMinted): void {
  // From: Zero Address, To: Recipient, For: Mint Amount
  handleRocketETHTransaction(
    event,
    ADDRESS_ZERO,
    event.params.to,
    event.params.amount,
  )
}

/**
 * Occurs when a staker transfer an rETH amount to another staker.
 */
export function handleTransfer(event: Transfer): void {
  // From: owner, To: Recipient, For: Specific rETH Amount
  handleRocketETHTransaction(
    event,
    event.params.from,
    event.params.to,
    event.params.value,
  )
}

/**
 * General flow of what should happen for a RocketETH transaction.
 */
function handleRocketETHTransaction(
  event: ethereum.Event,
  from: Address,
  to: Address,
  rETHAmount: BigInt,
): void {
  // Preliminary check to ensure we haven't handled this before.
  if (rocketEntityUtilities.hasTransactionHasBeenIndexed(event)) return

  // Who are the stakers for this transaction?
  var stakers = rocketEntityUtilities.getTransactionStakers(
    from,
    to,
    event.block.number,
    event.block.timestamp,
  )
  if (
    stakers === null ||
    stakers.fromStaker === null ||
    stakers.toStaker === null
  )
    return

  // Attempt to index this transaction.
  saveTransaction(event, stakers.fromStaker, stakers.toStaker, rETHAmount)
}

/**
 * Save a new Transaction that occured between the FROM and TO staker for a specific rETH amount.
 */
function saveTransaction(
  event: ethereum.Event,
  from: Staker,
  to: Staker,
  amount: BigInt,
): void {
  // This state has to be valid before we can actually do anything.
  if (
    event === null ||
    from === null ||
    from.id === null ||
    to === null ||
    to.id === null
  )
    return

  // Create a new transaction for the given values.
  const transaction = rocketPoolEntityFactory.createRocketETHTransaction(
    rocketEntityUtilities.extractRocketETHTransactionID(event),
    from,
    to,
    amount,
    event,
  )
  if (transaction === null) return

  // First, save the from and to stakers & then save the transaction.
  from.save()
  to.save()
  transaction.save()
}
