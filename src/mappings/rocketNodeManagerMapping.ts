import { BigInt } from '@graphprotocol/graph-ts'
import {
  NodeRegistered,
  NodeTimezoneLocationSet,
} from '../../generated/rocketNodeManager/rocketNodeManager'
import { generalUtilities } from '../utilities/generalutilities'
import { nodeUtilities } from '../utilities/nodeutilities'
import { rocketPoolEntityFactory } from '../entityfactory'
import { Node, NetworkNodeTimezone } from '../../generated/schema'

/**
 * Occurs when a node operator registers his address with the RocketPool protocol.
 */
export function handleNodeRegister(event: NodeRegistered): void {
  // We can only register an address as a node if it hasn't been registered yet.
  let node = Node.load(event.params.node.toHex())
  if (node !== null) return

  // Retrieve the associated timezone, if the timezone doesn't exist yet, we need to create it.
  let nodeTimezoneStringId = nodeUtilities.getNodeTimezoneId(
    event.params.node.toHex(),
  )
  let nodeTimezone = NetworkNodeTimezone.load(nodeTimezoneStringId)
  if (nodeTimezone === null || nodeTimezone.id == null) {
    nodeTimezone = rocketPoolEntityFactory.createNodeTimezone(
      nodeTimezoneStringId,
    )
  }

  // Increment the total registered nodes for this timezone.
  nodeTimezone.totalRegisteredNodes = nodeTimezone.totalRegisteredNodes.plus(
    BigInt.fromI32(1),
  )

  //Index the timezone changes.
  nodeTimezone.save()

  // Create the node for this timezone and index it.
  node = rocketPoolEntityFactory.createNode(
    event.params.node.toHex(),
    nodeTimezone.id,
    event.block.number,
    event.block.timestamp,
  )
  node.save()

  // Protocol entity should exist, if not, then we attempt to create it.
  let protocol = generalUtilities.getRocketPoolProtocolEntity()
  if (protocol === null || protocol.id == null) {
    protocol = rocketPoolEntityFactory.createRocketPoolProtocol()
    protocol.save()
  }

  // Add this node to the collection of the protocol if necessary and index.
  let protocolNodes = protocol.nodes
  if (protocol.nodes.indexOf(node.id) == -1) protocolNodes.push(node.id)
  protocol.nodes = protocolNodes
  protocol.save()
}

/**
 * Occurs when a node operator changes his timzone in the RocketPool protocol.
 */
export function handleNodeTimezoneChanged(
  event: NodeTimezoneLocationSet,
): void {
  if (event === null || event.params === null || event.params.node === null)
    return

  // The node in question has to exist before we can change its timezone.
  let node = Node.load(event.params.node.toHex())
  if (node === null) return

  // Decrement the total registered nodes for the old timezone.
  if (node.timezone != null) {
    let oldNodeTimezone = NetworkNodeTimezone.load(node.timezone)
    if (oldNodeTimezone !== null) {
      oldNodeTimezone.totalRegisteredNodes = oldNodeTimezone.totalRegisteredNodes.minus(
        BigInt.fromI32(1),
      )
      if (oldNodeTimezone.totalRegisteredNodes < BigInt.fromI32(0)) {
        oldNodeTimezone.totalRegisteredNodes = BigInt.fromI32(0)
      }
      oldNodeTimezone.save()
    }
  }

  // If the newly set timezone doesn't exist yet, we need to create it.
  let newNodeTimezoneId = nodeUtilities.getNodeTimezoneId(
    event.params.node.toHex(),
  )
  if (newNodeTimezoneId != null) {
    let newNodeTimezone = NetworkNodeTimezone.load(newNodeTimezoneId)
    if (newNodeTimezone === null || newNodeTimezone.id == null) {
      newNodeTimezone = rocketPoolEntityFactory.createNodeTimezone(
        newNodeTimezoneId,
      )
    }

    // Increment the total registered nodes for the new timezone and index.
    newNodeTimezone.totalRegisteredNodes = newNodeTimezone.totalRegisteredNodes.plus(
      BigInt.fromI32(1),
    )
    newNodeTimezone.save()
  }
}
