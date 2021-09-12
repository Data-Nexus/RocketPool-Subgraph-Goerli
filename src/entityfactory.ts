import { ethereum, BigInt } from '@graphprotocol/graph-ts'
import {
  Staker,
  RocketETHTransaction,
  NetworkBalanceCheckpoint,
  RocketPoolProtocol,
  StakerBalanceCheckpoint,
} from '../generated/schema'
import { BalancesUpdated } from '../generated/rocketNetworkBalances/rocketNetworkBalances'
import { ROCKETPOOL_PROTOCOL_ROOT_ID } from './constants'

class RocketPoolEntityFactory {
  /**
   * Should only every be saved once.
   */
  public createRocketPoolProtocol(): RocketPoolProtocol {
    let protocol = new RocketPoolProtocol(ROCKETPOOL_PROTOCOL_ROOT_ID)
    protocol.stakers = new Array<string>(0)
    protocol.lastNetworkBalanceCheckPoint = null
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
   * Attempts to create a new NetworkBalanceCheckpoint.
   */
  public createNetworkBalanceCheckpoint(
    id: string,
    event: BalancesUpdated,
    rEthExchangeRate: BigInt,
  ): NetworkBalanceCheckpoint | null {
    if (
      id === null ||
      event === null ||
      event.block === null ||
      event.params === null
    )
      return null

    // Instantiate a new network balance.
    let networkBalance = new NetworkBalanceCheckpoint(id)
    networkBalance.ethStaked = event.params.stakingEth
    networkBalance.totalEth = event.params.totalEth
    networkBalance.rEthCirculating = event.params.rethSupply
    networkBalance.rEthExchangeRate = rEthExchangeRate
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
    staker.block = blockNumber
    staker.blockTime = blockTime
    staker.lastBalanceCheckpoint = null
    staker.activeRETHBalance = BigInt.fromI32(0)
    staker.totalETHRewards = BigInt.fromI32(0)

    // Return our new Staker.
    return staker
  }

  /**
   * Attempts to create a new staker balance checkpoint for the given values.
   */
  public createStakerBalanceCheckpoint(
    id: string,
    staker: Staker | null,
    networkBalanceCheckpoint: NetworkBalanceCheckpoint | null,
    ethBalance: BigInt,
    rEthBalance: BigInt,
    ethRewardsSincePreviousCheckpoint: BigInt,
    blockNumber: BigInt,
    blockTime: BigInt,
  ): StakerBalanceCheckpoint | null {
    if (
      id === null ||
      staker === null ||
      staker.id === null ||
      networkBalanceCheckpoint === null ||
      networkBalanceCheckpoint.id === null
    )
      return null

    // Instantiate a new staker balance checkpoint.
    let stakerBalanceCheckpoint = new StakerBalanceCheckpoint(id)
    stakerBalanceCheckpoint.staker = staker.id
    stakerBalanceCheckpoint.networkBalanceCheckpoint =
      networkBalanceCheckpoint.id
    stakerBalanceCheckpoint.ethBalance = ethBalance
    stakerBalanceCheckpoint.rEthBalance = rEthBalance
    stakerBalanceCheckpoint.ethRewardsSincePreviousCheckpoint = ethRewardsSincePreviousCheckpoint
    stakerBalanceCheckpoint.block = blockNumber
    stakerBalanceCheckpoint.blockTime = blockTime

    // Return the new staker balance checkpoint.
    return stakerBalanceCheckpoint
  }
}

export let rocketPoolEntityFactory = new RocketPoolEntityFactory()
