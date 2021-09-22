import { Address, ethereum, BigInt } from '@graphprotocol/graph-ts'
import { rocketNodeManager } from '../../generated/rocketNodeManager/rocketNodeManager'
import { rocketDAONodeTrusted } from '../../generated/rocketRewardsPool/rocketDAONodeTrusted'
import { rocketStorage } from '../../generated/rocketRewardsPool/rocketStorage'
import { NetworkNodeBalanceCheckpoint } from '../../generated/schema'
import { ROCKET_NODE_MANAGER_CONTRACT_NAME, ROCKET_STORAGE_ADDRESS, ROCKET_DAO_NODE_TRUSTED_CONTRACT_NAME } from '../constants/contractconstants'
import { generalUtilities } from './generalUtilities';

class NodeUtilities {
  /**
   * Returns the node timezone identifier based on what was in the smart contracts.
   */
  public getNodeTimezoneId(nodeAddress: string) : string {
    let rocketStorageContract = rocketStorage.bind(ROCKET_STORAGE_ADDRESS);
    let rocketNodeManagerContractAddress = rocketStorageContract.getAddress(generalUtilities.getRocketVaultContractAddressKey(ROCKET_NODE_MANAGER_CONTRACT_NAME));
    let rocketNodeManagerContract = rocketNodeManager.bind(rocketNodeManagerContractAddress)
    let nodeTimezoneStringId = rocketNodeManagerContract.getNodeTimezoneLocation(
      Address.fromString(nodeAddress),
    )
    if (nodeTimezoneStringId == null) nodeTimezoneStringId = 'UNKNOWN'
    return nodeTimezoneStringId
  }

  /**
   * Checks if the given address is actually a trusted node.
   */
  public getIsTrustedNode(rocketStorageContract: rocketStorage, address: Address) : boolean {
    let isTrustedNode: boolean = false;

    let rocketDaoNodeTrustedAddress = rocketStorageContract.getAddress(
      generalUtilities.getRocketVaultContractAddressKey(ROCKET_DAO_NODE_TRUSTED_CONTRACT_NAME)
    )
    if (rocketDaoNodeTrustedAddress !== null) {
      let rocketDaoNodeTrustedContract = rocketDAONodeTrusted.bind(
        rocketDaoNodeTrustedAddress,
      )
        isTrustedNode = (
          rocketDaoNodeTrustedContract !== null &&
          rocketDaoNodeTrustedContract.getMemberIsValid(address)
        )
    }

    return isTrustedNode;
  }

  /**
   * Checks if there is already an indexed network node balance checkpoint for the given event.
   */
   public hasNetworkNodeBalanceCheckpointHasBeenIndexed(
    event: ethereum.Event,
  ): boolean {
    // Is this transaction already logged?
    return (
      NetworkNodeBalanceCheckpoint.load(
        generalUtilities.extractIdForEntity(event),
      ) !== null
    )
  }

  /**
   * Calculates and returns the minimum RPL a node operator needs to collaterize a minipool.
   */
  public getMinimumRPLForNewMinipool(nodeDepositAmount: BigInt, minimumEthCollateralRatio: BigInt,  rplPrice: BigInt) : BigInt {
      if(nodeDepositAmount == BigInt.fromI32(0) || minimumEthCollateralRatio == BigInt.fromI32(0) || rplPrice == BigInt.fromI32(0)) return BigInt.fromI32(0);
      return nodeDepositAmount.times(minimumEthCollateralRatio).div(rplPrice);
  }

  /**
   * Calculates and returns the maximum RPL a node operator needs to collaterize a minipool.
   */
   public getMaximumRPLForNewMinipool(nodeDepositAmount: BigInt, maximumETHCollateralRatio: BigInt,  rplPrice: BigInt) : BigInt {
    if(nodeDepositAmount == BigInt.fromI32(0) || maximumETHCollateralRatio == BigInt.fromI32(0) || rplPrice == BigInt.fromI32(0)) return BigInt.fromI32(0);
    return nodeDepositAmount.times(maximumETHCollateralRatio).div(rplPrice);
}
}

export let nodeUtilities = new NodeUtilities()
