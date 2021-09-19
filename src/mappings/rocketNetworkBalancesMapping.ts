import { BalancesUpdated } from '../../generated/rocketNetworkBalances/rocketNetworkBalances'
import {
  Staker,
  NetworkStakerBalanceCheckpoint,
  StakerBalanceCheckpoint,
} from '../../generated/schema'
import { rocketTokenRETH } from '../../generated/rocketNetworkBalances/rocketTokenRETH'
import { rocketDepositPool } from '../../generated/rocketNetworkBalances/rocketDepositPool'
import {
  rocketEntityUtilities,
  NetworkStakerRewardCheckpointSummary,
} from '../entityutilities'
import { rocketPoolEntityFactory } from '../entityfactory'
import {
  ADDRESS_ROCKET_DEPOSIT_POOL,
  ADDRESS_ROCKET_TOKEN_RETH,
  ADDRESS_ZERO_STRING,
  ONE_ETHER_IN_WEI,
} from './../constants'
import { BigInt } from '@graphprotocol/graph-ts'

/**
 * Occurs when an ODAO member votes on a balance (per block) and a consensus threshold is reached.
 */
export function handleBalancesUpdated(event: BalancesUpdated): void {
  // Preliminary check to ensure we haven't handled this before.
  if (
    rocketEntityUtilities.hasNetworkStakerBalanceCheckpointHasBeenIndexed(event)
  )
    return

  // Load the RocketTokenRETH contract.
  let rETHContract = rocketTokenRETH.bind(ADDRESS_ROCKET_TOKEN_RETH)
  if (rETHContract === null) return

  // Load the rocketDepositPool contract
  let rocketDepositPoolContract = rocketDepositPool.bind(
    ADDRESS_ROCKET_DEPOSIT_POOL,
  )
  if (rocketDepositPoolContract === null) return

  // How much is the total staker ETH balance in the deposit pool?
  let totalStakerETHWaitingInDepositPool = rocketDepositPoolContract.getBalance()

  // How much of the staker ETH balance in the deposit pool is not needed for queued minipools?
  let depositPoolStakerETHExcessBalance = rocketDepositPoolContract.getExcessBalance()

  // How much ETH is available as collateral in the RocketETH contract?
  let rEthTotalCollateral = rETHContract.getTotalCollateral()

  // The RocketEth contract balance is equal to the total collateral - the excess deposit pool balance.
  let totalStakerETHInRocketEthContract = rEthTotalCollateral.minus(
    depositPoolStakerETHExcessBalance,
  )
  if (totalStakerETHInRocketEthContract < BigInt.fromI32(0))
    totalStakerETHInRocketEthContract = BigInt.fromI32(0)

  // Attempt to create a new network balance checkpoint.
  let networkBalanceCheckpoint = rocketPoolEntityFactory.createNetworkStakerBalanceCheckpoint(
    rocketEntityUtilities.extractIdForEntity(event),
    event,
    totalStakerETHWaitingInDepositPool,
    totalStakerETHInRocketEthContract,
    rETHContract.getExchangeRate(),
  )
  if (networkBalanceCheckpoint === null) return

  // Protocol entity should exist, if not, then we attempt to create it.
  let protocol = rocketEntityUtilities.getRocketPoolProtocolEntity()
  if (protocol === null || protocol.id === null) {
    protocol = rocketPoolEntityFactory.createRocketPoolProtocol()
  }

  // We will use this to store the reward summary data for all staker checkpoints.
  let summary = new NetworkStakerRewardCheckpointSummary()

  // Retrieve exchange rate.
  let previousNetworkBalanceCheckpointId =
    protocol.lastNetworkStakerBalanceCheckPoint
  let previousNetworkBalanceCheckpoint = NetworkStakerBalanceCheckpoint.load(
    <string>previousNetworkBalanceCheckpointId,
  )
  if (previousNetworkBalanceCheckpoint !== null) {
    summary.totalStakerCheckpointsWithETHRewardsUpToThisCheckpoint = <BigInt>(
      previousNetworkBalanceCheckpoint.totalStakerCheckpointsWithETHRewardsUpToThisCheckpoint
    )
  }

  // Handle the staker impact.
  generateStakerBalanceCheckpoints(
    protocol.stakers,
    networkBalanceCheckpoint,
    previousNetworkBalanceCheckpoint,
    event.block.number,
    event.block.timestamp,
    summary,
  )

  // If for some reason our summary total up to this checkpoint was 0, then we try to set it based on the previous checkpoint.
  if (
    summary.totalStakerETHRewardsUpToThisCheckpoint == BigInt.fromI32(0) &&
    previousNetworkBalanceCheckpoint !== null
  ) {
    summary.totalStakerETHRewardsUpToThisCheckpoint =
      previousNetworkBalanceCheckpoint.totalStakerETHRewardsUpToThisCheckpoint
  }

  // Keep track of the total staker checkpoints related to ETH rewards up to this checkpoint.
  if (
    summary.totalStakersWithETHRewardsSincePreviousCheckpoint >
    BigInt.fromI32(0)
  ) {
    summary.totalStakerCheckpointsWithETHRewardsUpToThisCheckpoint = summary.totalStakerCheckpointsWithETHRewardsUpToThisCheckpoint.plus(
      summary.totalStakersWithETHRewardsSincePreviousCheckpoint,
    )
  }

  // Calculate average checkpoints with rewards per staker.
  if (
    summary.totalStakerCheckpointsWithETHRewardsUpToThisCheckpoint >=
      BigInt.fromI32(1) &&
    summary.totalStakersWithETHRewardsUpToThisCheckpoint >= BigInt.fromI32(1)
  ) {
    summary.averageCheckpointsWithRewardsPerStaker = 
       summary.totalStakerCheckpointsWithETHRewardsUpToThisCheckpoint.div(
        summary.totalStakersWithETHRewardsUpToThisCheckpoint,
    )
  }

  // Calculate average staker reward per checkpoint.
  if (
    summary.totalStakerETHRewardsUpToThisCheckpoint >= BigInt.fromI32(1) &&
    summary.averageCheckpointsWithRewardsPerStaker >= BigInt.fromI32(1) &&
    summary.totalStakersWithETHRewardsUpToThisCheckpoint >= BigInt.fromI32(1)
  ) {
    summary.averageStakerETHRewardsPerCheckpoint = 
      summary.totalStakerETHRewardsUpToThisCheckpoint.div(
        summary.totalStakersWithETHRewardsUpToThisCheckpoint
      ).div(
        summary.averageCheckpointsWithRewardsPerStaker);
  }

  // Based on the summary we got back from handling all the stakers, update our network balance checkpoint.
  networkBalanceCheckpoint.totalStakerETHRewardsSincePreviousCheckpoint =
    summary.totalStakerETHRewardsSincePreviousCheckpoint
  networkBalanceCheckpoint.totalStakersWithETHRewardsSincePreviousCheckpoint =
    summary.totalStakersWithETHRewardsSincePreviousCheckpoint
  networkBalanceCheckpoint.averageStakerETHRewardsSincePreviousCheckpoint =
    summary.averageStakerETHRewardsSincePreviousCheckpoint
  networkBalanceCheckpoint.totalStakerETHRewardsUpToThisCheckpoint =
    summary.totalStakerETHRewardsUpToThisCheckpoint
  networkBalanceCheckpoint.totalStakersWithETHRewardsUpToThisCheckpoint =
    summary.totalStakersWithETHRewardsUpToThisCheckpoint
  networkBalanceCheckpoint.totalStakerCheckpointsWithETHRewardsUpToThisCheckpoint =
    summary.totalStakerCheckpointsWithETHRewardsUpToThisCheckpoint
  networkBalanceCheckpoint.averageCheckpointsWithRewardsPerStaker =
    summary.averageCheckpointsWithRewardsPerStaker
  networkBalanceCheckpoint.averageStakerETHRewardsPerCheckpoint =
    summary.averageStakerETHRewardsPerCheckpoint
  networkBalanceCheckpoint.totalStakersWithAnRETHBalance =
    summary.totalStakersWithAnRETHBalance

  // Index these changes.
  networkBalanceCheckpoint.save()
  protocol.lastNetworkStakerBalanceCheckPoint = networkBalanceCheckpoint.id
  protocol.save()
}

/**
 * Loops through all stakers of the protocol.
 * If an active rETH balance is found..
 * Create a StakerBalanceCheckpoint
 */
function generateStakerBalanceCheckpoints(
  stakerIds: Array<string>,
  networkBalanceCheckpoint: NetworkStakerBalanceCheckpoint,
  previousNetworkBalanceCheckpoint: NetworkStakerBalanceCheckpoint | null,
  blockNumber: BigInt,
  blockTime: BigInt,
  summary: NetworkStakerRewardCheckpointSummary,
): void {
  // If we don't have any stakers, stop.
  if (stakerIds.length === 0 || summary === null) {
    return
  }

  // Loop through all the staker id's in the protocol.
  for (let index = 0; index < stakerIds.length; index++) {
    // Determine current staker ID.
    let stakerId = <string>stakerIds[index]

    // Preliminary check: staker ID can't be null.
    if (stakerId == null || stakerId == ADDRESS_ZERO_STRING) continue

    /**
     * Load the indexed staker.
     * Only continue if the staker actually has an rETH balance.
     * Storing the balances for stakers when they have an empty rETH balance would be redundant.
     * These stakers will keep their last checkpoint link & total rewards. (if they had any)
     */
    let staker = Staker.load(stakerId)
    if (staker === null) continue

    // If this staker has ever received rewards, then we need to keep track of that.
    let hadRewardsBeforeThisCheckpoint = false
    if (staker.totalETHRewards > BigInt.fromI32(0)) {
      hadRewardsBeforeThisCheckpoint = true
      summary.totalStakersWithETHRewardsUpToThisCheckpoint = summary.totalStakersWithETHRewardsUpToThisCheckpoint.plus(
        BigInt.fromI32(1),
      )
    }

    // Only generate a staker balance checkpoint if the staker still has an rETH balance.
    if (staker.rETHBalance == BigInt.fromI32(0)) continue

    // Update the summary so we know that this staker still had an rETH balance.
    summary.totalStakersWithAnRETHBalance = summary.totalStakersWithAnRETHBalance.plus(
      BigInt.fromI32(1),
    )

    // Store the current balances in temporary variables. This will make everything easier to read.
    let currentRETHBalance = staker.rETHBalance
    if (currentRETHBalance < BigInt.fromI32(0))
      currentRETHBalance = BigInt.fromI32(0)
    let currentETHBalance = currentRETHBalance
      .times(networkBalanceCheckpoint.rETHExchangeRate)
      .div(ONE_ETHER_IN_WEI)
    if (currentETHBalance < BigInt.fromI32(0))
      currentETHBalance = BigInt.fromI32(0)

    // Update the ETH balance of the staker.
    staker.ethBalance = currentETHBalance

    // By default, assume the previous (r)ETH balances are the same as the current ones.
    let previousRETHBalance = currentRETHBalance
    let previousETHBalance = currentETHBalance

    // If we had a previous staker balance checkpoint, then use the balances from that link.
    if (staker.lastBalanceCheckpoint !== null) {
      let previousStakerBalanceCheckpoint = StakerBalanceCheckpoint.load(
        <string>staker.lastBalanceCheckpoint,
      )
      if (previousStakerBalanceCheckpoint !== null) {
        previousRETHBalance = previousStakerBalanceCheckpoint.rETHBalance
        previousETHBalance = previousStakerBalanceCheckpoint.ethBalance
      }
      if (previousRETHBalance < BigInt.fromI32(0))
        previousRETHBalance = BigInt.fromI32(0)
      if (previousETHBalance < BigInt.fromI32(0))
        previousETHBalance = BigInt.fromI32(0)
    }

    // This will indicate how many ETH rewards we have since the previous checkpoint.
    let previousNetworkCheckpointExchangeRate = BigInt.fromI32(1)
    if (previousNetworkBalanceCheckpoint !== null) {
      previousNetworkCheckpointExchangeRate =
        previousNetworkBalanceCheckpoint.rETHExchangeRate
    }
    let ethRewardsSincePreviousCheckpoint = rocketEntityUtilities.getETHRewardsSincePreviousStakerBalanceCheckpoint(
      currentRETHBalance,
      currentETHBalance,
      previousRETHBalance,
      previousETHBalance,
      previousNetworkCheckpointExchangeRate,
      networkBalanceCheckpoint.rETHExchangeRate,
    )

    // Update stake total rewards based on how much he's earned since previous checkpoint.
    if (ethRewardsSincePreviousCheckpoint < BigInt.fromI32(0)) {
      staker.totalETHRewards = staker.totalETHRewards.minus(
        ethRewardsSincePreviousCheckpoint,
      )
    } else {
      staker.totalETHRewards = staker.totalETHRewards.plus(
        ethRewardsSincePreviousCheckpoint,
      )
    }

    // Create a new staker balance checkpoint for everything we've determined in this iteration.
    let stakerBalanceCheckpoint = rocketPoolEntityFactory.createStakerBalanceCheckpoint(
      networkBalanceCheckpoint.id + ' - ' + stakerId,
      staker,
      networkBalanceCheckpoint,
      currentETHBalance,
      currentRETHBalance,
      ethRewardsSincePreviousCheckpoint,
      staker.totalETHRewards,
      blockNumber,
      blockTime,
    )
    if (stakerBalanceCheckpoint != null) {
      // Keep our staker up to date with the active usable links/value(s) from this iteration.
      staker.lastBalanceCheckpoint = stakerBalanceCheckpoint.id

      // Index both the updated staker & the new staker balance checkpoint.
      stakerBalanceCheckpoint.save()
      staker.save()

      /*
        Now that we've indexed the staker/balance checkpoint..
        We need to update the summary.
        This includes: 
          - (if applicable) totalStakersWithETHRewardsSincePreviousCheckpoint
          - (if applicable) totalStakersWithETHRewardsUpToThisCheckpoint
          - ethRewardsSincePreviousCheckpoint
          - totalETHRewardsSinceCurrentCheckpoint
        */
      if (ethRewardsSincePreviousCheckpoint > BigInt.fromI32(0)) {
        summary.totalStakersWithETHRewardsSincePreviousCheckpoint = summary.totalStakersWithETHRewardsSincePreviousCheckpoint.plus(
          BigInt.fromI32(1),
        )

        // If this staker didn't have rewards before, keep track of that in the summary.
        if (hadRewardsBeforeThisCheckpoint == false) {
          summary.totalStakersWithETHRewardsUpToThisCheckpoint = summary.totalStakersWithETHRewardsUpToThisCheckpoint.plus(
            BigInt.fromI32(1),
          )
        }
      }
      rocketEntityUtilities.updateNetworkStakerRewardCheckpointSummary(
        summary,
        ethRewardsSincePreviousCheckpoint,
        staker.totalETHRewards,
      )
    }
  }

  /*
   When we've generated staker checkpoints for the current network staker balance checkpoint
   We need to calculate the averages.
  */

  // Calculate the average ETH rewards since the previous checkpoint.
  if (
    summary.totalStakerETHRewardsSincePreviousCheckpoint > BigInt.fromI32(0)
  ) {
    // Check if the total unique stakers with ETH rewards since previous checkpoint is greater than 0. (avoid divide by zero, though it's very unlikely)
    if (
      summary.totalStakersWithETHRewardsSincePreviousCheckpoint >
      BigInt.fromI32(0)
    ) {
      summary.averageStakerETHRewardsSincePreviousCheckpoint = summary.totalStakerETHRewardsSincePreviousCheckpoint.div(
        summary.totalStakersWithETHRewardsSincePreviousCheckpoint,
      )
    } else
      summary.averageStakerETHRewardsSincePreviousCheckpoint =
        summary.totalStakerETHRewardsSincePreviousCheckpoint
  }
}
