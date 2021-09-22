import { Address } from '@graphprotocol/graph-ts'
import { rocketNodeManager } from '../../generated/rocketNodeManager/rocketNodeManager'
import { rocketStorage } from '../../generated/rocketRewardsPool/rocketStorage'
import { ROCKET_NODE_MANAGER_CONTRACT_NAME, ROCKET_STORAGE_ADDRESS } from '../constants/contractconstants'
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
}

export let nodeUtilities = new NodeUtilities()
