import { Address, ethereum } from '@graphprotocol/graph-ts'
import { RocketETHTransaction, Staker } from '../generated/schema'
import { BigInt } from '@graphprotocol/graph-ts'
import { rocketPoolEntityFactory } from './entityfactory'

class RocketEntityUtilities {
  /**
   * Extracts the ID that is commonly used to identify a RocketETHTransaction based on the given event.
   */
  public extractRocketETHTransactionID(event: ethereum.Event): string {
    return !!event && !!event.transaction && event.logIndex
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
    return (
      RocketETHTransaction.load(
        rocketEntityUtilities.extractRocketETHTransactionID(event),
      ) !== null
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
  ): { fromStaker: Staker; toStaker: Staker } {
    /*
     * Load or attempt to create the (new) staker from whom the rETH is being transferred.
     */
    const fromId = this.extractStakerId(from)
    const fromStaker =
      Staker.load(fromId) ??
      rocketPoolEntityFactory.createStaker(fromId, blockNumber, blockTimeStamp)

    /**
     * Load or attempt to create the (new) staker to whom the rETH is being transferred.
     */
    const toId = this.extractStakerId(to)
    const toStaker =
      Staker.load(toId) ??
      rocketPoolEntityFactory.createStaker(toId, blockNumber, blockTimeStamp)

    return { fromStaker, toStaker }
  }
}

export const rocketEntityUtilities = new RocketEntityUtilities()
