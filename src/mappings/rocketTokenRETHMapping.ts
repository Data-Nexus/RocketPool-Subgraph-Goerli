import {
  ADDRESS_ROCKET_DEPOSIT_POOL,
  ADDRESS_ROCKET_DEPOSIT_POOL_STRING,
  ADDRESS_ROCKET_TOKEN_RETH,
  ADDRESS_ROCKET_TOKEN_RETH_STRING,
  ADDRESS_ZERO_STRING,
} from '../constants'
import { Address, BigInt } from '@graphprotocol/graph-ts'
import { Transfer } from '../../generated/rocketTokenRETH/rocketTokenRETH'
import { rocketTokenRETH } from '../../generated/rocketTokenRETH/rocketTokenRETH'
import { rocketDepositPool } from '../../generated/rocketTokenRETH/rocketDepositPool'
import { RocketPoolProtocol, Staker } from '../../generated/schema'
import { generalUtilities } from '../utilities/generalutilities'
import { stakerUtilities } from '../utilities/stakerUtilities'
import { rocketPoolEntityFactory } from '../entityfactory'
import { ethereum } from '@graphprotocol/graph-ts'

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
  if (generalUtilities.hasTransactionHasBeenIndexed(event)) return

  // Who are the stakers for this transaction?
  let stakers = stakerUtilities.getTransactionStakers(
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
  rETHAmount: BigInt,
): void {
  // This state has to be valid before we can actually do anything.
  if (
    event === null ||
    fromStaker === null ||
    fromStaker.id == null ||
    toStaker === null ||
    toStaker.id == null
  )
    return

  // Create a new transaction for the given values.
  let rEthTransaction = rocketPoolEntityFactory.createRocketETHTransaction(
    generalUtilities.extractIdForEntity(event),
    fromStaker,
    toStaker,
    rETHAmount,
    event,
  )
  if (rEthTransaction === null || rEthTransaction.id == null) return

  // Protocol entity should exist, if not, then we attempt to create it.
  let protocol = generalUtilities.getRocketPoolProtocolEntity()
  if (protocol === null || protocol.id == null) {
    protocol = rocketPoolEntityFactory.createRocketPoolProtocol()
    protocol.save()
  }

  // Load the RocketTokenRETH contract.
  let rETHContract = rocketTokenRETH.bind(ADDRESS_ROCKET_TOKEN_RETH)
  if (rETHContract === null) return

  // Update active balances for stakesr.
  let exchangeRate = rETHContract.getExchangeRate()
  stakerUtilities.changeStakerBalances(
    fromStaker,
    rETHAmount,
    exchangeRate,
    false,
  )
  stakerUtilities.changeStakerBalances(
    toStaker, 
    rETHAmount, 
    exchangeRate, 
    true)

  // Save all directly affected entities.
  fromStaker.save()
  toStaker.save()
  rEthTransaction.save()

  // Save all indirectly affected entities.
  saveProtocolRelatedStateForRETHTransaction(
    rETHAmount,
    fromStaker,
    toStaker,
    protocol,
    exchangeRate,
    rETHContract,
  )
}

/**
 * Updates related protocol state for this rETH transaction.
 */
function saveProtocolRelatedStateForRETHTransaction(
  rETHAmount: BigInt,
  from: Staker,
  to: Staker,
  protocol: RocketPoolProtocol,
  rETHExchangeRate: BigInt,
  rETHContract: rocketTokenRETH,
) : void {
  // Load up the deposit pool, as it contains some state that we need to update.
  let depositPool = generalUtilities.getDepositPool()
  if (depositPool === null || depositPool.id == null) {
    depositPool = rocketPoolEntityFactory.createDepositPool()
    protocol.depositPool = depositPool.id
  }

  // Update & index the deposit pool based on the latest state in the contract.
  let depositPoolContract = rocketDepositPool.bind(ADDRESS_ROCKET_DEPOSIT_POOL)
  depositPool.stakerETHBalance = depositPoolContract.getBalance()
  depositPool.excessStakerETHBalance = depositPoolContract.getExcessBalance()
  depositPool.save()

  // Load up the rocket ETH, as it contains some state that we need to update.
  let rocketETH = generalUtilities.getRocketETH()
  if (rocketETH === null || rocketETH.id == null) {
    rocketETH = rocketPoolEntityFactory.createRocketETH()
    protocol.rocketETH = rocketETH.id
  }

  // Update & index the deposit pool based on the latest state in the contract.
  if (from.id == ADDRESS_ZERO_STRING && rETHAmount > BigInt.fromI32(0)) {
    rocketETH.totalRETHSupply = rocketETH.totalRETHSupply.plus(rETHAmount)
  }
  rocketETH.exchangeRate = rETHExchangeRate
  rocketETH.stakerETHInContract = generalUtilities.getRocketETHBalance(
    depositPoolContract.getExcessBalance(),
    rETHContract.getTotalCollateral(),
  )
  rocketETH.save()

  // Add the stakers to the protocol. (if necessary)
  let protocolStakers = protocol.stakers
  if (protocolStakers.indexOf(from.id) == -1) protocolStakers.push(from.id)
  if (protocolStakers.indexOf(to.id) == -1) protocolStakers.push(to.id)
  protocol.stakers = protocolStakers

  // Save changes to the protocol.
  protocol.save()
}
