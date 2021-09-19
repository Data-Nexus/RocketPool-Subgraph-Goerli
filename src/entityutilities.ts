import { Address, ethereum } from '@graphprotocol/graph-ts'
import {
  RocketETHTransaction,
  NetworkStakerBalanceCheckpoint,
  Staker,
  RocketPoolProtocol,
} from '../generated/schema'
import { BigInt } from '@graphprotocol/graph-ts'
import { rocketPoolEntityFactory } from './entityfactory'
import { ROCKETPOOL_PROTOCOL_ROOT_ID, ONE_ETHER_IN_WEI, ADDRESS_ZERO_STRING } from './constants'

class RocketEntityUtilities {
  /**
   * Loads the Rocket Protocol entity from
   */
  public getRocketPoolProtocolEntity(): RocketPoolProtocol | null {
    return RocketPoolProtocol.load(ROCKETPOOL_PROTOCOL_ROOT_ID)
  }

  /**
   * Extracts the ID that is commonly used to identify an entity based on the given event.
   */
  public extractIdForEntity(event: ethereum.Event): string {
    return event.transaction.hash.toHex() + '-' + event.logIndex.toString();
  }

  /**
   * Attempts to create a new Staker.
   */
  public extractStakerId(address: Address): string {
    return address.toHexString();
  }

  /**
   * Checks if there is already an indexed transaction for the given event.
   */
  public hasTransactionHasBeenIndexed(event: ethereum.Event): boolean {
    // Is this transaction already logged?
    return RocketETHTransaction.load(this.extractIdForEntity(event)) !== null
  }

  /**
   * Checks if there is already an indexed network staker balance checkpoint for the given event.
   */
  public hasNetworkStakerBalanceCheckpointHasBeenIndexed(
    event: ethereum.Event,
  ): boolean {
    // Is this transaction already logged?
    return (
      NetworkStakerBalanceCheckpoint.load(this.extractIdForEntity(event)) !== null
    )
  }

  /**
   * Gets the relevant stakers based on some transaction parameters.
   */
  public getTransactionStakers(
    from: Address,
    to: Address,
    blockNumber: BigInt,
    blockTimeStamp: BigInt,
  ): TransactionStakers {
    /*
     * Load or attempt to create the (new) staker from whom the rETH is being transferred.
     */
    let fromId = this.extractStakerId(from)
    let fromStaker : Staker | null  = <Staker | null>Staker.load(fromId);
    if (fromStaker === null) {
      fromStaker = <Staker>(
        rocketPoolEntityFactory.createStaker(
          fromId,
          blockNumber,
          blockTimeStamp,
        )
      )
    }

    /**
     * Load or attempt to create the (new) staker to whom the rETH is being transferred.
     */
    let toId = this.extractStakerId(to)
    let toStaker: Staker | null = <Staker | null>Staker.load(toId);
    if (toStaker === null) {
      toStaker = <Staker>(
        rocketPoolEntityFactory.createStaker(toId, blockNumber, blockTimeStamp)
      )
    }

    return new TransactionStakers(<Staker>fromStaker, <Staker>toStaker);
  }

  /**
   * Changes the balance for a staker, with the amount and either a minus or a plus operation.
   */
  public changeStakerBalances(staker: Staker, rEthAmount: BigInt, rEthExchangeRate : BigInt, increase: boolean) : void {
    // Don't store balance for the zero address.
    if (staker === null || staker.id == ADDRESS_ZERO_STRING) return

    // Set current rETH balance.
    if (increase) staker.rETHBalance = staker.rETHBalance.plus(rEthAmount);
    else {
      if (staker.rETHBalance >= rEthAmount) staker.rETHBalance = staker.rETHBalance.minus(rEthAmount);
      else staker.rETHBalance = BigInt.fromI32(0); // Could be zero address.
    }

    // Set current ETH balance.
    if (rEthExchangeRate > BigInt.fromI32(0) && rEthAmount > BigInt.fromI32(0)) staker.ethBalance = staker.rETHBalance.times(rEthExchangeRate).div(ONE_ETHER_IN_WEI);
    else staker.ethBalance = BigInt.fromI32(0);
  }

  /**
   * Returns the total ETH rewards for a staker since the previous staker balance checkpoint.
   */
  public getETHRewardsSincePreviousStakerBalanceCheckpoint(
    activeRETHBalance: BigInt, 
    activeETHBalance: BigInt, 
    previousRETHBalance: BigInt, 
    previousETHBalance: BigInt,
    previousCheckPointExchangeRate: BigInt) : BigInt {

    // This will indicate how many ETH rewards we have since the previous checkpoint.
    let ethRewardsSincePreviousCheckpoint = BigInt.fromI32(0)

    /**
     * The staker can only have (+/-)rewards when he had an (r)ETH balance last checkpoint
     * and if his ETH balance from last time isn't the same as the current ETH balance.
     */
    if (
      previousRETHBalance > BigInt.fromI32(0) &&
      (activeETHBalance > previousETHBalance || activeETHBalance < previousETHBalance)
    ) {
      // CASE #1: The staker his rETH balance stayed the same since last checkpoint.
      if (activeRETHBalance == previousRETHBalance) {
        ethRewardsSincePreviousCheckpoint = activeETHBalance.minus(
          previousETHBalance,
        )
      }
      // CASE #2: The staker his rETH balance transferred some of holdings since last checkpoint.
      else if (activeRETHBalance < previousRETHBalance) {
        // How much was the ETH value that was transferred away during this checkpoint.
        let ethTransferredInCheckpoint = previousRETHBalance
          .minus(activeRETHBalance)
          .times(previousCheckPointExchangeRate)
          .div(ONE_ETHER_IN_WEI)
        ethRewardsSincePreviousCheckpoint = activeETHBalance.minus(
          previousETHBalance.minus(ethTransferredInCheckpoint),
        )
      }
      // CASE #3: The staker his rETH balance transferred some of holdings since last checkpoint.
      else if (activeRETHBalance > previousRETHBalance) {
        // How much was the ETH value that was received during this checkpoint.
        let ethReceivedInCheckpoint = activeRETHBalance
          .minus(previousRETHBalance)
          .times(previousCheckPointExchangeRate)
          .div(ONE_ETHER_IN_WEI)
        ethRewardsSincePreviousCheckpoint = activeETHBalance
          .minus(ethReceivedInCheckpoint)
          .minus(previousETHBalance)
      }
    }

    return ethRewardsSincePreviousCheckpoint;
  }

  /**
   * Updates the given summary based on the rewards since previous checkpoint and the total rewards for a staker.
   */
  public updateNetworkStakerRewardCheckpointSummary(summary : NetworkStakerRewardCheckpointSummary, ethRewardsSincePreviousCheckpoint: BigInt, totalETHRewards: BigInt) : void {
    if(summary === null) return
    
    if(ethRewardsSincePreviousCheckpoint > BigInt.fromI32(0)) {
      summary.totalStakerETHRewardsSincePreviousCheckpoint = summary.totalStakerETHRewardsSincePreviousCheckpoint.plus(ethRewardsSincePreviousCheckpoint);
    } else {
      summary.totalStakerETHRewardsSincePreviousCheckpoint = summary.totalStakerETHRewardsSincePreviousCheckpoint.minus(ethRewardsSincePreviousCheckpoint);
    }
    if(totalETHRewards > BigInt.fromI32(0)) {
      summary.totalStakerETHRewardsUpToThisCheckpoint = summary.totalStakerETHRewardsUpToThisCheckpoint.plus(totalETHRewards);
    } else {
      summary.totalStakerETHRewardsUpToThisCheckpoint = summary.totalStakerETHRewardsUpToThisCheckpoint.minus(totalETHRewards);
    }
  }
}

export class TransactionStakers {
  fromStaker: Staker
  toStaker: Staker

  constructor(from: Staker, to: Staker) {
    this.fromStaker = from;
    this.toStaker = to;
   }
}

export class NetworkStakerRewardCheckpointSummary {
  totalStakerETHRewardsSincePreviousCheckpoint: BigInt
  totalStakerETHRewardsUpToThisCheckpoint: BigInt

  constructor(totalStakerETHRewardsSincePreviousCheckpoint: BigInt, totalStakerETHRewardsUpToThisCheckpoint: BigInt) {
    this.totalStakerETHRewardsSincePreviousCheckpoint = totalStakerETHRewardsSincePreviousCheckpoint;
    this.totalStakerETHRewardsUpToThisCheckpoint = totalStakerETHRewardsUpToThisCheckpoint;
   }
}

export let rocketEntityUtilities = new RocketEntityUtilities()
