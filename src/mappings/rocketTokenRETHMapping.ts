import { ADDRESS_ZERO } from '../constants'
import { Address, BigInt } from '@graphprotocol/graph-ts'
import {
  TokensBurned,
  TokensMinted,
  Transfer,
} from '../../generated/rocketTokenRETH/rocketTokenRETH'
import { Staker } from '../../generated/schema'
import { rocketEntityUtilities } from '../entityutilities'
import { rocketPoolEntityFactory } from '../entityfactory'
import { ethereum } from '@graphprotocol/graph-ts'

/**
 * Occurs when a stakers burns rETH for ETH.
 * The ETH he will receive will be based on the current exchange rate of ETH:rETH.
 * This ratio is reported by the ODAO.
 */
export function handleTokensBurned(event: TokensBurned): void {
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
 * This ratio is reported by the ODAO.
 */
export function handleTokensMinted(event: TokensMinted): void {
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
  let stakers = rocketEntityUtilities.getTransactionStakers(
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
  fromStaker: Staker,
  toStaker: Staker,
  rEthAmount: BigInt,
): void {
  // This state has to be valid before we can actually do anything.
  if (
    event === null ||
    fromStaker === null ||
    fromStaker.id === null ||
    toStaker === null ||
    toStaker.id === null
  )
    return

  // Create a new transaction for the given values.
  let rEthTransaction = rocketPoolEntityFactory.createRocketETHTransaction(
    rocketEntityUtilities.extractIdForEntity(event),
    fromStaker,
    toStaker,
    rEthAmount,
    event,
  )
  if (rEthTransaction === null || rEthTransaction.id === null) return

  // Protocol entity should exist, if not, then we attempt to create it.
  let protocol = rocketEntityUtilities.getRocketPoolProtocolEntity()
  if (protocol === null || protocol.id === null) {
    protocol = rocketPoolEntityFactory.createRocketPoolProtocol()
    protocol.save()
  }

  // Update active balances for stakesr.
  rocketEntityUtilities.changeStakerBalance(fromStaker, rEthAmount, false);
  rocketEntityUtilities.changeStakerBalance(toStaker, rEthAmount, true);

  // Save all affected entities.
  fromStaker.save()
  toStaker.save()
  rEthTransaction.save()

  // Add the stakers to the protocol. (if necessary)
  let protocolStakers = protocol.stakers
  if (protocolStakers.indexOf(fromStaker.id) === -1)
    protocolStakers.push(fromStaker.id)
  if (protocolStakers.indexOf(toStaker.id) === -1)
    protocolStakers.push(toStaker.id)
  protocol.stakers = protocolStakers

  // Save changes to the protocol.
  protocol.save()
}
