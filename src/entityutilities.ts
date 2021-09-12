import { Address, ethereum } from '@graphprotocol/graph-ts'
import {
  RocketETHTransaction,
  NetworkBalanceCheckpoint,
  Staker,
  RocketPoolProtocol,
} from '../generated/schema'
import { BigInt } from '@graphprotocol/graph-ts'
import { rocketPoolEntityFactory } from './entityfactory'
import { ROCKETPOOL_PROTOCOL_ROOT_ID } from './constants'

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
    return !!event && !!event.transaction && !!event.logIndex
      ? event.transaction.hash.toHex() + '-' + event.logIndex.toString()
      : null
  }

  /**
   * Attempts to create a new Staker.
   */
  public extractStakerId(address: Address): string {
    return !!address ? address.toHexString() : null
  }

  /**
   * Checks if there is already an indexed transaction for the given event.
   */
  public hasTransactionHasBeenIndexed(event: ethereum.Event): boolean {
    // Is this transaction already logged?
    return RocketETHTransaction.load(this.extractIdForEntity(event)) !== null
  }

  /**
   * Checks if there is already an indexed network balance for the given event.
   */
  public hasNetworkBalanceCheckpointHasBeenIndexed(
    event: ethereum.Event,
  ): boolean {
    // Is this transaction already logged?
    return (
      NetworkBalanceCheckpoint.load(this.extractIdForEntity(event)) !== null
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
    let transactionStakers = new TransactionStakers()

    /*
     * Load or attempt to create the (new) staker from whom the rETH is being transferred.
     */
    let fromId = this.extractStakerId(from)
    transactionStakers.fromStaker = <Staker>Staker.load(fromId)
    if (transactionStakers.fromStaker === null) {
      transactionStakers.fromStaker = <Staker>(
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
    transactionStakers.toStaker = <Staker>Staker.load(toId)
    if (transactionStakers.toStaker === null) {
      transactionStakers.toStaker = <Staker>(
        rocketPoolEntityFactory.createStaker(toId, blockNumber, blockTimeStamp)
      )
    }

    return transactionStakers
  }

  /**
   * Changes the balance for a staker, with the amount and either a minus or a plus operation.
   */
  public changeStakerBalance(staker: Staker, rEthAmount: BigInt, increase: boolean) : void {
    if(staker === null) return;

    if (increase) staker.activeRETHBalance = staker.activeRETHBalance.plus(rEthAmount);
    else {
      if (staker.activeRETHBalance >= rEthAmount) staker.activeRETHBalance = staker.activeRETHBalance.minus(rEthAmount);
      else staker.activeRETHBalance = BigInt.fromI32(0); // Could be zero address.
    }
  }

  /**
   * Returns the total ETH rewards for a staker since the previous staker balance checkpoint.
   */
  public getETHRewardsSincePreviousStakerBalanceCheckpoint(
    activeRETHBalance: BigInt, 
    activeETHBalance: BigInt, 
    previousRETHBalance: BigInt, 
    previousETHBalance: BigInt) : BigInt {

    // This will indicate how many ETH rewards we have since the previous checkpoint.
    let ethRewardsSincePreviousCheckpoint = BigInt.fromI32(0)

    /**
     * The staker can only have (+/-)rewards when he had an (r)ETH balance last checkpoint
     * and if his ETH balance from last time isn't the same as the current ETH balance.
     */
    if (
      previousRETHBalance > BigInt.fromI32(0) &&
      activeETHBalance !== previousETHBalance
    ) {
      // CASE #1: The staker his rETH balance stayed the same since last checkpoint.
      if (activeRETHBalance === previousRETHBalance) {
        ethRewardsSincePreviousCheckpoint = activeETHBalance.minus(
          previousETHBalance,
        )
      }
      // CASE #2: The staker his rETH balance transferred some of holdings since last checkpoint.
      else if (activeRETHBalance < previousRETHBalance) {
        // Determine the rETH:ETH exchange rate for the previous checkpoint.
        let previousCheckpointExchangeRate = previousETHBalance.div(
          previousRETHBalance,
        )

        // How much was the ETH value that was transferred away during this checkpoint.
        let ethTransferredInCheckpoint = previousRETHBalance
          .minus(activeRETHBalance)
          .times(previousCheckpointExchangeRate)
        ethRewardsSincePreviousCheckpoint = activeETHBalance.minus(
          previousETHBalance.minus(ethTransferredInCheckpoint),
        )
      }
      // CASE #3: The staker his rETH balance transferred some of holdings since last checkpoint.
      else if (activeRETHBalance > previousRETHBalance) {
        // Determine the rETH:ETH exchange rate for the previous checkpoint.
        let previousCheckpointExchangeRate = previousETHBalance.div(
          previousRETHBalance,
        )

        // How much was the ETH value that was received during this checkpoint.
        let ethReceivedInCheckpoint = activeRETHBalance
          .minus(previousRETHBalance)
          .times(previousCheckpointExchangeRate)
        ethRewardsSincePreviousCheckpoint = activeETHBalance
          .minus(ethReceivedInCheckpoint)
          .minus(previousETHBalance)
      }
    }

    return ethRewardsSincePreviousCheckpoint;
  }
}

class TransactionStakers {
  fromStaker: Staker
  toStaker: Staker
}

export let rocketEntityUtilities = new RocketEntityUtilities()
