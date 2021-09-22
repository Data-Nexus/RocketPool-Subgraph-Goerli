import { Address, Bytes } from '@graphprotocol/graph-ts'
import { rocketDAONodeTrusted } from '../../generated/rocketRewardsPool/rocketDAONodeTrusted'
import { rocketStorage } from '../../generated/rocketRewardsPool/rocketStorage'
import {
    ROCKET_DAO_NODE_TRUSTED_CONTRACT_NAME,
    ROCKET_DAO_PROTOCOL_REWARD_CLAIM_CONTRACT_NAME
  } from '../constants/contractconstants'
import {
    RPLREWARDCLAIMERTYPE_NODE,
    RPLREWARDCLAIMERTYPE_PDAO,
    RPLREWARDCLAIMERTYPE_TRUSTEDNODE,
  } from '../constants/enumconstants'  
import { Node } from '../../generated/schema'
import { generalUtilities } from './generalUtilities'
import { nodeUtilities } from './nodeutilities';

class RPLRewardUtilties {
    
/**
 * Determine the claimer type for a specific RPL reward claim event.
 */
public getRplRewardClaimerType(
    rocketStorageContract: rocketStorage,
    claimingContract: Address,
    claimingAddress: Address,
  ): string | null {
    let rplRewardClaimerType: string | null = null
    if (
      rocketStorageContract === null ||
      claimingContract === null ||
      claimingAddress === null
    )
      return rplRewardClaimerType
  
    // We will use the rocket storage contract to get specific smart contract state.
    // If the rocket storage is null and causes an exception, stop indexing because that shouldn't occur.
    let pdaoClaimContractAddress : Address = rocketStorageContract.getAddress(
      generalUtilities.getRocketVaultContractAddressKey(ROCKET_DAO_PROTOCOL_REWARD_CLAIM_CONTRACT_NAME)
    )
  
    // #1: Could be the PDAO.
    if (
      pdaoClaimContractAddress !== null &&
      claimingContract.toHexString() == pdaoClaimContractAddress.toHexString()
    ) {
      rplRewardClaimerType = RPLREWARDCLAIMERTYPE_PDAO
    }
  
    // #2: Could be a trusted node.
    if (rplRewardClaimerType == null && nodeUtilities.getIsTrustedNode(rocketStorageContract, claimingAddress)) {
       rplRewardClaimerType = RPLREWARDCLAIMERTYPE_TRUSTEDNODE
    }
  
    // #3: if the claimer type is still null, it **should** be a regular node.
    if (rplRewardClaimerType == null) {
      // Load the associated regular node.
      let associatedNode = Node.load(claimingAddress.toHexString())
      if (associatedNode !== null) {
        rplRewardClaimerType = RPLREWARDCLAIMERTYPE_NODE
      }
    }
  
    return rplRewardClaimerType
  }
}

export let rplRewardUtilities = new RPLRewardUtilties()
