import { Address } from '@graphprotocol/graph-ts'
import { rocketNodeManager } from '../../generated/rocketNodeManager/rocketNodeManager'
import { rocketDAONodeTrusted } from '../../generated/rocketRewardsPool/rocketDAONodeTrusted'
import { rocketStorage } from '../../generated/rocketRewardsPool/rocketStorage'
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
      Address.fromHexString(nodeAddress),
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
}

export let nodeUtilities = new NodeUtilities()
