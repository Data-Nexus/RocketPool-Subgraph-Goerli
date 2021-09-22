import { BigInt, Address, Bytes } from '@graphprotocol/graph-ts'
import {
  RPLStaked,
  RPLSlashed,
  RPLWithdrawn,
} from '../../generated/rocketNodeStaking/rocketNodeStaking'
import { rocketTokenRETH } from '../../generated/rocketTokenRETH/rocketTokenRETH'
import { rocketNodeStaking } from '../../generated/rocketNodeStaking/rocketNodeStaking'
import { rocketStorage } from '../../generated/rocketNodeStaking/rocketStorage'
import { ONE_ETHER_IN_WEI } from './../constants/generalconstants'
import {
  ROCKET_STORAGE_ADDRESS,
  ROCKET_TOKEN_RETH_CONTRACT_NAME,
  ROCKET_NODE_STAKING_CONTRACT_NAME,
} from './../constants/contractconstants'
import {
  NODERPLSTAKETRANSACTIONTYPE_STAKED,
  NODERPLSTAKETRANSACTIONTYPE_WITHDRAWAL,
  NODERPLSTAKETRANSACTIONTYPE_SLASHED,
} from './../constants/enumconstants'
import { Node } from '../../generated/schema'
import { ethereum } from '@graphprotocol/graph-ts'
import { generalUtilities } from '../utilities/generalutilities'
import { rocketPoolEntityFactory } from '../entityfactory'


/**
 * Occurs when a node operator stakes RPL on his node to collaterize his minipools.
 */
export function handleRPLStaked(event: RPLStaked): void {
  saveNodeRPLStakeTransaction(
    event,
    event.params.from.toHex(),
    NODERPLSTAKETRANSACTIONTYPE_STAKED,
    event.params.amount,
  )
}

/**
 * Occurs when RPL is slashed to cover staker losses.
 */
export function handleRPLSlashed(event: RPLSlashed): void {
  saveNodeRPLStakeTransaction(
    event,
    event.params.node.toHex(),
    NODERPLSTAKETRANSACTIONTYPE_SLASHED,
    event.params.amount,
  )
}

/**
 * Occurs when a node operator withdraws RPL from his node.
 */
export function handleRPLWithdrawn(event: RPLWithdrawn): void {
  saveNodeRPLStakeTransaction(
    event,
    event.params.to.toHex(),
    NODERPLSTAKETRANSACTIONTYPE_WITHDRAWAL,
    event.params.amount,
  )
}

/**
 * Save a new RPL stake transaction.
 */
function saveNodeRPLStakeTransaction(
  event: ethereum.Event,
  nodeId: string,
  transactionType: string,
  amount: BigInt,
): void {
  // This state has to be valid before we can actually do anything.
  if (
    event === null ||
    event.block === null ||
    nodeId == null ||
    transactionType == null ||
    amount === BigInt.fromI32(0)
  )
    return

  // We can only handle an Node RPL transaction if the node exists.
  let node = Node.load(nodeId)
  if (node === null) return

  // Load the storage contract because we need to get the rETH contract address. (and some of its state)
  let rocketStorageContract = rocketStorage.bind(ROCKET_STORAGE_ADDRESS)
  let rETHContractAddress = rocketStorageContract.getAddress(
    generalUtilities.getRocketVaultContractAddressKey(ROCKET_TOKEN_RETH_CONTRACT_NAME) 
  )
  let rETHContract = rocketTokenRETH.bind(rETHContractAddress)
  if (rETHContract === null) return

  // Update active balances for stakesr.
  let exchangeRate = rETHContract.getExchangeRate()
  if (exchangeRate <= BigInt.fromI32(0)) exchangeRate = BigInt.fromI32(1)
  let ethAmount = amount.times(exchangeRate).div(ONE_ETHER_IN_WEI)

  // Create a new transaction for the given values.
  let nodeRPLStakeTransaction = rocketPoolEntityFactory.createNodeRPLStakeTransaction(
    generalUtilities.extractIdForEntity(event),
    nodeId,
    amount,
    ethAmount,
    transactionType,
    event.block.number,
    event.block.timestamp,
  )
  if (nodeRPLStakeTransaction === null || nodeRPLStakeTransaction.id == null)
    return

  // We will need the rocket node staking contract to get some latest state for the associated node.
  let rocketNodeStakingContractAddress = rocketStorageContract.getAddress(
    generalUtilities.getRocketVaultContractAddressKey(ROCKET_NODE_STAKING_CONTRACT_NAME) 
  )
  let rocketNodeStakingContract = rocketNodeStaking.bind(
    rocketNodeStakingContractAddress,
  )

  // Update node RPL balances & index those changes.
  updateNodeRPLBalances(
    node,
    amount,
    transactionType,
    rocketNodeStakingContract,
  )

  // Index
  nodeRPLStakeTransaction.save()
  node.save()
}

/**
 * After a transaction, the node RPL staking state must be brought up to date.
 */
function updateNodeRPLBalances(
  node: Node,
  amount: BigInt,
  transactionType: string,
  rocketNodeStakingContract: rocketNodeStaking,
) : void {
  node.rplStaked = rocketNodeStakingContract.getNodeRPLStake(
    Address.fromString(node.id),
  )
  node.effectiveRPLStaked = rocketNodeStakingContract.getNodeEffectiveRPLStake(
    Address.fromString(node.id),
  )

  // This isn't accessible via smart contracts, so we have to keep track manually.
  if (
    transactionType == NODERPLSTAKETRANSACTIONTYPE_SLASHED &&
    amount > BigInt.fromI32(0)
  ) {
    node.totalRPLSlashed = node.totalRPLSlashed.plus(amount)
  }
}
