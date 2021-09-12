import { BalancesUpdated } from '../../generated/rocketNetworkBalances/rocketNetworkBalances'
import {
  Staker,
  NetworkStakerBalanceCheckpoint,
  StakerBalanceCheckpoint,
} from '../../generated/schema'
import { rocketTokenRETH } from '../../generated/rocketNetworkBalances/rocketTokenRETH'
import { rocketDepositPool } from '../../generated/rocketNetworkBalances/rocketDepositPool'
import { rocketEntityUtilities } from '../entityutilities'
import { rocketPoolEntityFactory } from '../entityfactory'
import { ADDRESS_ROCKET_DEPOSIT_POOL, ADDRESS_ROCKET_TOKEN_RETH } from './../constants'
import { BigInt } from '@graphprotocol/graph-ts'

/**
 * Occurs when an ODAO member votes on a balance (per block) and a consensus threshold is reached.
 */
export function handleBalancesUpdated(event: BalancesUpdated): void {
  // Preliminary check to ensure we haven't handled this before.
  if (rocketEntityUtilities.hasNetworkStakerBalanceCheckpointHasBeenIndexed(event))
    return

  // Load the RocketTokenRETH contract.
  let rocketTokenRETHContract = rocketTokenRETH.bind(ADDRESS_ROCKET_TOKEN_RETH)
  if (rocketTokenRETHContract === null) return

  // Load the rocketDepositPool contract
  let rocketDepositPoolContract = rocketDepositPool.bind(ADDRESS_ROCKET_DEPOSIT_POOL)
  if (rocketDepositPoolContract === null) return

  // How much is the total staker ETH balance in the deposit pool?
  let stakerEthWaitingInDepositPoolTotal = rocketDepositPoolContract.getBalance();

  // How much of the staker ETH balance in the deposit pool is not needed for queued minipools?
  let depositPoolStakerEthExcessBalance = rocketDepositPoolContract.getExcessBalance();

  // How much ETH is available as collateral in the RocketETH contract?
  let rETHTotalCollateral = rocketTokenRETHContract.getTotalCollateral();

  // The RocketEth contract balance is equal to the total collateral - the excess deposit pool balance.
  let stakerEthInRocketEthContractTotal = rETHTotalCollateral.minus(depositPoolStakerEthExcessBalance);
  if(stakerEthInRocketEthContractTotal < BigInt.fromI32(0)) stakerEthInRocketEthContractTotal = BigInt.fromI32(0);

  // Attempt to create a new network balance checkpoint.
  let networkBalanceCheckpoint = rocketPoolEntityFactory.createNetworkStakerBalanceCheckpoint(
    rocketEntityUtilities.extractIdForEntity(event),
    event,
    stakerEthWaitingInDepositPoolTotal,
    stakerEthInRocketEthContractTotal,
    rocketTokenRETHContract.getExchangeRate(),
  )
  if (networkBalanceCheckpoint === null) return

  // Protocol entity should exist, if not, then we attempt to create it.
  let protocol = rocketEntityUtilities.getRocketPoolProtocolEntity()
  if (protocol === null || protocol.id === null)
    protocol = rocketPoolEntityFactory.createRocketPoolProtocol()

  // Index the network balance checkpoint and store it as the last checkpoint.
  networkBalanceCheckpoint.save()
  protocol.lastNetworkStakerBalanceCheckPoint = networkBalanceCheckpoint.id
  protocol.save()

  // Handle the staker impact.
  generateStakerBalanceCheckpoints(
    protocol.stakers,
    networkBalanceCheckpoint,
    event.block.number,
    event.block.timestamp,
  )
}

/**
 * Loops through all stakers of the protocol.
 * If an active rETH balance is found..
 * Create a StakerBalanceCheckpoint
 */
function generateStakerBalanceCheckpoints(
  stakerIds: Array<string> | null,
  networkBalanceCheckpoint: NetworkStakerBalanceCheckpoint | null,
  blockNumber: BigInt,
  blockTime: BigInt,
): void {
  // If we don't have any stakers, stop.
  if (
    stakerIds === null ||
    stakerIds.length === 0 ||
    networkBalanceCheckpoint === null ||
    networkBalanceCheckpoint.id === null
  )
    return

  // Loop through all the stakers in the protocol..
  stakerIds.forEach((stakerId) => {
    // Preliminary check: staker ID can't be null.
    if (stakerId === null) return

    // Check if we have already indexed a staker balance checkpoint for the current staker.
    let stakerBalanceCheckpointId =
      networkBalanceCheckpoint.id + ' - ' + stakerId
    if (StakerBalanceCheckpoint.load(stakerBalanceCheckpointId) !== null) return

    /**
     * Load the indexed staker.
     * Only continue if the staker actually has an rETH balance.
     * Storing the balances for stakers when they have an empty rETH balance would be redundant.
     * These stakers will keep their last checkpoint link & total rewards. (if they had any)
     */
    let staker = Staker.load(stakerId)
    if (staker === null || staker.activeRETHBalance === BigInt.fromI32(0))
      return

    // Store the active balances in temporary variables. This will make everything easier to read.
    let activeRETHBalance = staker.activeRETHBalance
    if (activeRETHBalance < BigInt.fromI32(0))
      activeRETHBalance = BigInt.fromI32(0)
    let activeETHBalance = activeRETHBalance.times(
      networkBalanceCheckpoint.rEthExchangeRate,
    )
    if (activeETHBalance < BigInt.fromI32(0))
      activeETHBalance = BigInt.fromI32(0)

    // By default, assume the previous (r)ETH balances are the same as the current ones.
    let previousRETHBalance = activeRETHBalance
    let previousETHBalance = activeETHBalance

    // If we had a previous staker balance checkpoint, then use the balances from that link.
    if (staker.lastBalanceCheckpoint !== null) {
      let previousStakerBalanceCheckpoint = StakerBalanceCheckpoint.load(
        staker.lastBalanceCheckpoint,
      )
      if (previousStakerBalanceCheckpoint !== null) {
        previousRETHBalance = previousStakerBalanceCheckpoint.rEthBalance
        previousETHBalance = previousStakerBalanceCheckpoint.ethBalance
      }
      if (previousRETHBalance < BigInt.fromI32(0))
        previousRETHBalance = BigInt.fromI32(0)
      if (previousETHBalance < BigInt.fromI32(0))
        previousETHBalance = BigInt.fromI32(0)
    }

    // This will indicate how many ETH rewards we have since the previous checkpoint.
    let ethRewardsSincePreviousCheckpoint = rocketEntityUtilities.getETHRewardsSincePreviousStakerBalanceCheckpoint(
      activeRETHBalance,
      activeETHBalance,
      previousRETHBalance,
      previousETHBalance,
    )

    // Create a new staker balance checkpoint for everything we've determined in this iteration.
    let stakerBalanceCheckpoint = rocketPoolEntityFactory.createStakerBalanceCheckpoint(
      stakerBalanceCheckpointId,
      staker,
      networkBalanceCheckpoint,
      activeETHBalance,
      activeRETHBalance,
      ethRewardsSincePreviousCheckpoint,
      blockNumber,
      blockTime,
    )
    if (stakerBalanceCheckpoint === null) return

    // Index the newly instantiated staker balance checkpoint.
    stakerBalanceCheckpoint.save()

    // Keep our staker up to date with the active usable links/value(s) from this iteration.
    staker.lastBalanceCheckpoint = stakerBalanceCheckpoint.id
    if (ethRewardsSincePreviousCheckpoint !== BigInt.fromI32(0)) {
      if (ethRewardsSincePreviousCheckpoint < BigInt.fromI32(0)) {
        staker.totalETHRewards = staker.totalETHRewards.minus(
          ethRewardsSincePreviousCheckpoint,
        )
      } else {
        staker.totalETHRewards = staker.totalETHRewards.plus(
          ethRewardsSincePreviousCheckpoint,
        )
      }
    }
    staker.save()
  })
}