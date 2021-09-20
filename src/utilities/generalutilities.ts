import { ethereum } from '@graphprotocol/graph-ts'
import {
  RocketETHTransaction,
  RocketPoolProtocol,
  DepositPool,
  RocketETH,
} from '../../generated/schema'
import { BigInt } from '@graphprotocol/graph-ts'
import {
  ROCKETPOOL_PROTOCOL_ROOT_ID,
  ADDRESS_ROCKET_DEPOSIT_POOL_STRING,
  ADDRESS_ROCKET_TOKEN_RETH_STRING,
} from './../constants'

class GeneralUtilities {
  /**
   * Loads the Rocket Protocol entity.
   */
  public getRocketPoolProtocolEntity(): RocketPoolProtocol | null {
    return RocketPoolProtocol.load(ROCKETPOOL_PROTOCOL_ROOT_ID)
  }

  /**
   * Loads the deposit pool entity.
   */
  public getDepositPool(): DepositPool | null {
    return DepositPool.load(ADDRESS_ROCKET_DEPOSIT_POOL_STRING)
  }

  /**
   * Loads the rocket ETH entity.
   */
  public getRocketETH(): RocketETH | null {
    return RocketETH.load(ADDRESS_ROCKET_TOKEN_RETH_STRING)
  }

  /**
   * Extracts the ID that is commonly used to identify an entity based on the given event.
   */
  public extractIdForEntity(event: ethereum.Event): string {
    return event.transaction.hash.toHex() + '-' + event.logIndex.toString()
  }

  /**
   * Checks if there is already an indexed transaction for the given event.
   */
  public hasTransactionHasBeenIndexed(event: ethereum.Event): boolean {
    // Is this transaction already logged?
    return RocketETHTransaction.load(this.extractIdForEntity(event)) !== null
  }

  /**
   * The RocketETH contract balance is equal to the total collateral - the excess deposit pool balance.
   */
  public getRocketETHBalance(
    depositPoolExcess: BigInt,
    rocketETHTotalCollateral: BigInt,
  ): BigInt {
    let totalStakerETHInRocketEthContract = rocketETHTotalCollateral.minus(
      depositPoolExcess,
    )

    if (totalStakerETHInRocketEthContract < BigInt.fromI32(0))
      totalStakerETHInRocketEthContract = BigInt.fromI32(0)

    return totalStakerETHInRocketEthContract
  }
}

export let generalUtilities = new GeneralUtilities()
