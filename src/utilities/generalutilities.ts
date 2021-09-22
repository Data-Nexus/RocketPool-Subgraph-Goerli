import { Address, Bytes, ethereum } from '@graphprotocol/graph-ts'
import {
  RocketPoolProtocol,
} from '../../generated/schema'
import { BigInt } from '@graphprotocol/graph-ts'
import {
  ROCKETPOOL_PROTOCOL_ROOT_ID
} from '../constants/generalconstants'
import { ROCKETPOOL_THEGRAPH_HELPER_CONTACT_ADDRESS_NAME } from '../constants/contractconstants'

class GeneralUtilities {
  /**
   * Loads the Rocket Protocol entity.
   */
  public getRocketPoolProtocolEntity(): RocketPoolProtocol | null {
    return RocketPoolProtocol.load(ROCKETPOOL_PROTOCOL_ROOT_ID)
  }

  /**
   * Extracts the ID that is commonly used to identify an entity based on the given event.
   */
  public extractIdForEntity(event: ethereum.Event): string {
    return event.transaction.hash.toHex() + '-' + event.logIndex.toString()
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

  /**
   * Performs a low level smart contract call to a helper class so we can get an address from the rocketvault.
   */
  public getRocketVaultContractAddressKey(key: string) : Bytes {
    return TheGraphRPHelperContract.get().getContractAddress(key);
  }
}
export let generalUtilities = new GeneralUtilities()

export class TheGraphRPHelperContract extends ethereum.SmartContract {
  static get(): TheGraphRPHelperContract {
    return new TheGraphRPHelperContract("rocketPoolTheGraphHelper", Address.fromString(ROCKETPOOL_THEGRAPH_HELPER_CONTACT_ADDRESS_NAME));
  }

  getContractAddress(key: string): Bytes {
    let result = super.call(
      "getContractAddress",
      "getContractAddress(string):(bytes32)",
      [ethereum.Value.fromString(key)]
    );

    return result[0].toBytes();
  }
}