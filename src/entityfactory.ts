import { ethereum, BigInt } from '@graphprotocol/graph-ts'
import {
  Staker,
  RocketETHTransaction,
  NetworkStakerBalanceCheckpoint,
  RocketPoolProtocol,
  StakerBalanceCheckpoint,
} from '../generated/schema'
import { BalancesUpdated } from '../generated/rocketNetworkBalances/rocketNetworkBalances'
import { ROCKETPOOL_PROTOCOL_ROOT_ID } from './constants'

class RocketPoolEntityFactory {
  /**
   * Should only every be created once.
   */
  public createRocketPoolProtocol(): RocketPoolProtocol {
    let protocol = new RocketPoolProtocol(ROCKETPOOL_PROTOCOL_ROOT_ID)
    protocol.stakers = new Array<string>(0)
    protocol.lastNetworkStakerBalanceCheckPoint = null
    return protocol
  }

  /**
   * Attempts to create a new RocketETHTransaction.
   */
  public createRocketETHTransaction(
    id: string,
    from: Staker,
    to: Staker,
    amount: BigInt,
    event: ethereum.Event,
  ): RocketETHTransaction | null {
    if (
      id === null ||
      from === null ||
      from.id === null ||
      to === null ||
      to.id === null ||
      event === null ||
      event.block === null ||
      event.transaction === null
    )
      return null

    // Instantiate a new transaction.
    let rocketETHTransaction = new RocketETHTransaction(id)
    rocketETHTransaction.from = from.id
    rocketETHTransaction.amount = amount
    rocketETHTransaction.to = to.id
    rocketETHTransaction.block = event.block.number
    rocketETHTransaction.blockTime = event.block.timestamp
    rocketETHTransaction.transactionHash = event.transaction.hash

    // Return our new transaction.
    return rocketETHTransaction
  }

  /**
   * Attempts to create a new NetworkStakerBalanceCheckpoint.
   */
  public createNetworkStakerBalanceCheckpoint(
    id: string,
    event: BalancesUpdated,
    totalStakerETHWaitingInDepositPool: BigInt,
    totalStakerETHInRocketEthContract: BigInt,
    rEthExchangeRate: BigInt
  ): NetworkStakerBalanceCheckpoint | null {
    if (
      id === null ||
      event === null ||
      event.block === null ||
      event.params === null
    )
      return null

    // Use 0 if negative was passed in for totals.
    if(totalStakerETHWaitingInDepositPool < BigInt.fromI32(0)) totalStakerETHWaitingInDepositPool = BigInt.fromI32(0);
    if(totalStakerETHInRocketEthContract < BigInt.fromI32(0)) totalStakerETHInRocketEthContract = BigInt.fromI32(0);
    let totalStakerETHInProtocol = BigInt.fromI32(0);
    if(event.params.totalEth > BigInt.fromI32(0)) totalStakerETHInProtocol = event.params.totalEth;
    let totalStakerETHActivelyStaking = BigInt.fromI32(0);
    if(event.params.stakingEth > BigInt.fromI32(0)) totalStakerETHActivelyStaking = event.params.stakingEth;

    // Determine how much ETH was in the pending or exited minipools related to stakers.
    let totalStakerETHInPendingOrExitedMinipools = totalStakerETHInProtocol.minus(totalStakerETHActivelyStaking).minus(totalStakerETHWaitingInDepositPool).minus(totalStakerETHInRocketEthContract);
    if (totalStakerETHInPendingOrExitedMinipools < BigInt.fromI32(0)) totalStakerETHInPendingOrExitedMinipools = BigInt.fromI32(0);

    // Instantiate a new network balance.
    let networkBalance = new NetworkStakerBalanceCheckpoint(id)
    networkBalance.totalStakerETHActivelyStaking = totalStakerETHActivelyStaking
    networkBalance.totalStakerETHWaitingInDepositPool = totalStakerETHWaitingInDepositPool
    networkBalance.totalStakerETHInRocketEthContract = totalStakerETHInRocketEthContract
    networkBalance.totalStakerETHInPendingOrExitedMinipools = totalStakerETHInPendingOrExitedMinipools
    networkBalance.totalStakerETHInProtocol = totalStakerETHInProtocol
    networkBalance.totalRETHSupply = event.params.rethSupply
    networkBalance.rETHExchangeRate = rEthExchangeRate
    networkBalance.block = event.block.number
    networkBalance.blockTime = event.block.timestamp

    // Return the new network balance checkpoint.
    return networkBalance
  }

  /**
   * Attempts to create a new Staker.
   */
  public createStaker(
    id: string,
    blockNumber: BigInt,
    blockTime: BigInt,
  ): Staker | null {
    if (id === null) return null

    // Instantiate a new staker.
    let staker = new Staker(id)
    staker.rETHBalance = BigInt.fromI32(0)
    staker.ethBalance = BigInt.fromI32(0)
    staker.totalETHRewards = BigInt.fromI32(0)
    staker.lastBalanceCheckpoint = null
    staker.block = blockNumber
    staker.blockTime = blockTime

    // Return our new Staker.
    return staker
  }

  /**
   * Attempts to create a new staker balance checkpoint for the given values.
   */
  public createStakerBalanceCheckpoint(
    id: string,
    staker: Staker | null,
    networkStakerBalanceCheckpoint: NetworkStakerBalanceCheckpoint | null,
    ethBalance: BigInt,
    rEthBalance: BigInt,
    ethRewardsSincePreviousCheckpoint: BigInt,
    totalETHRewardsUpToThisCheckpoint: BigInt,
    blockNumber: BigInt,
    blockTime: BigInt,
  ): StakerBalanceCheckpoint | null {
    if (
      id === null ||
      staker === null ||
      staker.id === null ||
      networkStakerBalanceCheckpoint === null ||
      networkStakerBalanceCheckpoint.id === null
    )
      return null

    // Instantiate a new staker balance checkpoint.
    let stakerBalanceCheckpoint = new StakerBalanceCheckpoint(id)
    stakerBalanceCheckpoint.stakerId = staker.id
    stakerBalanceCheckpoint.networkStakerBalanceCheckpointId = networkStakerBalanceCheckpoint.id
    stakerBalanceCheckpoint.ethBalance = ethBalance
    stakerBalanceCheckpoint.rETHBalance = rEthBalance
    stakerBalanceCheckpoint.ethRewardsSincePreviousCheckpoint = ethRewardsSincePreviousCheckpoint
    stakerBalanceCheckpoint.totalETHRewardsUpToThisCheckpoint = totalETHRewardsUpToThisCheckpoint
    stakerBalanceCheckpoint.block = blockNumber
    stakerBalanceCheckpoint.blockTime = blockTime

    // Return the new staker balance checkpoint.
    return stakerBalanceCheckpoint
  }
}

export let rocketPoolEntityFactory = new RocketPoolEntityFactory()
